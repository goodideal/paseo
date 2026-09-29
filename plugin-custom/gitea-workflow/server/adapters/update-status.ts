import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";

export function createUpdateStatusAdapter(
  clientPool: GiteaClientPool,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.update_status",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url(),
      token: z.string(),
      repoOwner: z.string(),
      repoName: z.string(),
      issueNumber: z.number().int(),
      addLabels: z.array(z.string()).default([]),
      removeLabels: z.array(z.string()).default([]),
    }),
    outputSchema: z.object({
      success: z.boolean(),
    }),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:status:{{issueNumber}}",
    execute: async (rawInput) => {
      const input = rawInput as {
        baseUrl: string;
        token: string;
        repoOwner: string;
        repoName: string;
        issueNumber: number;
        addLabels: string[];
        removeLabels: string[];
      };

      const client = clientPool.getClient({
        giteaUrl: input.baseUrl,
        giteaToken: input.token,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      });

      if (input.removeLabels && input.removeLabels.length > 0) {
        await client.removeLabelsByName(input.issueNumber, input.removeLabels);
      }
      if (input.addLabels && input.addLabels.length > 0) {
        await client.addLabelsByName(input.issueNumber, input.addLabels);
      }

      return { success: true };
    },
  };
}
