import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";

const execFileAsync = promisify(execFile);

export interface ResolveDeliveryOptions {
  getCommitSha?: (cwd: string) => Promise<string>;
}

export function createResolveDeliveryAdapter(
  options: ResolveDeliveryOptions = {},
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.resolve_delivery",
    version: "1.0.0",
    inputSchema: z.object({
      sourceBranch: z.string().min(1),
      targetBranch: z.string().min(1),
      pullRequestTitle: z.string().min(1),
      pullRequestBody: z.string().default(""),
      issueReference: z.string().min(1),
      cwd: z.string().min(1),
    }),
    outputSchema: z.object({
      manifest: z.record(z.string(), z.unknown()),
      manifestDigest: z.string(),
    }),
    executionRisk: "read",
    requiredPermissions: ["workspace.read"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:delivery:{{issueReference}}",
    execute: async (rawInput) => {
      const input = rawInput as {
        sourceBranch: string;
        targetBranch: string;
        pullRequestTitle: string;
        pullRequestBody: string;
        issueReference: string;
        cwd: string;
      };

      let commitSha: string;
      if (options.getCommitSha) {
        commitSha = await options.getCommitSha(input.cwd);
      } else {
        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
          cwd: input.cwd,
        });
        commitSha = stdout.trim();
      }

      const bodyDigest = createHash("sha256")
        .update(input.pullRequestBody || "", "utf8")
        .digest("hex");

      const manifest = {
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        commitSha,
        pullRequestTitle: input.pullRequestTitle,
        pullRequestBodyDigest: bodyDigest,
        issueReference: input.issueReference,
      };

      const manifestDigest = createHash("sha256")
        .update(JSON.stringify(manifest), "utf8")
        .digest("hex");

      return {
        manifest,
        manifestDigest,
      };
    },
  };
}
