import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginWorkflowStepAdapterRegistration } from "../shared/workflow-types.js";
import type { StepExecutorHost } from "./workflow-engine/step-executors.js";
import {
  extractWorkflowAgentHandoff,
  isWorkflowAgentHandoff,
} from "./workflow-engine/workflow-agent-handoff.js";
import type { WorkflowArtifact, WorkflowRun } from "./workflow-engine/workflow-models.js";
import type { WorkflowService } from "./workflow-engine/workflow-service.js";
import type { WorkflowStore } from "./workflow-engine/workflow-store.js";

const execFileAsync = promisify(execFile);

const PLUGIN_STEP_POLL_INTERVAL_MS = 1_500;
const DEFAULT_PLUGIN_STEP_TIMEOUT_MS = 30 * 60_000;

interface PluginStepDispatchResponse {
  status: "running" | "succeeded" | "failed";
  jobId?: string;
  output?: Record<string, unknown>;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveWorkspaceIdForCwd(paseo: PaseoApi, cwd: string): Promise<string | undefined> {
  try {
    const listed = await paseo.workspaces.list();
    const normalized = path.resolve(cwd);
    const match = listed.entries.find(
      (entry) => entry.workspaceDirectory && path.resolve(entry.workspaceDirectory) === normalized,
    );
    return match?.id;
  } catch {
    return undefined;
  }
}

export interface PluginStepExecutorHostOptions {
  paseoHome: string;
  getPaseo: () => PaseoApi | null;
  store: WorkflowStore;
  service: WorkflowService;
  localAdapters?: ReadonlyMap<string, PluginWorkflowStepAdapterRegistration>;
}

export function createPluginStepExecutorHost(
  options: PluginStepExecutorHostOptions,
): StepExecutorHost {
  const { paseoHome, getPaseo, store, service, localAdapters } = options;

  const requirePaseo = (): PaseoApi => {
    const api = getPaseo();
    if (!api) {
      throw new Error("Paseo API is unavailable for workflow execution");
    }
    return api;
  };

  const saveWorkflowArtifact = async (
    run: WorkflowRun,
    kind: string,
    content: string,
  ): Promise<WorkflowArtifact> => {
    const id = `artifact_${randomUUID().replaceAll("-", "")}`;
    const now = Date.now();
    const contentBuffer = Buffer.from(content, "utf8");
    const contentHash = createHash("sha256").update(contentBuffer).digest("hex");
    const artifactPath = `artifacts/${run.id}/${id}.txt`;
    const artifactDir = path.join(paseoHome, "artifacts", run.id);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(artifactDir, `${id}.txt`), contentBuffer);

    const artifact: WorkflowArtifact = {
      id,
      kind,
      path: artifactPath,
      contentHash,
      bytes: contentBuffer.length,
      redacted: false,
      createdAt: now,
    };

    store.update(
      { projectId: run.projectId, workspaceId: run.workspaceId, runId: run.id },
      (current) => ({
        ...current,
        artifacts: [...current.artifacts, artifact],
        updatedAt: now,
      }),
    );

    return artifact;
  };

  const runAgentHandle = async (
    agentHandle: Awaited<ReturnType<PaseoApi["agents"]["create"]>>,
    prompt: string,
    run: WorkflowRun,
  ) => {
    const agentId = agentHandle.id;
    const result = await agentHandle.run(prompt);
    const lastMessage = result.lastMessage ?? "";
    const finalArtifact = await saveWorkflowArtifact(run, "agent_output", lastMessage);

    if (result.status === "permission") {
      return {
        agentId,
        sessionId: agentId,
        outcome: "permission_pending" as const,
        finalArtifactId: finalArtifact.id,
      };
    }
    if (result.status === "error" || result.status === "timeout") {
      return {
        agentId,
        sessionId: agentId,
        outcome: "failed" as const,
        finalArtifactId: finalArtifact.id,
      };
    }
    if (result.final?.status === "closed") {
      return {
        agentId,
        sessionId: agentId,
        outcome: "cancelled" as const,
        finalArtifactId: finalArtifact.id,
      };
    }

    const handoffResult = extractWorkflowAgentHandoff(lastMessage);
    let handoffArtifactId: string | undefined;
    if (isWorkflowAgentHandoff(handoffResult)) {
      const handoffArtifact = await saveWorkflowArtifact(
        run,
        "handoff",
        JSON.stringify(handoffResult, null, 2),
      );
      handoffArtifactId = handoffArtifact.id;
    }

    return {
      agentId,
      sessionId: agentId,
      outcome: "completed" as const,
      finalArtifactId: finalArtifact.id,
      ...(handoffArtifactId ? { handoffArtifactId } : {}),
    };
  };

