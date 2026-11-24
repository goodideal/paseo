import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "../../shared/workflow-types.js";
import {
  WorkflowHarnessExecutionInfoSchema,
  type WorkflowHarnessExecutionInfo,
} from "../../shared/types.js";
import { DEFAULT_AGENT_REVIEW_PROMPT } from "../../shared/prompts.js";
import type { SettingsManager } from "../settings-manager.js";
import type { IssueRunIndexStore } from "../store.js";
import { resolveWorkflowAgentLaunch } from "../harness-bridge.js";
import { interpolatePrompt, type PromptInterpolationContext } from "../prompt-interpolator.js";
import { cleanIssueTitle } from "../workspace-title.js";
import { normalizeAgentChangeMode } from "./agent-execute.js";
import {
  createWorkspaceAgent,
  driveAgentTurn,
  resolveReviewReadOnlyMode,
  resolveRunWorkspaceContext,
  truncateAndRedactOutput,
} from "./run-workspace.js";

const execFileAsync = promisify(execFile);

export interface WorkspaceCheckResult {
  passed: boolean;
  command: string;
  report: string;
}

export interface QualityGateDeps {
  runWorkspaceCheck?: (cwd: string) => Promise<WorkspaceCheckResult>;
}

async function execCheckCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 5 * 60_000,
): Promise<WorkspaceCheckResult> {
  const displayCommand = [command, ...args].join(" ");
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CI: "true" },
    });
    const report = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n");
    return {
      passed: true,
      command: displayCommand,
      report: truncateAndRedactOutput(report || `${displayCommand} passed.`),
    };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const report = [execErr.stdout?.trim(), execErr.stderr?.trim(), execErr.message?.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      passed: false,
      command: displayCommand,
      report: truncateAndRedactOutput(report || `${displayCommand} failed.`),
    };
  }
}

export async function defaultRunWorkspaceCheck(cwd: string): Promise<WorkspaceCheckResult> {
  if (!cwd || !existsSync(cwd)) {
    return {
      passed: false,
      command: "cwd-check",
      report: `Workspace directory does not exist: ${cwd || "(empty)"}`,
    };
  }

  const pkgPath = path.join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as {
        scripts?: Record<string, string>;
        workspaces?: unknown;
      };
      const scripts = pkg.scripts ?? {};
      const hasWorkspaces = Boolean(pkg.workspaces);
      const hasStandaloneTest =
        !hasWorkspaces &&
        typeof scripts.test === "string" &&
        scripts.test.trim().length > 0 &&
        !scripts.test.includes("no test specified");

      const appendTestCheckIfApplicable = async (
        primaryRes: WorkspaceCheckResult,
      ): Promise<WorkspaceCheckResult> => {
        if (!primaryRes.passed || !hasStandaloneTest) {
          return primaryRes;
        }
        const testRes = await execCheckCommand("npm", ["test"], cwd);
        return {
          passed: testRes.passed,
          command: `${primaryRes.command} && ${testRes.command}`,
          report: truncateAndRedactOutput(
            [primaryRes.report, testRes.report].filter(Boolean).join("\n"),
          ),
        };
      };

      if (typeof scripts.typecheck === "string" && scripts.typecheck.trim().length > 0) {
        const tcRes = await execCheckCommand("npm", ["run", "typecheck"], cwd);
        return await appendTestCheckIfApplicable(tcRes);
      }

      if (existsSync(path.join(cwd, "tsconfig.json"))) {
        const tscRes = await execCheckCommand("npx", ["--no-install", "tsc", "--noEmit"], cwd);
        return await appendTestCheckIfApplicable(tscRes);
      }

      if (hasStandaloneTest) {
        return await execCheckCommand("npm", ["test"], cwd);
      }

      return {
        passed: true,
        command: "none",
        report: "No typecheck or standalone test script detected in package.json.",
      };
    } catch {
      return {
        passed: false,
        command: "package.json",
        report: "Invalid JSON in package.json",
      };
    }
  }

  if (existsSync(path.join(cwd, "go.mod"))) {
    return await execCheckCommand("go", ["vet", "./..."], cwd);
  }

  if (existsSync(path.join(cwd, "Cargo.toml"))) {
    return await execCheckCommand("cargo", ["check", "--quiet"], cwd);
  }

  return {
    passed: true,
    command: "none",
    report: "No standard verification manifest detected; skipped command check.",
  };
}

