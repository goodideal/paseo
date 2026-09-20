import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store.js";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { GiteaClientPool } from "../server/client-pool.js";
import type { ResolvedProjectGitea } from "../shared/types.js";

describe("WorktreeOrchestrator Multi-Project", () => {
  const sampleProject: ResolvedProjectGitea = {
    projectId: "proj-1",
    projectPath: "/tmp/proj-1",
    projectName: "proj-1",
    host: "gitea.local",
    baseUrl: "http://gitea.local",
    token: "tok",
    repoOwner: "owner",
    repoName: "proj-1",
    authSource: "tea",
  };

  it("enqueues issue with project metadata and executes through state machine", async () => {
    const storePath = join(tmpdir(), `test-orch-${Date.now()}.json`);
    const store = new TaskStore(storePath);
    const clientPool = new GiteaClientPool();

    const mockClient = clientPool.getClient({
      giteaUrl: sampleProject.baseUrl,
      giteaToken: sampleProject.token,
      repoOwner: sampleProject.repoOwner,
      repoName: sampleProject.repoName,
    });

    vi.spyOn(mockClient, "claimIssue").mockResolvedValue(undefined);
    vi.spyOn(mockClient, "createPullRequest").mockResolvedValue({
      url: "http://gitea.local/owner/proj-1/pulls/5",
    });
    vi.spyOn(mockClient, "markReviewed").mockResolvedValue(undefined);

    const orchestrator = new WorktreeOrchestrator({
      store,
      clientPool,
      maxConcurrentWorktrees: 2,
    });

    const task = await orchestrator.enqueueIssue(sampleProject, {
      number: 10,
      title: "Add API Endpoint",
      body: "Need GET /users",
      html_url: "http://gitea.local/owner/proj-1/issues/10",
      labels: [{ name: "agent-ready" }],
    });

    expect(task.projectId).toBe("proj-1");
    expect(task.state).toBe("queued");

    await orchestrator.processQueue();
    await orchestrator.waitForIdle();

    const pendingReview = await store.getTask(task.id);
    expect(pendingReview?.state).toBe("pending_human_review");
    expect(pendingReview?.diffSummary).toBeDefined();

    // Human approves
    const approveRes = await orchestrator.approveTask(task.id);
    expect(approveRes.ok).toBe(true);
    expect(approveRes.prUrl).toBe("http://gitea.local/owner/proj-1/pulls/5");

    const finalTask = await store.getTask(task.id);
    expect(finalTask?.state).toBe("done");
  });
});
