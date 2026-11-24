import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "../../shared/workflow-types.js";
import { WorkflowHarnessExecutionInfoSchema } from "../../shared/types.js";
import type { SettingsManager } from "../settings-manager.js";
import type { IssueRunIndexStore } from "../store.js";
import { cleanIssueTitle } from "../workspace-title.js";
import { interpolatePrompt, type PromptInterpolationContext } from "../prompt-interpolator.js";
import {
  DEFAULT_AGENT_AUTO_PROMPT,
  DEFAULT_AGENT_PLAN_PROMPT,
  DEFAULT_AGENT_REVIEW_PROMPT,
} from "../../shared/prompts.js";
import { resolveWorkflowAgentLaunch } from "../harness-bridge.js";
import {
  createWorkspaceAgent,
  driveAgentTurn,
  resolveReviewReadOnlyMode,
  resolveRunWorkspaceContext,
} from "./run-workspace.js";

const PHASE_META: Record<string, { icon: string; label: string }> = {
  brainstorm: { icon: "💡", label: "方案设计" },
  spec: { icon: "📝", label: "规范制定" },
  plan: { icon: "🎯", label: "方案质询与规划" },
  auto_design: { icon: "🤖", label: "全自动交付" },
  implement: { icon: "🛠️", label: "TDD编码" },
  review: { icon: "🔍", label: "独立审查" },
};

const UPSTREAM_STAGE_STEPS: Record<string, Array<{ stepId: string; title: string }>> = {
  spec: [{ stepId: "brainstorm-agent", title: "Brainstorm Proposal" }],
  plan: [
    { stepId: "brainstorm-agent", title: "Brainstorm Proposal" },
    { stepId: "spec-agent", title: "Design Specification" },
  ],
  implement: [
    { stepId: "brainstorm-agent", title: "Brainstorm Proposal" },
    { stepId: "spec-agent", title: "Design Specification" },
    { stepId: "plan-agent", title: "Implementation Plan" },
  ],
  review: [
    { stepId: "brainstorm-agent", title: "Brainstorm Proposal" },
    { stepId: "spec-agent", title: "Design Specification" },
    { stepId: "plan-agent", title: "Implementation Plan" },
    { stepId: "implement-agent", title: "Implementation Summary" },
    { stepId: "auto-design", title: "Auto Delivery Summary" },
  ],
};

