import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeOrchestrator, type OrchestratorPaseoApi } from "../server/orchestrator.js";
import { TaskStore } from "../server/store.js";
import type { GiteaClient } from "../server/gitea-client.js";
import type { ScreenshotBroker } from "../server/screenshot-pipeline.js";

describe("WorktreeOrchestrator", () => {
  let tempDir: string;
  let store: TaskStore;
  let orchestrator: WorktreeOrchestrator;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "orchestrator-test-"));
    store = new TaskStore(join(tempDir, "tasks.json"));
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.waitForIdle();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enqueues issue and creates task record", async () => {
    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({ url: "http://pr.url" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: tempDir,
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
    expect(mockGitea.claimIssue).toHaveBeenCalledWith(10);
  });

  it("executes task through full pipeline and stops dev server script", async () => {
    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({ url: "http://pr.url" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    const startScript = vi.fn().mockResolvedValue(undefined);
    const stopScript = vi.fn().mockResolvedValue(undefined);

    const mockPaseoApi: OrchestratorPaseoApi = {
      workspaces: {
        create: vi.fn().mockResolvedValue({ id: "ws-real-10" }),
        ref: vi.fn().mockReturnValue({
          agents: {
            create: vi.fn().mockResolvedValue({ id: "agent-real-10" }),
          },
        }),
      },
      scripts: {
        start: startScript,
        stop: stopScript,
      },
    };

    const mockBroker: ScreenshotBroker = {
      execute: vi.fn().mockImplementation(async (cmd) => {
        if (cmd.command === "new_tab") return { ok: true, result: { browserId: "tab-10" } };
        if (cmd.command === "screenshot") return { ok: true, result: { base64: "aGVsbG8=" } };
        return { ok: true, result: {} };
      }),
    };

    orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: tempDir,
      projectName: "repo",
      paseoApi: mockPaseoApi,
      screenshotBroker: mockBroker,
    });

    const task = await orchestrator.enqueueIssue({
      number: 10,
      title: "Add search bar",
      body: "Search bar should be in header.",
      html_url: "http://gitea.local/repo/issues/10",
      labels: [{ name: "agent-ready" }],
    });

    await orchestrator.executeTask(task);

    const finished = await store.getTask(task.id);
    expect(finished?.state).toBe("pending_human_review");
    expect(finished?.workspaceId).toBe("ws-real-10");
    expect(finished?.agentId).toBe("agent-real-10");
    expect(finished?.screenshots).toHaveLength(2);

    // Verify dev script lifecycle cleanup
    expect(startScript).toHaveBeenCalledWith({ workspaceId: "ws-real-10", scriptName: "dev" });
    expect(stopScript).toHaveBeenCalledWith({ workspaceId: "ws-real-10", scriptName: "dev" });
  });

  it("handles rejection and re-triggers execution with feedback", async () => {
    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({ url: "http://pr.url" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: tempDir,
      projectName: "repo",
    });

    const task = await orchestrator.enqueueIssue({
      number: 20,
      title: "Button styling",
      body: "Change button color.",
      html_url: "http://gitea.local/repo/issues/20",
      labels: [{ name: "agent-ready" }],
    });

    await orchestrator.executeTask(task);
    const ready = await store.getTask(task.id);
    expect(ready?.state).toBe("pending_human_review");

    // Reject with feedback
    await orchestrator.rejectTask(task.id, "Padding is too small");
    await orchestrator.waitForIdle();

    const reloaded = await store.getTask(task.id);
    expect(reloaded?.reviewFeedback).toContain("Padding is too small");
    expect(reloaded?.state).toBe("pending_human_review");
  });
});
