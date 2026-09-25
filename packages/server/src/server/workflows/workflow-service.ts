import { randomUUID } from "node:crypto";
import {
  compileWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionOverride,
} from "./definition-compiler.js";
import { scheduleWorkflow } from "./workflow-scheduler.js";
import type { StepAdapterRegistry } from "./step-adapter-registry.js";
import {
  type WorkflowApproval,
  type WorkflowRun,
  type WorkflowStepAttempt,
} from "./workflow-models.js";
import {
  type WorkflowScope,
  type WorkflowStore,
  type WorkflowStoreGetInput,
} from "./workflow-store.js";

export interface WorkflowServiceOptions {
  store: WorkflowStore;
  registry: StepAdapterRegistry;
  now?: () => number;
  createId?: (kind: "run" | "attempt" | "approval") => string;
}

export interface CreateWorkflowRunInput extends WorkflowScope {
  principalId: string;
  workspaceRoot: string;
  definition: WorkflowDefinition;
  repositoryOverride?: WorkflowDefinitionOverride;
  runtimeOverride?: WorkflowDefinitionOverride;
  promptRoot?: string;
  input?: Record<string, unknown>;
}

export interface WorkflowRunInput extends WorkflowStoreGetInput {}

export interface RetryWorkflowStepInput extends WorkflowRunInput {
  stepId: string;
}

export interface RespondWorkflowApprovalInput extends WorkflowRunInput {
  approvalId: string;
  approverId: string;
  decision: "approved" | "denied";
  denialReason?: string;
}

function terminalStatus(status: WorkflowRun["status"]): boolean {
  return ["succeeded", "failed", "cancelled", "blocked", "unknown"].includes(status);
}

function isActiveAttempt(status: WorkflowStepAttempt["status"]): boolean {
  return ["pending", "ready", "running", "retry_wait", "waiting_approval"].includes(status);
}

export class WorkflowService {
  private readonly now: () => number;
  private readonly createId: (kind: "run" | "attempt" | "approval") => string;

  constructor(private readonly options: WorkflowServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((kind) => `${kind}_${randomUUID().replaceAll("-", "")}`);
  }

  create(input: CreateWorkflowRunInput): WorkflowRun {
    const compiled = compileWorkflowDefinition({
      preset: input.definition,
      repositoryOverride: input.repositoryOverride,
      runtimeOverride: input.runtimeOverride,
      registry: this.options.registry,
      promptRoot: input.promptRoot,
    });
    const now = this.now();
    const run: WorkflowRun = {
      id: this.createId("run"),
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      definitionId: compiled.definition.id,
      definitionRevision: compiled.definition.revision,
      definitionHash: compiled.definitionHash,
      workspaceRoot: input.workspaceRoot,
      principalId: input.principalId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      stepAttempts: [],
      approvals: [],
      artifacts: [],
      runInput: (input.input ?? {}) as WorkflowRun["runInput"],
      resolvedDefinition: structuredClone(
        compiled.definition,
      ) as unknown as WorkflowRun["resolvedDefinition"],
      intents: [],
      receipts: [],
      leases: [],
      unknownOutcomes: [],
    };
    const firstStep = compiled.definition.steps[0];
    const requiresApproval = firstStep.approval === "required";
    const attempt = this.createAttempt(
      firstStep.id,
      firstStep.type,
      requiresApproval ? "waiting_approval" : "ready",
      input.input ?? {},
    );
    run.stepAttempts.push(attempt);
    if (requiresApproval) {
      run.approvals.push(this.createApproval(run, attempt));
      run.status = "waiting_approval";
    } else {
      run.status = "running";
    }
    return this.options.store.create(run);
  }

  list(scope: WorkflowScope): WorkflowRun[] {
    return this.options.store.list(scope);
  }

  inspect(input: WorkflowRunInput): WorkflowRun {
    return this.requireRun(input);
  }

  cancel(input: WorkflowRunInput): WorkflowRun {
    return this.options.store.update(input, (current) => {
      if (terminalStatus(current.status)) return current;
      const now = this.now();
      return {
        ...current,
        status: "cancelled",
        updatedAt: now,
        stepAttempts: current.stepAttempts.map((attempt) =>
          isActiveAttempt(attempt.status)
            ? { ...attempt, status: "cancelled" as const, completedAt: now }
            : attempt,
        ),
        approvals: current.approvals.map((approval) =>
          approval.status === "pending"
            ? {
                ...approval,
                status: "denied" as const,
                decidedAt: now,
                denialReason: "Run cancelled",
              }
            : approval,
        ),
      };
    });
  }

