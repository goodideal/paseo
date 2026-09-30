import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { IssueRunIndexStore } from "../store.js";

const execFileAsync = promisify(execFile);

export interface ResolveDeliveryOptions {
  getCommitSha?: (cwd: string) => Promise<string>;
}

export function createResolveDeliveryAdapter(
  indexStoreOrOptions?: IssueRunIndexStore | ResolveDeliveryOptions,
  options?: ResolveDeliveryOptions,
): PluginWorkflowStepAdapterRegistration {
  const indexStore =
    indexStoreOrOptions && typeof (indexStoreOrOptions as any).getEntryByRunId === "function"
      ? (indexStoreOrOptions as IssueRunIndexStore)
      : undefined;
  const opts =
    options ??
    (indexStoreOrOptions && typeof (indexStoreOrOptions as any).getEntryByRunId !== "function"
      ? (indexStoreOrOptions as ResolveDeliveryOptions)
      : {});
  return {
    type: "gitea.resolve_delivery",
    version: "1.0.0",
    inputSchema: z.object({
      sourceBranch: z.string().min(1).optional(),
      targetBranch: z.string().min(1).default("main"),
      pullRequestTitle: z.string().min(1).optional(),
      pullRequestBody: z.string().default(""),
      issueReference: z.string().min(1).optional(),
      cwd: z.string().min(1).optional(),
    }),
    outputSchema: z.object({
      manifest: z.record(z.string(), z.unknown()),
      manifestDigest: z.string(),
      pullRequestTitle: z.string().optional(),
      pullRequestBody: z.string().optional(),
    }),
    executionRisk: "read",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:delivery:{{issueReference}}",
    execute: async (rawInput, context) => {
      const input = rawInput as {
        sourceBranch?: string;
        targetBranch?: string;
        pullRequestTitle?: string;
        pullRequestBody?: string;
        issueReference?: string;
        cwd?: string;
      };

      let issueNumber = 0;
      if (context && (context as any).run?.runId && indexStore) {
        const entry = await indexStore.getEntryByRunId((context as any).run.runId);
        if (entry) {
          issueNumber = entry.issueNumber;
        }
      }

      const cwd = input.cwd || process.cwd();
      let commitSha: string;
      if (opts.getCommitSha) {
        commitSha = await opts.getCommitSha(cwd);
      } else {
        try {
          const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
          commitSha = stdout.trim();
        } catch {
          commitSha = "0000000000000000000000000000000000000000";
        }
      }

      let sourceBranch = input.sourceBranch;
      if (!sourceBranch) {
        try {
          const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
          sourceBranch = stdout.trim() || `workflow-${(context as any)?.run?.runId ?? "run"}`;
        } catch {
          sourceBranch = `workflow-${(context as any)?.run?.runId ?? "run"}`;
        }
      }

      const issueReference =
        input.issueReference || (issueNumber ? `#${issueNumber}` : "manual-delivery");
      const pullRequestTitle =
        input.pullRequestTitle ||
        (issueNumber ? `fix: resolve issue #${issueNumber}` : "Automated Delivery");
      const pullRequestBody =
        input.pullRequestBody ||
        (issueNumber ? `### Automated Implementation\n\nResolves #${issueNumber}\n` : "");

      const bodyDigest = createHash("sha256").update(pullRequestBody, "utf8").digest("hex");

      const manifest = {
        sourceBranch,
        targetBranch: input.targetBranch || "main",
        commitSha,
        pullRequestTitle,
        pullRequestBodyDigest: bodyDigest,
        issueReference,
      };

      const manifestDigest = createHash("sha256")
        .update(JSON.stringify(manifest), "utf8")
        .digest("hex");

      return {
        manifest,
        manifestDigest,
        pullRequestTitle,
        pullRequestBody,
      };
    },
  };
}
