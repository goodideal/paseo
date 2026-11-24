import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type {
  PluginWorkflowPreset,
  PluginWorkflowStepAdapterRegistration,
  WorkflowRunsClient,
} from "../shared/workflow-types.js";
import {
  workflowApprovalApproveRpc,
  workflowApprovalDenyRpc,
  workflowApprovalListRpc,
  workflowArtifactGetRpc,
  workflowArtifactListRpc,
  workflowDefinitionInspectRpc,
  workflowDefinitionListRpc,
  workflowInteractionRespondRpc,
  workflowRegistryRegisterRpc,
  workflowRunCancelRpc,
  workflowRunCreateRpc,
  workflowRunInspectRpc,
  workflowRunListRpc,
  workflowRunResumeRpc,
  workflowRunRetryRpc,
} from "../shared/workflow-rpc-contracts.js";
import { WorkflowHarnessExecutionInfoSchema } from "../shared/types.js";
import { registerBuiltInWorkflowStepManifests } from "./workflow-engine/core-step-manifests.js";
import type { WorkflowDefinition } from "./workflow-engine/definition-compiler.js";
import { StepAdapterRegistry } from "./workflow-engine/step-adapter-registry.js";
import { StepExecutor } from "./workflow-engine/step-executors.js";
import { createDefaultVerificationProfileRegistry } from "./workflow-engine/verification-profiles.js";
import type { WorkflowPermission, WorkflowRun } from "./workflow-engine/workflow-models.js";
import { createWorkflowPresetRegistry } from "./workflow-engine/workflow-preset-registry.js";
import { WorkflowService } from "./workflow-engine/workflow-service.js";
import { WorkflowStore } from "./workflow-engine/workflow-store.js";
import { createPluginStepExecutorHost } from "./workflow-executor-runtime.js";

const DEFAULT_PERMISSIONS = new Set<string>([
  "workspace.read",
  "workspace.write",
  "workspace.manage",
  "automation.manage",
  "agent.run",
  "git.write",
  "pr.write",
  "daemon.manage",
]);

function toIso(timestamp: number | undefined): string | null {
  return timestamp === undefined ? null : new Date(timestamp).toISOString();
}

function toExecutionRisk(
  run: WorkflowRun,
): "observe" | "workspace_write" | "external_side_effect" | "privileged" {
  const step = run.stepAttempts.at(-1);
  if (!step) return "observe";
  if (step.adapterType.startsWith("git.")) return "external_side_effect";
  if (step.adapterType === "verify.command" || step.adapterType === "approval.wait") {
    return "observe";
  }
  return "workspace_write";
}

function toRunSummary(run: WorkflowRun, sourcePreset: string = run.definitionId) {
  const current = run.stepAttempts.findLast((attempt) =>
    ["pending", "ready", "running", "retry_wait", "waiting_approval"].includes(attempt.status),
  );
  const pendingInteraction = run.interactions?.findLast((item) => item.status === "pending");
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
    pendingInteraction: pendingInteraction ?? null,
  };
}

function extractAttemptSummary(outputs: Record<string, unknown> | undefined): string | null {
  if (!outputs) return null;
  if (typeof outputs.summary === "string" && outputs.summary.length > 0) {
    return outputs.summary;
  }
  if (
    typeof outputs.outcome === "string" &&
    outputs.outcome.length > 0 &&
    outputs.outcome !== "completed"
  ) {
    return outputs.outcome;
  }
  return null;
}

