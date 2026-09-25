import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { WorkflowPresetRegistry } from "../../workflows/workflow-preset-registry.js";
import type { WorkflowRun } from "../../workflows/workflow-models.js";
import type { WorkflowService } from "../../workflows/workflow-service.js";
import type { StepExecutor } from "../../workflows/step-executors.js";
import type { DaemonPermission } from "../../authorization/index.js";

interface WorkflowSessionHost {
  emit(message: SessionOutboundMessage): void;
}

interface WorkflowWorkspace {
  cwd: string;
}

export interface WorkflowSessionOptions {
  host: WorkflowSessionHost;
  workflowService: WorkflowService;
  presets: WorkflowPresetRegistry;
  principalId: string;
  permissions: readonly DaemonPermission[];
  executor?: StepExecutor;
  resolveWorkspace(scope: {
    projectId: string;
    workspaceId: string;
  }): Promise<WorkflowWorkspace | null>;
  logger: pino.Logger;
}

type WorkflowRequest = Extract<SessionInboundMessage, { type: `workflow.${string}` }>;

function toIso(timestamp: number | undefined): string | null {
  return timestamp === undefined ? null : new Date(timestamp).toISOString();
}

function toExecutionRisk(
  run: WorkflowRun,
): "observe" | "workspace_write" | "external_side_effect" | "privileged" {
  const step = run.stepAttempts.at(-1);
  if (!step) return "observe";
  if (step.adapterType.startsWith("git.")) return "external_side_effect";
  if (step.adapterType === "verify.command" || step.adapterType === "approval.wait")
    return "observe";
  return "workspace_write";
}

function toRunSummary(run: WorkflowRun, sourcePreset: string = run.definitionId) {
  const current = run.stepAttempts.findLast((attempt) =>
    ["pending", "ready", "running", "retry_wait", "waiting_approval"].includes(attempt.status),
  );
  return {
    projectId: run.projectId,
    workspaceId: run.workspaceId,
    runId: run.id,
    workflowId: run.definitionId,
    name: run.definitionId,
    sourcePreset,
    definitionRevision: run.definitionRevision,
    definitionHash: run.definitionHash,
    status: run.status,
    currentStepId: current?.stepId ?? null,
    executionRisk: toExecutionRisk(run),
    createdAt: new Date(run.createdAt).toISOString(),
    updatedAt: new Date(run.updatedAt).toISOString(),
    completedAt: ["succeeded", "failed", "cancelled", "blocked", "unknown"].includes(run.status)
      ? new Date(run.updatedAt).toISOString()
      : null,
  };
}

function toRunDetail(run: WorkflowRun, sourcePreset?: string) {
  return {
    ...toRunSummary(run, sourcePreset),
    stepAttempts: run.stepAttempts.map((attempt, index) => ({
      stepId: attempt.stepId,
      attempt: index + 1,
      status: attempt.status,
      startedAt: toIso(attempt.startedAt),
      completedAt: toIso(attempt.completedAt),
      skipReason: attempt.skipReason ?? null,
      failureReason: attempt.failureClassification ?? null,
    })),
  };
}

function toApproval(run: WorkflowRun, approval: WorkflowRun["approvals"][number]) {
  const attempt = run.stepAttempts.find((candidate) => candidate.id === approval.attemptId);
  return {
    projectId: run.projectId,
    workspaceId: run.workspaceId,
    approvalId: approval.id,
    runId: run.id,
    stepId: approval.stepId,
    status: approval.status,
    action: attempt?.adapterType ?? approval.stepId,
    target: run.workspaceRoot,
    policyReason: approval.reason,
    createdAt: new Date(approval.requestedAt).toISOString(),
    decidedAt: toIso(approval.decidedAt),
    reason: approval.denialReason ?? null,
  };
}

function toArtifact(run: WorkflowRun, artifact: WorkflowRun["artifacts"][number]) {
  return {
    projectId: run.projectId,
    workspaceId: run.workspaceId,
    artifactId: artifact.id,
    runId: run.id,
    stepId: null,
    kind: artifact.kind,
    name: artifact.path.split("/").at(-1) ?? artifact.id,
    contentType: "application/json",
    sizeBytes: artifact.bytes,
    createdAt: new Date(artifact.createdAt).toISOString(),
  };
}

export class WorkflowSession {
  constructor(private readonly options: WorkflowSessionOptions) {}

  async handle(request: WorkflowRequest): Promise<void> {
    try {
      await this.handleRequest(request);
    } catch (error) {
      this.options.logger.warn(
        { err: error, requestType: request.type },
        "Workflow request failed",
      );
      this.emitError(request, error);
    }
  }

  private handleDefinitionRequest(request: WorkflowRequest): void {
    if (request.type === "workflow.definition.list.request") {
      this.options.host.emit({
        type: "workflow.definition.list.response",
        payload: {
          ...this.responseScope(request),
          definitions: this.options.presets.list(),
          error: null,
        },
      });
      return;
    }

    if (request.type === "workflow.definition.inspect.request") {
      const definition = this.options.presets.inspect(request.workflowId);
      this.options.host.emit({
        type: "workflow.definition.inspect.response",
        payload: {
          ...this.responseScope(request),
          definition: definition ?? null,
          error: definition ? null : `Unknown workflow preset: ${request.workflowId}`,
        },
      });
    }
  }

