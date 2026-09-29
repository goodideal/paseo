import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPaseoClient, type PaseoClient, type PaseoApi } from "@getpaseo/client";
import {
  approveTaskRpc,
  diagnoseProjectsRpc,
  getTaskDetailRpc,
  listTasksRpc,
  pruneEvidenceRpc,
  rejectTaskRpc,
} from "./shared/contracts.js";
import { giteaSettingsDefinition } from "./shared/settings.js";
import { SettingsManager } from "./server/settings-manager.js";
import { DiagnosticsService } from "./server/diagnostics.js";
import { IssueRunIndexStore, TaskStore } from "./server/store.js";
import { GiteaClientPool } from "./server/client-pool.js";
import { ProjectGiteaResolver } from "./server/resolver.js";
import { MultiProjectPoller } from "./server/poller.js";
import { createGiteaStepAdapters } from "./server/adapters/index.js";
import { issueToPrPreset } from "./server/presets/issue-to-pr.js";
import { EvidenceManager } from "./server/evidence-manager.js";
import { EvidencePruner } from "./server/cleanup.js";

function getDaemonWsUrl(): string {
  const listen = process.env.PASEO_LISTEN || "127.0.0.1:6767";
  if (listen.startsWith("ws://") || listen.startsWith("wss://")) {
    return listen.endsWith("/ws") ? listen : `${listen}/ws`;
  }
  return `ws://${listen.replace(/\/+$/, "")}/ws`;
}

export default function contribute(server: PluginServerContext) {
  const settingsHandle = server.registerSettings(giteaSettingsDefinition);
  const settingsManager = new SettingsManager(settingsHandle);
  void settingsManager.initialize();

  const storePath = join(tmpdir(), "paseo-gitea-workflow", "tasks.json");
  const store = new TaskStore(storePath);
  const indexPath = join(tmpdir(), "paseo-gitea-workflow", "issue-index.json");
  const indexStore = new IssueRunIndexStore(indexPath);

  const clientPool = new GiteaClientPool();
  const resolver = new ProjectGiteaResolver();
  const diagnosticsService = new DiagnosticsService(resolver, clientPool, settingsManager);
  let activePaseo: PaseoApi | null = null;
  let paseoClient: PaseoClient | null = null;

  const pruner = new EvidencePruner(
    EvidenceManager,
    {
      runInspect: (opts: { projectId: string; workspaceId: string; runId: string }) =>
        (paseoClient ?? activePaseo)!.workflows.runInspect(opts),
    } as any,
    settingsManager,
  );

  for (const adapter of createGiteaStepAdapters(clientPool)) {
    server.registerWorkflowStepAdapter?.(adapter);
  }
  server.registerWorkflowPreset?.(issueToPrPreset);

  let poller: MultiProjectPoller | null = null;

  async function initBackgroundPoller(): Promise<void> {
    try {
      paseoClient = createPaseoClient({
        url: getDaemonWsUrl(),
        reconnect: { enabled: true },
      });
      await paseoClient.connect();

      if (!poller) {
        poller = new MultiProjectPoller({
          settings: settingsManager,
          resolver,
          clientPool,
          indexStore,
          getWorkflows: () => (paseoClient ?? activePaseo)?.workflows,
          getProjects: async () => {
            const api = paseoClient ?? activePaseo;
            if (!api) return [];
            const list = await api.projects.list();
            return list.projects;
          },
        });
        poller.start();
      }
    } catch (err) {
      console.warn("[gitea-workflow] Background client connect deferred/failed:", err);
    }
  }

  void initBackgroundPoller();

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
        getWorkflows: () => context.paseo.workflows,
        getProjects: async () => {
          const list = await context.paseo.projects.list();
          return list.projects;
        },
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
    const workflows = context.paseo.workflows;
    if (workflows) {
      try {
        const list = await workflows.approvalList({
          projectId: "default",
          workspaceId: "default",
          runId: taskId,
        });
        const pending = list.approvals.find((a) => a.status === "pending");
        if (pending) {
          await workflows.approvalApprove({
            projectId: "default",
            workspaceId: "default",
            runId: taskId,
            approvalId: pending.approvalId,
          });
          return { ok: true };
        }
      } catch {
        // ignore
      }
    }
    return { ok: true };
  });

  server.handle(rejectTaskRpc, async ({ taskId, feedback }, context) => {
    const workflows = context.paseo.workflows;
    if (workflows) {
      try {
        const list = await workflows.approvalList({
          projectId: "default",
          workspaceId: "default",
          runId: taskId,
        });
        const pending = list.approvals.find((a) => a.status === "pending");
        if (pending) {
          await workflows.approvalDeny({
            projectId: "default",
            workspaceId: "default",
            runId: taskId,
            approvalId: pending.approvalId,
            reason: feedback,
          });
          return { ok: true };
        }
      } catch {
        // ignore
      }
    }
    return { ok: true };
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
    const diagnostics = await diagnosticsService.diagnoseProjects(projects);
    return { diagnostics };
  });

  server.handle(pruneEvidenceRpc, async ({ olderThanDays }) => {
    const nowMs = Date.now();
    const result = await pruner.pruneExpiredEvidence(nowMs);
    return result;
  });

  const cleanupTimer = setInterval(
    () => {
      void pruner.pruneExpiredEvidence().catch(() => {});
    },
    24 * 60 * 60 * 1000,
  );

  return () => {
    clearInterval(cleanupTimer);
    settingsManager.dispose();
    poller?.stop();
    if (paseoClient) {
      void paseoClient.close().catch(() => {});
    }
  };
}
