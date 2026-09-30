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
      getRunIdForIssue: vi.fn().mockResolvedValue(null),
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-gitea-101" }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
      runInspect: vi.fn(),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-active", projectId: "proj-auth", workspaceKind: "local_checkout" }],
      }),
      open: vi.fn(),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-auth", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-auth",
        workspaceId: "wks-active",
        workflowId: "gitea.issue-to-pr",
        input: expect.objectContaining({ issueNumber: 101, token: "tok" }),
      }),
    );
    expect(mockIndexStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 101, runId: "run-gitea-101" }),
    );
  });

  it("retries issue when existing workflow run has failed", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-retry",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([{ number: 303, title: "Retry bug", labels: [] }]),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue("run-failed-303"),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-new-303" }),
      runInspect: vi.fn().mockResolvedValue({
        run: { id: "run-failed-303", status: "failed" },
      }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-retry", projectId: "proj-retry", workspaceKind: "local_checkout" }],
      }),
      open: vi.fn(),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () =>
        [{ projectId: "proj-retry", projectRootPath: "/path/to/repo", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockIndexStore.removeRun).toHaveBeenCalledWith("proj-retry", "org", "repo", 303);
    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-retry",
        workspaceId: "wks-retry",
        input: expect.objectContaining({ issueNumber: 303, token: "tok" }),
      }),
    );
  });

  it("skips issue when existing workflow run is actively running", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-running",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([{ number: 404, title: "Running bug", labels: [] }]),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue("run-active-404"),
      recordRun: vi.fn(),
      removeRun: vi.fn(),
    };
    const mockWorkflows = {
      runCreate: vi.fn(),
      runInspect: vi.fn().mockResolvedValue({
        run: { id: "run-active-404", status: "running" },
      }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [
          { id: "wks-running", projectId: "proj-running", workspaceKind: "local_checkout" },
        ],
      }),
      open: vi.fn(),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () =>
        [
          { projectId: "proj-running", projectRootPath: "/path/to/repo", projectKind: "git" },
        ] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockIndexStore.removeRun).not.toHaveBeenCalled();
    expect(mockWorkflows.runCreate).not.toHaveBeenCalled();
  });

  it("falls back to workspaces.open when no active workspace is in list", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-fallback",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([{ number: 202, title: "Feature", labels: [] }]),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue(null),
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn(),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-202" }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({ entries: [] }),
      open: vi.fn().mockResolvedValue({ id: "wks-opened" }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () =>
        [
          { projectId: "proj-fallback", projectRootPath: "/path/to/repo", projectKind: "git" },
        ] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockWorkspaces.open).toHaveBeenCalledWith({ cwd: "/path/to/repo" });
    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-fallback",
        workspaceId: "wks-opened",
      }),
    );
  });

  it("skips project and does not call runCreate when workspace cannot be resolved", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-noworkspace",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockWorkflows = {
      runCreate: vi.fn(),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({ entries: [] }),
      open: vi.fn().mockRejectedValue(new Error("Directory not found")),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => ({ fetchReadyIssues: vi.fn() }) } as any,
      indexStore: {
        hasActiveRunForIssue: vi.fn(),
        getRunIdForIssue: vi.fn().mockResolvedValue(null),
        removeRun: vi.fn(),
      } as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () =>
        [
          { projectId: "proj-noworkspace", projectRootPath: "/nonexistent", projectKind: "git" },
        ] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).not.toHaveBeenCalled();
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

  it("dispatches to gitea.issue-to-pr.auto for agent-auto tag", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-auto",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([{ number: 701, title: "Auto bug", labels: [{ name: "agent-auto" }] }]),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue(null),
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-auto-701" }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
      runInspect: vi.fn(),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-auto", projectId: "proj-auto", workspaceKind: "local_checkout" }],
      }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-auto", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-auto",
        workspaceId: "wks-auto",
        workflowId: "gitea.issue-to-pr.auto",
        input: expect.objectContaining({
          issueNumber: 701,
          mode: "auto",
          conflictWarning: false,
        }),
      }),
    );
  });

  it("dispatches to gitea.issue-to-pr.plan for agent-plan tag", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-plan",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([{ number: 702, title: "Plan bug", labels: [{ name: "agent-plan" }] }]),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue(null),
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-plan-702" }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
      runInspect: vi.fn(),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-plan", projectId: "proj-plan", workspaceKind: "local_checkout" }],
      }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-plan", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-plan",
        workspaceId: "wks-plan",
        workflowId: "gitea.issue-to-pr.plan",
        input: expect.objectContaining({
          issueNumber: 702,
          mode: "plan",
          conflictWarning: false,
        }),
      }),
    );
  });
});
