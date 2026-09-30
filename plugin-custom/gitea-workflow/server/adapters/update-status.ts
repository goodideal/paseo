import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";

export function createUpdateStatusAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.update_status",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional().default(""),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      issueNumber: z.number().int().optional(),
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
    execute: async (rawInput, context) => {
      const input = rawInput as {
        baseUrl?: string;
        token?: string;
        repoOwner?: string;
        repoName?: string;
        issueNumber?: number;
        addLabels?: string[];
        removeLabels?: string[];
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
          `update_status missing required parameters: baseUrl=${baseUrl}, repoOwner=${repoOwner}, repoName=${repoName}, issueNumber=${issueNumber}`,
        );
      }

      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
      });

      if (input.removeLabels && input.removeLabels.length > 0) {
        await client.removeLabelsByName(issueNumber, input.removeLabels);
      }
      if (input.addLabels && input.addLabels.length > 0) {
        await client.addLabelsByName(issueNumber, input.addLabels);
      }

      return { success: true };
    },
  };
}