function toRunDetail(run: WorkflowRun, sourcePreset?: string) {
  return {
    ...toRunSummary(run, sourcePreset),
    stepAttempts: run.stepAttempts.map((attempt, index) => {
      const outputs = attempt.declaredOutputs;
      const agentId =
        typeof outputs?.agentId === "string" && outputs.agentId.length > 0 ? outputs.agentId : null;
      const summary = extractAttemptSummary(outputs);
      const parsedHarness = outputs?.harness
        ? WorkflowHarnessExecutionInfoSchema.safeParse(outputs.harness)
        : null;
      const harness = parsedHarness?.success ? parsedHarness.data : null;

      return {
        stepId: attempt.stepId,
        attempt: index + 1,
        status: attempt.status,
        startedAt: toIso(attempt.startedAt),
        completedAt: toIso(attempt.completedAt),
        skipReason: attempt.skipReason ?? null,
        failureReason: attempt.failureClassification ?? null,
        agentId,
        summary,
        harness,
      };
    }),
    interactions: run.interactions ?? [],
    deliveryApprovalManifest: run.deliveryApprovalManifest ?? null,
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
    redacted: artifact.redacted,
    createdAt: new Date(artifact.createdAt).toISOString(),
  };
}

export interface EmbeddedWorkflowRuntimeOptions {
  paseoHome: string;
  getPaseo: () => PaseoApi | null;
  stepAdapters: readonly PluginWorkflowStepAdapterRegistration[];
  initialPresets: readonly PluginWorkflowPreset[];
}

export interface EmbeddedWorkflowRuntime {
  client: WorkflowRunsClient;
  registerRpcHandlers(server: PluginServerContext, onPaseo?: (api: PaseoApi) => void): void;
  dispose(): void;
}

/**
 * Creates an in-process workflow DAG runtime hosting the StepAdapterRegistry, preset registry,
 * WorkflowService, and StepExecutor inside gitea-workflow so steps execute without cross-plugin IPC.
 */
