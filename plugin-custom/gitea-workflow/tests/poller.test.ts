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

  it("cancels and supersedes stale run in waiting_approval when user tags issue with agent-plan", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-retrigger",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([
          { number: 137, title: "Semantic cache", labels: [{ name: "agent-plan" }] },
        ]),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue("run-stale-137"),
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-new-137" }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
      runInspect: vi.fn().mockResolvedValue({
        run: {
          runId: "run-stale-137",
          workflowId: "gitea.issue-to-pr.unattended",
          status: "waiting_approval",
          createdAt: Date.now() - 3600_000,
        },
      }),
      runCancel: vi.fn().mockResolvedValue({ success: true }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-1", projectId: "proj-retrigger", workspaceKind: "local_checkout" }],
      }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-retrigger", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockWorkflows.runCancel).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-stale-137",
      }),
    );
    expect(mockIndexStore.removeRun).toHaveBeenCalledWith("proj-retrigger", "org", "repo", 137);
    expect(mockWorkflows.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "gitea.issue-to-pr.plan",
        input: expect.objectContaining({ issueNumber: 137 }),
      }),
    );
  });

  it("posts gate prompt and approves workflow when approval comment is found during waiting_approval", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-gate",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([
          { number: 137, title: "Semantic cache", labels: [{ name: "agent-plan" }] },
        ]),
      addIssueLabel: vi.fn().mockResolvedValue(undefined),
      removeIssueLabel: vi.fn().mockResolvedValue(undefined),
      listIssueComments: vi.fn().mockResolvedValue([
        {
          id: 501,
          body: "同意",
          created_at: new Date(Date.now() + 1000).toISOString(),
        },
      ]),
      createIssueComment: vi.fn().mockResolvedValue({ id: 502 }),
    };
    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue("run-gate-137"),
      hasActiveRunForIssue: vi.fn().mockResolvedValue(true),
      recordRun: vi.fn(),
      removeRun: vi.fn(),
      listEntries: vi.fn().mockResolvedValue([
        {
          issueNumber: 137,
          runId: "run-gate-137",
          projectId: "proj-gate",
          repoOwner: "org",
          repoName: "repo",
        },
      ]),
    };
    const mockWorkflows = {
      runCreate: vi.fn(),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
      runInspect: vi.fn().mockResolvedValue({
        run: {
          runId: "run-gate-137",
          workflowId: "gitea.issue-to-pr.plan",
          status: "waiting_approval",
          createdAt: Date.now() - 10_000,
        },
      }),
      approvalList: vi.fn().mockResolvedValue({
        approvals: [
          {
            approvalId: "app-1",
            stepId: "gate-brainstorm",
            status: "pending",
            createdAt: new Date(Date.now() - 5000).toISOString(),
            policyReason: "Brainstorm proposal requires confirmation",
          },
        ],
      }),
      approvalApprove: vi.fn().mockResolvedValue({ success: true }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-1", projectId: "proj-gate", workspaceKind: "local_checkout" }],
      }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-gate", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockClient.addIssueLabel).toHaveBeenCalledWith(137, "agent-waiting-approval");
    expect(mockWorkflows.approvalApprove).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-gate-137",
        approvalId: "app-1",
      }),
    );
    expect(mockClient.removeIssueLabel).toHaveBeenCalledWith(137, "agent-waiting-approval");
  });
  it("updates issue labels to agent-delivered when workflow run completes", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-complete",
        baseUrl: "https://gitea.local",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([]),
      removeIssueLabel: vi.fn().mockResolvedValue(undefined),
      addIssueLabel: vi.fn().mockResolvedValue(undefined),
    };
    const mockIndexStore = {
      listEntries: vi.fn().mockResolvedValue([
        {
          projectId: "proj-complete",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 200,
          runId: "run-complete-200",
        },
      ]),
      removeRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      runInspect: vi.fn().mockResolvedValue({
        run: { runId: "run-complete-200", status: "succeeded" },
      }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-1", projectId: "proj-complete", workspaceKind: "local_checkout" }],
      }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-complete", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockIndexStore.removeRun).toHaveBeenCalledWith("proj-complete", "org", "repo", 200);
    expect(mockClient.removeIssueLabel).toHaveBeenCalledWith(200, "agent-in-progress");
    expect(mockClient.removeIssueLabel).toHaveBeenCalledWith(200, "agent-waiting-approval");
    expect(mockClient.addIssueLabel).toHaveBeenCalledWith(200, "agent-delivered");
  });
  it("injects agent proposal summary into gate prompt comment when waiting for approval", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-prop",
        baseUrl: "https://gitea.local",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([]),
      addIssueLabel: vi.fn().mockResolvedValue(undefined),
      removeIssueLabel: vi.fn().mockResolvedValue(undefined),
      listIssueComments: vi.fn().mockResolvedValue([]),
      createIssueComment: vi.fn().mockResolvedValue({ id: 888 }),
    };
    const mockIndexStore = {
      listEntries: vi.fn().mockResolvedValue([
        {
          issueNumber: 155,
          runId: "run-prop-155",
          projectId: "proj-prop",
          repoOwner: "org",
          repoName: "repo",
        },
      ]),
    };
    const mockWorkflows = {
      runInspect: vi.fn().mockResolvedValue({
        run: {
          runId: "run-prop-155",
          workflowId: "gitea.issue-to-pr.plan",
          status: "waiting_approval",
          stepAttempts: [
            {
              stepId: "brainstorm-agent",
              status: "succeeded",
              declaredOutputs: {
                summary:
                  "#### 方案架构建议\n- 方案 A: Redis 缓存\n- 方案 B: 本地 SQLite\n推荐方案 A。",
              },
            },
          ],
        },
      }),
      approvalList: vi.fn().mockResolvedValue({
        approvals: [
          {
            approvalId: "app-prop-1",
            stepId: "gate-brainstorm",
            status: "pending",
            createdAt: new Date().toISOString(),
            policyReason: "Brainstorm proposal requires confirmation",
          },
        ],
      }),
    };
    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-1", projectId: "proj-prop", workspaceKind: "local_checkout" }],
      }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [{ projectId: "proj-prop", projectKind: "git" }] as any,
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(mockClient.createIssueComment).toHaveBeenCalledWith(
      155,
      expect.stringContaining("#### 方案架构建议"),
    );
  });
});
