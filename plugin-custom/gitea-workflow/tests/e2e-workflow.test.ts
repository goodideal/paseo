import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IssueRunIndexStore } from "../server/store.js";
import { GiteaClientPool } from "../server/client-pool.js";
import { ProjectGiteaResolver } from "../server/resolver.js";
import { MultiProjectPoller } from "../server/poller.js";
import { SettingsManager } from "../server/settings-manager.js";
import { issueToPrPreset } from "../server/presets/issue-to-pr.js";

describe("E2E Automated Task to Review Flow (Multi-Project)", () => {
  it("runs full lifecycle: ingestion -> poller -> workflow preset run -> index tracking", async () => {
    const indexPath = join(tmpdir(), `test-e2e-index-${Date.now()}.json`);
    const indexStore = new IssueRunIndexStore(indexPath);
    const clientPool = new GiteaClientPool();
    const resolver = new ProjectGiteaResolver();

    const mockSettings = {
      current: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        projects: { "proj-ecommerce": { enabled: true, readyLabel: "agent-ready" } },
      },
      isProjectAuthorized: vi.fn().mockImplementation((id: string) => id === "proj-ecommerce"),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };

    vi.spyOn(resolver, "resolveProject").mockResolvedValue({
      projectId: "proj-ecommerce",
      projectPath: "/tmp/ecom",
      projectName: "ecommerce",
      host: "gitea.local",
      baseUrl: "http://gitea.local",
      token: "tok-123",
      repoOwner: "shop",
      repoName: "storefront",
      authSource: "tea",
    });

    const client = clientPool.getClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "tok-123",
      repoOwner: "shop",
      repoName: "storefront",
      listenLabel: "agent-ready",
    });

    vi.spyOn(client, "fetchReadyIssues").mockResolvedValue([
      {
        number: 1,
        title: "Product page mobile wrap issue",
        body: "Cart button overflows viewport width on small devices.",
        html_url: "http://gitea.local/shop/storefront/issues/1",
        labels: [{ name: "agent-ready" }],
      },
    ]);

    const createdRuns: Array<{ presetId: string; input: Record<string, unknown> }> = [];
    const mockWorkflows = {
      runCreate: vi.fn().mockImplementation(async (opts) => {
        createdRuns.push({ presetId: opts.workflowId, input: opts.input });
        return { runId: "run-ecom-1" };
      }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
    };

    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [
          { id: "wks-ecom-1", projectId: "proj-ecommerce", workspaceKind: "local_checkout" },
        ],
      }),
      open: vi.fn(),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver,
      clientPool,
      indexStore,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [
        {
          projectId: "proj-ecommerce",
          projectRootPath: "/tmp/ecom",
          projectKind: "git",
        },
      ],
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(createdRuns).toHaveLength(1);
    expect(createdRuns[0].presetId).toBe(issueToPrPreset.workflowId);
    expect(createdRuns[0].input.issueNumber).toBe(1);
    expect(await indexStore.hasActiveRunForIssue("proj-ecommerce", "shop", "storefront", 1)).toBe(
      true,
    );
  });

  it("routes agent-auto issue to auto preset and agent-plan issue to plan preset end-to-end", async () => {
    const indexPath = join(tmpdir(), `test-e2e-tag-index-${Date.now()}.json`);
    const indexStore = new IssueRunIndexStore(indexPath);
    const clientPool = new GiteaClientPool();
    const resolver = new ProjectGiteaResolver();

    const mockSettings = {
      current: {
        enabled: true,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 5,
        projects: { "proj-tags": { enabled: true } },
      },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };

    vi.spyOn(resolver, "resolveProject").mockResolvedValue({
      projectId: "proj-tags",
      projectPath: "/tmp/tags",
      projectName: "tag-project",
      host: "gitea.local",
      baseUrl: "http://gitea.local",
      token: "tok-456",
      repoOwner: "org",
      repoName: "repo",
      authSource: "tea",
    });

    const client = clientPool.getClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "tok-456",
      repoOwner: "org",
      repoName: "repo",
    });

    vi.spyOn(client, "fetchReadyIssues").mockResolvedValue([
      {
        number: 10,
        title: "Auto task",
        body: "Execute unattended",
        html_url: "http://gitea.local/org/repo/issues/10",
        labels: [{ name: "agent-auto" }],
      },
      {
        number: 11,
        title: "Plan task",
        body: "Execute strict superpowers",
        html_url: "http://gitea.local/org/repo/issues/11",
        labels: [{ name: "agent-plan" }],
      },
      {
        number: 12,
        title: "Conflict task",
        body: "Both tags present",
        html_url: "http://gitea.local/org/repo/issues/12",
        labels: [{ name: "agent-auto" }, { name: "agent-plan" }],
      },
    ]);

    const createdRuns: Array<{ presetId: string; input: Record<string, unknown> }> = [];
    const mockWorkflows = {
      runCreate: vi.fn().mockImplementation(async (opts) => {
        createdRuns.push({ presetId: opts.workflowId, input: opts.input });
        return { runId: `run-${opts.input.issueNumber}` };
      }),
      runList: vi.fn().mockResolvedValue({ runs: [] }),
    };

    const mockWorkspaces = {
      list: vi.fn().mockResolvedValue({
        entries: [{ id: "wks-tags", projectId: "proj-tags", workspaceKind: "local_checkout" }],
      }),
      open: vi.fn(),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver,
      clientPool,
      indexStore,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () => [
        {
          projectId: "proj-tags",
          projectRootPath: "/tmp/tags",
          projectKind: "git",
        },
      ],
      getWorkspaces: () => mockWorkspaces as any,
    });

    await poller.poll();

    expect(createdRuns).toHaveLength(3);

    // Issue 10: Auto mode
    expect(createdRuns[0].presetId).toBe("gitea.issue-to-pr.auto");
    expect(createdRuns[0].input.mode).toBe("auto");
    expect(createdRuns[0].input.conflictWarning).toBe(false);

    // Issue 11: Plan mode
    expect(createdRuns[1].presetId).toBe("gitea.issue-to-pr.plan");
    expect(createdRuns[1].input.mode).toBe("plan");
    expect(createdRuns[1].input.conflictWarning).toBe(false);

    // Issue 12: Conflict -> Demote to Plan mode with warning
    expect(createdRuns[2].presetId).toBe("gitea.issue-to-pr.plan");
    expect(createdRuns[2].input.mode).toBe("plan");
    expect(createdRuns[2].input.conflictWarning).toBe(true);
  });
});
