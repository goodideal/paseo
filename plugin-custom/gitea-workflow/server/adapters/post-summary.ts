import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";

function sanitizeCommentBody(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length > 3) {
      result = result.replaceAll(secret, "[redacted]");
    }
  }
  // Strip common local filesystem paths like /Users/..., /home/..., /root/... or C:\Users\...
  result = result.replace(
    /(\/Users\/[a-zA-Z0-9._-]+\/|\/home\/[a-zA-Z0-9._-]+\/|\/root\/|[a-zA-Z]:[\\\/]Users[\\\/][a-zA-Z0-9._-]+[\\\/])/g,
    "~/",
  );
  return result;
}

export function createPostSummaryAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.post_lifecycle_summary",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional().default(""),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      issueNumber: z.number().int().optional(),
      stage: z.string(),
      summary: z.string(),
      prUrl: z.string().optional(),
    }),
    outputSchema: z.object({
      commentPosted: z.boolean(),
    }),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:comment:{{issueNumber}}",
    execute: async (rawInput, context) => {
      const input = rawInput as {
        baseUrl?: string;
        token?: string;
        repoOwner?: string;
        repoName?: string;
        issueNumber?: number;
        stage: string;
        summary: string;
        prUrl?: string;
      };

      let token = input.token || "";
      let baseUrl = input.baseUrl || "";
      let repoOwner = input.repoOwner || "";
      let repoName = input.repoName || "";
      let issueNumber = input.issueNumber || 0;

      if ((!token || !repoOwner || !issueNumber || !baseUrl) && (context as any)?.run?.runId) {
        if (indexStore) {
          const entry = await indexStore.getEntryByRunId((context as any).run.runId);
          if (entry) {
            token = token || entry.token || "";
            baseUrl = baseUrl || entry.baseUrl || "";
            repoOwner = repoOwner || entry.repoOwner || "";
            repoName = repoName || entry.repoName || "";
            issueNumber = issueNumber || entry.issueNumber || 0;
          }
        }
      }

      if (!baseUrl || !repoOwner || !repoName || !issueNumber) {
        throw new Error(
          `post_summary missing required parameters: baseUrl=${baseUrl}, repoOwner=${repoOwner}, repoName=${repoName}, issueNumber=${issueNumber}`,
        );
      }

      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
      });

      let comment = `### 🤖 Paseo Agent Workflow Update\n\n**Stage:** \`${input.stage}\`\n\n${input.summary}`;
      if (input.prUrl) {
        comment += `\n\n🔗 **Pull Request:** [${input.prUrl}](${input.prUrl})`;
      }

      const sanitized = sanitizeCommentBody(comment, [token]);
      await client.createComment(issueNumber, sanitized);

      return { commentPosted: true };
    },
  };
}
