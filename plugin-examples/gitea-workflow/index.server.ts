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
import { GiteaClient } from "./server/gitea-client.js";
import { WorktreeOrchestrator } from "./server/orchestrator.js";
import { IssuePoller } from "./server/poller.js";
import type { GiteaSettings } from "./shared/types.js";

export default function contribute(server: PluginServerContext) {
  const storePath = join(tmpdir(), "paseo-gitea-workflow", "tasks.json");
  const store = new TaskStore(storePath);

  const defaultSettings: GiteaSettings = {
    giteaUrl: process.env.GITEA_URL ?? "https://gitea.example.com",
    giteaToken: process.env.GITEA_TOKEN ?? "mock-token",
    repoOwner: process.env.GITEA_OWNER ?? "owner",
    repoName: process.env.GITEA_REPO ?? "repo",
    listenLabel: "agent-ready",
    inProgressLabel: "agent-in-progress",
    reviewedLabel: "agent-reviewed",
    pollIntervalSeconds: 60,
    maxConcurrentWorktrees: 3,
  };

  const gitea = new GiteaClient(defaultSettings);
  const orchestrator = new WorktreeOrchestrator({
    store,
    gitea,
    projectPath: process.cwd(),
    projectName: defaultSettings.repoName,
  });

  const poller = new IssuePoller(gitea, orchestrator, defaultSettings.pollIntervalSeconds * 1000);
  if (process.env.GITEA_TOKEN) {
    poller.start();
  }

  server.handle(listTasksRpc, async () => {
    const tasks = await store.listTasks();
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
    poller.stop();
  };
}
