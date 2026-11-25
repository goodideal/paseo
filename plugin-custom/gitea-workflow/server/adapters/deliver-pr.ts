import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "../../shared/workflow-types.js";
import type { GiteaClientPool } from "../client-pool.js";
import type { IssueRunIndexStore } from "../store.js";
import type { SettingsManager } from "../settings-manager.js";
import {
  buildSshCommand,
  parseGiteaEndpoint,
  type GiteaIdentityBridge,
} from "../identity-bridge.js";
import { cleanIssueTitle } from "../workspace-title.js";
import {
  resolveGiteaAdapterTarget,
  resolveRunIdentityMetadata,
  resolveRunWorkspaceContext,
  truncateAndRedactOutput,
} from "./run-workspace.js";

const execFileAsync = promisify(execFile);

export interface PushBranchAuthOptions {
  token?: string;
  baseUrl?: string;
  giteaUsername?: string;
  sshKeyPath?: string;
}

export type PushExecFn = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<unknown>;

export interface DeliverPrDeps {
  pushBranch?: (cwd: string, branch: string, auth?: PushBranchAuthOptions) => Promise<void>;
  getCurrentBranch?: (cwd: string) => Promise<string>;
  getDefaultBaseBranch?: (cwd: string) => Promise<string>;
  identityBridge?: GiteaIdentityBridge;
}

export interface FormatPullRequestBodyParams {
  issueNumber: number;
  issueTitle?: string;
  implementationSummary?: string;
  qualityGate?: {
    passed?: boolean;
    verdict?: string;
    repairCyclesUsed?: number;
    maxRepairCycles?: number;
    verifyPassed?: boolean;
    verifyCommand?: string;
    verifyReport?: string;
    summary?: string;
  };
}

