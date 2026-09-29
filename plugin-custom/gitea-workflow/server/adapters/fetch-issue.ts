import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";

export function createFetchIssueAdapter(
  clientPool: GiteaClientPool,
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
    execute: async (rawInput) => {
      const input = rawInput as {
        baseUrl: string;
        token: string;
        repoOwner: string;
        repoName: string;
        issueNumber: number;
      };

      const client = clientPool.getClient({
        giteaUrl: input.baseUrl,
        giteaToken: input.token,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      });

      const issue = await client.getIssue(input.issueNumber);
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
