import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiteaClient } from "../server/gitea-client.js";

describe("GiteaClient", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedRequests: Array<{
    url: string;
    method: string;
    body?: Record<string, unknown>;
    headers?: unknown;
  }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedRequests = [];

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        const method = init?.method ?? "GET";
        const body = init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : undefined;
        capturedRequests.push({ url: urlStr, method, body, headers: init?.headers });

        if (urlStr.includes("/issues?state=open")) {
          return new Response(
            JSON.stringify([
              {
                number: 42,
                title: "Add dark mode toggle",
                body: "Please add a toggle in settings.",
                html_url: "http://gitea.local/owner/repo/issues/42",
                labels: [{ name: "agent-ready" }],
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (
          urlStr.includes("/labels") ||
          urlStr.includes("/comments") ||
          urlStr.includes("/pulls")
        ) {
          return new Response(
            JSON.stringify({ ok: true, html_url: "http://gitea.local/owner/repo/pulls/10" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("Not found", { status: 404 });
      });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("filters out issues missing listenLabel or containing pull_request", async () => {
    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
    });

    // Mock returning mixed issues (Gitea API behavior when label does not exist)
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      return new Response(
        JSON.stringify([
          { number: 1, title: "No label issue", labels: [] },
          { number: 2, title: "Other label issue", labels: [{ name: "status:doing" }] },
          {
            number: 3,
            title: "PR with label",
            labels: [{ name: "agent-ready" }],
            pull_request: {},
          },
          { number: 4, title: "Real agent-ready issue", labels: [{ name: "agent-ready" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const issues = await client.fetchReadyIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(4);
  });

  it("fetches ready issues with pagination parameters", async () => {
    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    const issues = await client.fetchReadyIssues({ page: 2, limit: 20 });
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(42);
    expect(issues[0].title).toBe("Add dark mode toggle");

    const req = capturedRequests.find((r) => r.url.includes("/issues?state=open"));
    expect(req?.url).toContain("page=2");
    expect(req?.url).toContain("limit=20");
  });

  it("claims issue by updating labels and posting comment", async () => {
    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    await client.claimIssue(42);
    const commentReq = capturedRequests.find((r) => r.url.includes("/comments"));
    expect(commentReq).toBeDefined();
    expect(commentReq?.body?.body).toContain("Paseo Agent");
  });

  it("throws when claim label addition fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        const method = init?.method ?? "GET";
        if (urlStr.includes("/labels") && method === "DELETE") {
          return new Response("{}", { status: 200 });
        }
        if (urlStr.includes("/labels") && method === "POST") {
          return new Response("Forbidden", { status: 403, statusText: "Forbidden" });
        }
        return new Response("{}", { status: 200 });
      });

    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "invalid-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    await expect(client.claimIssue(42)).rejects.toThrow("Failed to add label");
  });

  it("creates a pull request", async () => {
    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    const pr = await client.createPullRequest({
      title: "[Agent] Add dark mode toggle",
      body: "Resolves #42",
      headBranch: "agent/issue-42",
      baseBranch: "main",
    });

    expect(pr.url).toBe("http://gitea.local/owner/repo/pulls/10");
  });

  it("recovers existing PR URL on 409 Conflict", async () => {
    globalThis.fetch = vi.fn().mockImplementationOnce(async () => {
      return new Response(
        JSON.stringify({
          message:
            "pull request already exists for these targets [id: 369, issue_id: 72, head_repo_id: 23, base_repo_id: 23, head_branch: agent/issue-70, base_branch: develop]",
          url: "https://git.codevai.cc/api/swagger",
        }),
        { status: 409, statusText: "Conflict" },
      );
    });

    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
    });

    const pr = await client.createPullRequest({
      title: "[Agent] Issue 70",
      body: "Resolves #70",
      headBranch: "agent/issue-70",
      baseBranch: "develop",
    });

    expect(pr.url).toBe("http://gitea.local/owner/repo/pulls/72");
  });

  it("does not recreate label when it already exists in repo", async () => {
    let postLabelCalled = false;
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      const urlStr = url.toString();
      const method = init?.method ?? "GET";
      if (urlStr.includes("/labels") && method === "GET") {
        return new Response(JSON.stringify([{ id: 45, name: "agent-reviewed" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (!urlStr.includes("/issues/") && urlStr.includes("/labels") && method === "POST") {
        postLabelCalled = true;
        return new Response(JSON.stringify({ id: 99, name: "agent-reviewed" }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    });

    const client = new GiteaClient({
      giteaUrl: "http://gitea.local",
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      reviewedLabel: "agent-reviewed",
    });

    await client.markReviewed(70);
    expect(postLabelCalled).toBe(false);
  });
});
