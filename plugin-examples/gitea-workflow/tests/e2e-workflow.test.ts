import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "../server/store.js";
import type { GiteaClient } from "../server/gitea-client.js";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { ScreenshotPipeline, type ScreenshotBroker } from "../server/screenshot-pipeline.js";

describe("End-to-End Gitea Automated Workflow", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gitea-e2e-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("completes full lifecycle: claim -> screenshot -> human approve -> PR creation", async () => {
    const store = new TaskStore(join(tempDir, "tasks.json"));

    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi
        .fn()
        .mockResolvedValue({ url: "https://gitea.local/owner/repo/pulls/1" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    const orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: tempDir,
      projectName: "sample-app",
    });

    // 1. Enqueue issue
    const task = await orchestrator.enqueueIssue({
      number: 88,
      title: "Fix responsive layout",
      body: "Header overflows on mobile.",
      html_url: "https://gitea.local/owner/repo/issues/88",
      labels: [{ name: "agent-ready" }],
    });

    expect(task.state).toBe("queued");
    expect(mockGitea.claimIssue).toHaveBeenCalledWith(88);

    // 2. Mock Dev server & Screenshot pipeline
    const serviceUrl = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: task.branchName,
      projectName: "sample-app",
    });

    const mockBroker: ScreenshotBroker = {
      execute: vi.fn().mockImplementation(async (cmd) => {
        if (cmd.command === "new_tab") return { ok: true, result: { browserId: "tab-1" } };
        if (cmd.command === "screenshot") return { ok: true, result: { base64: "aGVsbG8=" } };
        return { ok: true, result: {} };
      }),
    };

    const screenshots = await ScreenshotPipeline.captureViewports({
      broker: mockBroker,
      url: serviceUrl,
      outputDir: tempDir,
    });

    expect(screenshots).toHaveLength(2);
    await store.updateTask(task.id, {
      state: "pending_human_review",
      screenshots,
    });

    const readyTask = await store.getTask(task.id);
    expect(readyTask?.state).toBe("pending_human_review");
    expect(readyTask?.screenshots).toHaveLength(2);

    // 3. Human approves task
    const approval = await orchestrator.approveTask(task.id);
    expect(approval.ok).toBe(true);
    expect(approval.prUrl).toBe("https://gitea.local/owner/repo/pulls/1");

    const finalTask = await store.getTask(task.id);
    expect(finalTask?.state).toBe("done");
    expect(mockGitea.markReviewed).toHaveBeenCalledWith(88);
  });
});