  private async handleRunRequest(request: WorkflowRequest): Promise<void> {
    if (request.type === "workflow.run.create.request") {
      await this.createRun(request);
      return;
    }

    if (request.type === "workflow.run.list.request") {
      const runs = this.options.workflowService
        .list(request)
        .filter((run) => request.status === undefined || run.status === request.status)
        .map((run) => toRunSummary(run, this.options.presets.get(run.definitionId)?.sourcePreset));
      this.options.host.emit({
        type: "workflow.run.list.response",
        payload: { ...this.responseScope(request), runs, error: null },
      });
      return;
    }

    if (request.type === "workflow.run.inspect.request") {
      const run = this.options.workflowService.inspect(request);
      this.options.host.emit({
        type: "workflow.run.inspect.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          run: toRunDetail(run, this.options.presets.get(run.definitionId)?.sourcePreset),
          error: null,
        },
      });
      return;
    }

    if (request.type === "workflow.run.cancel.request") {
      const run = this.options.workflowService.cancel(request);
      this.options.host.emit({
        type: "workflow.run.cancel.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          run: toRunSummary(run, this.options.presets.get(run.definitionId)?.sourcePreset),
          error: null,
        },
      });
      return;
    }

    if (request.type === "workflow.run.retry.request") {
      const run = this.options.workflowService.retry(request);
      this.options.host.emit({
        type: "workflow.run.retry.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          run: toRunSummary(run, this.options.presets.get(run.definitionId)?.sourcePreset),
          error: null,
        },
      });
      return;
    }

    if (request.type === "workflow.run.resume.request") {
      const run = this.options.workflowService.resume(request);
      this.options.host.emit({
        type: "workflow.run.resume.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          run: toRunSummary(run, this.options.presets.get(run.definitionId)?.sourcePreset),
          error: null,
        },
      });
    }
  }

  private handleApprovalRequest(request: WorkflowRequest): void {
    if (request.type === "workflow.approval.list.request") {
      let approvals: ReturnType<typeof toApproval>[] = [];
      if (request.runId) {
        const run = this.options.workflowService.inspect({
          projectId: request.projectId,
          workspaceId: request.workspaceId,
          runId: request.runId,
        });
        approvals = run.approvals.map((approval) => toApproval(run, approval));
      } else {
        const runs = this.options.workflowService.list(request);
        approvals = runs.flatMap((run) =>
          run.approvals.map((approval) => toApproval(run, approval)),
        );
      }
      this.options.host.emit({
        type: "workflow.approval.list.response",
        payload: {
          ...this.responseScope(request),
          runId: request.runId ?? null,
          approvals,
          error: null,
        },
      });
      return;
    }

    if (
      request.type === "workflow.approval.approve.request" ||
      request.type === "workflow.approval.deny.request"
    ) {
      const run = this.options.workflowService.respondApproval({
        ...request,
        approverId: this.options.principalId,
        decision: request.type === "workflow.approval.approve.request" ? "approved" : "denied",
        denialReason:
          request.type === "workflow.approval.deny.request" ? request.reason : undefined,
      });
      const approval = run.approvals.find((candidate) => candidate.id === request.approvalId);
      if (request.type === "workflow.approval.approve.request") {
        this.kickRun(run);
      }
      this.options.host.emit({
        type:
          request.type === "workflow.approval.approve.request"
            ? "workflow.approval.approve.response"
            : "workflow.approval.deny.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          approval: approval ? toApproval(run, approval) : null,
          run: toRunSummary(run, this.options.presets.get(run.definitionId)?.sourcePreset),
          error: null,
        },
      });
    }
  }

  private handleArtifactRequest(request: WorkflowRequest): void {
    if (request.type === "workflow.artifact.list.request") {
      const run = this.options.workflowService.inspect(request);
      this.options.host.emit({
        type: "workflow.artifact.list.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          artifacts: run.artifacts.map((artifact) => toArtifact(run, artifact)),
          error: null,
        },
      });
      return;
    }

    if (request.type === "workflow.artifact.get.request") {
      const run = this.options.workflowService.inspect(request);
      const artifact = run.artifacts.find((candidate) => candidate.id === request.artifactId);
      this.options.host.emit({
        type: "workflow.artifact.get.response",
        payload: {
          ...this.responseScope(request),
          runId: run.id,
          artifact: artifact ? toArtifact(run, artifact) : null,
          content: null,
          error: artifact ? null : `Workflow artifact was not found: ${request.artifactId}`,
        },
      });
    }
  }

  private async handleRequest(request: WorkflowRequest): Promise<void> {
    if (request.type.startsWith("workflow.definition.")) {
      this.handleDefinitionRequest(request);
      return;
    }
    if (request.type.startsWith("workflow.run.")) {
      await this.handleRunRequest(request);
      return;
    }
    if (request.type.startsWith("workflow.approval.")) {
      this.handleApprovalRequest(request);
      return;
    }
    if (request.type.startsWith("workflow.artifact.")) {
      this.handleArtifactRequest(request);
    }
  }

  private async createRun(
    request: Extract<WorkflowRequest, { type: "workflow.run.create.request" }>,
  ): Promise<void> {
    const preset = this.options.presets.get(request.workflowId);
    if (!preset) {
      this.options.host.emit({
        type: "workflow.run.create.response",
        payload: {
          ...this.responseScope(request),
          run: null,
          error: `Unknown workflow preset: ${request.workflowId}`,
        },
      });
      return;
    }
    const workspace = await this.options.resolveWorkspace(request);
    if (!workspace) throw new Error(`Workspace was not found in scope: ${request.workspaceId}`);
    const run = this.options.workflowService.create({
      ...request,
      principalId: this.options.principalId,
      workspaceRoot: workspace.cwd,
      definition: preset.definition,
    });
    this.options.host.emit({
      type: "workflow.run.create.response",
      payload: {
        ...this.responseScope(request),
        runId: run.id,
        run: toRunSummary(run, this.options.presets.get(run.definitionId)?.sourcePreset),
        error: null,
      },
    });
    this.kickRun(run);
  }

  private kickRun(run: WorkflowRun): void {
    if (!this.options.executor || run.status !== "running") return;
    void this.driveRun({
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runId: run.id,
    }).catch((error) =>
      this.options.logger.error({ err: error, runId: run.id }, "Workflow execution failed"),
    );
  }

  private async driveRun(input: {
    projectId: string;
    workspaceId: string;
    runId: string;
  }): Promise<void> {
    if (!this.options.executor) return;
    let run = this.options.workflowService.inspect(input);
    while (run.status === "running") {
      const ready = run.stepAttempts.find((attempt) => attempt.status === "ready");
      if (!ready) {
        run = this.options.workflowService.schedule(input);
        const scheduled = run.stepAttempts.find((attempt) => attempt.status === "ready");
        if (!scheduled) return;
      }
      const attempt = run.stepAttempts.find((candidate) => candidate.status === "ready");
      if (!attempt) return;
      run = await this.options.workflowService.executeAttempt({
        run: input,
        attemptId: attempt.id,
        principalPermissions: new Set(this.options.permissions),
        executor: this.options.executor,
      });
    }
  }

  private responseScope(request: WorkflowRequest): {
    projectId: string;
    workspaceId: string;
    requestId: string;
    runId: string | null;
  } {
    return {
      projectId: request.projectId,
      workspaceId: request.workspaceId,
      requestId: request.requestId,
      runId: "runId" in request ? (request.runId ?? null) : null,
    };
  }

  private emitError(request: WorkflowRequest, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const response = this.responseScope(request);
    const payload = { ...response, error: message };
    switch (request.type) {
      case "workflow.definition.list.request":
        this.options.host.emit({
          type: "workflow.definition.list.response",
          payload: { ...payload, definitions: [] },
        });
        return;
      case "workflow.definition.inspect.request":
        this.options.host.emit({
          type: "workflow.definition.inspect.response",
          payload: { ...payload, definition: null },
        });
        return;
      case "workflow.run.list.request":
        this.options.host.emit({
          type: "workflow.run.list.response",
          payload: { ...payload, runs: [] },
        });
        return;
      case "workflow.run.inspect.request":
        this.options.host.emit({
          type: "workflow.run.inspect.response",
          payload: { ...payload, run: null },
        });
        return;
      case "workflow.run.create.request":
      case "workflow.run.cancel.request":
      case "workflow.run.retry.request":
      case "workflow.run.resume.request": {
        const type = request.type.replace(".request", ".response") as Extract<
          SessionOutboundMessage["type"],
          `workflow.run.${string}.response`
        >;
        this.options.host.emit({
          type,
          payload: { ...payload, run: null },
        } as SessionOutboundMessage);
        return;
      }
      case "workflow.approval.list.request":
        this.options.host.emit({
          type: "workflow.approval.list.response",
          payload: { ...payload, approvals: [] },
        });
        return;
      case "workflow.approval.approve.request":
      case "workflow.approval.deny.request": {
        const type = request.type.replace(".request", ".response") as Extract<
          SessionOutboundMessage["type"],
          `workflow.approval.${string}.response`
        >;
        this.options.host.emit({
          type,
          payload: { ...payload, approval: null, run: null },
        } as SessionOutboundMessage);
        return;
      }
      case "workflow.artifact.list.request":
        this.options.host.emit({
          type: "workflow.artifact.list.response",
          payload: { ...payload, artifacts: [] },
        });
        return;
      case "workflow.artifact.get.request":
        this.options.host.emit({
          type: "workflow.artifact.get.response",
          payload: { ...payload, artifact: null, content: null },
        });
        return;
      default:
        return;
    }
  }
}
