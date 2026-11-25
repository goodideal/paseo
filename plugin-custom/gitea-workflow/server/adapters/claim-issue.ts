import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "../../shared/workflow-types.js";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";
import { TRIGGER_LABELS } from "../../shared/types.js";
import { resolveGiteaAdapterTarget } from "./run-workspace.js";

export function createClaimIssueAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.claim_issue",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional().default(""),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      issueNumber: z.number().int().optional(),
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
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as {
        baseUrl?: string;
        token?: string;
        repoOwner?: string;
        repoName?: string;
        issueNumber?: number;
        listenLabel?: string;
        inProgressLabel?: string;
      };

      const { token, baseUrl, repoOwner, repoName, issueNumber, identityId, runInput } =
        await resolveGiteaAdapterTarget(input, context, indexStore);
      const listenLabel = input.listenLabel || runInput.listenLabel || "agent-ready";
      const inProgressLabel = input.inProgressLabel || "agent-in-progress";

      if (!baseUrl || !repoOwner || !repoName || !issueNumber) {
        throw new Error(
          `claim_issue missing required parameters: baseUrl=${baseUrl}, repoOwner=${repoOwner}, repoName=${repoName}, issueNumber=${issueNumber}`,
        );
      }

      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
        listenLabel,
        inProgressLabel,
        ...(identityId ? { identityId } : {}),
      });

      const issue = await client.getIssue(issueNumber);
      const validTriggers: string[] = [
        ...TRIGGER_LABELS.AUTO,
        ...TRIGGER_LABELS.PLAN,
        listenLabel.toLowerCase(),
      ];
      const triggerLabelObj = issue.labels?.find((l) =>
        validTriggers.includes(l.name.trim().toLowerCase()),
      );
      if (!triggerLabelObj) {
        const inProgress = issue.labels?.some(
          (l) => l.name.toLowerCase() === inProgressLabel.toLowerCase(),
        );
        if (inProgress) {
          return { claimed: true };
        }
        throw new Error(
          `Label '${listenLabel}' no longer present on issue #${issueNumber}. Aborting claim.`,
        );
      }

      await client.claimIssue(issueNumber, triggerLabelObj.id);
      return { claimed: true };
    },
  };
}
