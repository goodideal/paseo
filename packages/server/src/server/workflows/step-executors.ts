import { createHash, randomUUID } from "node:crypto";
import type { RegisteredStepAdapter, StepAdapterRegistry } from "./step-adapter-registry.js";
import type { VerificationProfile, VerificationProfileRegistry } from "./verification-profiles.js";
import type {
  WorkflowIntent,
  WorkflowReceipt,
  WorkflowRun,
  WorkflowStepAttempt,
  WorkflowUnknownOutcome,
} from "./workflow-models.js";

export interface StepExecutorHost {
  createWorktree?(params: {
    workspaceId: string;
    workspaceRoot: string;
    branch: string;
  }): Promise<{ worktreePath: string; branch?: string }>;
  checkWorktreeExists?(params: {
    workspaceId: string;
    workspaceRoot: string;
    branch: string;
  }): Promise<{ worktreePath: string } | null>;
  dispatchAgent?(params: {
    cwd: string;
    promptId: string;
    provider?: string;
  }): Promise<{ agentId: string; sessionId: string; resumable: boolean }>;
  runVerification?(params: {
    profile: VerificationProfile;
    cwd: string;
  }): Promise<{ passed: boolean; report?: string }>;
  gitPush?(params: {
    cwd: string;
    remote: string;
    branch: string;
  }): Promise<{ success: boolean; commitSha: string }>;
  createPullRequest?(params: {
    cwd: string;
    title: string;
    baseBranch: string;
    branch: string;
  }): Promise<{ prUrl: string; prNumber: number }>;
  findPullRequest?(params: {
    cwd: string;
    branch: string;
  }): Promise<{ prUrl: string; prNumber: number } | null>;
  executePluginAdapter?(params: {
    pluginId: string;
    adapterType: string;
    input: Record<string, unknown>;
    run: WorkflowRun;
  }): Promise<Record<string, unknown>>;
}

export interface StepExecutionInput {
  run: WorkflowRun;
  stepId: string;
  attemptId: string;
  input: Record<string, unknown>;
  principalPermissions: Set<import("../authorization/index.js").DaemonPermission>;
  now: number;
  findingSeverity?: "P0" | "P1" | "P2" | "P3";
}

export interface StepExecutionResult {
  run: WorkflowRun;
  status: WorkflowStepAttempt["status"];
  declaredOutputs?: Record<string, unknown>;
  error?: string;
}

export interface PreparedStepExecutionInput {
  run: WorkflowRun;
  attemptId: string;
  now: number;
}

export interface StepExecutionOutcome {
  attemptId: string;
  status: "succeeded" | "failed" | "unknown";
  completedAt: number;
  declaredOutputs?: WorkflowStepAttempt["declaredOutputs"];
  receipt?: WorkflowReceipt;
  unknownOutcome?: WorkflowUnknownOutcome;
  failureClassification?: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function requireJsonRecord(value: unknown): WorkflowStepAttempt["declaredOutputs"] {
  return value as WorkflowStepAttempt["declaredOutputs"];
}

export class StepExecutor {
  constructor(
    private readonly registry: StepAdapterRegistry,
    private readonly profileRegistry: VerificationProfileRegistry,
    private readonly host: StepExecutorHost,
  ) {}

  async execute(input: StepExecutionInput): Promise<StepExecutionResult> {
    const attempt = input.run.stepAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) throw new Error(`Workflow step attempt was not found: ${input.attemptId}`);
    const adapter = this.requireAdapter(attempt.adapterType);
    for (const permission of adapter.requiredPermissions) {
      if (!input.principalPermissions.has(permission)) {
        const run = {
          ...input.run,
          status: "failed" as const,
          updatedAt: input.now,
          stepAttempts: input.run.stepAttempts.map((candidate) =>
            candidate.id === attempt.id
              ? {
                  ...candidate,
                  status: "failed" as const,
                  completedAt: input.now,
                  failureClassification: "permission_denied",
                }
              : candidate,
          ),
        };
        return {
          run,
          status: "failed",
          error: `Principal lacks required permission: ${permission}`,
        };
      }
    }
    const approved = input.run.approvals.some(
      (approval) =>
        approval.attemptId === attempt.id &&
        approval.status === "approved" &&
        approval.consumedAt !== undefined,
    );
    if (adapter.executionRisk === "external_write" && !approved) {
      const approval = input.run.approvals.find(
        (candidate) => candidate.attemptId === attempt.id && candidate.status === "pending",
      ) ?? {
        id: `approval_${attempt.id}_${input.now}`,
        stepId: attempt.stepId,
        attemptId: attempt.id,
        status: "pending" as const,
        requesterId: input.run.principalId,
        requestedAt: input.now,
        expiresAt: input.now + 15 * 60 * 1000,
        reason:
          input.findingSeverity === "P0"
            ? `[P0 High Priority] External action requires approval: ${adapter.type}`
            : `External action requires approval: ${adapter.type}`,
      };
      const run = {
        ...input.run,
        status: "waiting_approval" as const,
        updatedAt: input.now,
        approvals: input.run.approvals.some((candidate) => candidate.id === approval.id)
          ? input.run.approvals
          : [...input.run.approvals, approval],
        stepAttempts: input.run.stepAttempts.map((candidate) =>
          candidate.id === attempt.id
            ? {
                ...candidate,
                status: "waiting_approval" as const,
                input: input.input as WorkflowStepAttempt["input"],
              }
            : candidate,
        ),
      };
      return { run, status: "waiting_approval" };
    }
    const readyRun: WorkflowRun = {
      ...input.run,
      stepAttempts: input.run.stepAttempts.map((candidate) =>
        candidate.id === attempt.id
          ? {
              ...candidate,
              status: "ready" as const,
              input: input.input as WorkflowStepAttempt["input"],
            }
          : candidate,
      ),
    };
    const prepared = this.prepare({ run: readyRun, attemptId: attempt.id, now: input.now });
    const outcome = await this.executePrepared({
      run: prepared,
      attemptId: attempt.id,
      now: input.now,
    });
    const run = this.applyOutcome(prepared, outcome);
    return {
      run,
      status: outcome.status,
      declaredOutputs: outcome.declaredOutputs,
      ...(outcome.failureClassification ? { error: outcome.failureClassification } : {}),
    };
  }

