import { existsSync } from "node:fs";
import type { IssueRunIndexEntry } from "../../shared/types.js";
import {
  buildTeamCollabOwnerMetadata,
  type GiteaIdentityBridge,
  type TeamCollabOwnerMetadata,
} from "../identity-bridge.js";
import type { IssueRunIndexStore } from "../store.js";
import { formatWorkflowWorkspaceTitle } from "../workspace-title.js";

export interface ResolvedGiteaAdapterTarget {
  token: string;
  baseUrl: string;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  identityId?: string;
  entry: IssueRunIndexEntry | null;
  runInput: Record<string, any>;
}

export async function resolveGiteaAdapterTarget(
  rawInput: Record<string, any> | null | undefined,
  context: unknown,
  indexStore?: IssueRunIndexStore,
): Promise<ResolvedGiteaAdapterTarget> {
  const input = rawInput ?? {};
  const runCtx = (context as any)?.run ?? {};
  const runId = typeof runCtx.runId === "string" ? runCtx.runId : "";
  const runInput: Record<string, any> =
    runCtx.runInput && typeof runCtx.runInput === "object" ? runCtx.runInput : {};
  const entry = runId && indexStore ? await indexStore.getEntryByRunId(runId) : null;

  const pickNonEmptyString = (...candidates: unknown[]): string => {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return "";
  };

  const pickPositiveInt = (...candidates: unknown[]): number => {
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }
    return 0;
  };

  const token = pickNonEmptyString(input.token, runInput.token, entry?.token);
  const baseUrl = pickNonEmptyString(input.baseUrl, runInput.baseUrl, entry?.baseUrl);
  const repoOwner = pickNonEmptyString(input.repoOwner, runInput.repoOwner, entry?.repoOwner);
  const repoName = pickNonEmptyString(input.repoName, runInput.repoName, entry?.repoName);
  const issueNumber = pickPositiveInt(input.issueNumber, runInput.issueNumber, entry?.issueNumber);
  const identityId =
    pickNonEmptyString(input.identityId, runInput.identityId, entry?.identityId) || undefined;

  if (identityId && !token) {
    throw new Error(`Selected Gitea identity (${identityId}) has no valid token for this run`);
  }

  return {
    token,
    baseUrl,
    repoOwner,
    repoName,
    issueNumber,
    ...(identityId ? { identityId } : {}),
    entry,
    runInput,
  };
}

export interface RunIdentityMetadata {
  identityId?: string;
  identitySource?: "team-collab" | "tea" | "env";
  authorName?: string;
  authorEmail?: string;
  giteaUsername?: string;
  sshKeyPath?: string;
  token?: string;
  baseUrl?: string;
  teamCollabOwner: TeamCollabOwnerMetadata | null;
}

export function resolveRunIdentityMetadata(
  entry?: Partial<IssueRunIndexEntry> | null,
  runInput?: Record<string, unknown> | null,
): RunIdentityMetadata {
  const input = runInput ?? {};
  const rawIdentityId =
    (typeof entry?.identityId === "string" && entry.identityId.trim()) ||
    (typeof input.identityId === "string" && input.identityId.trim()) ||
    undefined;

  let identitySource: "team-collab" | "tea" | "env" | undefined;
  const candidateSource = entry?.identitySource ?? input.identitySource;
  if (candidateSource === "team-collab" || candidateSource === "tea" || candidateSource === "env") {
    identitySource = candidateSource;
  }

  const authorName =
    (typeof entry?.authorName === "string" && entry.authorName.trim()) ||
    (typeof input.authorName === "string" && input.authorName.trim()) ||
    undefined;
  const authorEmail =
    (typeof entry?.authorEmail === "string" && entry.authorEmail.trim()) ||
    (typeof input.authorEmail === "string" && input.authorEmail.trim()) ||
    undefined;
  const giteaUsername =
    (typeof entry?.giteaUsername === "string" && entry.giteaUsername.trim()) ||
    (typeof input.giteaUsername === "string" && input.giteaUsername.trim()) ||
    undefined;
  const sshKeyPath =
    (typeof entry?.sshKeyPath === "string" && entry.sshKeyPath.trim()) ||
    (typeof input.sshKeyPath === "string" && input.sshKeyPath.trim()) ||
    undefined;
  const token =
    (typeof entry?.token === "string" && entry.token.trim()) ||
    (typeof input.token === "string" && input.token.trim()) ||
    undefined;
  const baseUrl =
    (typeof entry?.baseUrl === "string" && entry.baseUrl.trim()) ||
    (typeof input.baseUrl === "string" && input.baseUrl.trim()) ||
    undefined;

  const teamCollabOwner = buildTeamCollabOwnerMetadata({
    id: rawIdentityId,
    source: identitySource,
    name: authorName,
    email: authorEmail,
  });

  return {
    ...(rawIdentityId ? { identityId: rawIdentityId } : {}),
    ...(identitySource ? { identitySource } : {}),
    ...(authorName ? { authorName } : {}),
    ...(authorEmail ? { authorEmail } : {}),
    ...(giteaUsername ? { giteaUsername } : {}),
    ...(sshKeyPath ? { sshKeyPath } : {}),
    ...(token ? { token } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    teamCollabOwner,
  };
}

export function enrichAgentLaunchWithIdentity<
  T extends {
    labels?: Record<string, string>;
    metadata?: Record<string, unknown>;
  },
>(launch: T, identity: RunIdentityMetadata): T {
  if (!identity.teamCollabOwner && !identity.giteaUsername) {
    return launch;
  }
  const labels: Record<string, string> = {
    ...(launch.labels ?? {}),
    ...(identity.giteaUsername ? { "gitea.assignee": identity.giteaUsername } : {}),
  };
  const hasMetadata = Boolean(launch.metadata || identity.teamCollabOwner);
  const metadata: Record<string, unknown> | undefined = hasMetadata
    ? {
        ...(launch.metadata ?? {}),
        ...(identity.teamCollabOwner ? { "team-collab.owner": identity.teamCollabOwner } : {}),
      }
    : undefined;
  return {
    ...launch,
    labels,
    ...(metadata ? { metadata } : {}),
  };
}

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
  identity?: RunIdentityMetadata;
  identityBridge?: GiteaIdentityBridge;
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
    identity,
    identityBridge,
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
  if (targetWorkspaceId && identity?.teamCollabOwner && wsRef) {
    try {
      const currentWs = typeof wsRef.current === "function" ? wsRef.current() : null;
      const isWorktreeWorkspace =
        Boolean(worktreeOutput?.workspaceId && targetWorkspaceId === worktreeOutput.workspaceId) ||
        currentWs?.workspaceKind === "worktree";
      const existingOwner = currentWs?.metadata?.["team-collab.owner"];
      if (isWorktreeWorkspace && !existingOwner && typeof wsRef.setMetadata === "function") {
        await wsRef.setMetadata({
          ...(currentWs?.metadata ?? {}),
          "team-collab.owner": identity.teamCollabOwner,
        });
      }
    } catch {
      // ignore metadata sync error
    }
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

  if (identityBridge && identity?.authorName && identity?.authorEmail) {
    await identityBridge
      .applyIdentityToWorktree(trimmedCwd, {
        name: identity.authorName,
        email: identity.authorEmail,
        sshKeyPath: identity.sshKeyPath,
        source: identity.identitySource,
      })
      .catch(() => {});
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
    .replace(/\b(Basic\s+)[A-Za-z0-9+/=]{6,}/gi, "$1[redacted]")
    .replace(/\b(Authorization\s*[:=]\s*(?:token|Bearer|Basic)?\s*)[^\s"',;]+/gi, "$1[redacted]")
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
