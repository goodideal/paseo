import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "../../shared/workflow-types.js";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";
import { resolveGiteaAdapterTarget } from "./run-workspace.js";

export function createFetchIssueAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.fetch_issue",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional().default(""),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      issueNumber: z.number().int().optional(),
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
      const { token, baseUrl, repoOwner, repoName, issueNumber, identityId } =
        await resolveGiteaAdapterTarget(rawInput as Record<string, unknown>, context, indexStore);

      if (!baseUrl || !repoOwner || !repoName || !issueNumber) {
        throw new Error(
          `fetch_issue missing required parameters: baseUrl=${baseUrl}, repoOwner=${repoOwner}, repoName=${repoName}, issueNumber=${issueNumber}`,
        );
      }

      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
        ...(identityId ? { identityId } : {}),
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