  return {
    createWorktree: async ({ workspaceRoot, branch, baseBranch, title }) => {
      const paseo = requirePaseo();
      const handle = await paseo.workspaces.create({
        source: {
          kind: "worktree",
          cwd: workspaceRoot,
          action: "branch-off",
          branchName: branch,
          worktreeSlug: branch,
          ...(baseBranch ? { baseBranch } : {}),
        },
        ...(title ? { title } : {}),
      });
      const current = handle.current();
      const worktreePath = current?.workspaceDirectory ?? handle.directory ?? workspaceRoot;
      return {
        worktreePath,
        branch: current?.gitRuntime?.currentBranch ?? branch,
        workspaceId: handle.id,
      };
    },

    dispatchAgent: async ({ cwd, promptId, provider }) => {
      const paseo = requirePaseo();
      const workspaceId = await resolveWorkspaceIdForCwd(paseo, cwd);
      const agentOptions = {
        title: `Workflow ${promptId}`,
        prompt: promptId,
        config: {
          provider: provider ?? "codex",
        },
      };
      const handle = workspaceId
        ? await paseo.workspaces.ref(workspaceId).agents.create(agentOptions)
        : await paseo.agents.create({ cwd, ...agentOptions });
      return { agentId: handle.id, sessionId: handle.id, resumable: true };
    },

    runAgentUntilComplete: async ({ cwd, prompt, profile, mode, run, stepId }) => {
      const paseo = requirePaseo();
      let provider = "codex";
      if (
        typeof profile === "object" &&
        profile &&
        "provider" in profile &&
        typeof (profile as { provider?: unknown }).provider === "string"
      ) {
        provider = (profile as { provider: string }).provider;
      } else if (typeof profile === "string" && profile !== "default") {
        provider = profile;
      }
      const workspaceId = (await resolveWorkspaceIdForCwd(paseo, cwd)) ?? run.workspaceId;
      const agentOptions = {
        title: `Workflow ${run.id} - ${stepId}`,
        config: {
          provider,
          ...(mode ? { modeId: mode } : {}),
        },
      };
      const agentHandle = workspaceId
        ? await paseo.workspaces.ref(workspaceId).agents.create(agentOptions)
        : await paseo.agents.create({ cwd, ...agentOptions });
      return runAgentHandle(agentHandle, prompt, run);
    },

    continueAgentUntilComplete: async ({ agentId, prompt, mode, run }) => {
      const paseo = requirePaseo();
      const handle = paseo.agents.ref(agentId);
      const daemonClient = (
        paseo as unknown as {
          daemonClient?: { setAgentMode?: (id: string, modeId: string) => Promise<unknown> };
        }
      ).daemonClient;
      if (mode && daemonClient?.setAgentMode) {
        await daemonClient.setAgentMode(agentId, mode).catch(() => {});
      }
      return runAgentHandle(handle, prompt, run);
    },

    waitForInteraction: async ({ run, stepId, question, promptArtifactId }) => {
      const answered = run.interactions?.findLast(
        (item) => item.stepId === stepId && item.status === "answered",
      );
      if (answered) {
        return {
          interactionId: answered.id,
          status: "answered",
          answerArtifactId: answered.answerArtifactId,
          responderId: answered.responderId,
          answeredAt: answered.answeredAt,
        };
      }
      const existingPending = run.interactions?.findLast(
        (item) => item.stepId === stepId && item.status === "pending",
      );
      if (existingPending) {
        return {
          interactionId: existingPending.id,
          status: "pending",
        };
      }
      let effectivePromptArtifactId = promptArtifactId;
      if (!effectivePromptArtifactId) {
        const promptArtifact = await saveWorkflowArtifact(
          run,
          "interaction_prompt",
          question ?? "Awaiting user input",
        );
        effectivePromptArtifactId = promptArtifact.id;
      }
      const interactionId = `interaction_${randomUUID().replaceAll("-", "")}`;
      await service.createInteraction({
        projectId: run.projectId,
        workspaceId: run.workspaceId,
        runId: run.id,
        stepId,
        promptArtifactId: effectivePromptArtifactId,
        interactionId,
      });
      return {
        interactionId,
        status: "pending",
      };
    },

    runVerification: async ({ profile, cwd }) => {
      try {
        const result = await execFileAsync(profile.command, profile.args, {
          cwd,
          timeout: profile.timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
          env: Object.fromEntries(
            (profile.envAllowlist ?? [])
              .filter((key) => process.env[key] !== undefined)
              .map((key) => [key, process.env[key] as string]),
          ),
        });
        const report = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
        return {
          passed: true,
          ...(report ? { report } : {}),
        };
      } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
        };
        if (execError.killed) {
          throw new Error(`Verification timed out after ${profile.timeoutMs}ms`);
        }
        const report = [execError.stdout?.trim(), execError.stderr?.trim() || String(error)]
          .filter(Boolean)
          .join("\n");
        return {
          passed: false,
          ...(report ? { report } : {}),
        };
      }
    },

    createPullRequest: async ({ cwd, title, baseBranch, branch }) => {
      await execFileAsync("git", ["push", "-u", "origin", branch], { cwd });
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "create", "--title", title, "--base", baseBranch, "--head", branch, "--body", ""],
        { cwd },
      );
      const prUrl = stdout.trim().split("\n").pop()?.trim() ?? "";
      const match = prUrl.match(/\/pull\/(\d+)/);
      return {
        prUrl,
        prNumber: match ? Number(match[1]) : 0,
      };
    },

    findPullRequest: async () => null,

    executePluginAdapter: async ({ pluginId, adapterType, input, run, timeoutMs }) => {
      const paseo = requirePaseo();
      const stepOutputs: Record<string, Record<string, unknown>> = {};
      for (const attempt of run.stepAttempts) {
        if (attempt.status === "succeeded" && attempt.declaredOutputs) {
          stepOutputs[attempt.stepId] = attempt.declaredOutputs;
        }
      }
      const localAdapter = localAdapters?.get(adapterType);
      if (localAdapter && (pluginId === "gitea-workflow" || !pluginId)) {
        const output = await localAdapter.execute(input, {
          paseo,
          run: {
            projectId: run.projectId,
            workspaceId: run.workspaceId,
            runId: run.id,
            workspaceRoot: run.workspaceRoot,
            runInput: run.runInput,
            stepOutputs,
          },
          stepOutputs,
        });
        return output ?? {};
      }
      const payload = {
        adapterType,
        input,
        run: {
          projectId: run.projectId,
          workspaceId: run.workspaceId,
          runId: run.id,
          workspaceRoot: run.workspaceRoot,
          runInput: run.runInput,
          stepOutputs,
        },
      };

      const dispatchRes = (await paseo.plugins.invoke(
        pluginId,
        "workflow.step.dispatch",
        payload,
      )) as PluginStepDispatchResponse;

      if (dispatchRes.status === "succeeded") {
        return dispatchRes.output ?? {};
      }
      if (dispatchRes.status === "failed") {
        throw new Error(dispatchRes.error ?? `Plugin step ${adapterType} failed`);
      }
      if (!dispatchRes.jobId) {
        throw new Error(`Plugin step ${adapterType} returned running without jobId`);
      }

      const deadline = Date.now() + (timeoutMs ?? DEFAULT_PLUGIN_STEP_TIMEOUT_MS);
      while (Date.now() < deadline) {
        await sleep(PLUGIN_STEP_POLL_INTERVAL_MS);
        const pollRes = (await paseo.plugins.invoke(pluginId, "workflow.step.poll", {
          jobId: dispatchRes.jobId,
        })) as PluginStepDispatchResponse;

        if (pollRes.status === "succeeded") {
          return pollRes.output ?? {};
        }
        if (pollRes.status === "failed") {
          throw new Error(pollRes.error ?? `Plugin step ${adapterType} failed`);
        }
      }

      throw new Error(
        `Plugin step ${pluginId}/${adapterType} timed out after ${timeoutMs ?? DEFAULT_PLUGIN_STEP_TIMEOUT_MS}ms`,
      );
    },
  };
}
