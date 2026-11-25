import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { readFileSync } from "node:fs";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPaseoClient, type PaseoClient, type PaseoApi } from "@getpaseo/client";
import {
  approveTaskRpc,
  diagnoseProjectsRpc,
  getTaskDetailRpc,
  listTasksRpc,
  pruneEvidenceRpc,
  rejectTaskRpc,
  syncGiteaIdentitiesRpc,
} from "./shared/contracts.js";
import { giteaSettingsDefinition } from "./shared/settings.js";
import { SettingsManager } from "./server/settings-manager.js";
import { DiagnosticsService } from "./server/diagnostics.js";
import { IssueRunIndexStore, TaskStore } from "./server/store.js";
import { GiteaClientPool } from "./server/client-pool.js";
import { GiteaIdentityBridge } from "./server/identity-bridge.js";
import { ProjectGiteaResolver } from "./server/resolver.js";
import { MultiProjectPoller } from "./server/poller.js";
import { createGiteaStepAdapters } from "./server/adapters/index.js";
import { giteaWorkflowPresets } from "./server/presets/issue-to-pr.js";
import { EvidenceManager } from "./server/evidence-manager.js";
import { EvidencePruner } from "./server/cleanup.js";
import { createEmbeddedWorkflowRuntime } from "./server/embedded-workflow-runtime.js";
import { WorkflowStepJobRunner } from "./server/step-job-runner.js";
import { workflowStepDispatchRpc, workflowStepPollRpc } from "./shared/workflow-types.js";

function getPaseoHome(): string {
  return process.env.PASEO_HOME || join(homedir(), ".paseo");
}

