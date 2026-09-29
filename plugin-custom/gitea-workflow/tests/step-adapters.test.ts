import { describe, it, expect, vi } from "vitest";
import { createFetchIssueAdapter } from "../server/adapters/fetch-issue.js";
import { createClaimIssueAdapter } from "../server/adapters/claim-issue.js";
import { createUpdateStatusAdapter } from "../server/adapters/update-status.js";
import { createPostSummaryAdapter } from "../server/adapters/post-summary.js";
import { createResolveDeliveryAdapter } from "../server/adapters/resolve-delivery.js";

describe("Gitea Dedicated Step Adapters", () => {
  describe("gitea.fetch_issue", () => {
    it("fetches issue details and computes immutable digest", async () => {
      const mockClient = {
        getIssue: vi.fn().mockResolvedValue({
          number: 42,
          title: "Fix responsive navbar",
          body: "Navbar wraps on 375px screens",
          html_url: "https://git.example.com/org/repo/issues/42",
          labels: [{ name: "agent-ready" }],
        }),
      };
      const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };
      const adapter = createFetchIssueAdapter(mockPool as any);

      const result = await adapter.execute(
        {
          baseUrl: "https://git.example.com",
          token: "tok",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 42,
        },
        { paseo: {} as any, run: { projectId: "p1", workspaceId: "w1", runId: "r1" } },
      );

      expect(result.issueNumber).toBe(42);
      expect(result.title).toBe("Fix responsive navbar");
      expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("gitea.claim_issue", () => {
    it("claims issue atomically and transitions labels", async () => {
      const mockClient = {
        getIssue: vi.fn().mockResolvedValue({
          number: 42,
          labels: [{ name: "agent-ready", id: 101 }],
        }),
        claimIssue: vi.fn().mockResolvedValue(undefined),
      };
      const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };

      const adapter = createClaimIssueAdapter(mockPool as any);
      const result = await adapter.execute(
        {
          baseUrl: "https://git.example.com",
          token: "tok",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 42,
          listenLabel: "agent-ready",
          inProgressLabel: "agent-in-progress",
        },
        { paseo: {} as any, run: { projectId: "p1", workspaceId: "w1", runId: "r1" } },
      );

      expect(result.claimed).toBe(true);
      expect(mockClient.claimIssue).toHaveBeenCalledWith(42, 101);
    });

    it("aborts claim if readyLabel was already removed", async () => {
      const mockClient = {
        getIssue: vi.fn().mockResolvedValue({
          number: 42,
          labels: [{ name: "other-label", id: 102 }],
        }),
        claimIssue: vi.fn(),
      };
      const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };

      const adapter = createClaimIssueAdapter(mockPool as any);
      await expect(
        adapter.execute(
          {
            baseUrl: "https://git.example.com",
            token: "tok",
            repoOwner: "org",
            repoName: "repo",
            issueNumber: 42,
            listenLabel: "agent-ready",
            inProgressLabel: "agent-in-progress",
          },
          { paseo: {} as any, run: { projectId: "p1", workspaceId: "w1", runId: "r1" } },
        ),
      ).rejects.toThrow("Label 'agent-ready' no longer present on issue #42");
      expect(mockClient.claimIssue).not.toHaveBeenCalled();
    });
  });

  describe("gitea.update_status", () => {
    it("updates labels on issue", async () => {
      const mockClient = {
        addLabelsByName: vi.fn().mockResolvedValue(undefined),
        removeLabelsByName: vi.fn().mockResolvedValue(undefined),
      };
      const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };
      const adapter = createUpdateStatusAdapter(mockPool as any);

      const result = await adapter.execute(
        {
          baseUrl: "https://git.example.com",
          token: "tok",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 42,
          addLabels: ["status:review", "agent-reviewed"],
          removeLabels: ["status:doing", "agent-in-progress"],
        },
        { paseo: {} as any, run: { projectId: "p1", workspaceId: "w1", runId: "r1" } },
      );

      expect(result.success).toBe(true);
      expect(mockClient.removeLabelsByName).toHaveBeenCalledWith(42, [
        "status:doing",
        "agent-in-progress",
      ]);
      expect(mockClient.addLabelsByName).toHaveBeenCalledWith(42, [
        "status:review",
        "agent-reviewed",
      ]);
    });
  });

  describe("gitea.post_lifecycle_summary", () => {
    it("posts sanitized markdown comment without exposing local paths or tokens", async () => {
      const mockClient = {
        createComment: vi.fn().mockResolvedValue(undefined),
      };
      const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };
      const adapter = createPostSummaryAdapter(mockPool as any);

      const result = await adapter.execute(
        {
          baseUrl: "https://git.example.com",
          token: "super-secret-token",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 42,
          stage: "pr_created",
          summary: "Implementation complete and PR submitted.",
          prUrl: "https://git.example.com/org/repo/pulls/10",
        },
        { paseo: {} as any, run: { projectId: "p1", workspaceId: "w1", runId: "r1" } },
      );

      expect(result.commentPosted).toBe(true);
      expect(mockClient.createComment).toHaveBeenCalledTimes(1);
      const callArg = mockClient.createComment.mock.calls[0][1];
      expect(callArg).toContain("Paseo Agent");
      expect(callArg).toContain("https://git.example.com/org/repo/pulls/10");
      expect(callArg).not.toContain("super-secret-token");
    });
  });

  describe("gitea.resolve_delivery", () => {
    it("assembles delivery manifest and computes digest", async () => {
      const adapter = createResolveDeliveryAdapter({
        getCommitSha: async () => "abcdef1234567890abcdef1234567890abcdef12",
      });

      const result = await adapter.execute(
        {
          sourceBranch: "agent/issue-42-feat",
          targetBranch: "main",
          pullRequestTitle: "feat: add navbar",
          pullRequestBody: "Resolves #42 with responsive styles.",
          issueReference: "42",
          cwd: "/workspace/repo",
        },
        { paseo: {} as any, run: { projectId: "p1", workspaceId: "w1", runId: "r1" } },
      );

      expect(result.manifest).toMatchObject({
        sourceBranch: "agent/issue-42-feat",
        targetBranch: "main",
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        pullRequestTitle: "feat: add navbar",
        issueReference: "42",
      });
      expect(result.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
