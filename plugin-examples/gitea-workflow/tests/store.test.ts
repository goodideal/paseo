import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "../server/store.js";
import type { GiteaWorkflowTask } from "../shared/types.js";

describe("TaskStore", () => {
  let tempDir: string;
  let storePath: string;
  let store: TaskStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gitea-store-test-"));
    storePath = join(tempDir, "tasks.json");
    store = new TaskStore(storePath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists and reads tasks", async () => {
    const task: GiteaWorkflowTask = {
      id: "task-1",
      issueNumber: 1,
      issueTitle: "Test Issue",
      issueUrl: "http://example.com/1",
      issueBody: "Body text",
      repoOwner: "testowner",
      repoName: "testrepo",
      branchName: "agent/issue-1-test",
      workspaceId: null,
      agentId: null,
      state: "queued",
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.saveTask(task);
    const loaded = await store.getTask("task-1");
    expect(loaded).toEqual(task);

    const all = await store.listTasks();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("task-1");
  });

  it("updates task state atomically", async () => {
    const task: GiteaWorkflowTask = {
      id: "task-2",
      issueNumber: 2,
      issueTitle: "State transition",
      issueUrl: "http://example.com/2",
      issueBody: "Test",
      repoOwner: "owner",
      repoName: "repo",
      branchName: "agent/issue-2",
      workspaceId: null,
      agentId: null,
      state: "queued",
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.saveTask(task);
    await store.updateTask("task-2", { state: "coding", agentId: "agent-99" });

    const updated = await store.getTask("task-2");
    expect(updated?.state).toBe("coding");
    expect(updated?.agentId).toBe("agent-99");
  });
});
