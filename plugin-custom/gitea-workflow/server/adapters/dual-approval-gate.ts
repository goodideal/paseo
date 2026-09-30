import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";
import { LIFECYCLE_LABELS } from "../../shared/types.js";

export function isApprovalComment(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith(">")) return false;

  const slashMatch = /^\/(approve|lgtm|proceed|yes)\b/i.test(trimmed);
  if (slashMatch) return true;

  const cnMatch = /^(?:同意|确认|批准|通过|确认通过|同意推进)$/i.test(trimmed);
  if (cnMatch) return true;

  const enMatch = /^(?:lgtm|approved?|proceed|yes)$/i.test(trimmed);
  if (enMatch) return true;

  const optionMatch =
    /^(?:选|采用)?\s*方案?\s*([a-c])$/i.test(trimmed) || /^([a-c])$/i.test(trimmed);
  if (optionMatch) return true;

  return false;
}

export function isOptionSelection(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith(">")) return false as unknown as null;

  const match = trimmed.match(/^(?:选|采用)?\s*方案?\s*([a-c])$/i) || trimmed.match(/^([a-c])$/i);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }
  return null;
}

export function createDualApprovalGateAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.dual_approval_gate",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional().default(""),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      issueNumber: z.number().int().optional(),
      phase: z.string().default("gate"),
      reason: z.string().default("Requires confirmation to proceed"),
      pollIntervalMs: z.number().int().min(100).default(5000),
      maxWaitMs: z.number().int().default(60_000),
    }),
    outputSchema: z.object({
      approved: z.boolean(),
      selectedOption: z.string().nullable().optional(),
      feedback: z.string().optional(),
      channel: z.enum(["gitea_comment", "paseo_ui"]),
    }),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "required",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:gate:{{issueNumber}}:{{phase}}",
    execute: async (rawInput, context) => {
      const input = rawInput as {
        baseUrl?: string;
        token?: string;
        repoOwner?: string;
        repoName?: string;
        issueNumber?: number;
        phase?: string;
        reason?: string;
        pollIntervalMs?: number;
        maxWaitMs?: number;
      };

      let token = input.token || "";
      let baseUrl = input.baseUrl || "";
      let repoOwner = input.repoOwner || "";
      let repoName = input.repoName || "";
      let issueNumber = input.issueNumber || 0;
      const phase = input.phase || "gate";
      const reason = input.reason || "Requires confirmation to proceed";
      const pollIntervalMs = input.pollIntervalMs || 5000;
      const maxWaitMs = input.maxWaitMs || 60_000;

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
          `dual_approval_gate missing required parameters: baseUrl=${baseUrl}, repoOwner=${repoOwner}, repoName=${repoName}, issueNumber=${issueNumber}`,
        );
      }

      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
      });

      // 1. Mark issue with agent-waiting-approval
      await client.addIssueLabel(issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL).catch(() => {});

      // 2. Post gate comment
      const gatePrompt = [
        `### 🛑 Paseo 门禁：等待确认（阶段：${phase}）`,
        "",
        reason,
        "",
        "您可以通过以下方式推进或调整：",
        "1. **直接回复批准**：回复 `/approve`、`同意` 或选项编号（如 `A` / `方案A`）；",
        "2. **在 Paseo 中确认**：在移动端或 Web 控制台点击通过；",
        "3. **提出调整意见**：直接在评论中写下反馈。",
      ].join("\n");

      await client.createIssueComment(issueNumber, gatePrompt).catch(() => {});

      const startTime = Date.now();
      const deadline = startTime + maxWaitMs;

      // 3. Poll for comments
      while (Date.now() < deadline) {
        try {
          const comments = await client.listIssueComments(issueNumber);
          for (const comment of comments) {
            const commentTime = new Date(comment.created_at).getTime();
            if (commentTime >= startTime - 2000 && isApprovalComment(comment.body)) {
              const selectedOption = isOptionSelection(comment.body);
              await client
                .removeIssueLabel(issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
                .catch(() => {});
              return {
                approved: true,
                selectedOption,
                feedback: comment.body,
                channel: "gitea_comment" as const,
              };
            }
          }
        } catch {
          // ignore transient poll error
        }

        // Check if context step was approved via Paseo UI
        const stepContext = (context as any)?.step;
        if (stepContext?.status === "approved" || stepContext?.status === "completed") {
          await client
            .removeIssueLabel(issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
            .catch(() => {});
          return {
            approved: true,
            channel: "paseo_ui" as const,
          };
        }

        // If we are in unit test or deadline reached, exit
        if (maxWaitMs <= pollIntervalMs) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      // Default timeout cleanup
      await client.removeIssueLabel(issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL).catch(() => {});
      return {
        approved: false,
        channel: "gitea_comment" as const,
      };
    },
  };
}
