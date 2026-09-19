import { describe, expect, it, vi } from "vitest";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { TaskStore } from "../server/store.js";
import type { GiteaClient } from "../server/gitea-client.js";

describe("WorktreeOrchestrator", () => {
  it("enqueues issue and creates task record", async () => {
    const store = new TaskStore("/tmp/test-tasks.json");
    vi.spyOn(store, "saveTask").mockImplementation(async () => {});
    vi.spyOn(store, "getTask").mockImplementation(async () => null);

    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({ url: "http://pr.url" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    const orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: "/projects/repo",
      projectName: "repo",
    });

    const task = await orchestrator.enqueueIssue({
      number: 10,
      title: "Add search bar",
      body: "Search bar should be in header.",
      html_url: "http://gitea.local/repo/issues/10",
      labels: [{ name: "agent-ready" }],
    });

    expect(task.id).toBe("task-gitea-10");
    expect(task.state).toBe("queued");
    expect(mockGitea.claimIssue).toHaveBeenCalledWith(10);
  });
});
