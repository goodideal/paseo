import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";

export function createFetchIssueAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.fetch_issue",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url(),
      token: z.string().optional().default(""),
      repoOwner: z.string(),
      repoName: z.string(),
      issueNumber: z.number().int(),
    }),
    outputSchema: z.object({
      issueNumber: z.number().int(),
      title: z.string(),
      body: z.string(),
      htmlUrl: z.string(),
      labels: z.array(z.string()),
      digest: z.string(),
    }),
    executionRisk: "read",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:issue:{{issueNumber}}",
    execute: async (rawInput, context) => {
      const input = rawInput as {
        baseUrl: string;
        token?: string;
        repoOwner: string;
        repoName: string;
        issueNumber: number;
      };

      let token = input.token || "";
      let baseUrl = input.baseUrl;
      let repoOwner = input.repoOwner;
      let repoName = input.repoName;
      let issueNumber = input.issueNumber;

      if (!token && (context as any)?.run?.runId && indexStore) {
        const entry = await indexStore.getEntryByRunId((context as any).run.runId);
        if (entry) {
          token = token || entry.token || "";
          baseUrl = baseUrl || entry.baseUrl || "";
          repoOwner = repoOwner || entry.repoOwner || "";
          repoName = repoName || entry.repoName || "";
          issueNumber = issueNumber || entry.issueNumber || 0;
        }
      }

      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
      });

      const issue = await client.getIssue(issueNumber);
      const labels = (issue.labels ?? []).map((l) => l.name);
      const digest = createHash("sha256")
        .update(
          JSON.stringify({ number: issue.number, title: issue.title, body: issue.body, labels }),
        )
        .digest("hex");

      return {
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        htmlUrl: issue.html_url,
        labels,
        digest,
      };
    },
  };
}
