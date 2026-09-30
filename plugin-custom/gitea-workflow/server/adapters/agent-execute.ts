import { z } from "zod";
import type { PluginWorkflowStepAdapterRegistration } from "@getpaseo/plugin/server";
import type { SettingsManager } from "../settings-manager.js";
import type { IssueRunIndexStore } from "../store.js";

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
      let targetCwd = (context as any)?.run?.workspaceRoot || process.cwd();
      let targetWorkspaceId: string | undefined = undefined;

      if ((context as any)?.paseo?.workspaces && projectId) {
        try {
          const list = await (context as any).paseo.workspaces.list({ filter: { projectId } });
          const entries = list?.entries ?? [];
          const match = entries.find(
            (w: any) => runId && (w.workspaceDirectory?.includes(runId) || w.name?.includes(runId)),
          );
          if (match?.workspaceDirectory) {
            targetCwd = match.workspaceDirectory;
            targetWorkspaceId = match.id;
          } else {
            // Check upstream worktree-create output if available
            const wtOutput = (context as any)?.stepOutputs?.["worktree-create"];
            if (wtOutput?.directory || wtOutput?.cwd) {
              targetCwd = wtOutput.directory || wtOutput.cwd;
              targetWorkspaceId = wtOutput.workspaceId;
            } else {
              const worktrees = entries.filter((w: any) => w.workspaceKind === "worktree");
              if (worktrees.length === 1) {
                targetCwd = worktrees[0].workspaceDirectory || targetCwd;
                targetWorkspaceId = worktrees[0].id;
              }
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
        if (phase === "implement") {
          prompt = `You are an automated software engineer assigned to Gitea Issue #${issueNum}: ${issueTitle}.
First, use the \`gitea\` skill to fetch Issue #${issueNum} and review its complete context, requirements, acceptance criteria, and discussion comments.
Then, load and follow \`superpowers:executing-plans\` or \`superpowers:subagent-driven-development\`.
Strictly adhere to Test-Driven Development (TDD):
1. Review the requirement and existing code;
2. Write unit tests proving the intended behavior;
3. Implement clean, focused code until all tests pass;
4. Verify with tests, lint, and typecheck;
5. Commit your changes with clear conventional commit syntax.`;
        } else if (phase === "brainstorm") {
          prompt = `You are addressing Gitea Issue #${issueNum}: ${issueTitle}.
First, use the \`gitea\` skill to fetch Issue #${issueNum} and inspect its complete background, core scope, acceptance criteria, and discussion comments.
Then, load and follow \`superpowers:brainstorming\` to thoroughly analyze the requirements, explore alternative technical architectures, and output distinct design proposals (方案 A / B / C) with clear pros, cons, and recommendations.`;
        } else {
          prompt = `You are addressing Gitea Issue #${issueNum}: ${issueTitle} (Phase: ${phase}).
First, use the \`gitea\` skill to fetch Issue #${issueNum} and review the context and requirements.
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

      const meta = PHASE_META[phase.toLowerCase()] || { icon: "🤖", label: phase };
      const shortTitle = issueTitle ? ` · ${issueTitle.slice(0, 28)}` : "";
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