export function parseReviewVerdict(text: string): "PASS" | "CHANGES_REQUESTED" {
  if (!text || !text.trim()) {
    return "CHANGES_REQUESTED";
  }

  const cleaned = text.replace(/```paseo-workflow-handoff[\s\S]*?```/gi, "").trim();
  if (!cleaned) {
    return "CHANGES_REQUESTED";
  }

  const candidates: Array<{ index: number; verdict: "PASS" | "CHANGES_REQUESTED" }> = [];

  // 1. Explicit verdict clauses/lines (strictly case-sensitive UPPERCASE verdict tokens)
  const explicitClauseRegex =
    /(?:^|[\n.;!。；！])\s*(?:[-*>#]+\s*)?(?:\*{0,2})(?:[Ff]inal\s+)?(?:[Vv]erdict|[Dd]ecision|[Cc]onclusion|裁决|结论)\*{0,2}\s*[:：]\s*\*{0,2}(CHANGES_REQUESTED|PASS)\*{0,2}(?=$|[^A-Za-z0-9_])/g;
  for (const match of cleaned.matchAll(explicitClauseRegex)) {
    const token = match[1];
    if (token === "PASS" || token === "CHANGES_REQUESTED") {
      candidates.push({
        index: (match.index ?? 0) + match[0].lastIndexOf(token),
        verdict: token,
      });
    }
  }

  // 2. Standalone verdict lines
  const standaloneBoldLineRegex =
    /^\s*(?:[-*>#]+\s*)?\*{1,2}(CHANGES_REQUESTED|PASS)\*{1,2}\s*[.!。！]*$/gm;
  for (const match of cleaned.matchAll(standaloneBoldLineRegex)) {
    const token = match[1];
    if (token === "PASS" || token === "CHANGES_REQUESTED") {
      candidates.push({
        index: (match.index ?? 0) + match[0].lastIndexOf(token),
        verdict: token,
      });
    }
  }

  const standalonePlainLineRegex = /^\s*(CHANGES_REQUESTED|PASS)\s*[.!。！]*$/gm;
  for (const match of cleaned.matchAll(standalonePlainLineRegex)) {
    const token = match[1];
    if (token === "PASS" || token === "CHANGES_REQUESTED") {
      candidates.push({
        index: (match.index ?? 0) + match[0].lastIndexOf(token),
        verdict: token,
      });
    }
  }

  // 3. Inline bold verdict tokens (excluding negated/instructional phrases)
  const sanitizedForInlineBold = cleaned
    .replace(
      /\*{0,2}(?:PASS|CHANGES_REQUESTED)\*{0,2}\s*(?:or|\/|\||vs\.?)\s*\*{0,2}(?:PASS|CHANGES_REQUESTED)\*{0,2}/g,
      (m) => " ".repeat(m.length),
    )
    .replace(
      /\b(?:[Nn]o|[Nn]ot|[Nn]ever|[Ww]ithout|[Rr]eturn|[Oo]utput)\s+\*{0,2}(?:CHANGES_REQUESTED|PASS)\*{0,2}/g,
      (m) => " ".repeat(m.length),
    );
  const inlineBoldRegex = /\*{2}(CHANGES_REQUESTED|PASS)\*{2}(?=$|[^A-Za-z0-9_*])/g;
  for (const match of sanitizedForInlineBold.matchAll(inlineBoldRegex)) {
    const token = match[1];
    if (token === "PASS" || token === "CHANGES_REQUESTED") {
      candidates.push({
        index: (match.index ?? 0) + match[0].lastIndexOf(token),
        verdict: token,
      });
    }
  }

  candidates.sort((a, b) => a.index - b.index);
  const lastCandidate = candidates[candidates.length - 1];

  const sanitizedForCritical = cleaned
    .replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length))
    .replace(/(?:\b(?:zero|no|0|without|none)\s+|`)\[\s*critical\s*\]`?/gi, (m) =>
      " ".repeat(m.length),
    );
  const criticalMatches = [...sanitizedForCritical.matchAll(/\[\s*critical\s*\]/gi)];
  if (criticalMatches.length > 0) {
    const lastCriticalIndex = criticalMatches[criticalMatches.length - 1]?.index ?? 0;
    if (!lastCandidate || lastCandidate.index < lastCriticalIndex) {
      return "CHANGES_REQUESTED";
    }
    return lastCandidate.verdict;
  }

  if (!lastCandidate) {
    return "CHANGES_REQUESTED";
  }

  return lastCandidate.verdict;
}

function extractStepSummary(stepOut: Record<string, unknown> | undefined): string {
  if (!stepOut || typeof stepOut !== "object") return "";
  if (typeof stepOut.summary === "string" && stepOut.summary.trim().length > 0) {
    return stepOut.summary.trim();
  }
  if (
    typeof stepOut.outcome === "string" &&
    stepOut.outcome.trim().length > 0 &&
    stepOut.outcome.trim() !== "completed"
  ) {
    return stepOut.outcome.trim();
  }
  return "";
}

export function createQualityGateAdapter(
  settingsManager?: SettingsManager,
  indexStore?: IssueRunIndexStore,
  deps?: QualityGateDeps,
): PluginWorkflowStepAdapterRegistration {
  const runWorkspaceCheck = deps?.runWorkspaceCheck ?? defaultRunWorkspaceCheck;

  return {
    type: "gitea.quality_gate",
    version: "1.0.0",
    inputSchema: z.object({
      timeoutMs: z.number().int().positive().optional(),
      maxRepairCycles: z.number().int().min(0).max(5).optional(),
    }),
    outputSchema: z.object({
      agentId: z.string(),
      status: z.string(),
      passed: z.boolean(),
      verdict: z.enum(["PASS", "CHANGES_REQUESTED"]),
      repairCyclesUsed: z.number().int().nonnegative(),
      maxRepairCycles: z.number().int().nonnegative(),
      verifyPassed: z.boolean(),
      verifyCommand: z.string(),
      verifyReport: z.string(),
      outcome: z.string(),
      summary: z.string(),
      latestImplementationSummary: z.string().optional(),
      harness: WorkflowHarnessExecutionInfoSchema.optional(),
    }),
    executionRisk: "workspace_write",
    requiredPermissions: ["workspace.write"],
    repositoryCallable: true,
    idempotency: "none",
    cancellation: "supported",
    recovery: "not_resumable",
    supportedPlatforms: ["darwin", "linux", "win32"],
    resourceConflictKey: "workspace:agent",
    execute: async (rawInput, context) => {
      const input = (rawInput ?? {}) as {
        timeoutMs?: number;
        maxRepairCycles?: number;
      };
      const runId = (context as any)?.run?.runId;
      const projectId = (context as any)?.run?.projectId;
      const entry = runId && indexStore ? await indexStore.getEntryByRunId(runId) : null;
      const runInput = (context as any)?.run?.runInput ?? {};
      const effectiveIssueNum = entry?.issueNumber || runInput.issueNumber || 0;
      const effectiveIssueTitle = entry?.issueTitle || runInput.issueTitle || "";
      const effectiveIssueBody = (entry as any)?.issueBody || runInput.issueBody || "";
      const repoOwner = entry?.repoOwner || runInput.repoOwner || "";
      const repoName = entry?.repoName || runInput.repoName || "";
      const allStepOutputs: Record<string, unknown> = {
        ...((context as any)?.run?.stepOutputs ?? {}),
        ...((context as any)?.stepOutputs ?? {}),
      };
      const wtOutput = allStepOutputs["worktree-create"] as Record<string, any> | undefined;
      const branchName = wtOutput?.branch || runInput.branch || "";
      const resolvedProjectId = projectId || entry?.projectId || runInput.projectId || "";
      const effectiveProjectId = resolvedProjectId || projectId;

      const workspaceCtx = await resolveRunWorkspaceContext({
        paseo: (context as any)?.paseo,
        projectId: effectiveProjectId,
        runId,
        issueNumber: effectiveIssueNum,
        issueTitle: effectiveIssueTitle,
        workspaceRoot: (context as any)?.run?.workspaceRoot,
        worktreeOutput: wtOutput,
        requireAgentApi: true,
      });
      const { targetCwd, targetWorkspaceId } = workspaceCtx;

      const timeoutMs =
        input.timeoutMs ??
        (context as any)?.step?.timeoutMs ??
        (context as any)?.definitionStep?.timeoutMs ??
        30 * 60 * 1000;

      const maxCycles = Math.max(
        0,
        input.maxRepairCycles ?? settingsManager?.current?.maxAutomaticRepairCycles ?? 2,
      );

      const planOut = allStepOutputs["plan-agent"] as Record<string, unknown> | undefined;
      const implementOut = (allStepOutputs["implement-agent"] ?? allStepOutputs["auto-design"]) as
        | Record<string, unknown>
        | undefined;

      let latestCodingAgentId =
        typeof implementOut?.agentId === "string" && implementOut.agentId.trim().length > 0
          ? implementOut.agentId.trim()
          : undefined;
      const initialImplSummary = extractStepSummary(implementOut);
      let latestImplementationSummary = initialImplSummary
        ? truncateAndRedactOutput(initialImplSummary)
        : undefined;
      const rawPlanSummary = extractStepSummary(planOut);
      const planSummary = rawPlanSummary ? truncateAndRedactOutput(rawPlanSummary) : "";

      let passed = false;
      let repairCyclesUsed = 0;
      let lastReviewAgentId = "";
      let lastReviewSummary = "";
      let lastVerdict: "PASS" | "CHANGES_REQUESTED" = "CHANGES_REQUESTED";
      let lastReviewHarnessInfo: WorkflowHarnessExecutionInfo | undefined;
      let lastVerifyRes: WorkspaceCheckResult = {
        passed: true,
        command: "none",
        report: "",
      };

      const interpolationContext: PromptInterpolationContext = {
        issueNumber: effectiveIssueNum,
        issueTitle: effectiveIssueTitle,
        issueBody: effectiveIssueBody,
        repoOwner,
        repoName,
        branchName,
        projectId: resolvedProjectId,
      };

      const rawReviewTemplate =
        typeof settingsManager?.getAgentReviewPrompt === "function"
          ? settingsManager.getAgentReviewPrompt(resolvedProjectId)
          : DEFAULT_AGENT_REVIEW_PROMPT;
      const baseReviewPrompt = interpolatePrompt(
        rawReviewTemplate || DEFAULT_AGENT_REVIEW_PROMPT,
        interpolationContext,
      );

      const cleanShort = effectiveIssueTitle ? cleanIssueTitle(effectiveIssueTitle) : "";
      const shortTitle = cleanShort ? ` · ${cleanShort.slice(0, 28)}` : "";

      for (let cycle = 0; cycle <= maxCycles; cycle++) {
        // 1. Run workspace verification check
        const rawVerifyRes = await runWorkspaceCheck(targetCwd);
        const verifyRes: WorkspaceCheckResult = {
          passed: rawVerifyRes.passed,
          command: rawVerifyRes.command,
          report: truncateAndRedactOutput(rawVerifyRes.report || ""),
        };
        lastVerifyRes = verifyRes;

        // 2. Build review prompt with upstream context and verification summary
        const contextSections: string[] = [];
        if (planSummary) {
          contextSections.push(`### Implementation Plan (plan-agent)\n${planSummary}`);
        }
        if (latestImplementationSummary) {
          contextSections.push(
            `### Implementation Summary (implement-agent)\n${latestImplementationSummary}`,
          );
        }
        const verifyStatusLabel = verifyRes.passed ? "PASSED" : "FAILED";
        contextSections.push(
          `### Automated Workspace Verification (Cycle ${cycle})\n- **Status**: ${verifyStatusLabel}\n- **Command**: \`${verifyRes.command}\`\n- **Report**:\n\`\`\`\n${verifyRes.report || "(empty)"}\n\`\`\``,
        );

        const reviewPrompt = `${baseReviewPrompt}\n\n## Approved Upstream Stage Context\n\n${contextSections.join("\n\n")}`;

        // 3. Spawn & drive independent review agent (strictly read-only mode)
        const reviewLaunch = await resolveWorkflowAgentLaunch({
          paseo: (context as any)?.paseo,
          settingsManager,
          projectId: effectiveProjectId,
          workspaceId: targetWorkspaceId,
          cwd: targetCwd,
          runId,
          phase: "review",
          issueTitle: effectiveIssueTitle,
          issueBody: effectiveIssueBody,
        });

        const reviewModeId = resolveReviewReadOnlyMode(reviewLaunch.provider);
        const reviewConfig: { provider: string; modeId: string; thinkingOptionId?: string } = {
          provider: reviewLaunch.providerSelection,
          modeId: reviewModeId,
        };
        if (reviewLaunch.thinkingOptionId) {
          reviewConfig.thinkingOptionId = reviewLaunch.thinkingOptionId;
        }
        const cycleSuffix = cycle > 0 ? ` (第${cycle + 1}轮)` : "";
        const reviewTitle = `🔍 [#${effectiveIssueNum}] 独立审查${cycleSuffix}${shortTitle}`;

        const reviewHandle = await createWorkspaceAgent(workspaceCtx, (context as any)?.paseo, {
          title: reviewTitle,
          prompt: reviewPrompt,
          config: reviewConfig,
          labels: reviewLaunch.labels,
          metadata: reviewLaunch.metadata,
        });

        lastReviewAgentId = reviewHandle.id;
        lastReviewHarnessInfo = reviewLaunch.harnessInfo;
        const reviewMsg = await driveAgentTurn(reviewHandle, reviewPrompt, timeoutMs);
        const trimmedReviewMsg = reviewMsg.trim();
        const verdict = trimmedReviewMsg
          ? parseReviewVerdict(trimmedReviewMsg)
          : "CHANGES_REQUESTED";
        lastVerdict = verdict;
        lastReviewSummary = trimmedReviewMsg
          ? truncateAndRedactOutput(trimmedReviewMsg)
          : "[Critical] Independent review agent returned empty output.";

        // 4. Evaluate gate condition
        if (verifyRes.passed && verdict === "PASS") {
          passed = true;
          break;
        }

        // 5. Same-session auto-repair if cycles remain
        if (cycle < maxCycles) {
          const failureReasons: string[] = [];
          if (!verifyRes.passed) {
            failureReasons.push(
              `### Workspace Verification Failure (\`${verifyRes.command}\`)\n\`\`\`\n${verifyRes.report}\n\`\`\``,
            );
          }
          if (verdict === "CHANGES_REQUESTED") {
            failureReasons.push(
              `### Independent Code Review Findings (\`CHANGES_REQUESTED\`)\n${lastReviewSummary}`,
            );
          }

          const repairPrompt = [
            `## Automated Quality Gate Repair (Cycle ${cycle + 1} of ${maxCycles})`,
            `Gitea Issue #${effectiveIssueNum}: ${effectiveIssueTitle} | Branch: ${branchName || "current"}`,
            "",
            "The automated quality gate reported blockers that must be resolved before PR delivery:",
            "",
            failureReasons.join("\n\n"),
            "",
            "### Repair Instructions:",
            "1. Address every verification error and `[Critical]` review blocker using vertical TDD (`Red -> Green -> Refactor` at public module Seams).",
            "2. Run targeted tests and typecheck/lint to confirm all checks pass.",
            `3. Commit your fixes cleanly on \`${branchName || "the current branch"}\` and leave a clean working tree.`,
            "4. Output an updated `pr` skill summary block (`## Summary`, `## Evidence`, `## Merge Danger`) at the end of your response.",
          ].join("\n");

          let repairedInExistingSession = false;
          if (latestCodingAgentId && typeof (context as any)?.paseo?.agents?.ref === "function") {
            const existingCodingRef = (context as any).paseo.agents.ref(latestCodingAgentId);
            if (existingCodingRef && typeof existingCodingRef.run === "function") {
              try {
                const repairRes = await existingCodingRef.run(repairPrompt, { timeoutMs });
                if (repairRes.status !== "idle") {
                  const errSuffix = repairRes.error ? `: ${repairRes.error}` : "";
                  throw new Error(
                    `Repair run failed with status "${repairRes.status}"${errSuffix}`,
                  );
                }
                if (typeof repairRes.lastMessage === "string" && repairRes.lastMessage.trim()) {
                  latestImplementationSummary = truncateAndRedactOutput(
                    repairRes.lastMessage.trim(),
                  );
                }
                repairedInExistingSession = true;
              } catch {
                if (typeof existingCodingRef.detach === "function") {
                  await existingCodingRef.detach().catch(() => {});
                }
                repairedInExistingSession = false;
              }
            }
          }

          if (!repairedInExistingSession) {
            const repairLaunch = await resolveWorkflowAgentLaunch({
              paseo: (context as any)?.paseo,
              settingsManager,
              projectId: effectiveProjectId,
              workspaceId: targetWorkspaceId,
              cwd: targetCwd,
              runId,
              phase: "implement",
              issueTitle: effectiveIssueTitle,
              issueBody: effectiveIssueBody,
            });
            const rawMode = settingsManager?.getAgentChangeMode
              ? settingsManager.getAgentChangeMode(effectiveProjectId)
              : "auto";
            const repairModeId = normalizeAgentChangeMode(repairLaunch.provider, rawMode);
            const repairConfig: { provider: string; modeId: string; thinkingOptionId?: string } = {
              provider: repairLaunch.providerSelection,
              modeId: repairModeId,
            };
            if (repairLaunch.thinkingOptionId) {
              repairConfig.thinkingOptionId = repairLaunch.thinkingOptionId;
            }
            const repairTitle = `🛠️ [#${effectiveIssueNum}] 自动修复 (第${cycle + 1}轮)${shortTitle}`;

            const repairHandle = await createWorkspaceAgent(workspaceCtx, (context as any)?.paseo, {
              title: repairTitle,
              prompt: repairPrompt,
              config: repairConfig,
              labels: repairLaunch.labels,
              metadata: repairLaunch.metadata,
            });

            latestCodingAgentId = repairHandle.id;
            const repairMsg = await driveAgentTurn(repairHandle, repairPrompt, timeoutMs);
            if (repairMsg.trim()) {
              latestImplementationSummary = truncateAndRedactOutput(repairMsg.trim());
            }
          }

          repairCyclesUsed += 1;
        }
      }

      const result: Record<string, unknown> = {
        agentId: lastReviewAgentId,
        status: "succeeded",
        passed: lastVerifyRes.passed && lastVerdict === "PASS",
        verdict: lastVerdict,
        repairCyclesUsed,
        maxRepairCycles: maxCycles,
        verifyPassed: lastVerifyRes.passed,
        verifyCommand: lastVerifyRes.command,
        verifyReport: lastVerifyRes.report,
        outcome: lastReviewSummary,
        summary: lastReviewSummary,
      };
      if (latestImplementationSummary) {
        result.latestImplementationSummary = latestImplementationSummary;
      }
      if (lastReviewHarnessInfo) {
        result.harness = lastReviewHarnessInfo;
      }
      return result;
    },
  };
}
