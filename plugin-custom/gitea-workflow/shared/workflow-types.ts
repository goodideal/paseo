import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import type { PaseoApi } from "@getpaseo/client";

export interface PluginWorkflowPreset {
  workflowId: string;
  name: string;
  sourcePreset?: string;
  definition: Record<string, unknown>;
}

export interface PluginWorkflowStepAdapterContext {
  paseo: PaseoApi;
  run: {
    projectId: string;
    workspaceId: string;
    runId: string;
    workspaceRoot?: string;
    runInput?: Record<string, unknown>;
    stepOutputs?: Record<string, Record<string, unknown>>;
  };
  stepOutputs?: Record<string, Record<string, unknown>>;
}

export interface PluginWorkflowStepAdapterRegistration {
  type: string;
  version: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  executionRisk: "read" | "workspace_observe" | "workspace_write" | "external_write" | "privileged";
  requiredPermissions: string[];
  repositoryCallable: boolean;
  idempotency: "none" | "required";
  cancellation: "unsupported" | "supported" | "best_effort";
  recovery: "not_resumable" | "resumable" | "inspect_before_retry";
  supportedPlatforms: Array<"darwin" | "linux" | "win32">;
  resourceConflictKey: string;
  execute(
    input: unknown,
    context: PluginWorkflowStepAdapterContext,
  ): Promise<Record<string, unknown>>;
}

export const workflowStepDispatchRpc = defineRpc({
  name: "workflow.step.dispatch",
  input: z.object({
    adapterType: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    run: z
      .object({
        projectId: z.string(),
        workspaceId: z.string(),
        runId: z.string(),
        workspaceRoot: z.string().optional(),
        runInput: z.record(z.string(), z.unknown()).optional(),
        stepOutputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      })
      .passthrough(),
  }),
  output: z.object({
    status: z.enum(["running", "succeeded", "failed"]),
    jobId: z.string().optional(),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
});

export const workflowStepPollRpc = defineRpc({
  name: "workflow.step.poll",
  input: z.object({
    jobId: z.string().min(1),
  }),
  output: z.object({
    status: z.enum(["running", "succeeded", "failed"]),
    output: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
});

export function toStepAdapterManifest(adapter: PluginWorkflowStepAdapterRegistration) {
  return {
    type: adapter.type,
    version: adapter.version,
    executionRisk: adapter.executionRisk,
    requiredPermissions: adapter.requiredPermissions,
    repositoryCallable: adapter.repositoryCallable,
    idempotency: adapter.idempotency,
    cancellation: adapter.cancellation,
    recovery: adapter.recovery,
    supportedPlatforms: adapter.supportedPlatforms,
    resourceConflictKey: adapter.resourceConflictKey,
  };
}

export const WORKFLOW_RUNS_PLUGIN_ID = "workflow-runs";

export interface WorkflowRunsClient {
  runCreate(input: {
    projectId: string;
    workspaceId: string;
    workflowId: string;
    input?: Record<string, unknown>;
  }): Promise<{ runId: string | null; run: any; error: string | null }>;
  runInspect(input: {
    projectId: string;
    workspaceId: string;
    runId: string;
  }): Promise<{ runId: string | null; run: any; error: string | null }>;
  runCancel(input: {
    projectId: string;
    workspaceId: string;
    runId: string;
    reason?: string;
  }): Promise<{ runId: string | null; run: any; error: string | null }>;
  approvalList(input: {
    projectId: string;
    workspaceId: string;
    runId?: string;
  }): Promise<{ runId: string | null; approvals: any[]; error: string | null }>;
  approvalApprove(input: {
    projectId: string;
    workspaceId: string;
    runId: string;
    approvalId: string;
  }): Promise<{ runId: string | null; approval: any; run: any; error: string | null }>;
  approvalDeny(input: {
    projectId: string;
    workspaceId: string;
    runId: string;
    approvalId: string;
    reason?: string;
  }): Promise<{ runId: string | null; approval: any; run: any; error: string | null }>;
}

export function createWorkflowRunsClient(
  getPaseo: () => PaseoApi | null | undefined,
  ensureRegistered?: (paseo: PaseoApi) => Promise<void>,
): WorkflowRunsClient {
  const invoke = async <T>(method: string, input: Record<string, unknown>): Promise<T> => {
    const paseo = getPaseo();
    if (!paseo?.plugins?.invoke) {
      throw new Error("Workflow runs plugin RPC is unavailable");
    }
    return (await paseo.plugins.invoke(WORKFLOW_RUNS_PLUGIN_ID, method, input)) as T;
  };

  return {
    runCreate: async (input) => {
      const paseo = getPaseo();
      if (!paseo?.plugins?.invoke) {
        throw new Error("Workflow runs plugin RPC is unavailable");
      }
      if (ensureRegistered) {
        await ensureRegistered(paseo);
      }
      return invoke("workflow.run.create", input);
    },
    runInspect: (input) => invoke("workflow.run.inspect", input),
    runCancel: (input) => invoke("workflow.run.cancel", input),
    approvalList: (input) => invoke("workflow.approval.list", input),
    approvalApprove: (input) => invoke("workflow.approval.approve", input),
    approvalDeny: (input) => invoke("workflow.approval.deny", input),
  };
}
