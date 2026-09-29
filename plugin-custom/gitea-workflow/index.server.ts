import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPaseoClient, type PaseoClient } from "@getpaseo/client";
import {
  approveTaskRpc,
  diagnoseProjectsRpc,
  getTaskDetailRpc,
  listTasksRpc,
  rejectTaskRpc,
} from "./shared/contracts.js";
import { giteaSettingsDefinition } from "./shared/settings.js";
import { SettingsManager } from "./server/settings-manager.js";
import { DiagnosticsService } from "./server/diagnostics.js";
import { TaskStore } from "./server/store.js";
import { GiteaClientPool } from "./server/client-pool.js";
import { ProjectGiteaResolver } from "./server/resolver.js";
import { WorktreeOrchestrator } from "./server/orchestrator.js";
import { MultiProjectPoller } from "./server/poller.js";
import { createGiteaStepAdapters } from "./server/adapters/index.js";
import { issueToPrPreset } from "./server/presets/issue-to-pr.js";

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
  const clientPool = new GiteaClientPool();
  const resolver = new ProjectGiteaResolver();
  const diagnosticsService = new DiagnosticsService(resolver, clientPool, settingsManager);

  for (const adapter of createGiteaStepAdapters(clientPool)) {
    server.registerWorkflowStepAdapter?.(adapter);
  }
  server.registerWorkflowPreset?.(issueToPrPreset);

  const orchestrator = new WorktreeOrchestrator({
    store,
    clientPool,
    maxConcurrentWorktrees: 3,
  });

  let poller: MultiProjectPoller | null = null;
  let paseoClient: PaseoClient | null = null;

  async function initBackgroundPoller(): Promise<void> {
    try {
      paseoClient = createPaseoClient({
        url: getDaemonWsUrl(),
        reconnect: { enabled: true },
      });
      await paseoClient.connect();
      orchestrator.setPaseoApi(paseoClient);

      if (!poller) {
        poller = new MultiProjectPoller(resolver, orchestrator, paseoClient.projects, 30_000);
        poller.start();
      }
    } catch (err) {
      console.warn("[gitea-workflow] Background client connect deferred/failed:", err);
    }
  }

  void initBackgroundPoller();

  server.handle(listTasksRpc, async ({ projectId, workspaceId }, context) => {
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

    if (!orchestrator.hasPaseoApi && context.paseo) {
      orchestrator.setPaseoApi(context.paseo);
    }

    if (!poller && context.paseo?.projects) {
      poller = new MultiProjectPoller(resolver, orchestrator, context.paseo.projects, 30_000);
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

  server.handle(approveTaskRpc, async ({ taskId }) => {
    return orchestrator.approveTask(taskId);
  });

  server.handle(rejectTaskRpc, async ({ taskId, feedback }) => {
    return orchestrator.rejectTask(taskId, feedback);
  });

  server.handle(diagnoseProjectsRpc, async (_input, context) => {
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

  return () => {
    settingsManager.dispose();
    poller?.stop();
    if (paseoClient) {
      void paseoClient.close().catch(() => {});
    }
  };
}
