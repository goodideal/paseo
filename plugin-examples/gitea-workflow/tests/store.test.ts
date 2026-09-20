import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { TaskStore } from "../server/store.js";
import type { GiteaWorkflowTask } from "../shared/types.js";

describe("TaskStore", () => {
  let testFilePath: string;
  let store: TaskStore;

  const sampleTask: GiteaWorkflowTask = {
    id: "task-1",
    projectId: "proj-alpha",
    projectPath: "/projects/alpha",
    issueNumber: 1,
    issueTitle: "Sample Issue",
    issueUrl: "http://gitea.local/owner/repo/issues/1",
    issueBody: "Sample body",
    giteaBaseUrl: "http://gitea.local",
    repoOwner: "owner",
    repoName: "repo",
    branchName: "agent/issue-1-sample",
    workspaceId: "ws-alpha-1",
    agentId: "agent-alpha-1",
    state: "queued",
    screenshots: [],
    diffSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleTaskBeta: GiteaWorkflowTask = {
    ...sampleTask,
    id: "task-2",
    projectId: "proj-beta",
    workspaceId: "ws-beta-1",
  };

  beforeEach(() => {
    testFilePath = join(tmpdir(), `test-task-store-${Date.now()}-${Math.random()}.json`);
    store = new TaskStore(testFilePath);
  });

  afterEach(async () => {
    await rm(testFilePath, { force: true });
  });

  it("saves, lists, and filters tasks by projectId and workspaceId", async () => {
    await store.saveTask(sampleTask);
    await store.saveTask(sampleTaskBeta);

    const allTasks = await store.listTasks();
    expect(allTasks).toHaveLength(2);

    const alphaTasks = await store.listTasks({ projectId: "proj-alpha" });
    expect(alphaTasks).toHaveLength(1);
    expect(alphaTasks[0].id).toBe("task-1");

    const betaWsTasks = await store.listTasks({ workspaceId: "ws-beta-1" });
    expect(betaWsTasks).toHaveLength(1);
    expect(betaWsTasks[0].id).toBe("task-2");
  });

  it("updates task state and diffSummary", async () => {
    await store.saveTask(sampleTask);
    const updated = await store.updateTask("task-1", {
      state: "coding",
      diffSummary: { additions: 10, deletions: 2, filesChanged: 1 },
    });

    expect(updated.state).toBe("coding");
    expect(updated.diffSummary?.additions).toBe(10);

    const reloaded = await store.getTask("task-1");
    expect(reloaded?.state).toBe("coding");
  });

  it("handles concurrent atomic updates safely", async () => {
    await store.saveTask(sampleTask);
    await Promise.all([
      store.updateTask("task-1", { state: "coding" }),
      store.updateTask("task-1", { state: "self_review" }),
    ]);

    const final = await store.getTask("task-1");
    expect(["coding", "self_review"]).toContain(final?.state);
  });
});
