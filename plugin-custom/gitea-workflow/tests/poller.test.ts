import { describe, expect, it, vi } from "vitest";
import { MultiProjectPoller } from "../server/poller.js";

describe("MultiProjectPoller", () => {
  it("skips unauthorized projects and creates workflow run for authorized ready issues", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockImplementation((id: string) => id === "proj-auth"),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-auth",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([{ number: 101, title: "Fix bug", labels: [{ name: "agent-ready" }] }]),
    };
    const mockIndexStore = {
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-gitea-101" }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-auth", projectKind: "git" }] as any,
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "gitea.issue-to-pr",
        input: expect.objectContaining({ issueNumber: 101 }),
      }),
    );
    expect(mockIndexStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 101, runId: "run-gitea-101" }),
    );
  });

  it("does not poll when global automation is disabled", async () => {
    const mockSettings = {
      current: { enabled: false, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
    };
    const mockWorkflows = {
      runCreate: vi.fn(),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: {} as any,
      clientPool: {} as any,
      indexStore: {} as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [] as any,
    });

    await poller.poll();
    expect(mockWorkflows.runCreate).not.toHaveBeenCalled();
  });
});