  resume(input: WorkflowRunInput): WorkflowRun {
    return this.options.store.update(input, (current) => {
      if (current.status !== "cancelled" && current.status !== "blocked") {
        throw new Error(`Workflow run cannot resume from status: ${current.status}`);
      }
      const now = this.now();
      return {
        ...current,
        status: "running",
        updatedAt: now,
        stepAttempts: current.stepAttempts.map((attempt) =>
          attempt.status === "cancelled" || attempt.status === "blocked"
            ? {
                ...attempt,
                status: "ready" as const,
                completedAt: undefined,
                failureClassification: undefined,
              }
            : attempt,
        ),
      };
    });
  }

  retry(input: RetryWorkflowStepInput): WorkflowRun {
    return this.options.store.update(input, (current) => {
      const previous = current.stepAttempts.findLast((attempt) => attempt.stepId === input.stepId);
      if (!previous) throw new Error(`Workflow step was not found: ${input.stepId}`);
      if (previous.status === "running") {
        throw new Error(`Cannot retry a running step: ${input.stepId}`);
      }
      const definition = this.requireDefinition(current);
      const step = definition.steps.find((candidate) => candidate.id === input.stepId);
      if (!step) throw new Error(`Workflow definition step was not found: ${input.stepId}`);
      const requiresApproval = step.approval === "required";
      const attempt = this.createAttempt(
        previous.stepId,
        previous.adapterType,
        requiresApproval ? "waiting_approval" : "ready",
        previous.input,
      );
      const next = {
        ...current,
        status: requiresApproval ? ("waiting_approval" as const) : ("running" as const),
        updatedAt: this.now(),
        stepAttempts: [...current.stepAttempts, attempt],
        approvals: [...current.approvals],
      };
      if (requiresApproval) next.approvals.push(this.createApproval(next, attempt));
      return next;
    });
  }

  respondApproval(input: RespondWorkflowApprovalInput): WorkflowRun {
    return this.options.store.update(input, (current) => {
      const approval = current.approvals.find((candidate) => candidate.id === input.approvalId);
      if (!approval) throw new Error(`Workflow approval was not found: ${input.approvalId}`);
      if (approval.status !== "pending") {
        throw new Error(`Workflow approval is not pending: ${input.approvalId}`);
      }
      if (current.status !== "waiting_approval") {
        throw new Error(`Workflow run is not waiting for approval: ${current.status}`);
      }
      const attempt = current.stepAttempts.find((candidate) => candidate.id === approval.attemptId);
      if (!attempt || attempt.status !== "waiting_approval") {
        throw new Error(`Workflow approval attempt is not waiting: ${approval.attemptId}`);
      }
      const now = this.now();
      if (approval.expiresAt <= now) {
        throw new Error(`Workflow approval is expired: ${input.approvalId}`);
      }
      const decidedApproval: WorkflowApproval = {
        ...approval,
        status: input.decision === "approved" ? "approved" : "denied",
        approverId: input.approverId,
        decidedAt: now,
        consumedAt: input.decision === "approved" ? now : undefined,
        denialReason: input.decision === "denied" ? input.denialReason : undefined,
      };
      const approvals = current.approvals.map((candidate) =>
        candidate.id === decidedApproval.id ? decidedApproval : candidate,
      );
      const stepAttempts = current.stepAttempts.map((candidate) =>
        candidate.id === approval.attemptId
          ? {
              ...candidate,
              status: input.decision === "approved" ? ("ready" as const) : ("failed" as const),
              completedAt: input.decision === "denied" ? now : undefined,
              failureClassification: input.decision === "denied" ? "approval_denied" : undefined,
            }
          : candidate,
      );
      return {
        ...current,
        approvals,
        stepAttempts,
        updatedAt: now,
        status: input.decision === "approved" ? "running" : "failed",
      };
    });
  }

  schedule(input: WorkflowRunInput): WorkflowRun {
    return this.options.store.update(
      input,
      (current) =>
        scheduleWorkflow(current, this.requireDefinition(current), this.now(), {
          registry: this.options.registry,
        }).run,
    );
  }

