import type { WorkflowDefinition } from "./definition-compiler.js";
import { evaluateCondition } from "./definition-compiler.js";
import type { StepAdapterRegistry } from "./step-adapter-registry.js";
import type { WorkflowLease, WorkflowRun, WorkflowStepAttempt } from "./workflow-models.js";

export interface WorkflowScheduleOptions {
  registry?: StepAdapterRegistry;
  leaseHolder?: string;
  leaseTtlMs?: number;
}

export interface WorkflowScheduleResult {
  run: WorkflowRun;
  hasReadyStep: boolean;
}

function isTerminal(status: WorkflowStepAttempt["status"]): boolean {
  return ["succeeded", "skipped", "failed", "cancelled", "blocked", "unknown"].includes(status);
}

function isSuccessfulDependency(status: WorkflowStepAttempt["status"]): boolean {
  return status === "succeeded" || status === "skipped";
}

function outputsOf(run: WorkflowRun): Record<string, Record<string, unknown>> {
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const attempt of run.stepAttempts) {
    if (attempt.status === "succeeded" && attempt.declaredOutputs) {
      outputs[attempt.stepId] = attempt.declaredOutputs;
    }
  }
  return outputs;
}

function latestAttempt(run: WorkflowRun, stepId: string): WorkflowStepAttempt | undefined {
  return run.stepAttempts.findLast((attempt) => attempt.stepId === stepId);
}

function dependenciesComplete(run: WorkflowRun, dependsOn: string[]): boolean {
  return dependsOn.every((stepId) => {
    const attempt = latestAttempt(run, stepId);
    return attempt ? isSuccessfulDependency(attempt.status) : false;
  });
}

function resolveConflictKey(
  template: string,
  scope: { workspaceId: string; branch?: string },
): string {
  return template
    .replaceAll("{{workspaceId}}", scope.workspaceId)
    .replaceAll("{{branch}}", scope.branch ?? "main");
}

function collectActiveConflictKeys(
  attempts: WorkflowStepAttempt[],
  definition: WorkflowDefinition,
  workspaceId: string,
  registry?: StepAdapterRegistry,
): Set<string> {
  const activeKeys = new Set<string>();
  if (!registry) return activeKeys;

  for (const attempt of attempts) {
    if (isTerminal(attempt.status)) continue;
    const step = definition.steps.find((s) => s.id === attempt.stepId);
    if (!step) continue;
    const manifest = registry.get(step.type);
    if (manifest?.resourceConflictKey) {
      const branch = typeof attempt.input?.branch === "string" ? attempt.input.branch : undefined;
      activeKeys.add(resolveConflictKey(manifest.resourceConflictKey, { workspaceId, branch }));
    }
  }
  return activeKeys;
}

function hasResourceConflict(
  manifest: import("./step-adapter-registry.js").StepAdapterManifest | undefined,
  workspaceId: string,
  activeConflictKeys: Set<string>,
): boolean {
  if (!manifest?.resourceConflictKey) return false;
  const key = resolveConflictKey(manifest.resourceConflictKey, { workspaceId, branch: "main" });
  if (activeConflictKeys.has(key)) return true;
  activeConflictKeys.add(key);
  return false;
}

function resolveInitialStepInput(
  step: WorkflowDefinition["steps"][number],
  runInput?: Record<string, unknown>,
): Record<string, unknown> {
  const initial = step.input ? { ...step.input } : {};
  if ((step.dependsOn?.length ?? 0) === 0 && runInput) {
    Object.assign(initial, runInput);
  }
  return initial;
}

function evaluateStepCandidate(
  step: WorkflowDefinition["steps"][number],
  run: WorkflowRun,
  nextAttempts: WorkflowStepAttempt[],
  outputs: Record<string, Record<string, unknown>>,
  activeConflictKeys: Set<string>,
  now: number,
  options?: WorkflowScheduleOptions,
): WorkflowStepAttempt | null {
  if (step.when) {
    const condition = evaluateCondition(step.when, outputs);
    if (!condition.value) {
      return {
        id: `skip_${step.id}_${nextAttempts.length + 1}`,
        stepId: step.id,
        adapterType: step.type,
        adapterVersion: options?.registry?.get(step.type)?.version ?? "resolved",
        status: "skipped",
        input: {},
        startedAt: now,
        completedAt: now,
        skipReason: condition.skippedReason,
      };
    }
  }

  const manifest = options?.registry?.get(step.type);
  if (hasResourceConflict(manifest, run.workspaceId, activeConflictKeys)) {
    return null;
  }

  return {
    id: `attempt_${step.id}_${nextAttempts.length + 1}`,
    stepId: step.id,
    adapterType: step.type,
    adapterVersion: manifest?.version ?? "resolved",
    status: "ready",
    input: resolveInitialStepInput(
      step,
      run.runInput as Record<string, unknown> | undefined,
    ) as WorkflowStepAttempt["input"],
  };
}