  prepare(input: PreparedStepExecutionInput): WorkflowRun {
    const attempt = input.run.stepAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) throw new Error(`Workflow step attempt was not found: ${input.attemptId}`);
    if (attempt.status !== "ready") {
      throw new Error(`Workflow step attempt is not ready: ${attempt.status}`);
    }
    const adapter = this.requireAdapter(attempt.adapterType);
    const parsedInput = adapter.inputSchema.parse(attempt.input) as Record<string, unknown>;
    let intent = input.run.intents.find((candidate) => candidate.attemptId === attempt.id);
    const intents = [...input.run.intents];
    if (
      !intent &&
      (adapter.idempotency === "required" || adapter.executionRisk === "external_write")
    ) {
      intent = this.createIntent(input.run, attempt, parsedInput, input.now);
      intents.push(intent);
    }
    return {
      ...input.run,
      intents,
      updatedAt: input.now,
      stepAttempts: input.run.stepAttempts.map((candidate) =>
        candidate.id === attempt.id
          ? {
              ...candidate,
              status: "running" as const,
              input: parsedInput as WorkflowStepAttempt["input"],
              idempotencyKey: intent?.idempotencyKey,
              startedAt: candidate.startedAt ?? input.now,
            }
          : candidate,
      ),
    };
  }

  async executePrepared(input: PreparedStepExecutionInput): Promise<StepExecutionOutcome> {
    const attempt = input.run.stepAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) throw new Error(`Workflow step attempt was not found: ${input.attemptId}`);
    if (attempt.status !== "running") {
      throw new Error(`Workflow step attempt is not running: ${attempt.status}`);
    }
    const adapter = this.requireAdapter(attempt.adapterType);
    const intent = input.run.intents.find((candidate) => candidate.attemptId === attempt.id);
    try {
      const rawOutput = await this.executeAdapter(adapter, attempt.input, input.run);
      const output = adapter.outputSchema.parse(rawOutput);
      return {
        attemptId: attempt.id,
        status: "succeeded",
        completedAt: input.now,
        declaredOutputs: requireJsonRecord(output),
        ...(intent
          ? {
              receipt: {
                id: `receipt_${attempt.stepId}_${input.now}_${randomUUID().replaceAll("-", "")}`,
                intentId: intent.id,
                stepId: attempt.stepId,
                attemptId: attempt.id,
                outputDigest: sha256(JSON.stringify(output)),
                createdAt: input.now,
              },
            }
          : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (intent && adapter.executionRisk === "external_write") {
        return {
          attemptId: attempt.id,
          status: "unknown",
          completedAt: input.now,
          failureClassification: "unknown_outcome",
          unknownOutcome: {
            id: `unknown_${attempt.stepId}_${input.now}_${randomUUID().replaceAll("-", "")}`,
            stepId: attempt.stepId,
            attemptId: attempt.id,
            intentId: intent.id,
            recordedAt: input.now,
            reason: `External execution failed ambiguously: ${message}`,
          },
        };
      }
      return {
        attemptId: attempt.id,
        status: "failed",
        completedAt: input.now,
        failureClassification: message,
      };
    }
  }

  applyOutcome(run: WorkflowRun, outcome: StepExecutionOutcome): WorkflowRun {
    const receipts = outcome.receipt ? [...run.receipts, outcome.receipt] : run.receipts;
    const unknownOutcomes = outcome.unknownOutcome
      ? [...run.unknownOutcomes, outcome.unknownOutcome]
      : run.unknownOutcomes;
    return {
      ...run,
      receipts,
      unknownOutcomes,
      updatedAt: outcome.completedAt,
      status: outcome.status === "unknown" ? "unknown" : run.status,
      stepAttempts: run.stepAttempts.map((attempt) =>
        attempt.id === outcome.attemptId
          ? {
              ...attempt,
              status: outcome.status,
              completedAt: outcome.completedAt,
              declaredOutputs: outcome.declaredOutputs,
              failureClassification: outcome.failureClassification,
            }
          : attempt,
      ),
    };
  }

  private requireAdapter(type: string): RegisteredStepAdapter {
    const adapter = this.registry.get(type);
    if (!adapter) throw new Error(`Step adapter not registered: ${type}`);
    return adapter;
  }

  private createIntent(
    run: WorkflowRun,
    attempt: WorkflowStepAttempt,
    input: Record<string, unknown>,
    now: number,
  ): WorkflowIntent {
    return {
      id: `intent_${attempt.stepId}_${attempt.id}`,
      stepId: attempt.stepId,
      attemptId: attempt.id,
      idempotencyKey: sha256(`${run.id}:${attempt.stepId}:${attempt.id}`),
      inputDigest: sha256(JSON.stringify(input)),
      createdAt: now,
    };
  }

  private async executeAdapter(
    adapter: RegisteredStepAdapter,
    input: Record<string, unknown>,
    run: WorkflowRun,
  ): Promise<Record<string, unknown>> {
    if (adapter.owner.kind === "plugin") {
      if (!this.host.executePluginAdapter) {
        throw new Error(`Plugin adapter execution is unavailable: ${adapter.type}`);
      }
      return this.host.executePluginAdapter({
        pluginId: adapter.owner.pluginId,
        adapterType: adapter.type,
        input,
        run,
      });
    }
    switch (adapter.type) {
      case "worktree.create":
        return this.executeWorktree(input, run);
      case "agent.dispatch":
      case "review.agent":
        return this.executeAgent(input, run.workspaceRoot);
      case "verify.command":
        return this.executeVerify(input, run.workspaceRoot);
      case "approval.wait":
        return { approved: true };
      case "git.push":
        return this.executePush(input, run.workspaceRoot);
      case "git.create_pr":
        return this.executePr(input, run.workspaceRoot);
      default:
        throw new Error(`Core adapter execution is unavailable: ${adapter.type}`);
    }
  }

  private async executeWorktree(
    input: Record<string, unknown>,
    run: WorkflowRun,
  ): Promise<Record<string, unknown>> {
    const branch = typeof input.branch === "string" ? input.branch : `workflow-${run.id}`;
    const existing = await this.host.checkWorktreeExists?.({
      workspaceId: run.workspaceId,
      workspaceRoot: run.workspaceRoot,
      branch,
    });
    if (existing) return { worktreePath: existing.worktreePath, branch };
    if (!this.host.createWorktree) throw new Error("Worktree adapter host is unavailable");
    const created = await this.host.createWorktree({
      workspaceId: run.workspaceId,
      workspaceRoot: run.workspaceRoot,
      branch,
    });
    return { worktreePath: created.worktreePath, branch: created.branch ?? branch };
  }

  private async executeAgent(
    input: Record<string, unknown>,
    cwd: string,
  ): Promise<Record<string, unknown>> {
    if (!this.host.dispatchAgent) throw new Error("Agent adapter host is unavailable");
    const promptId = typeof input.promptId === "string" ? input.promptId : "workflow";
    const provider = typeof input.provider === "string" ? input.provider : undefined;
    return this.host.dispatchAgent({ cwd, promptId, provider });
  }

  private async executeVerify(
    input: Record<string, unknown>,
    cwd: string,
  ): Promise<Record<string, unknown>> {
    const profileName =
      typeof input.verificationProfile === "string" ? input.verificationProfile : "";
    const profile = this.profileRegistry.get(profileName);
    if (!profile) throw new Error(`Unregistered verification profile: ${profileName}`);
    if (!this.host.runVerification) throw new Error("Verification adapter host is unavailable");
    const result = await this.host.runVerification({ profile, cwd });
    return { passed: result.passed, report: result.report ?? "" };
  }

  private async executePush(
    input: Record<string, unknown>,
    cwd: string,
  ): Promise<Record<string, unknown>> {
    if (!this.host.gitPush) throw new Error("Git push adapter host is unavailable");
    const remote = typeof input.remote === "string" ? input.remote : "origin";
    const branch = typeof input.branch === "string" ? input.branch : "HEAD";
    return this.host.gitPush({ cwd, remote, branch });
  }

  private async executePr(
    input: Record<string, unknown>,
    cwd: string,
  ): Promise<Record<string, unknown>> {
    const branch = typeof input.branch === "string" ? input.branch : "HEAD";
    const existing = await this.host.findPullRequest?.({ cwd, branch });
    if (existing) return { url: existing.prUrl, prNumber: existing.prNumber };
    if (!this.host.createPullRequest) throw new Error("Create PR adapter host is unavailable");
    const title = typeof input.title === "string" ? input.title : "Automated workflow change";
    const baseBranch = typeof input.baseBranch === "string" ? input.baseBranch : "main";
    const created = await this.host.createPullRequest({ cwd, title, baseBranch, branch });
    return { url: created.prUrl, prNumber: created.prNumber };
  }
}
