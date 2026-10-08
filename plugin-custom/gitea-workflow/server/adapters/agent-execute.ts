import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { SettingsManager } from "../settings-manager.js";
import type { IssueRunIndexStore } from "../store.js";
import { formatWorkflowWorkspaceTitle, cleanIssueTitle } from "../workspace-title.js";
import { interpolatePrompt, type PromptInterpolationContext } from "../prompt-interpolator.js";
import { DEFAULT_AGENT_AUTO_PROMPT, DEFAULT_AGENT_PLAN_PROMPT } from "../../shared/prompts.js";

const PHASE_META: Record<string, { icon: string; label: string }> = {
  brainstorm: { icon: "💡", label: "方案设计" },
  spec: { icon: "📝", label: "规范制定" },
  plan: { icon: "📋", label: "计划编写" },
  implement: { icon: "🛠️", label: "TDD编码" },
  review: { icon: "🔍", label: "独立审查" },
};

export function createAgentExecuteAdapter(
  settingsManager: SettingsManager,
  indexStore: IssueRunIndexStore,
): PluginWorkflowStepAdapterRegistration {
  return {
    type: "gitea.agent_execute",
    version: "1.0.0",
    inputSchema: z.object({
      phase: z.string().default("implement"),
      prompt: z.string().optional(),
    }),
    outputSchema: z.object({
      agentId: z.string(),
      status: z.string(),
      outcome: z.string(),
      summary: z.string().optional(),
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
      const input = rawInput as { phase?: string; prompt?: string };
      const runId = (context as any)?.run?.runId;
      const projectId = (context as any)?.run?.projectId;
      const entry = runId ? await indexStore.getEntryByRunId(runId) : null;

      // 1. Locate the worktree workspace created for this run
      let targetCwd = (context as any)?.run?.workspaceRoot || "";
      let targetWorkspaceId: string | undefined = undefined;

      if ((context as any)?.paseo?.workspaces && projectId) {
        try {
          const list = await (context as any).paseo.workspaces.list({ filter: { projectId } });
          const entries: any[] = list?.entries ?? [];
          const wtOutput =
            (context as any)?.stepOutputs?.["worktree-create"] ??
            (context as any)?.run?.stepOutputs?.["worktree-create"];

          if (wtOutput?.workspaceId) {
            targetWorkspaceId = wtOutput.workspaceId;
            const ws = entries.find((w: any) => w.id === targetWorkspaceId);
            if (ws?.workspaceDirectory) {
              targetCwd = ws.workspaceDirectory;
            } else if (wtOutput?.directory || wtOutput?.cwd || wtOutput?.worktreePath) {
              targetCwd = wtOutput.directory || wtOutput.cwd || wtOutput.worktreePath;
            }
          }

          // Match by issue number or branch pattern in worktree workspace
          if (!targetWorkspaceId && entry?.issueNumber) {
            const issueTag = `issue-${entry.issueNumber}`;
            const issueHashTag = `#${entry.issueNumber}`;
            const match = entries.find(
              (w: any) =>
                w.workspaceKind === "worktree" &&
                (w.name?.includes(issueTag) ||
                  w.workspaceDirectory?.includes(issueTag) ||
                  w.title?.includes(issueHashTag) ||
                  w.title?.includes(issueTag) ||
                  w.branch?.includes(issueTag)),
            );
            if (match) {
              targetWorkspaceId = match.id;
              targetCwd = match.workspaceDirectory || targetCwd;
            }
          }

          // Match by runId
          if (!targetWorkspaceId && runId) {
            const match = entries.find(
              (w: any) =>
                w.workspaceDirectory?.includes(runId) ||
                w.name?.includes(runId) ||
                w.branch?.includes(runId),
            );
            if (match) {
              targetWorkspaceId = match.id;
              targetCwd = match.workspaceDirectory || targetCwd;
            }
          }

          // Single worktree fallback
          if (!targetWorkspaceId) {
            const worktrees = entries.filter((w: any) => w.workspaceKind === "worktree");
            if (worktrees.length === 1) {
              targetCwd = worktrees[0].workspaceDirectory || targetCwd;
              targetWorkspaceId = worktrees[0].id;
            }
          }

          // Safe project fallback: NEVER fall back to process.cwd() (home directory danger!)
          if (!targetWorkspaceId || !targetCwd) {
            const mainWs =
              entries.find(
                (w: any) => w.workspaceKind === "local_checkout" || w.workspaceKind === "checkout",
              ) || entries[0];
            if (mainWs) {
              targetWorkspaceId = targetWorkspaceId || mainWs.id;
              targetCwd = targetCwd || mainWs.workspaceDirectory || mainWs.projectRootPath || "";
            }
          }

          // Ensure the workspace has a semantic title
          if (targetWorkspaceId) {
            try {
              const wsRef = (context as any).paseo.workspaces.ref(targetWorkspaceId);
              const currentWs = typeof wsRef?.current === "function" ? wsRef.current() : null;
              const titleToSet =
                entry?.issueTitle && entry?.issueNumber
                  ? formatWorkflowWorkspaceTitle({
                      issueNumber: entry.issueNumber,
                      rawTitle: entry.issueTitle,
                    })
                  : entry?.issueNumber
                    ? `#${entry.issueNumber}`
                    : undefined;
              if (titleToSet && !currentWs?.title && typeof wsRef?.setTitle === "function") {
                await wsRef.setTitle(titleToSet);
              }
            } catch {
              // ignore title sync error
            }
          }
        } catch {
          // ignore lookup error
        }
      }

      // 2. Resolve provider & model from settings
      const rawProvider = settingsManager.getAgentProvider(projectId);
      const provider = rawProvider.toLowerCase().includes("codex")
        ? "codex"
        : rawProvider.toLowerCase().includes("opencode")
          ? "opencode"
          : rawProvider.toLowerCase().includes("antigravity")
            ? "antigravity"
            : "claude";
      const model = settingsManager.getAgentModel(projectId);

      const issueNum = entry?.issueNumber ?? 0;
      const issueTitle = entry?.issueTitle ?? "";
      const phase = input.phase ?? "implement";

      // 3. Compose prompt
      let prompt = input.prompt;
      if (!prompt) {
        const runInput = (context as any)?.run?.runInput ?? {};
        const effectiveIssueNum = issueNum || runInput.issueNumber || 0;
        const effectiveIssueTitle = issueTitle || runInput.issueTitle || "";
        const effectiveIssueBody = (entry as any)?.issueBody || runInput.issueBody || "";
        const repoOwner = entry?.repoOwner || runInput.repoOwner || "";
        const repoName = entry?.repoName || runInput.repoName || "";
        const branchName = runInput.branch || "";
        const resolvedProjectId = projectId || entry?.projectId || runInput.projectId || "";

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
        } else if (phase === "brainstorm") {
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
First, use the \`gitea\` skill to fetch Issue #${effectiveIssueNum} and review its complete context, requirements, acceptance criteria, and discussion comments.
Then, load and follow \`superpowers:executing-plans\` or \`superpowers:subagent-driven-development\`.
Strictly adhere to Test-Driven Development (TDD):
1. Review the requirement and existing code;
2. Write unit tests proving the intended behavior;
3. Implement clean, focused code until all tests pass;
4. Verify with tests, lint, and typecheck;
5. Commit your changes with clear conventional commit syntax.`;
        } else {
          prompt = `You are addressing Gitea Issue #${effectiveIssueNum}: ${effectiveIssueTitle} (Phase: ${phase}).
First, use the \`gitea\` skill to fetch Issue #${effectiveIssueNum} and review the context and requirements.
Then, proceed with the engineering workflow and ensure high code quality.`;
        }
      }

      // 4. Create and drive agent with friendly title
      if (!(context as any)?.paseo?.agents) {
        throw new Error("Paseo Agent API is not available");
      }

      const modelName = model || "gemini-flash[1M]";
      const providerSelection = `${provider}/${modelName}`;
      const modeId = settingsManager.getAgentChangeMode
        ? settingsManager.getAgentChangeMode(projectId)
        : "auto";

      if (!targetCwd) {
        throw new Error(
          `Cannot resolve valid working directory for project ${projectId || "unknown"} (issue #${issueNum})`,
        );
      }

      const meta = PHASE_META[phase.toLowerCase()] || { icon: "🤖", label: phase };
      const cleanShort = issueTitle ? cleanIssueTitle(issueTitle) : "";
      const shortTitle = cleanShort ? ` · ${cleanShort.slice(0, 28)}` : "";
      const agentTitle = `${meta.icon} [#${issueNum}] ${meta.label}${shortTitle}`;

      const agentHandle = await (context as any).paseo.agents.create({
        cwd: targetCwd,
        workspaceId: targetWorkspaceId,
        title: agentTitle,
        config: {
          provider: providerSelection,
          modeId,
        },
      });

      // Execute prompt and await completion
      let outcome = "completed";
      let summary = "";
      if (typeof agentHandle.run === "function") {
        const runRes = await agentHandle.run(prompt);
        if (runRes.status === "error") {
          throw new Error(`Agent run failed: ${runRes.error || runRes.status}`);
        }
        outcome = runRes.lastMessage || outcome;
        summary = runRes.lastMessage || "";
      } else {
        await agentHandle.send(prompt);
        if (typeof agentHandle.waitForFinish === "function") {
          const waitRes = await agentHandle.waitForFinish();
          outcome = waitRes.lastMessage || outcome;
          summary = waitRes.lastMessage || "";
        }
      }

      return {
        agentId: agentHandle.id,
        status: "succeeded",
        outcome,
        summary,
      };
    },
  };
}