function getLocalCredential(): string | undefined {
  try {
    const token = readFileSync(join(getPaseoHome(), "local-credential"), "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeDaemonWsUrl(raw: string): string {
  let address = raw.trim();
  address = address.replace(/^0\.0\.0\.0(?=:|$)/, "127.0.0.1");
  if (address.startsWith("ws://") || address.startsWith("wss://")) {
    address = address.replace(/^ws:\/\/0\.0\.0\.0(?=:|$)/, "ws://127.0.0.1");
    return address.endsWith("/ws") ? address : `${address}/ws`;
  }
  return `ws://${address.replace(/\/+$/, "")}/ws`;
}

function getDaemonWsUrl(): string {
  if (process.env.PASEO_LISTEN) {
    return normalizeDaemonWsUrl(process.env.PASEO_LISTEN);
  }

  try {
    const lock = JSON.parse(readFileSync(join(getPaseoHome(), "paseo.pid"), "utf8")) as {
      listen?: unknown;
    };
    if (typeof lock.listen === "string" && lock.listen) {
      return normalizeDaemonWsUrl(lock.listen);
    }
  } catch {
    // fallback to default port
  }

  return "ws://127.0.0.1:6767/ws";
}

export default function contribute(server: PluginServerContext) {
  const settingsHandle = server.registerSettings(giteaSettingsDefinition);
  const settingsManager = new SettingsManager(settingsHandle);
  void settingsManager.initialize();

  const dataDir = process.env.PASEO_HOME
    ? join(process.env.PASEO_HOME, "plugins", "gitea-workflow")
    : join(tmpdir(), "paseo-gitea-workflow");
  const storePath = join(dataDir, "tasks.json");
  const store = new TaskStore(storePath);
  const indexPath = join(dataDir, "issue-index.json");
  const indexStore = new IssueRunIndexStore(indexPath);

  const clientPool = new GiteaClientPool();
  const identityBridge = new GiteaIdentityBridge({ paseoHome: getPaseoHome() });
  const resolver = new ProjectGiteaResolver({ identityBridge });
  let activePaseo: PaseoApi | null = null;
  let paseoClient: PaseoClient | null = null;
  const diagnosticsService = new DiagnosticsService(
    resolver,
    clientPool,
    settingsManager,
    () => paseoClient ?? activePaseo,
    identityBridge,
  );

  const stepAdapters = createGiteaStepAdapters(
    clientPool,
    indexStore,
    settingsManager,
    identityBridge,
  );
  const stepJobRunner = new WorkflowStepJobRunner(stepAdapters);
  const workflowRuntime = createEmbeddedWorkflowRuntime({
    paseoHome: getPaseoHome(),
    getPaseo: () => paseoClient ?? activePaseo,
    stepAdapters,
    initialPresets: giteaWorkflowPresets,
    indexStore,
    identityBridge,
  });
  workflowRuntime.registerRpcHandlers(server, (api) => {
    activePaseo = api;
  });

  const pruner = new EvidencePruner(EvidenceManager, workflowRuntime.client, settingsManager);

  server.handle(workflowStepDispatchRpc, (input, context) => {
    activePaseo = context.paseo;
    return stepJobRunner.dispatch(input, context);
  });

  server.handle(workflowStepPollRpc, ({ jobId }) => {
    return stepJobRunner.poll(jobId);
  });

  let poller: MultiProjectPoller | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let isDisposed = false;
  let isConnecting = false;

  async function tryStartBackgroundPoller(): Promise<void> {
    if (isDisposed || poller || isConnecting) return;
    isConnecting = true;
    try {
      if (!paseoClient) {
        paseoClient = createPaseoClient({
          url: getDaemonWsUrl(),
          localCredential: () => getLocalCredential(),
          reconnect: { enabled: true },
        });
      }
      await paseoClient.connect();

      if (!poller && !isDisposed) {
        poller = new MultiProjectPoller({
          settings: settingsManager,
          resolver,
          clientPool,
          indexStore,
          identityBridge,
          getPaseo: () => paseoClient ?? activePaseo,
          getWorkflows: () => (paseoClient || activePaseo ? workflowRuntime.client : undefined),
          getProjects: async () => {
            const api = paseoClient ?? activePaseo;
            if (!api) return [];
            const list = await api.projects.list();
            return list.projects;
          },
          getWorkspaces: () => (paseoClient ?? activePaseo)?.workspaces,
        });
        poller.start();
        console.log("[gitea-workflow] Background poller started successfully");
        if (retryTimer) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }
    } catch (err) {
      console.warn(
        "[gitea-workflow] Background client connect deferred/retrying:",
        (err as Error)?.message ?? String(err),
      );
    } finally {
      isConnecting = false;
    }
  }

  void tryStartBackgroundPoller();

  // Watchdog: continually retry connecting if daemon was restarting, credentials pending, or transiently unavailable
  retryTimer = setInterval(() => {
    if (isDisposed) return;
    if (!poller) {
      void tryStartBackgroundPoller();
    }
  }, 10_000);

  server.handle(listTasksRpc, async ({ projectId, workspaceId }, context) => {
    activePaseo = context.paseo;
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && workspaceId) {
      try {
        const wsRef = context.paseo.workspaces.ref(workspaceId);
        const ws = wsRef.current();
        if (ws?.projectId) {
          resolvedProjectId = ws.projectId;
        }
      } catch {
        // ignore workspace ref lookup error
      }
    }

    if (!poller && context.paseo?.projects) {
      poller = new MultiProjectPoller({
        settings: settingsManager,
        resolver,
        clientPool,
        indexStore,
        identityBridge,
        getPaseo: () => paseoClient ?? activePaseo,
        getWorkflows: () => workflowRuntime.client,
        getProjects: async () => {
          const list = await context.paseo.projects.list();
          return list.projects;
        },
        getWorkspaces: () => context.paseo.workspaces,
      });
      poller.start();
    }

    const tasks = await store.listTasks({
      projectId: resolvedProjectId,
      workspaceId,
    });
    return { tasks };
  });

  server.handle(getTaskDetailRpc, async ({ taskId }) => {
    const task = await store.getTask(taskId);
    return { task };
  });

  server.handle(approveTaskRpc, async ({ taskId }, context) => {
    activePaseo = context.paseo;
    try {
      const task = await store.getTask(taskId);
      const projectId = task?.projectId ?? "default";
      const workspaceId = task?.workspaceId ?? "default";
      const list = await workflowRuntime.client.approvalList({
        projectId,
        workspaceId,
        runId: taskId,
      });
      const pending = list.approvals.find((a) => a.status === "pending");
      if (pending) {
        await workflowRuntime.client.approvalApprove({
          projectId,
          workspaceId,
          runId: taskId,
          approvalId: pending.approvalId,
        });
        return { ok: true };
      }
      return { ok: false, error: `No pending approval found for task ${taskId}` };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  server.handle(rejectTaskRpc, async ({ taskId, feedback }, context) => {
    activePaseo = context.paseo;
    try {
      const task = await store.getTask(taskId);
      const projectId = task?.projectId ?? "default";
      const workspaceId = task?.workspaceId ?? "default";
      const list = await workflowRuntime.client.approvalList({
        projectId,
        workspaceId,
        runId: taskId,
      });
      const pending = list.approvals.find((a) => a.status === "pending");
      if (pending) {
        await workflowRuntime.client.approvalDeny({
          projectId,
          workspaceId,
          runId: taskId,
          approvalId: pending.approvalId,
          reason: feedback,
        });
        return { ok: true };
      }
      return { ok: false, error: `No pending approval found for task ${taskId}` };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  server.handle(diagnoseProjectsRpc, async (_input, context) => {
    activePaseo = context.paseo;
    let projects: any[] = [];
    try {
      const list = await context.paseo.projects.list();
      projects = list.projects.filter((p) => p.projectKind === "git");
    } catch {
      // fallback if project list is pending
    }
    const [diagnostics, harnessStatus, identityProbe] = await Promise.all([
      diagnosticsService.diagnoseProjects(projects, context.paseo),
      diagnosticsService.probeHarnessStatus(context.paseo),
      diagnosticsService.probeIdentities(context.paseo),
    ]);
    return {
      diagnostics,
      harnessStatus,
      identities: identityProbe.identities,
      teamCollabStatus: identityProbe.teamCollabStatus,
    };
  });

  server.handle(syncGiteaIdentitiesRpc, async (_input, context) => {
    activePaseo = context.paseo;
    return await identityBridge.syncHostIdentities(context.paseo);
  });

  server.handle(pruneEvidenceRpc, async ({ olderThanDays }) => {
    const nowMs = Date.now();
    const result = await pruner.pruneExpiredEvidence(nowMs, olderThanDays);
    return result;
  });

  const cleanupTimer = setInterval(
    () => {
      void pruner.pruneExpiredEvidence().catch(() => {});
    },
    24 * 60 * 60 * 1000,
  );

  return () => {
    isDisposed = true;
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    clearInterval(cleanupTimer);
    settingsManager.dispose();
    poller?.stop();
    workflowRuntime.dispose();
    if (paseoClient) {
      void paseoClient.close().catch(() => {});
    }
  };
}
