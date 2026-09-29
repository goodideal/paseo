import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";

export function createClaimIssueAdapter(
  clientPool: GiteaClientPool,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.claim_issue",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url(),
      token: z.string(),
      repoOwner: z.string(),
      repoName: z.string(),
      issueNumber: z.number().int(),
      listenLabel: z.string().default("agent-ready"),
      inProgressLabel: z.string().default("agent-in-progress"),
    }),
    outputSchema: z.object({
      claimed: z.boolean(),
    }),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:claim:{{issueNumber}}",
    execute: async (rawInput) => {
      const input = rawInput as {
        baseUrl: string;
        token: string;
        repoOwner: string;
        repoName: string;
        issueNumber: number;
        listenLabel: string;
        inProgressLabel: string;
      };

      const client = clientPool.getClient({
        giteaUrl: input.baseUrl,
        giteaToken: input.token,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        listenLabel: input.listenLabel,
        inProgressLabel: input.inProgressLabel,
      });

      const issue = await client.getIssue(input.issueNumber);
      const readyLabelObj = issue.labels?.find(
        (l) => l.name.toLowerCase() === input.listenLabel.toLowerCase(),
      );
      if (!readyLabelObj) {
        throw new Error(
          `Label '${input.listenLabel}' no longer present on issue #${input.issueNumber}. Aborting claim.`,
        );
      }

      await client.claimIssue(input.issueNumber, readyLabelObj.id);
      return { claimed: true };
    },
  };
}
