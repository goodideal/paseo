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

  it("fetches ready issues", async () => {
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

    const issues = await client.fetchReadyIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(42);
    expect(issues[0].title).toBe("Add dark mode toggle");
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
});
