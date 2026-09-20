import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  approveTaskRpc,
  getTaskDetailRpc,
  listTasksRpc,
  rejectTaskRpc,
} from "./shared/contracts.js";
import { TaskStore } from "./server/store.js";
import { GiteaClientPool } from "./server/client-pool.js";
import { ProjectGiteaResolver } from "./server/resolver.js";
import { WorktreeOrchestrator } from "./server/orchestrator.js";
import { MultiProjectPoller } from "./server/poller.js";

export default function contribute(server: PluginServerContext) {
  const storePath = join(tmpdir(), "paseo-gitea-workflow", "tasks.json");
  const store = new TaskStore(storePath);
  const clientPool = new GiteaClientPool();
  const resolver = new ProjectGiteaResolver();

  const orchestrator = new WorktreeOrchestrator({
    store,
    clientPool,
    maxConcurrentWorktrees: 3,
  });

  let poller: MultiProjectPoller | null = null;

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

    if (!poller && context.paseo?.projects) {
      poller = new MultiProjectPoller(resolver, orchestrator, context.paseo.projects, 60_000);
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

  return () => {
    poller?.stop();
  };
}