function computeLeases(
  run: WorkflowRun,
  attempts: WorkflowStepAttempt[],
  now: number,
  options?: WorkflowScheduleOptions,
): WorkflowLease[] {
  if (!options?.leaseHolder) return run.leases ?? [];

  const activeLeases = (run.leases ?? []).filter((lease) => lease.expiresAt > now);
  const ttl = options.leaseTtlMs ?? 30_000;

  for (const attempt of attempts) {
    if (attempt.status !== "ready" && attempt.status !== "running") continue;
    if (!activeLeases.some((l) => l.attemptId === attempt.id)) {
      activeLeases.push({
        id: `lease_${attempt.id}_${now}`,
        stepId: attempt.stepId,
        attemptId: attempt.id,
        holder: options.leaseHolder,
        expiresAt: now + ttl,
      });
    }
  }
  return activeLeases;
}

function resolveRunStatus(
  currentStatus: WorkflowRun["status"],
  attempts: WorkflowStepAttempt[],
  definition: WorkflowDefinition,
  hasReadyStep: boolean,
): WorkflowRun["status"] {
  const latestAttempts = definition.steps.map((step) =>
    attempts.findLast((attempt) => attempt.stepId === step.id),
  );
  if (latestAttempts.some((attempt) => attempt?.status === "unknown")) return "unknown";
  if (latestAttempts.some((attempt) => attempt?.status === "blocked")) return "blocked";
  if (latestAttempts.some((attempt) => attempt?.status === "failed")) return "failed";
  if (latestAttempts.some((attempt) => attempt?.status === "cancelled")) return "cancelled";
  const allSuccessful = latestAttempts.every(
    (attempt) => attempt?.status === "succeeded" || attempt?.status === "skipped",
  );
  if (allSuccessful) return "succeeded";
  if (hasReadyStep || latestAttempts.some((attempt) => attempt?.status === "running")) {
    return "running";
  }
  return currentStatus;
}

export function scheduleWorkflow(
  run: WorkflowRun,
  definition: WorkflowDefinition,
  now: number,
  options?: WorkflowScheduleOptions,
): WorkflowScheduleResult {
  if (["cancelled", "succeeded", "failed", "blocked", "unknown"].includes(run.status)) {
    return { run, hasReadyStep: false };
  }

  const nextAttempts = [...run.stepAttempts];
  const outputs = outputsOf(run);
  const activeConflictKeys = collectActiveConflictKeys(
    nextAttempts,
    definition,
    run.workspaceId,
    options?.registry,
  );

  let activeConcurrency = nextAttempts.filter((a) => !isTerminal(a.status)).length;
  const maxConcurrency = definition.maxConcurrency ?? 16;

  for (const step of definition.steps) {
    const latest = latestAttempt({ ...run, stepAttempts: nextAttempts }, step.id);
    if (
      latest ||
      !dependenciesComplete({ ...run, stepAttempts: nextAttempts }, step.dependsOn ?? [])
    ) {
      continue;
    }
    if (activeConcurrency >= maxConcurrency) continue;

    const scheduled = evaluateStepCandidate(
      step,
      run,
      nextAttempts,
      outputs,
      activeConflictKeys,
      now,
      options,
    );
    if (scheduled) {
      nextAttempts.push(scheduled);
      if (scheduled.status === "ready") activeConcurrency += 1;
    }
  }

  const hasReadyStep = nextAttempts.some((a) => a.status === "ready");
  const leases = computeLeases(run, nextAttempts, now, options);
  const status = resolveRunStatus(run.status, nextAttempts, definition, hasReadyStep);

  return {
    run: { ...run, status, updatedAt: now, stepAttempts: nextAttempts, leases },
    hasReadyStep,
  };
}
