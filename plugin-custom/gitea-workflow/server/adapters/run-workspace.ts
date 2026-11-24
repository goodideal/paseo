import { existsSync } from "node:fs";
import { formatWorkflowWorkspaceTitle } from "../workspace-title.js";

export interface ResolveRunWorkspaceParams {
  paseo?: any;
  projectId?: string;
  runId?: string;
  issueNumber?: number;
  issueTitle?: string;
  explicitCwd?: string;
  workspaceRoot?: string;
  worktreeOutput?: Record<string, any>;
  syncWorkspaceTitle?: boolean;
  requireAgentApi?: boolean;
  requireDirectoryExists?: boolean;
}

export interface RunWorkspaceContext {
  targetCwd: string;
  targetWorkspaceId?: string;
  wsRef: any;
  canCreateOnWorkspaceRef: boolean;
}

export interface CreateWorkspaceAgentOptions {
  title: string;
  prompt: string;
  config: {
    provider: string;
    modeId: string;
    thinkingOptionId?: string;
  };
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export async function resolveRunWorkspaceContext(
  params: ResolveRunWorkspaceParams,
): Promise<RunWorkspaceContext> {
  const {
    paseo,
    projectId,
    runId,
    issueNumber = 0,
    issueTitle = "",
    explicitCwd,
    workspaceRoot,
    worktreeOutput,
    syncWorkspaceTitle = false,
    requireAgentApi = false,
    requireDirectoryExists = false,
  } = params;

  let targetWorkspaceId: string | undefined = worktreeOutput?.workspaceId;
  let targetCwd: string =
    explicitCwd ||
    worktreeOutput?.worktreePath ||
    worktreeOutput?.directory ||
    worktreeOutput?.cwd ||
    workspaceRoot ||
    "";

  if (!explicitCwd && paseo?.workspaces && projectId) {
    try {
      const list = await paseo.workspaces.list({ filter: { projectId } });
      const entries: any[] = list?.entries ?? [];

      if (targetWorkspaceId) {
        const ws = entries.find((w: any) => w.id === targetWorkspaceId);
        if (ws?.workspaceDirectory) {
          targetCwd = ws.workspaceDirectory;
        }
      }

      if (!targetWorkspaceId && issueNumber) {
        const issueTag = `issue-${issueNumber}`;
        const issueHashTag = `#${issueNumber}`;
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

      if (!targetWorkspaceId) {
        const worktrees = entries.filter((w: any) => w.workspaceKind === "worktree");
        if (worktrees.length === 1) {
          targetCwd = worktrees[0].workspaceDirectory || targetCwd;
          targetWorkspaceId = worktrees[0].id;
        }
      }

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

      if (syncWorkspaceTitle && targetWorkspaceId && typeof paseo.workspaces.ref === "function") {
        try {
          const ref = paseo.workspaces.ref(targetWorkspaceId);
          const currentWs = typeof ref?.current === "function" ? ref.current() : null;
          let titleToSet: string | undefined;
          if (issueTitle && issueNumber) {
            titleToSet = formatWorkflowWorkspaceTitle({
              issueNumber,
              rawTitle: issueTitle,
            });
          } else if (issueNumber) {
            titleToSet = `#${issueNumber}`;
          }
          if (titleToSet && !currentWs?.title && typeof ref?.setTitle === "function") {
            await ref.setTitle(titleToSet);
          }
        } catch {
          // ignore workspace title sync failure
        }
      }
    } catch {
      // ignore workspace lookup failure
    }
  }

  let wsRef: any = null;
  if (targetWorkspaceId && typeof paseo?.workspaces?.ref === "function") {
    wsRef = paseo.workspaces.ref(targetWorkspaceId);
  }
  const canCreateOnWorkspaceRef = Boolean(
    targetWorkspaceId && wsRef && typeof wsRef.agents?.create === "function",
  );

  if (requireAgentApi && !canCreateOnWorkspaceRef && !paseo?.agents) {
    throw new Error("Paseo Agent API is not available");
  }

  const trimmedCwd = targetCwd.trim();
  if (!trimmedCwd) {
    throw new Error(
      `Cannot resolve valid working directory for project ${projectId || "unknown"} (issue #${issueNumber})`,
    );
  }

  if (requireDirectoryExists && !existsSync(trimmedCwd)) {
    throw new Error(
      `Resolved working directory does not exist for project ${projectId || "unknown"} (issue #${issueNumber}): ${trimmedCwd}`,
    );
  }

  return {
    targetCwd: trimmedCwd,
    targetWorkspaceId,
    wsRef,
    canCreateOnWorkspaceRef,
  };
}

export async function createWorkspaceAgent(
  workspaceCtx: RunWorkspaceContext,
  paseo: any,
  options: CreateWorkspaceAgentOptions,
): Promise<any> {
  const baseAgentCreateOpts: Record<string, unknown> = {
    title: options.title,
    prompt: options.prompt,
    config: options.config,
    labels: options.labels,
  };
  if (options.metadata) {
    baseAgentCreateOpts.metadata = options.metadata;
  }

  if (workspaceCtx.canCreateOnWorkspaceRef && workspaceCtx.wsRef) {
    return await workspaceCtx.wsRef.agents.create(baseAgentCreateOpts);
  }

  const fallbackAgentCreateOpts: Record<string, unknown> = {
    cwd: workspaceCtx.targetCwd,
    ...baseAgentCreateOpts,
  };
  if (workspaceCtx.targetWorkspaceId) {
    fallbackAgentCreateOpts.workspaceId = workspaceCtx.targetWorkspaceId;
  }
  return await paseo.agents.create(fallbackAgentCreateOpts);
}

export async function driveAgentTurn(
  agentHandle: any,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const safeDetach = async () => {
    if (typeof agentHandle?.detach === "function") {
      await agentHandle.detach().catch(() => {});
    }
  };

  try {
    if (typeof agentHandle?.waitForFinish === "function") {
      const waitRes = await agentHandle.waitForFinish(timeoutMs);
      if (waitRes.status !== "idle") {
        const errSuffix = waitRes.error ? `: ${waitRes.error}` : "";
        throw new Error(`Agent run failed with status "${waitRes.status}"${errSuffix}`);
      }
      return waitRes.lastMessage || "";
    }
    if (typeof agentHandle?.run === "function") {
      const runRes = await agentHandle.run(prompt, { timeoutMs });
      if (runRes.status !== "idle") {
        const errSuffix = runRes.error ? `: ${runRes.error}` : "";
        throw new Error(`Agent run failed with status "${runRes.status}"${errSuffix}`);
      }
      return runRes.lastMessage || "";
    }
    if (typeof agentHandle?.send === "function") {
      await agentHandle.send(prompt);
    }
    return "";
  } catch (err) {
    await safeDetach();
    throw err;
  }
}

export function resolveReviewReadOnlyMode(provider: string): string {
  const p = (provider || "").toLowerCase().trim();
  if (p.includes("codex")) {
    return "auto-review";
  }
  if (
    p.includes("claude") ||
    p.includes("opencode") ||
    p === "pi" ||
    p.startsWith("pi/") ||
    p.startsWith("pi-") ||
    p.startsWith("pi_")
  ) {
    return "plan";
  }
  return "auto";
}

export function truncateAndRedactOutput(
  text: string,
  maxChars = 12_000,
  secrets: string[] = [],
): string {
  if (!text) return "";

  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length > 3) {
      result = result.replaceAll(secret, "[redacted]");
    }
  }

  result = result
    .replace(/(https?:\/\/)([^\s/@:]+(?::[^\s/@]+)?)(@)/gi, "$1[redacted]$3")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(Authorization\s*[:=]\s*(?:token|Bearer)?\s*)[^\s"',;]+/gi, "$1[redacted]")
    .replace(
      /\b((?:access_|gitea_|api_|auth_)?(?:token|key|secret|password)\s*[=:]\s*)["']?[A-Za-z0-9._~+/-]{6,}["']?/gi,
      "$1[redacted]",
    )
    .replace(/\b(ghp|gho|ghu|ghs|ghr|github_pat|glpat)_[A-Za-z0-9_]{16,}\b/g, "[redacted]")
    .replace(/\bsk-(?:ant|live|proj)?[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[redacted private key]",
    );

  const suffix = "\n...[truncated]...";
  if (maxChars > 0 && result.length > maxChars) {
    if (maxChars <= suffix.length) {
      return result.slice(0, maxChars);
    }
    return `${result.slice(0, maxChars - suffix.length)}${suffix}`;
  }
  return result;
}