export function createEmbeddedWorkflowRuntime(
  options: EmbeddedWorkflowRuntimeOptions,
): EmbeddedWorkflowRuntime {
  const { paseoHome, getPaseo, stepAdapters, initialPresets } = options;
  const store = new WorkflowStore({ paseoHome });
  const registry = new StepAdapterRegistry();
  registerBuiltInWorkflowStepManifests(registry);
  const presets = createWorkflowPresetRegistry(registry);
  const service = new WorkflowService({ store, registry });
  const profiles = createDefaultVerificationProfileRegistry();

  const localAdapters = new Map<string, PluginWorkflowStepAdapterRegistration>();
  for (const adapter of stepAdapters) {
    localAdapters.set(adapter.type, adapter);
    registry.registerPlugin({
      pluginId: "gitea-workflow",
      manifest: {
        type: adapter.type,
        version: adapter.version,
        inputSchema: z.record(z.string(), z.unknown()),
        outputSchema: z.record(z.string(), z.unknown()),
        executionRisk: adapter.executionRisk,
        requiredPermissions: adapter.requiredPermissions as WorkflowPermission[],
        repositoryCallable: adapter.repositoryCallable,
        idempotency: adapter.idempotency,
        cancellation: adapter.cancellation,
        recovery: adapter.recovery,
        supportedPlatforms: adapter.supportedPlatforms,
        resourceConflictKey: adapter.resourceConflictKey,
      },
    });
  }

  for (const preset of initialPresets) {
    presets.register({
      workflowId: preset.workflowId,
      name: preset.name,
      sourcePreset: preset.sourcePreset ?? "gitea-workflow",
      definition: preset.definition as unknown as WorkflowDefinition,
    });
  }

  let disposed = false;
  const activeRunDrives = new Set<string>();

  const executor = new StepExecutor(
    registry,
    profiles,
    createPluginStepExecutorHost({
      paseoHome,
      getPaseo,
      store,
      service,
      localAdapters,
    }),
  );

  const driveRun = async (input: {
    projectId: string;
    workspaceId: string;
    runId: string;
  }): Promise<void> => {
    if (disposed || activeRunDrives.has(input.runId)) return;
    activeRunDrives.add(input.runId);
    try {
      let run = service.inspect(input);
      while (!disposed && run.status === "running") {
        const ready = run.stepAttempts.find((attempt) => attempt.status === "ready");
        if (!ready) {
          run = service.schedule(input);
          const scheduled = run.stepAttempts.find((attempt) => attempt.status === "ready");
          if (!scheduled) return;
        }
        const attempt = run.stepAttempts.find((candidate) => candidate.status === "ready");
        if (!attempt) return;
        run = await service.executeAttempt({
          run: input,
          attemptId: attempt.id,
          principalPermissions: DEFAULT_PERMISSIONS,
          executor,
        });
      }
    } finally {
      activeRunDrives.delete(input.runId);
    }
  };

  const kickRun = (run: WorkflowRun): void => {
    if (disposed || run.status !== "running") return;
    void driveRun({
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runId: run.id,
    }).catch((error) => {
      console.error(`[gitea-workflow] Workflow execution failed (${run.id}):`, error);
    });
  };

  const resolveWorkspaceCwd = async (
    paseo: PaseoApi,
    scope: { projectId: string; workspaceId: string },
  ): Promise<string> => {
    try {
      const wsRef = paseo.workspaces.ref(scope.workspaceId);
      const current = wsRef.current();
      if (current?.workspaceDirectory) {
        return current.workspaceDirectory;
      }
    } catch {
      // fall through to list
    }
    const listed = await paseo.workspaces.list({ filter: { projectId: scope.projectId } });
    const match = listed.entries.find((entry) => entry.id === scope.workspaceId);
    if (match?.workspaceDirectory) {
      return match.workspaceDirectory;
    }
    throw new Error(`Workspace was not found in scope: ${scope.workspaceId}`);
  };

  const runCreateImpl = async (
    input: {
      projectId: string;
      workspaceId: string;
      workflowId: string;
      input?: Record<string, unknown>;
    },
    paseoOverride?: PaseoApi | null,
  ) => {
    try {
      const preset = presets.get(input.workflowId);
      if (!preset) {
        return {
          runId: null,
          run: null,
          error: `Unknown workflow preset: ${input.workflowId}`,
        };
      }
      const api = paseoOverride ?? getPaseo();
      if (!api) {
        return {
          runId: null,
          run: null,
          error: "Paseo API is unavailable for workspace lookup",
        };
      }
      const cwd = await resolveWorkspaceCwd(api, input);
      const run = service.create({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        principalId: "plugin:gitea-workflow",
        workspaceRoot: cwd,
        definition: preset.definition,
        input: input.input,
      });
      kickRun(run);
      return {
        runId: run.id,
        run: toRunSummary(run, preset.sourcePreset),
        error: null,
      };
    } catch (error) {
      return {
        runId: null,
        run: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const runInspectImpl = async (input: {
    projectId: string;
    workspaceId: string;
    runId: string;
  }) => {
    try {
      const run = service.inspect(input);
      return {
        runId: run.id,
        run: toRunDetail(run, presets.get(run.definitionId)?.sourcePreset),
        error: null,
      };
    } catch (error) {
      return {
        runId: input.runId,
        run: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const runCancelImpl = async (input: {
    projectId: string;
    workspaceId: string;
    runId: string;
    reason?: string;
  }) => {
    try {
      const run = service.cancel(input);
      return {
        runId: run.id,
        run: toRunSummary(run, presets.get(run.definitionId)?.sourcePreset),
        error: null,
      };
    } catch (error) {
      return {
        runId: input.runId,
        run: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const approvalListImpl = async (input: {
    projectId: string;
    workspaceId: string;
    runId?: string;
  }) => {
    try {
      let approvals: ReturnType<typeof toApproval>[] = [];
      if (input.runId) {
        const run = service.inspect({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
        approvals = run.approvals.map((approval) => toApproval(run, approval));
      } else {
        const runs = service.list(input);
        approvals = runs.flatMap((run) =>
          run.approvals.map((approval) => toApproval(run, approval)),
        );
      }
      return {
        runId: input.runId ?? null,
        approvals,
        error: null,
      };
    } catch (error) {
      return {
        runId: input.runId ?? null,
        approvals: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const approvalApproveImpl = async (input: {
    projectId: string;
    workspaceId: string;
    runId: string;
    approvalId: string;
  }) => {
    try {
      const run = service.respondApproval({
        ...input,
        approverId: "plugin:gitea-workflow",
        decision: "approved",
      });
      const approval = run.approvals.find((candidate) => candidate.id === input.approvalId);
      kickRun(run);
      return {
        runId: run.id,
        approval: approval ? toApproval(run, approval) : null,
        run: toRunSummary(run, presets.get(run.definitionId)?.sourcePreset),
        error: null,
      };
    } catch (error) {
      return {
        runId: input.runId,
        approval: null,
        run: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const approvalDenyImpl = async (input: {
    projectId: string;
    workspaceId: string;
    runId: string;
    approvalId: string;
    reason?: string;
  }) => {
    try {
      const run = service.respondApproval({
        ...input,
        approverId: "plugin:gitea-workflow",
        decision: "denied",
        denialReason: input.reason,
      });
      const approval = run.approvals.find((candidate) => candidate.id === input.approvalId);
      return {
        runId: run.id,
        approval: approval ? toApproval(run, approval) : null,
        run: toRunSummary(run, presets.get(run.definitionId)?.sourcePreset),
        error: null,
      };
    } catch (error) {
      return {
        runId: input.runId,
        approval: null,
        run: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const client: WorkflowRunsClient = {
    runCreate: (input) => runCreateImpl(input),
    runInspect: (input) => runInspectImpl(input),
    runCancel: (input) => runCancelImpl(input),
    approvalList: (input) => approvalListImpl(input),
    approvalApprove: (input) => approvalApproveImpl(input),
    approvalDeny: (input) => approvalDenyImpl(input),
  };

  const registerRpcHandlers = (
    server: PluginServerContext,
    onPaseo?: (api: PaseoApi) => void,
  ): void => {
    const capture = (api: PaseoApi | undefined) => {
      if (api) onPaseo?.(api);
    };

    server.handle(workflowRegistryRegisterRpc, async (input, context) => {
      capture(context.paseo);
      presets.unregisterPlugin(input.pluginId);
      registry.unregisterPlugin(input.pluginId);

      for (const adapter of input.stepAdapters) {
        registry.registerPlugin({
          pluginId: input.pluginId,
          manifest: {
            type: adapter.type,
            version: adapter.version,
            inputSchema: z.record(z.string(), z.unknown()),
            outputSchema: z.record(z.string(), z.unknown()),
            executionRisk: adapter.executionRisk,
            requiredPermissions: adapter.requiredPermissions as WorkflowPermission[],
            repositoryCallable: adapter.repositoryCallable,
            idempotency: adapter.idempotency,
            cancellation: adapter.cancellation,
            recovery: adapter.recovery,
            supportedPlatforms: adapter.supportedPlatforms,
            resourceConflictKey: adapter.resourceConflictKey,
          },
        });
      }

      for (const preset of input.presets) {
        presets.register({
          workflowId: preset.workflowId,
          name: preset.name,
          sourcePreset: input.pluginId,
          definition: preset.definition as unknown as WorkflowDefinition,
        });
      }

      return {
        ok: true,
        registeredPresets: input.presets.length,
        registeredAdapters: input.stepAdapters.length,
      };
    });

    server.handle(workflowDefinitionListRpc, async (_input, context) => {
      capture(context.paseo);
      return {
        definitions: presets.list(),
        error: null,
      };
    });

    server.handle(workflowDefinitionInspectRpc, async (input, context) => {
      capture(context.paseo);
      const definition = presets.inspect(input.workflowId);
      return {
        definition: definition ?? null,
        error: definition ? null : `Unknown workflow preset: ${input.workflowId}`,
      };
    });

    server.handle(workflowRunCreateRpc, async (input, context) => {
      capture(context.paseo);
      return runCreateImpl(input, context.paseo);
    });

    server.handle(workflowRunListRpc, async (input, context) => {
      capture(context.paseo);
      try {
        const runs = service
          .list(input)
          .filter((run) => input.status === undefined || run.status === input.status)
          .map((run) => toRunSummary(run, presets.get(run.definitionId)?.sourcePreset));
        return { runs, error: null };
      } catch (error) {
        return { runs: [], error: error instanceof Error ? error.message : String(error) };
      }
    });

    server.handle(workflowRunInspectRpc, async (input, context) => {
      capture(context.paseo);
      return runInspectImpl(input);
    });

    server.handle(workflowRunCancelRpc, async (input, context) => {
      capture(context.paseo);
      return runCancelImpl(input);
    });

    server.handle(workflowRunRetryRpc, async (input, context) => {
      capture(context.paseo);
      try {
        const run = service.retry(input);
        kickRun(run);
        return {
          runId: run.id,
          run: toRunSummary(run, presets.get(run.definitionId)?.sourcePreset),
          error: null,
        };
      } catch (error) {
        return {
          runId: input.runId,
          run: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    server.handle(workflowRunResumeRpc, async (input, context) => {
      capture(context.paseo);
      try {
        const run = service.resume(input);
        kickRun(run);
        return {
          runId: run.id,
          run: toRunSummary(run, presets.get(run.definitionId)?.sourcePreset),
          error: null,
        };
      } catch (error) {
        return {
          runId: input.runId,
          run: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    server.handle(workflowApprovalListRpc, async (input, context) => {
      capture(context.paseo);
      return approvalListImpl(input);
    });

    server.handle(workflowApprovalApproveRpc, async (input, context) => {
      capture(context.paseo);
      return approvalApproveImpl(input);
    });

    server.handle(workflowApprovalDenyRpc, async (input, context) => {
      capture(context.paseo);
      return approvalDenyImpl(input);
    });

    server.handle(workflowArtifactListRpc, async (input, context) => {
      capture(context.paseo);
      try {
        const run = service.inspect(input);
        return {
          runId: run.id,
          artifacts: run.artifacts.map((artifact) => toArtifact(run, artifact)),
          error: null,
        };
      } catch (error) {
        return {
          runId: input.runId,
          artifacts: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    server.handle(workflowArtifactGetRpc, async (input, context) => {
      capture(context.paseo);
      try {
        const run = service.inspect(input);
        const artifact = run.artifacts.find((candidate) => candidate.id === input.artifactId);
        let content: unknown = null;
        let error: string | null = null;
        if (!artifact) {
          error = `Workflow artifact was not found: ${input.artifactId}`;
        } else if (!artifact.redacted) {
          const artifactFile = path.isAbsolute(artifact.path)
            ? artifact.path
            : path.join(paseoHome, artifact.path);
          if (existsSync(artifactFile)) {
            const raw = readFileSync(artifactFile, "utf-8");
            content = raw.length > 64 * 1024 ? raw.slice(0, 64 * 1024) : raw;
          } else {
            error = `Artifact file not found: ${artifact.path}`;
          }
        }
        return {
          runId: run.id,
          artifact: artifact ? toArtifact(run, artifact) : null,
          content,
          error,
        };
      } catch (error) {
        return {
          runId: input.runId,
          artifact: null,
          content: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    server.handle(workflowInteractionRespondRpc, async (input, context) => {
      capture(context.paseo);
      try {
        const run = await service.respondInteraction({
          ...input,
          responderId: "plugin:gitea-workflow",
          answer: input.answer,
        });
        const interaction = run.interactions.find(
          (candidate) => candidate.id === input.interactionId,
        );
        kickRun(run);
        return {
          runId: run.id,
          interaction: interaction ?? null,
          error: null,
        };
      } catch (error) {
        return {
          runId: input.runId,
          interaction: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };

  return {
    client,
    registerRpcHandlers,
    dispose: () => {
      disposed = true;
      activeRunDrives.clear();
    },
  };
}
