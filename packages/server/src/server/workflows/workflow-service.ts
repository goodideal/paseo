import { createHash, randomUUID } from "node:crypto";
import {
  compileWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionOverride,
} from "./definition-compiler.js";
import { scheduleWorkflow } from "./workflow-scheduler.js";
import type { StepAdapterRegistry } from "./step-adapter-registry.js";
import {
  type WorkflowApproval,
  type WorkflowArtifact,
  type WorkflowInteraction,
  WorkflowInteractionSchema,
  type WorkflowRun,
  type WorkflowStepAttempt,
} from "./workflow-models.js";
import {
  type WorkflowScope,
  type WorkflowStore,
  type WorkflowStoreGetInput,
} from "./workflow-store.js";

export type WorkflowEntityKind = "run" | "attempt" | "approval" | "interaction" | "artifact";

export interface WorkflowServiceOptions {
  store: WorkflowStore;
  registry: StepAdapterRegistry;
  now?: () => number;
  createId?: (kind: WorkflowEntityKind) => string;
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

export interface CreateWorkflowInteractionInput extends WorkflowRunInput {
  interactionId?: string;
  stepId: string;
  promptArtifactId: string;
}

export interface RespondWorkflowInteractionInput extends WorkflowRunInput {
  interactionId: string;
  responderId: string;
  answer: string;
}

export interface ExpireWorkflowInteractionInput extends WorkflowRunInput {
  interactionId: string;
}

export class WorkflowInteractionStateError extends Error {
  constructor(
    public readonly interactionId: string,
    public readonly status?: string,
    message?: string,
  ) {
    super(
      message ??
        (status === "answered"
          ? `Workflow interaction is already answered: ${interactionId}`
          : `Workflow interaction is not pending: ${interactionId} (${status ?? "not found"})`),
    );
    this.name = "WorkflowInteractionStateError";
  }
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
      "[redacted private key]",
    )
    .replace(/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g, "[redacted]")
    .replace(/\bsk-(?:ant|live|proj)?[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(
      /\b(api[_-]?key|password|token|secret)\s*[:=]\s*["']?[^\s"'\n]+["']?/gi,
      "$1: [redacted]",
    );
}

function terminalStatus(status: WorkflowRun["status"]): boolean {
  return ["succeeded", "failed", "cancelled", "blocked", "unknown"].includes(status);
}

function isActiveAttempt(status: WorkflowStepAttempt["status"]): boolean {
  return ["pending", "ready", "running", "retry_wait", "waiting_approval"].includes(status);
}

export class WorkflowService {
  private readonly now: () => number;
  private readonly createId: (kind: WorkflowEntityKind) => string;

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
      interactions: [],
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
        interactions: current.interactions.map((interaction) =>
          interaction.status === "pending"
            ? { ...interaction, status: "cancelled" as const }
            : interaction,
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

  async createInteraction(input: CreateWorkflowInteractionInput): Promise<WorkflowRun> {
    const run = this.requireRun(input);
    if (terminalStatus(run.status)) {
      throw new Error(`Cannot create interaction for terminal run status: ${run.status}`);
    }
    const interactionId = input.interactionId ?? this.createId("interaction");
    const now = this.now();
    const interaction: WorkflowInteraction = {
      id: interactionId,
      runId: run.id,
      stepId: input.stepId,
      status: "pending",
      promptArtifactId: input.promptArtifactId,
      requestedAt: now,
    };
    WorkflowInteractionSchema.parse(interaction);

    return this.options.store.update(input, (current) => {
      const existing = current.interactions.find(
        (item) =>
          item.id === interactionId || (item.stepId === input.stepId && item.status === "pending"),
      );
      if (existing) {
        throw new WorkflowInteractionStateError(
          existing.id,
          existing.status,
          `Workflow interaction already exists for step: ${input.stepId}`,
        );
      }
      return {
        ...current,
        updatedAt: now,
        interactions: [...current.interactions, interaction],
      };
    });
  }

  async respondInteraction(input: RespondWorkflowInteractionInput): Promise<WorkflowRun> {
    const run = this.requireRun(input);
    const interaction = run.interactions.find((item) => item.id === input.interactionId);
    if (!interaction || interaction.status !== "pending") {
      throw new WorkflowInteractionStateError(input.interactionId, interaction?.status);
    }
    if (terminalStatus(run.status)) {
      throw new WorkflowInteractionStateError(
        input.interactionId,
        run.status,
        `Workflow run cannot respond to interaction in terminal status: ${run.status}`,
      );
    }
    if (!input.answer || input.answer.trim().length === 0) {
      throw new Error("Workflow interaction answer cannot be empty");
    }
    return this.options.store.update(input, (current) => {
      const currentInteraction = current.interactions.find(
        (item) => item.id === input.interactionId,
      );
      if (!currentInteraction || currentInteraction.status !== "pending") {
        throw new WorkflowInteractionStateError(input.interactionId, currentInteraction?.status);
      }
      const answerArtifact = this.createRedactedTextArtifact(current, input.answer);
      const withAnswer = this.answerInteraction(
        current,
        currentInteraction.id,
        input.responderId,
        answerArtifact,
      );
      return scheduleWorkflow(withAnswer, this.requireDefinition(withAnswer), this.now(), {
        registry: this.options.registry,
      }).run;
    });
  }

  async expireInteraction(input: ExpireWorkflowInteractionInput): Promise<WorkflowRun> {
    const run = this.requireRun(input);
    const interaction = run.interactions.find((item) => item.id === input.interactionId);
    if (!interaction || interaction.status !== "pending") {
      throw new WorkflowInteractionStateError(input.interactionId, interaction?.status);
    }
    return this.options.store.update(input, (current) => {
      const currentInteraction = current.interactions.find(
        (item) => item.id === input.interactionId,
      );
      if (!currentInteraction || currentInteraction.status !== "pending") {
        throw new WorkflowInteractionStateError(input.interactionId, currentInteraction?.status);
      }
      const now = this.now();
      const updatedRun: WorkflowRun = {
        ...current,
        updatedAt: now,
        interactions: current.interactions.map((item) =>
          item.id === input.interactionId ? { ...item, status: "expired" as const } : item,
        ),
      };
      return scheduleWorkflow(updatedRun, this.requireDefinition(updatedRun), now, {
        registry: this.options.registry,
      }).run;
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
              interactions: current.interactions.map((interaction) => {
                const attempt = current.stepAttempts.find(
                  (a) => a.stepId === interaction.stepId && isActiveAttempt(a.status),
                );
                if (
                  interaction.status === "pending" &&
                  attempt &&
                  typeSet.has(attempt.adapterType)
                ) {
                  return { ...interaction, status: "cancelled" as const };
                }
                return interaction;
              }),
            }),
          );
        }
      }
    }
  }

  private createRedactedTextArtifact(run: WorkflowRun, answer: string): WorkflowArtifact {
    const redactedText = redactSensitiveText(answer);
    const contentHash = createHash("sha256").update(redactedText, "utf8").digest("hex");
    const id = this.createId("artifact");
    const now = this.now();
    return {
      id,
      kind: "interaction_answer",
      path: `artifacts/${run.id}/${id}.txt`,
      contentHash,
      bytes: Buffer.byteLength(redactedText, "utf8"),
      redacted: true,
      createdAt: now,
    };
  }

  private answerInteraction(
    run: WorkflowRun,
    interactionId: string,
    responderId: string,
    answerArtifact: WorkflowArtifact,
  ): WorkflowRun {
    const now = this.now();
    return {
      ...run,
      updatedAt: now,
      artifacts: [...run.artifacts, answerArtifact],
      interactions: run.interactions.map((interaction) =>
        interaction.id === interactionId
          ? {
              ...interaction,
              status: "answered" as const,
              answerArtifactId: answerArtifact.id,
              answeredAt: now,
              responderId,
            }
          : interaction,
      ),
    };
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