export function formatPullRequestBody(params: FormatPullRequestBodyParams): string {
  const { issueNumber, issueTitle, implementationSummary, qualityGate } = params;
  const wip = qualityGate?.passed === false;
  const issueRef = wip ? `Refs #${issueNumber}` : `Closes #${issueNumber}`;
  const rawImplInput = (implementationSummary || "").trim();
  const normalizedImpl = wip
    ? rawImplInput.replace(/\b(?:Closes|Fixes|Resolves)\s+#(\d+)\b/gi, "Refs #$1")
    : rawImplInput;
  const rawImpl = truncateAndRedactOutput(normalizedImpl);
  const hasPrSkillSummary = /^##\s+Summary\b/im.test(rawImpl);

  const verifyStatus =
    qualityGate?.verifyPassed === false
      ? `FAILED (\`${qualityGate.verifyCommand || "check"}\`)`
      : `PASSED (\`${qualityGate?.verifyCommand || "none"}\`)`;
  const reviewVerdict = qualityGate?.verdict || (wip ? "CHANGES_REQUESTED" : "PASS");
  const repairCyclesText = `${qualityGate?.repairCyclesUsed ?? 0} / ${qualityGate?.maxRepairCycles ?? 2}`;

  const sanitizedVerifyReport = qualityGate?.verifyReport
    ? truncateAndRedactOutput(qualityGate.verifyReport)
    : "";
  const sanitizedReviewSummary = qualityGate?.summary
    ? truncateAndRedactOutput(qualityGate.summary)
    : "";

  const qualityGateBlock = [
    "### Automated Quality Gate",
    `- **Issue**: ${issueRef}`,
    `- **Verification**: ${verifyStatus}`,
    `- **Independent Review**: ${reviewVerdict}`,
    `- **Auto-Repair Cycles**: ${repairCyclesText}`,
  ].join("\n");

  const blockerDetails: string[] = [];
  if (wip) {
    blockerDetails.push(
      `⚠️ **[WIP] Automated Quality Gate Blockers Remaining** (exhausted ${repairCyclesText} auto-repair cycles):`,
    );
    if (qualityGate?.verifyPassed === false && sanitizedVerifyReport) {
      blockerDetails.push(`- **Verification Failure**:\n\`\`\`\n${sanitizedVerifyReport}\n\`\`\``);
    }
    if (sanitizedReviewSummary) {
      blockerDetails.push(`- **Independent Review Findings**:\n${sanitizedReviewSummary}`);
    }
  }

  if (hasPrSkillSummary) {
    const sections: string[] = [];
    const expectedDirectivePattern = wip
      ? new RegExp(`\\bRefs\\s+#${issueNumber}\\b`, "i")
      : new RegExp(`\\b(?:Closes|Fixes|Resolves)\\s+#${issueNumber}\\b`, "i");
    if (!expectedDirectivePattern.test(rawImpl)) {
      sections.push(issueRef);
    }
    sections.push(rawImpl);

    if (!/^##\s+Evidence\b/im.test(rawImpl)) {
      sections.push(
        [
          "## Evidence",
          `- Automated Workspace Verification: ${verifyStatus}`,
          `- Independent Code Review Verdict: ${reviewVerdict}`,
        ].join("\n"),
      );
    }

    if (!/^##\s+Merge Danger\b/im.test(rawImpl)) {
      const mergeDangerBody = wip
        ? blockerDetails.join("\n\n")
        : "Low — automated verification and independent review passed with zero critical blockers.";
      sections.push(["## Merge Danger", mergeDangerBody].join("\n\n"));
    } else if (wip && blockerDetails.length > 0) {
      sections.push(blockerDetails.join("\n\n"));
    }

    sections.push(qualityGateBlock);
    return sections.join("\n\n");
  }

  const issueTitleSuffix = issueTitle ? `: ${issueTitle}` : "";
  const summarySection = [
    "## Summary",
    issueRef,
    "",
    rawImpl || `Automated implementation for Gitea Issue #${issueNumber}${issueTitleSuffix}.`,
  ].join("\n");

  const evidenceLines = [
    "## Evidence",
    `- **Workspace Verification**: ${verifyStatus}`,
    `- **Independent Review**: ${reviewVerdict}`,
    `- **Auto-Repair Cycles**: ${repairCyclesText}`,
  ];
  if (sanitizedVerifyReport && qualityGate?.verifyPassed !== false) {
    evidenceLines.push(`- **Verification Output**: \`${sanitizedVerifyReport.slice(0, 240)}\``);
  }
  const evidenceSection = evidenceLines.join("\n");

  const mergeDangerBody = wip
    ? blockerDetails.join("\n\n")
    : "Low — all automated workspace checks and two-axis independent review (`Standards` + `Spec`) passed.";
  const mergeDangerSection = ["## Merge Danger", mergeDangerBody].join("\n\n");

  return [summarySection, evidenceSection, mergeDangerSection, qualityGateBlock].join("\n\n");
}

export async function defaultPushBranch(
  cwd: string,
  branch: string,
  authOrExec?: PushBranchAuthOptions | PushExecFn,
  maybeExecFn?: PushExecFn,
): Promise<void> {
  const auth = typeof authOrExec === "function" ? undefined : authOrExec;
  const execFn: PushExecFn =
    typeof authOrExec === "function" ? authOrExec : (maybeExecFn ?? execFileAsync);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  };

  const pushArgs: string[] = ["push", "-u", "origin", "--", branch];
  const secretsToRedact: string[] = [];
  if (auth?.token) {
    secretsToRedact.push(auth.token);
  }

  if (auth?.token || auth?.sshKeyPath) {
    let originUrlRaw = "";
    try {
      const res = (await execFn("git", ["config", "--get", "remote.origin.url"], {
        cwd,
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
        env,
      })) as { stdout?: string } | undefined;
      if (typeof res?.stdout === "string") {
        originUrlRaw = res.stdout.trim();
      }
    } catch {
      originUrlRaw = "";
    }

    const parsedOrigin = parseGiteaEndpoint(originUrlRaw);

    if (parsedOrigin !== null) {
      // Case A: HTTP(S) Remote
      if (auth.token) {
        const parsedBase = parseGiteaEndpoint(auth.baseUrl);
        const originMatches = parsedBase === null || parsedOrigin.origin === parsedBase.origin;

        if (originMatches) {
          let hasWorktreeCredHelper = false;
          try {
            const helperRes = (await execFn(
              "git",
              ["config", "--worktree", "--get", "credential.helper"],
              {
                cwd,
                timeout: 5_000,
                maxBuffer: 1024 * 1024,
                env,
              },
            )) as { stdout?: string } | undefined;
            hasWorktreeCredHelper = Boolean(helperRes?.stdout?.trim());
          } catch {
            hasWorktreeCredHelper = false;
          }

          if (!hasWorktreeCredHelper) {
            const basicUser = auth.giteaUsername?.trim() || "token";
            const basicCreds = Buffer.from(`${basicUser}:${auth.token}`, "utf8").toString("base64");
            secretsToRedact.push(basicCreds);
            env.GIT_CONFIG_COUNT = "1";
            env.GIT_CONFIG_KEY_0 = `http.${parsedOrigin.origin}/.extraHeader`;
            env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basicCreds}`;
          }
        }
      }
    } else if (auth.sshKeyPath) {
      // Case B: SSH Remote
      const sshCmd = buildSshCommand(auth.sshKeyPath);
      if (sshCmd) {
        env.GIT_SSH_COMMAND = sshCmd;
      }
    }
  }

  const execOptions: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    env?: NodeJS.ProcessEnv;
  } = {
    cwd,
    timeout: 110_000,
    maxBuffer: 16 * 1024 * 1024,
    ...(auth ? { env } : {}),
  };

  try {
    await execFn("git", pushArgs, execOptions);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const execErr = err as { stderr?: string; stdout?: string };
    const combined = [rawMsg, execErr?.stderr, execErr?.stdout].filter(Boolean).join("\n");
    const redacted = truncateAndRedactOutput(combined, 4_000, secretsToRedact);
    throw new Error(redacted || "git push failed");
  }
}

async function defaultGetCurrentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd,
      timeout: 15_000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function defaultGetDefaultBaseBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd,
      timeout: 15_000,
    });
    const trimmed = stdout.trim();
    if (trimmed.startsWith("refs/remotes/origin/")) {
      return trimmed.slice("refs/remotes/origin/".length).trim() || "main";
    }
    return trimmed || "main";
  } catch {
    return "main";
  }
}

export function createDeliverPrAdapter(
  clientPool: GiteaClientPool,
  indexStore?: IssueRunIndexStore,
  settingsManager?: SettingsManager,
  deps?: DeliverPrDeps,
): PluginWorkflowStepAdapterRegistration {
  const pushBranch = deps?.pushBranch ?? defaultPushBranch;
  const getCurrentBranch = deps?.getCurrentBranch ?? defaultGetCurrentBranch;
  const getDefaultBaseBranch = deps?.getDefaultBaseBranch ?? defaultGetDefaultBaseBranch;

  return {
    type: "gitea.deliver_pr",
    version: "1.0.0",
    inputSchema: z.object({
      baseUrl: z.string().url().optional(),
      token: z.string().optional(),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      issueNumber: z.number().int().optional(),
      issueTitle: z.string().optional(),
      headBranch: z.string().optional(),
      baseBranch: z.string().optional(),
      listenLabel: z.string().optional(),
      cwd: z.string().optional(),
    }),
    outputSchema: z.object({
      url: z.string(),
      headBranch: z.string(),
      baseBranch: z.string(),
      title: z.string(),
      wip: z.boolean(),
      summary: z.string(),
    }),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "gitea:delivery:{{issueNumber}}",
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as {
        baseUrl?: string;
        token?: string;
        repoOwner?: string;
        repoName?: string;
        issueNumber?: number;
        issueTitle?: string;
        headBranch?: string;
        baseBranch?: string;
        listenLabel?: string;
        cwd?: string;
      };

      const runId = (context as any)?.run?.runId;
      const projectId = (context as any)?.run?.projectId;
      const target = await resolveGiteaAdapterTarget(input, context, indexStore);
      const { token, baseUrl, repoOwner, repoName, identityId, entry, runInput } = target;
      const allStepOutputs: Record<string, unknown> = {
        ...((context as any)?.run?.stepOutputs ?? {}),
        ...((context as any)?.stepOutputs ?? {}),
      };

      const fetchOut = allStepOutputs["fetch-issue"] as Record<string, any> | undefined;
      const wtOutput = allStepOutputs["worktree-create"] as Record<string, any> | undefined;
      const implementOut = (allStepOutputs["implement-agent"] ?? allStepOutputs["auto-design"]) as
        | Record<string, any>
        | undefined;
      const qualityGateOut = allStepOutputs["independent-review"] as
        | Record<string, any>
        | undefined;

      const issueNumber =
        target.issueNumber ||
        (typeof fetchOut?.issueNumber === "number" ? fetchOut.issueNumber : 0);
      const issueTitle =
        input.issueTitle || runInput.issueTitle || entry?.issueTitle || fetchOut?.title || "";
      const resolvedProjectId = projectId || entry?.projectId || runInput.projectId || "";
      const projectReadyLabel = resolvedProjectId
        ? settingsManager?.getReadyLabel?.(resolvedProjectId)
        : undefined;
      const listenLabel =
        input.listenLabel || runInput.listenLabel || projectReadyLabel || "agent-ready";

      if (!baseUrl || !repoOwner || !repoName || !issueNumber) {
        throw new Error(
          `deliver_pr missing required parameters: baseUrl=${baseUrl}, repoOwner=${repoOwner}, repoName=${repoName}, issueNumber=${issueNumber}`,
        );
      }

      const workspaceCtx = await resolveRunWorkspaceContext({
        paseo: (context as any)?.paseo,
        projectId: resolvedProjectId || projectId,
        runId,
        issueNumber,
        issueTitle,
        explicitCwd: input.cwd,
        workspaceRoot: (context as any)?.run?.workspaceRoot,
        worktreeOutput: wtOutput,
        requireDirectoryExists: true,
        identity: resolveRunIdentityMetadata(entry, runInput),
        identityBridge: deps?.identityBridge,
      });
      const { targetCwd } = workspaceCtx;
      if (!existsSync(targetCwd)) {
        throw new Error(`Working directory does not exist: ${targetCwd}`);
      }

      const headBranch = (
        input.headBranch ||
        wtOutput?.branch ||
        runInput.branch ||
        (await getCurrentBranch(targetCwd)) ||
        ""
      ).trim();

      const configuredBase = settingsManager?.getBaseBranch?.(resolvedProjectId);
      const baseBranch = (
        input.baseBranch ||
        runInput.baseBranch ||
        configuredBase ||
        (await getDefaultBaseBranch(targetCwd)) ||
        "main"
      ).trim();

      if (!headBranch) {
        throw new Error(
          `deliver_pr cannot resolve a non-empty headBranch for issue #${issueNumber}`,
        );
      }
      if (headBranch.startsWith("-")) {
        throw new Error(`Invalid headBranch "${headBranch}": branch name must not start with "-"`);
      }
      if (!baseBranch || baseBranch.startsWith("-")) {
        throw new Error(`Invalid baseBranch "${baseBranch}": branch name must not start with "-"`);
      }
      if (headBranch === baseBranch) {
        throw new Error(
          `Invalid headBranch "${headBranch}": headBranch must not equal baseBranch "${baseBranch}"`,
        );
      }

      const runIdentity = resolveRunIdentityMetadata(entry, runInput);
      const pushAuth: PushBranchAuthOptions = {
        token,
        baseUrl,
        ...(runIdentity.giteaUsername ? { giteaUsername: runIdentity.giteaUsername } : {}),
        ...(runIdentity.sshKeyPath ? { sshKeyPath: runIdentity.sshKeyPath } : {}),
      };

      // 1. Push branch to remote
      const hasExplicitIdentityAuth = Boolean(
        runIdentity.identityId || runIdentity.giteaUsername || runIdentity.sshKeyPath,
      );
      if (!deps?.pushBranch || hasExplicitIdentityAuth) {
        await pushBranch(targetCwd, headBranch, pushAuth);
      } else {
        await pushBranch(targetCwd, headBranch);
      }

      // 2. Format PR title and body
      const wip = qualityGateOut?.passed === false;
      const conventionalPrefixMatch = issueTitle.match(
        /^\s*((?:feat|fix|chore|docs|style|refactor|perf|test|build|ci)(?:\([^)]+\))?!?:)\s*/i,
      );
      const conventionalPrefix = conventionalPrefixMatch?.[1]
        ? `${conventionalPrefixMatch[1].toLowerCase()} `
        : "";
      const cleanedTitle =
        cleanIssueTitle(issueTitle) || issueTitle.trim() || `Resolve issue #${issueNumber}`;
      const titledWithPrefix =
        conventionalPrefix && !cleanedTitle.toLowerCase().startsWith(conventionalPrefix.trim())
          ? `${conventionalPrefix}${cleanedTitle}`
          : cleanedTitle;
      const hasIssueSuffix = titledWithPrefix.includes(`#${issueNumber}`);
      const baseTitle = hasIssueSuffix ? titledWithPrefix : `${titledWithPrefix} (#${issueNumber})`;
      const wipPrefix = wip ? "[WIP] " : "";
      const title = `${wipPrefix}${baseTitle}`;

      let fallbackOutcome = "";
      if (typeof implementOut?.outcome === "string" && implementOut.outcome !== "completed") {
        fallbackOutcome = implementOut.outcome.trim();
      }
      const implementationSummary =
        (typeof qualityGateOut?.latestImplementationSummary === "string" &&
          qualityGateOut.latestImplementationSummary.trim()) ||
        (typeof implementOut?.summary === "string" && implementOut.summary.trim()) ||
        fallbackOutcome;

      let qualityGateInfo: FormatPullRequestBodyParams["qualityGate"];
      if (qualityGateOut) {
        qualityGateInfo = {
          passed: qualityGateOut.passed,
          verdict: qualityGateOut.verdict,
          repairCyclesUsed: qualityGateOut.repairCyclesUsed,
          maxRepairCycles: qualityGateOut.maxRepairCycles,
          verifyPassed: qualityGateOut.verifyPassed,
          verifyCommand: qualityGateOut.verifyCommand,
          verifyReport: qualityGateOut.verifyReport,
          summary: qualityGateOut.summary || qualityGateOut.outcome,
        };
      }

      const body = truncateAndRedactOutput(
        formatPullRequestBody({
          issueNumber,
          issueTitle,
          implementationSummary,
          qualityGate: qualityGateInfo,
        }),
        36_000,
        [token],
      );

      // 3. Create Pull Request via Gitea API
      const inProgressLabel = settingsManager?.current?.inProgressLabel || "agent-in-progress";
      const reviewedLabel = settingsManager?.current?.reviewedLabel || "agent-reviewed";
      const client = clientPool.getClient({
        giteaUrl: baseUrl,
        giteaToken: token,
        repoOwner,
        repoName,
        listenLabel,
        inProgressLabel,
        reviewedLabel,
        ...(identityId ? { identityId } : {}),
      });

      const created = await client.createPullRequest({
        title,
        body,
        headBranch,
        baseBranch,
      });

      // 4. Update Issue status & post completion/WIP comment
      if (!wip) {
        await client.markReviewed(issueNumber, { prUrl: created.url });
      } else {
        const repairCyclesText = `${qualityGateOut?.repairCyclesUsed ?? 0}/${qualityGateOut?.maxRepairCycles ?? 2}`;
        const verifyFailedText =
          qualityGateOut?.verifyPassed === false
            ? `FAILED (\`${qualityGateOut?.verifyCommand || "check"}\`)`
            : "PASSED";
        const wipComment = truncateAndRedactOutput(
          [
            `⚠️ **Paseo Agent** opened a **[WIP] Pull Request**: ${created.url}`,
            "",
            `Automated quality gate still had remaining blockers after exhausting **${repairCyclesText}** automatic repair cycles. Human review and intervention are requested:`,
            `- **Workspace Verification**: ${verifyFailedText}`,
            `- **Independent Code Review**: \`${qualityGateOut?.verdict || "CHANGES_REQUESTED"}\``,
          ].join("\n"),
          12_000,
          [token],
        );
        await client.createIssueComment(issueNumber, wipComment).catch(() => {});
        if (typeof client.removeLabelsByName === "function") {
          await client
            .removeLabelsByName(issueNumber, ["status:doing", inProgressLabel])
            .catch(() => {});
        }
        if (typeof client.addLabelsByName === "function") {
          await client.addLabelsByName(issueNumber, ["status:review"]).catch(() => {});
        }
      }

      return {
        url: created.url,
        headBranch,
        baseBranch,
        title,
        wip,
        summary: `${wipPrefix}PR created: ${created.url}`,
      };
    },
  };
}