  async executeAttempt(input: {
    run: WorkflowRunInput;
    attemptId: string;
    principalPermissions: Set<import("../authorization/index.js").DaemonPermission>;
    executor: import("./step-executors.js").StepExecutor;
  }): Promise<WorkflowRun> {
    const current = this.requireRun(input.run);
    const attempt = current.stepAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) throw new Error(`Workflow step attempt was not found: ${input.attemptId}`);
    if (attempt.status !== "ready") {
      throw new Error(`Workflow step attempt is not ready: ${attempt.status}`);
    }
    const now = this.now();
    const adapter = this.options.registry.get(attempt.adapterType);
    if (!adapter) throw new Error(`Step adapter not registered: ${attempt.adapterType}`);
    for (const permission of adapter.requiredPermissions) {
      if (!input.principalPermissions.has(permission)) {
        return this.options.store.update(input.run, (run) => ({
          ...run,
          status: "failed",
          updatedAt: now,
          stepAttempts: run.stepAttempts.map((candidate) =>
            candidate.id === attempt.id
              ? {
                  ...candidate,
                  status: "failed" as const,
                  completedAt: now,
                  failureClassification: "permission_denied",
                }
              : candidate,
          ),
        }));
      }
    }
    const prepared = await input.executor.prepare({ run: current, attemptId: attempt.id, now });
    const persistedPrepared = this.options.store.update(input.run, () => prepared);
    const outcome = await input.executor.executePrepared({
      run: persistedPrepared,
      attemptId: attempt.id,
      now: this.now(),
    });
    this.options.store.update(input.run, (run) => input.executor.applyOutcome(run, outcome));
    return this.options.store.update(
      input.run,
      (run) =>
        scheduleWorkflow(run, this.requireDefinition(run), this.now(), {
          registry: this.options.registry,
        }).run,
    );
  }

  handlePluginUnload(pluginId: string, unregisteredTypes: string[]): void {
    const now = this.now();
    const typeSet = new Set(unregisteredTypes);
    const runs = this.options.store.list();
    for (const run of runs) {
      if (["running", "waiting_approval"].includes(run.status)) {
        const hasUnloaded = run.stepAttempts.some(
          (attempt) => isActiveAttempt(attempt.status) && typeSet.has(attempt.adapterType),
        );
        if (hasUnloaded) {
          this.options.store.update(
            { projectId: run.projectId, workspaceId: run.workspaceId, runId: run.id },
            (current) => ({
              ...current,
              status: "blocked",
              updatedAt: now,
              stepAttempts: current.stepAttempts.map((attempt) =>
                typeSet.has(attempt.adapterType) && isActiveAttempt(attempt.status)
                  ? {
                      ...attempt,
                      status: "blocked" as const,
                      failureClassification: "dependency_unavailable",
                      skipReason: `Plugin ${pluginId} contribution unavailable`,
                    }
                  : attempt,
              ),
            }),
          );
        }
      }
    }
  }

  private requireRun(input: WorkflowRunInput): WorkflowRun {
    const run = this.options.store.get(input);
    if (!run) throw new Error(`Workflow run was not found in scope: ${input.runId}`);
    return run;
  }

  private requireDefinition(run: WorkflowRun): WorkflowDefinition {
    return run.resolvedDefinition as WorkflowDefinition;
  }

  private createAttempt(
    stepId: string,
    adapterType: string,
    status: WorkflowStepAttempt["status"],
    input: Record<string, unknown>,
  ): WorkflowStepAttempt {
    return {
      id: this.createId("attempt"),
      stepId,
      adapterType,
      adapterVersion: this.options.registry.get(adapterType)?.version ?? "resolved",
      status,
      input: input as WorkflowStepAttempt["input"],
    };
  }

  private createApproval(run: WorkflowRun, attempt: WorkflowStepAttempt): WorkflowApproval {
    const now = this.now();
    return {
      id: this.createId("approval"),
      stepId: attempt.stepId,
      attemptId: attempt.id,
      status: "pending",
      requesterId: run.principalId,
      requestedAt: now,
      expiresAt: now + 15 * 60 * 1000,
      reason: `Approval required for ${attempt.adapterType}`,
    };
  }
}
