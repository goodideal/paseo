import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";

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
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.post_lifecycle_summary",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url(),
      token: z.string().optional().default(""),
      repoOwner: z.string(),
      repoName: z.string(),
      issueNumber: z.number().int(),
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
    execute: async (rawInput) => {
      const input = rawInput as {
        baseUrl: string;
        token: string;
        repoOwner: string;
        repoName: string;
        issueNumber: number;
        stage: string;
        summary: string;
        prUrl?: string;
      };

      const client = clientPool.getClient({
        giteaUrl: input.baseUrl,
        giteaToken: input.token,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      });

      let comment = `### 🤖 Paseo Agent Workflow Update\n\n**Stage:** \`${input.stage}\`\n\n${input.summary}`;
      if (input.prUrl) {
        comment += `\n\n🔗 **Pull Request:** [${input.prUrl}](${input.prUrl})`;
      }

      const sanitized = sanitizeCommentBody(comment, [input.token]);
      await client.createComment(input.issueNumber, sanitized);

      return { commentPosted: true };
    },
  };
}