function extractStepSummaryText(stepOut: Record<string, unknown>): string {
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

function buildUpstreamStageContextBlock(
  phase: string,
  stepOutputs: Record<string, unknown>,
): string {
  const candidates = UPSTREAM_STAGE_STEPS[phase.toLowerCase()];
  if (!candidates || candidates.length === 0) return "";

  const sections: string[] = [];
  for (const { stepId, title } of candidates) {
    const stepOut = stepOutputs[stepId] as Record<string, unknown> | undefined;
    if (!stepOut || typeof stepOut !== "object") continue;
    const summaryText = extractStepSummaryText(stepOut);
    if (summaryText) {
      sections.push(`### ${title} (${stepId})\n${summaryText}`);
    }
  }

  if (sections.length === 0) return "";
  return `\n\n## Approved Upstream Stage Context\n\n${sections.join("\n\n")}`;
}

export function normalizeAgentChangeMode(provider: string, rawMode?: string): string {
  const p = (provider || "claude").toLowerCase().trim();
  const m = (rawMode || "").trim();

  if (p.includes("claude")) {
    if (m === "full-access") {
      return "bypassPermissions";
    }
    const validClaudeModes = ["plan", "default", "acceptEdits", "auto", "bypassPermissions"];
    return validClaudeModes.includes(m) ? m : "auto";
  }

  if (p.includes("codex")) {
    if (m === "bypassPermissions" || m === "acceptEdits") {
      return "full-access";
    }
    const validCodexModes = ["auto", "auto-review", "full-access"];
    return validCodexModes.includes(m) ? m : "auto";
  }

  if (p.includes("opencode")) {
    if (m === "full-access" || m === "bypassPermissions" || m === "auto") {
      return "build";
    }
    const validOpenCodeModes = ["build", "plan"];
    return validOpenCodeModes.includes(m) ? m : "build";
  }

  if (p === "pi" || p.startsWith("pi/") || p.startsWith("pi-") || p.startsWith("pi_")) {
    if (m === "full-access" || m === "bypassPermissions" || m === "acceptEdits" || m === "build") {
      return "auto";
    }
    const validPiModes = ["auto", "plan", "read-only"];
    return validPiModes.includes(m) ? m : "auto";
  }

  return m || "auto";
}

export function createAgentExecuteAdapter(
  settingsManager: SettingsManager,
  indexStore: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.agent_execute",
    version: "1.0.0",
    inputSchema: z.object({
      phase: z.string().default("implement"),
      role: z.string().optional(),
      prompt: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    outputSchema: z.object({
      agentId: z.string(),
      status: z.string(),
      outcome: z.string(),
      summary: z.string().optional(),
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
      const input = rawInput as {
        phase?: string;
        role?: string;
        prompt?: string;
        timeoutMs?: number;
      };
      const runId = (context as any)?.run?.runId;
      const projectId = (context as any)?.run?.projectId;
      const entry = runId ? await indexStore.getEntryByRunId(runId) : null;
      const issueNum = entry?.issueNumber ?? 0;
      const issueTitle = entry?.issueTitle ?? "";
      const phase = input.phase ?? "implement";
      const runInput = (context as any)?.run?.runInput ?? {};
      const effectiveIssueNum = issueNum || runInput.issueNumber || 0;
      const effectiveIssueTitle = issueTitle || runInput.issueTitle || "";
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

      // 1. Locate the worktree workspace created for this run
      const workspaceCtx = await resolveRunWorkspaceContext({
        paseo: (context as any)?.paseo,
        projectId: effectiveProjectId,
        runId,
        issueNumber: effectiveIssueNum,
        issueTitle: effectiveIssueTitle,
        workspaceRoot: (context as any)?.run?.workspaceRoot,
        worktreeOutput: wtOutput,
        syncWorkspaceTitle: true,
        requireAgentApi: true,
      });
      const { targetCwd, targetWorkspaceId } = workspaceCtx;

      // 2. Compose prompt
      let prompt = input.prompt;
      if (!prompt) {
        const interpolationContext: PromptInterpolationContext = {
          issueNumber: effectiveIssueNum,
          issueTitle: effectiveIssueTitle,
          issueBody: effectiveIssueBody,
          repoOwner,
          repoName,
          branchName,
          projectId: resolvedProjectId,
        };

        if (phase === "auto_design") {
          const rawTemplate =
            typeof settingsManager?.getAgentAutoPrompt === "function"
              ? settingsManager.getAgentAutoPrompt(resolvedProjectId)
              : DEFAULT_AGENT_AUTO_PROMPT;
          prompt = interpolatePrompt(
            rawTemplate || DEFAULT_AGENT_AUTO_PROMPT,
            interpolationContext,
          );
        } else if (phase === "plan" || phase === "brainstorm") {
          const rawTemplate =
            typeof settingsManager?.getAgentPlanPrompt === "function"
              ? settingsManager.getAgentPlanPrompt(resolvedProjectId)
              : DEFAULT_AGENT_PLAN_PROMPT;
          prompt = interpolatePrompt(
            rawTemplate || DEFAULT_AGENT_PLAN_PROMPT,
            interpolationContext,
          );
        } else if (phase === "implement") {
          prompt = `You are an automated software engineer assigned to Gitea Issue #${effectiveIssueNum}: ${effectiveIssueTitle}.
Repository: ${repoOwner}/${repoName} | Branch: ${branchName}

Issue Context:
${effectiveIssueBody || "(No description provided)"}

## Workflow Instructions:
1. **Understand & Diagnose (\`codebase-design\` / \`diagnosing-bugs\`)**:
   - Follow the approved \`plan-agent\` upstream context and inspect relevant existing code. If additional details are needed, check Issue #${effectiveIssueNum}.
   - For bug fixes and regressions, follow \`diagnosing-bugs\` (reproduce -> isolate -> root cause); for features and refactors, follow \`codebase-design\` (deep modules with simple public interfaces).
2. **Execute via Vertical TDD (\`tdd\`)**:
   - Work in vertical \`Red -> Green -> Refactor\` slices at public module Seams:
     1) Write one failing behavior test at a public Seam proving the intended behavior;
     2) Implement minimal clean code to make the test pass;
     3) Refactor and verify with targeted tests, lint, and typecheck (never run full monorepo test suites).
3. **Commit & PR Summary (\`pr\`)**:
   - Commit your changes cleanly on \`${branchName || "the current branch"}\` with conventional commit syntax (\`feat(...)\`, \`fix(...)\`) and leave a clean working tree.
   - Conclude your final response with a structured \`pr\` skill summary containing \`## Summary\`, \`## Evidence\`, and \`## Merge Danger\`.`;
        } else if (phase === "review") {
          const rawTemplate =
            typeof settingsManager?.getAgentReviewPrompt === "function"
              ? settingsManager.getAgentReviewPrompt(resolvedProjectId)
              : DEFAULT_AGENT_REVIEW_PROMPT;
          prompt = interpolatePrompt(
            rawTemplate || DEFAULT_AGENT_REVIEW_PROMPT,
            interpolationContext,
          );
        } else {
          prompt = `You are addressing Gitea Issue #${effectiveIssueNum}: ${effectiveIssueTitle} (Phase: ${phase}).
Repository: ${repoOwner}/${repoName} | Branch: ${branchName}

Issue Context:
${effectiveIssueBody || "(No description provided)"}

First, review the issue context and requirements. Then proceed with the engineering workflow ensuring high code quality.`;
        }

        const upstreamBlock = buildUpstreamStageContextBlock(phase, allStepOutputs);
        if (upstreamBlock) {
          prompt = `${prompt}${upstreamBlock}`;
        }
      }

      // 3. Resolve harness routing, provider, model, labels & metadata
      const launch = await resolveWorkflowAgentLaunch({
        paseo: (context as any)?.paseo,
        settingsManager,
        projectId: effectiveProjectId,
        workspaceId: targetWorkspaceId,
        cwd: targetCwd,
        runId,
        phase,
        explicitRole: input.role,
        issueTitle: effectiveIssueTitle,
        issueBody: effectiveIssueBody,
      });

      const rawMode = settingsManager?.getAgentChangeMode
        ? settingsManager.getAgentChangeMode(effectiveProjectId)
        : "auto";
      const modeId =
        phase.toLowerCase() === "review"
          ? resolveReviewReadOnlyMode(launch.provider)
          : normalizeAgentChangeMode(launch.provider, rawMode);
      const config: { provider: string; modeId: string; thinkingOptionId?: string } = {
        provider: launch.providerSelection,
        modeId,
      };
      if (launch.thinkingOptionId) {
        config.thinkingOptionId = launch.thinkingOptionId;
      }

      const meta = PHASE_META[phase.toLowerCase()] || { icon: "🤖", label: phase };
      const cleanShort = effectiveIssueTitle ? cleanIssueTitle(effectiveIssueTitle) : "";
      const shortTitle = cleanShort ? ` · ${cleanShort.slice(0, 28)}` : "";
      const agentTitle = `${meta.icon} [#${effectiveIssueNum}] ${meta.label}${shortTitle}`;

      // 4. Create and drive agent with friendly title
      const agentHandle = await createWorkspaceAgent(workspaceCtx, (context as any)?.paseo, {
        title: agentTitle,
        prompt,
        config,
        labels: launch.labels,
        metadata: launch.metadata,
      });

      const timeoutMs =
        input.timeoutMs ??
        (context as any)?.step?.timeoutMs ??
        (context as any)?.definitionStep?.timeoutMs ??
        30 * 60 * 1000;

      const summary = await driveAgentTurn(agentHandle, prompt, timeoutMs);
      const outcome = summary || "completed";

      return {
        agentId: agentHandle.id,
        status: "succeeded",
        outcome,
        summary,
        harness: launch.harnessInfo,
      };
    },
  };
}
