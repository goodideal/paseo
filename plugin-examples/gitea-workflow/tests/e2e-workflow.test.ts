import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store.js";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { GiteaClientPool } from "../server/client-pool.js";
import type { ResolvedProjectGitea } from "../shared/types.js";

describe("E2E Automated Task to Review Flow (Multi-Project)", () => {
  it("runs full lifecycle: ingestion -> worktree -> review -> approve -> PR", async () => {
    const storePath = join(tmpdir(), `test-e2e-${Date.now()}.json`);
    const store = new TaskStore(storePath);
    const clientPool = new GiteaClientPool();

    const sampleProject: ResolvedProjectGitea = {
      projectId: "proj-ecommerce",
      projectPath: "/tmp/ecom",
      projectName: "ecommerce",
      host: "gitea.local",
      baseUrl: "http://gitea.local",
      token: "tok-123",
      repoOwner: "shop",
      repoName: "storefront",
      authSource: "tea",
    };

    const client = clientPool.getClient({
      giteaUrl: sampleProject.baseUrl,
      giteaToken: sampleProject.token,
      repoOwner: sampleProject.repoOwner,
      repoName: sampleProject.repoName,
    });

    vi.spyOn(client, "claimIssue").mockResolvedValue(undefined);
    vi.spyOn(client, "markReviewed").mockResolvedValue(undefined);
    vi.spyOn(client, "createPullRequest").mockResolvedValue({
      url: "http://gitea.local/shop/storefront/pulls/88",
    });

    const mockBroker = {
      execute: vi.fn().mockImplementation(async ({ command }) => {
        if (command === "new_tab") {
          return { ok: true, result: { browserId: "tab-123" } };
        }
        if (command === "screenshot") {
          return { ok: true, result: { base64: Buffer.from("fake-png").toString("base64") } };
        }
        return { ok: true };
      }),
    };

    const orchestrator = new WorktreeOrchestrator({
      store,
      clientPool,
      screenshotBroker: mockBroker,
      paseoApi: {
        workspaces: {
          create: vi.fn().mockResolvedValue({ id: "ws-e2e-test" }),
          ref: vi.fn().mockReturnValue({
            agents: {
              create: vi.fn().mockResolvedValue({ id: "agent-e2e-test" }),
            },
          }),
        },
        scripts: {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    // 1. Issue Enqueued
    const task = await orchestrator.enqueueIssue(sampleProject, {
      number: 88,
      title: "Add Apple Pay Support",
      body: "Integrate Apple Pay into checkout button",
      html_url: "http://gitea.local/shop/storefront/issues/88",
      labels: [{ name: "agent-ready" }],
    });

    expect(task.state).toBe("queued");
    expect(task.projectId).toBe("proj-ecommerce");

    // 2. Process Queue & Wait for Execution
    await orchestrator.processQueue();
    await orchestrator.waitForIdle();

    // 3. Verify in Pending Human Review
    const pendingTask = await store.getTask(task.id);
    expect(pendingTask?.state).toBe("pending_human_review");
    expect(pendingTask?.workspaceId).toBe("ws-e2e-test");
    expect(pendingTask?.agentId).toBe("agent-e2e-test");
    expect(pendingTask?.screenshots).toHaveLength(2);
    expect(pendingTask?.screenshots[0].dataUri).toBeDefined();

    // 4. Human Approval
    const approveRes = await orchestrator.approveTask(task.id);
    expect(approveRes.ok).toBe(true);
    expect(approveRes.prUrl).toBe("http://gitea.local/shop/storefront/pulls/88");

    // 5. Final State Done
    const finalTask = await store.getTask(task.id);
    expect(finalTask?.state).toBe("done");
  });

  it("handles rejection loop: pending_review -> reject with feedback -> re-executes to pending_review", async () => {
    const storePath = join(tmpdir(), `test-e2e-reject-${Date.now()}.json`);
    const store = new TaskStore(storePath);
    const clientPool = new GiteaClientPool();

    const sampleProject: ResolvedProjectGitea = {
      projectId: "proj-web",
      projectPath: "/tmp/web",
      projectName: "web",
      host: "gitea.local",
      baseUrl: "http://gitea.local",
      token: "tok-123",
      repoOwner: "org",
      repoName: "web",
      authSource: "tea",
    };

    const client = clientPool.getClient({
      giteaUrl: sampleProject.baseUrl,
      giteaToken: sampleProject.token,
      repoOwner: sampleProject.repoOwner,
      repoName: sampleProject.repoName,
    });

    vi.spyOn(client, "claimIssue").mockResolvedValue(undefined);

    const orchestrator = new WorktreeOrchestrator({
      store,
      clientPool,
    });

    const task = await orchestrator.enqueueIssue(sampleProject, {
      number: 99,
      title: "Fix Navigation Bar",
      body: "Navbar overlaps content",
      html_url: "http://gitea.local/org/web/issues/99",
      labels: [{ name: "agent-ready" }],
    });

    await orchestrator.processQueue();
    await orchestrator.waitForIdle();

    const pendingTask = await store.getTask(task.id);
    expect(pendingTask?.state).toBe("pending_human_review");

    // Human Rejection with feedback
    const rejectRes = await orchestrator.rejectTask(task.id, "Please adjust margin-top to 16px");
    expect(rejectRes.ok).toBe(true);

    await orchestrator.waitForIdle();

    const rePendingTask = await store.getTask(task.id);
    expect(rePendingTask?.state).toBe("pending_human_review");
    expect(rePendingTask?.reviewFeedback).toContain("Please adjust margin-top to 16px");
  });
});
