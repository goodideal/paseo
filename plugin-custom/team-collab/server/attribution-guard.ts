import fs from "node:fs";
import path from "node:path";
import type {
  PluginHandlerContext,
  PluginHookAgent,
  PluginHookContext,
  PluginHookPayload,
  PluginHookResult,
} from "@getpaseo/plugin/server";
import {
  createSystemBotOwnerMetadata,
  MEMBER_ID_PATTERN,
  parseWorkspaceOwnerMetadata,
  SYSTEM_BOT_MEMBER_ID,
  TEAM_COLLAB_OWNER_META_KEY,
  type TeamCollabPolicies,
  type TeamMemberProfile,
  type WorkspaceOwnerMetadata,
} from "../shared/contracts.js";
import { buildSshCommand, type GitConfigurator } from "./git-configurator.js";
import type { SecretStore } from "./secret-store.js";

type PaseoApiType = PluginHandlerContext["paseo"];
type PermissionRequestType = PluginHookPayload<"agent.permission.before">["request"];

const MANAGED_SESSION_ENV_KEYS = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_SSH_COMMAND",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITEA_TOKEN",
  "GITLAB_TOKEN",
  "GITLAB_HOST",
  "TEAM_COLLAB_OWNER_ID",
] as const;

interface ShellToken {
  kind: "word" | "sep";
  value: string;
}

function normalizeFsPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function formatOwnerWorkspaceLabel(ownerId: string): string {
  return `@${ownerId.trim()}`;
}

export function isOwnerWorkspaceLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed.startsWith("@")) return false;
  const slug = trimmed.slice(1);
  return slug === SYSTEM_BOT_MEMBER_ID || MEMBER_ID_PATTERN.test(slug);
}

function tokenizeShell(command: string): { tokens: ShellToken[]; subshells: string[] } {
  const tokens: ShellToken[] = [];
  const subshells: string[] = [];
  let current = "";
  let hasWord = false;
  let i = 0;

  const flushWord = () => {
    if (hasWord) {
      tokens.push({ kind: "word", value: current });
      current = "";
      hasWord = false;
    }
  };

  while (i < command.length) {
    const ch = command[i];

    if (ch === "\n" || ch === ";") {
      flushWord();
      tokens.push({ kind: "sep", value: ch });
      i += 1;
      continue;
    }

    if (ch === "&" || ch === "|") {
      flushWord();
      if (command[i + 1] === ch) {
        tokens.push({ kind: "sep", value: ch + ch });
        i += 2;
      } else {
        tokens.push({ kind: "sep", value: ch });
        i += 1;
      }
      continue;
    }

    if (/\s/.test(ch)) {
      flushWord();
      i += 1;
      continue;
    }

    if (ch === "'") {
      hasWord = true;
      i += 1;
      while (i < command.length && command[i] !== "'") {
        current += command[i];
        i += 1;
      }
      if (i < command.length) i += 1;
      continue;
    }

    if (ch === '"') {
      hasWord = true;
      i += 1;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < command.length) {
          current += command[i + 1];
          i += 2;
          continue;
        }
        if (command[i] === "$" && command[i + 1] === "(") {
          const { inner, nextIndex } = readBalancedSubshell(command, i + 2);
          subshells.push(inner);
          i = nextIndex;
          continue;
        }
        if (command[i] === "`") {
          const endTick = command.indexOf("`", i + 1);
          if (endTick > i) {
            subshells.push(command.slice(i + 1, endTick));
            i = endTick + 1;
            continue;
          }
        }
        current += command[i];
        i += 1;
      }
      if (i < command.length) i += 1;
      continue;
    }

    if (ch === "$" && command[i + 1] === "(") {
      hasWord = true;
      const { inner, nextIndex } = readBalancedSubshell(command, i + 2);
      subshells.push(inner);
      i = nextIndex;
      continue;
    }

    if (ch === "`") {
      hasWord = true;
      const endTick = command.indexOf("`", i + 1);
      if (endTick > i) {
        subshells.push(command.slice(i + 1, endTick));
        i = endTick + 1;
        continue;
      }
    }

    if (ch === "\\" && i + 1 < command.length) {
      hasWord = true;
      current += command[i + 1];
      i += 2;
      continue;
    }

    hasWord = true;
    current += ch;
    i += 1;
  }

  flushWord();
  return { tokens, subshells };
}

function readBalancedSubshell(src: string, startIdx: number): { inner: string; nextIndex: number } {
  let depth = 1;
  let i = startIdx;
  while (i < src.length && depth > 0) {
    if (src[i] === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  const inner = src.slice(startIdx, depth === 0 ? i - 1 : i);
  return { inner, nextIndex: i };
}

const GIT_FLAGS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

const FORGE_CLI_FLAGS_WITH_VALUE = new Set([
  "-R",
  "--repo",
  "-l",
  "--login",
  "--hostname",
  "-o",
  "--output",
]);

const SUDO_FLAGS_WITH_VALUE = new Set([
  "-u",
  "--user",
  "-g",
  "--group",
  "-C",
  "--close-from",
  "-D",
  "--chdir",
  "-R",
  "--chroot",
  "-T",
  "--command-timeout",
  "-h",
  "--host",
  "-p",
  "--prompt",
  "-r",
  "--role",
  "-t",
  "--type",
  "-U",
  "--other-user",
]);

const ENV_FLAGS_WITH_VALUE = new Set(["-u", "--unset", "-C", "--chdir", "-a", "--argv0"]);

const TIMEOUT_FLAGS_WITH_VALUE = new Set(["-k", "--kill-after", "-s", "--signal"]);

const STDBUF_FLAGS_WITH_VALUE = new Set(["-i", "--input", "-o", "--output", "-e", "--error"]);

const SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

function unwrapCommandPrefix(
  seg: readonly string[],
  depth: number,
): { nextIdx: number; matchedRecursive: boolean; skipSegment: boolean } {
  let idx = 0;

  while (idx < seg.length) {
    const word = seg[idx];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      idx += 1;
      continue;
    }

    const base = path.posix.basename(word.replaceAll("\\", "/")).toLowerCase();

    if (base === "env") {
      idx += 1;
      while (idx < seg.length) {
        const tok = seg[idx];
        if (tok === "--") {
          idx += 1;
          break;
        }
        if (tok === "-S" || tok === "--split-string") {
          if (idx + 1 < seg.length && isProtectedGitWriteCommand(seg[idx + 1], depth + 1)) {
            return { nextIdx: idx, matchedRecursive: true, skipSegment: true };
          }
          idx += 2;
          continue;
        }
        if (tok.startsWith("-S") && tok.length > 2) {
          if (isProtectedGitWriteCommand(tok.slice(2), depth + 1)) {
            return { nextIdx: idx, matchedRecursive: true, skipSegment: true };
          }
          idx += 1;
          continue;
        }
        if (tok.startsWith("--split-string=")) {
          if (isProtectedGitWriteCommand(tok.slice("--split-string=".length), depth + 1)) {
            return { nextIdx: idx, matchedRecursive: true, skipSegment: true };
          }
          idx += 1;
          continue;
        }
        if (ENV_FLAGS_WITH_VALUE.has(tok)) {
          idx += 2;
          continue;
        }
        if (tok.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (base === "sudo") {
      idx += 1;
      while (idx < seg.length) {
        const tok = seg[idx];
        if (tok === "--") {
          idx += 1;
          break;
        }
        if (SUDO_FLAGS_WITH_VALUE.has(tok)) {
          idx += 2;
          continue;
        }
        if (tok.startsWith("-")) {
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (base === "timeout") {
      idx += 1;
      while (idx < seg.length) {
        const tok = seg[idx];
        if (tok === "--") {
          idx += 1;
          break;
        }
        if (TIMEOUT_FLAGS_WITH_VALUE.has(tok)) {
          idx += 2;
          continue;
        }
        if (tok.startsWith("-")) {
          idx += 1;
          continue;
        }
        break;
      }
      // Skip mandatory duration positional argument
      if (idx < seg.length) {
        idx += 1;
      }
      continue;
    }

    if (base === "nice") {
      idx += 1;
      while (idx < seg.length) {
        const tok = seg[idx];
        if (tok === "--") {
          idx += 1;
          break;
        }
        if (tok === "-n" || tok === "--adjustment") {
          idx += 2;
          continue;
        }
        if (tok.startsWith("-")) {
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (base === "stdbuf") {
      idx += 1;
      while (idx < seg.length) {
        const tok = seg[idx];
        if (tok === "--") {
          idx += 1;
          break;
        }
        if (STDBUF_FLAGS_WITH_VALUE.has(tok)) {
          idx += 2;
          continue;
        }
        if (tok.startsWith("-")) {
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (base === "nohup" || base === "time" || base === "exec") {
      idx += 1;
      while (idx < seg.length && seg[idx].startsWith("-")) {
        if (seg[idx] === "--") {
          idx += 1;
          break;
        }
        idx += 1;
      }
      continue;
    }

    if (base === "command") {
      idx += 1;
      let isLookupOnly = false;
      while (idx < seg.length && seg[idx].startsWith("-")) {
        const tok = seg[idx];
        if (tok === "--") {
          idx += 1;
          break;
        }
        if (/^-[a-zA-Z]*[vV]/.test(tok)) {
          isLookupOnly = true;
        }
        idx += 1;
      }
      if (isLookupOnly) {
        return { nextIdx: idx, matchedRecursive: false, skipSegment: true };
      }
      continue;
    }

    break;
  }

  return { nextIdx: idx, matchedRecursive: false, skipSegment: false };
}

export function isProtectedGitWriteCommand(rawCommand: string, depth = 0): boolean {
  if (!rawCommand || depth > 5) {
    return false;
  }
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return false;
  }

  const { tokens, subshells } = tokenizeShell(trimmed);
  for (const sub of subshells) {
    if (isProtectedGitWriteCommand(sub, depth + 1)) {
      return true;
    }
  }

  const segments: string[][] = [];
  let currentSeg: string[] = [];
  for (const tok of tokens) {
    if (tok.kind === "sep") {
      if (currentSeg.length > 0) {
        segments.push(currentSeg);
        currentSeg = [];
      }
    } else {
      currentSeg.push(tok.value);
    }
  }
  if (currentSeg.length > 0) {
    segments.push(currentSeg);
  }

  for (const seg of segments) {
    const unwrapped = unwrapCommandPrefix(seg, depth);
    if (unwrapped.matchedRecursive) {
      return true;
    }
    if (unwrapped.skipSegment || unwrapped.nextIdx >= seg.length) {
      continue;
    }

    const idx = unwrapped.nextIdx;
    const bin = path.posix.basename(seg[idx].replaceAll("\\", "/")).toLowerCase();
    const args = seg.slice(idx + 1);

    if (bin === "eval") {
      const innerEval = args.filter((a) => a !== "--").join(" ");
      if (innerEval && isProtectedGitWriteCommand(innerEval, depth + 1)) {
        return true;
      }
      continue;
    }

    if (SHELL_WRAPPERS.has(bin)) {
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === "--") break;
        if ((a === "-o" || a === "+o" || a === "-O" || a === "+O") && i + 1 < args.length) {
          i += 1;
          continue;
        }
        if ((a === "--command" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) && i + 1 < args.length) {
          if (isProtectedGitWriteCommand(args[i + 1], depth + 1)) {
            return true;
          }
          break;
        }
      }
      continue;
    }

    if (bin === "git") {
      let subcmd: string | null = null;
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (GIT_FLAGS_WITH_VALUE.has(a)) {
          i += 1;
          continue;
        }
        if (a.startsWith("-")) {
          continue;
        }
        subcmd = a.toLowerCase();
        break;
      }
      if (subcmd === "commit" || subcmd === "push") {
        return true;
      }
      continue;
    }

    if (bin === "gh" || bin === "tea") {
      const positional: string[] = [];
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (FORGE_CLI_FLAGS_WITH_VALUE.has(a)) {
          i += 1;
          continue;
        }
        if (a.startsWith("-")) {
          continue;
        }
        positional.push(a.toLowerCase());
        if (positional.length >= 2) break;
      }
      if (
        positional.length >= 2 &&
        (positional[0] === "pr" || positional[0] === "pull" || positional[0] === "pulls") &&
        positional[1] === "create"
      ) {
        return true;
      }
    }
  }

  return false;
}

export function extractCommandFromPermissionRequest(request: PermissionRequestType): string | null {
  if (!request) return null;
  if (request.detail?.type === "shell" && typeof request.detail.command === "string") {
    return request.detail.command;
  }
  const input = request.input;
  if (typeof input === "string") {
    return input;
  }
  if (input && typeof input === "object") {
    if (typeof input.command === "string") {
      return input.command;
    }
    if (Array.isArray(input.command)) {
      const parts = input.command.filter((item): item is string => typeof item === "string");
      if (parts.length > 0) {
        const bin = path.posix.basename(parts[0]).toLowerCase();
        if (SHELL_WRAPPERS.has(bin)) {
          const cIdx = parts.findIndex(
            (p, idx) => idx > 0 && (p === "--command" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(p)),
          );
          if (cIdx >= 0 && parts[cIdx + 1]) {
            return parts[cIdx + 1];
          }
        }
        return parts
          .map((part) =>
            /\s|["'$`;&|><]/.test(part) ? `'${part.replaceAll("'", "'\\''")}'` : part,
          )
          .join(" ");
      }
    }
    if (typeof input.cmd === "string") {
      return input.cmd;
    }
  }
  return null;
}

function isUnattendedWorkflowSignal(params: {
  metadata?: Readonly<Record<string, unknown>> | null;
  labels?: Readonly<Record<string, string>> | null;
  title?: string | null;
  branchName?: string | null;
}): boolean {
  const { metadata, labels, title, branchName } = params;
  if (labels) {
    if (
      labels["paseo.unattended"] === "1" ||
      labels["paseo.workflow.unattended"] === "1" ||
      labels["paseo.workflow"] === "gitea-workflow"
    ) {
      return true;
    }
    for (const key of Object.keys(labels)) {
      if (key.startsWith("gitea.") || key.startsWith("gitea-workflow")) {
        return true;
      }
    }
  }
  if (metadata) {
    if (metadata.unattended === true || metadata["gitea-workflow"] !== undefined) {
      return true;
    }
    for (const key of Object.keys(metadata)) {
      if (
        key.startsWith("gitea.") ||
        key.startsWith("gitea-workflow") ||
        key.startsWith("paseo.workflow")
      ) {
        return true;
      }
    }
  }
  if (title && /^Workflow\s+/i.test(title.trim())) {
    return true;
  }
  if (branchName && /^gitea-workflow\//i.test(branchName.trim())) {
    return true;
  }
  return false;
}

function extractAssigneeHints(params: {
  metadata?: Readonly<Record<string, unknown>> | null;
  labels?: Readonly<Record<string, string>> | null;
  title?: string | null;
  branchName?: string | null;
}): string[] {
  const hints: string[] = [];
  const collectFromRecord = (rec?: Record<string, unknown> | null) => {
    if (!rec) return;
    const candidateKeys = [
      "assignee",
      "assigneeEmail",
      "assigneeUsername",
      "gitea.assignee",
      "gitea.issue.assignee",
      "issueAssignee",
    ];
    for (const key of candidateKeys) {
      const val = rec[key];
      if (typeof val === "string" && val.trim()) {
        hints.push(val.trim());
      } else if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        for (const subKey of ["login", "username", "email", "id"]) {
          if (typeof obj[subKey] === "string" && (obj[subKey] as string).trim()) {
            hints.push((obj[subKey] as string).trim());
          }
        }
      }
    }
  };
  collectFromRecord(metadataRecord(params.metadata));
  collectFromRecord(metadataRecord(params.labels));

  for (const text of [params.title, params.branchName]) {
    if (!text) continue;
    const mentionMatches = text.matchAll(/@([a-zA-Z0-9._-]+)/g);
    for (const m of mentionMatches) {
      if (m[1]) hints.push(m[1]);
    }
    const kvMatches = text.matchAll(/assignee[:=]([a-zA-Z0-9._@-]+)/gi);
    for (const m of kvMatches) {
      if (m[1]) hints.push(m[1]);
    }
  }
  return hints;
}

function metadataRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function matchMemberByHints(
  hints: readonly string[],
  roster: readonly TeamMemberProfile[],
): TeamMemberProfile | null {
  if (hints.length === 0) return null;
  const enabledMembers = roster.filter((m) => m.enabled !== false);
  for (const rawHint of hints) {
    const h = rawHint.trim().toLowerCase();
    if (!h) continue;
    const found = enabledMembers.find(
      (m) =>
        m.id.toLowerCase() === h ||
        m.email.toLowerCase() === h ||
        (m.gitUsername && m.gitUsername.toLowerCase() === h) ||
        (m.giteaUsername && m.giteaUsername.toLowerCase() === h) ||
        (m.githubUsername && m.githubUsername.toLowerCase() === h),
    );
    if (found) return found;
  }
  return null;
}

function buildUnclaimedGuardSystemPrompt(reason: "unclaimed" | "shared_main_checkout"): string {
  if (reason === "shared_main_checkout") {
    return [
      "[Team Collab Guard] 当前工作区位于多人共享的本地 Git 主检出目录（Main Checkout），策略已禁止在主目录直接提交或推送。",
      "严禁执行 `git commit`、`git push`、`gh pr create` 或 `tea pr create`。",
      "如需提交代码，请创建独立的 Git Worktree 工作区并认领成员身份，或在插件设置中显式开启 allowSharedLocalCheckoutCommit。",
    ].join("\n");
  }
  return [
    "[Team Collab Guard] 当前工作区尚未认领团队成员身份（Unclaimed）。",
    "在完成身份绑定前，严禁执行 `git commit`、`git push`、`gh pr create` 或 `tea pr create`（只读命令如 `git status`、`git diff`、`git log` 可正常执行）。",
    "请提示用户先在界面右上角成员选择器、输入框身份胶囊，或输入 `/iam <memberId>` 绑定归属成员后再执行提交与推送。",
  ].join("\n");
}

function buildPermissionDenyMessage(reason: "unclaimed" | "shared_main_checkout"): string {
  if (reason === "shared_main_checkout") {
    return "Team Collab 已拦截该操作：当前目录为多人共享的 Git 主检出目录（非独立 Worktree），禁止直接执行 git commit / push 或创建 PR。请切换到独立 Worktree 工作区后操作。";
  }
  return "Team Collab 已拦截该操作：当前工作区尚未认领成员身份，禁止执行 git commit / push 或创建 PR。请先在界面右上角、输入框身份胶囊或输入 `/iam <memberId>` 认领工作区归属人。";
}

function stripManagedSessionEnv(env: Record<string, string>, dataDir: string): void {
  for (const key of MANAGED_SESSION_ENV_KEYS) {
    delete env[key];
  }
  if (typeof env.PATH === "string" && env.PATH.length > 0) {
    const rawShimsRoot = path.resolve(dataDir, "shims");
    const normShimsRoot = normalizeFsPath(rawShimsRoot);
    const cleaned = env.PATH.split(path.delimiter)
      .filter(Boolean)
      .filter((entry) => {
        const resolved = path.resolve(entry);
        const normalized = normalizeFsPath(entry);
        if (
          resolved === rawShimsRoot ||
          resolved.startsWith(rawShimsRoot + path.sep) ||
          normalized === normShimsRoot ||
          normalized.startsWith(normShimsRoot + path.sep)
        ) {
          return false;
        }
        return true;
      });
    env.PATH = cleaned.join(path.delimiter);
  }
}

interface CachedWorkspaceEntry {
  workspaceId: string;
  cwd: string;
  normalizedCwd: string;
  owner: WorkspaceOwnerMetadata | null;
}

export interface AttributionGuardOptions {
  secretStore: SecretStore;
  gitConfigurator: GitConfigurator;
  getPolicies: () => TeamCollabPolicies;
  getSettingsMembers: () => readonly TeamMemberProfile[];
  onKnownRepoDirectory?: (cwd: string) => void;
}

export class AttributionGuard {
  private readonly secretStore: SecretStore;
  private readonly gitConfigurator: GitConfigurator;
  private readonly getPolicies: () => TeamCollabPolicies;
  private readonly getSettingsMembers: () => readonly TeamMemberProfile[];
  private readonly onKnownRepoDirectory?: (cwd: string) => void;

  private readonly workspaceById = new Map<string, CachedWorkspaceEntry>();
  private readonly workspaceIdsByCwd = new Map<string, Set<string>>();
  private readonly agentOwnerById = new Map<string, WorkspaceOwnerMetadata | null>();
  private readonly agentLabelsById = new Map<string, Record<string, string>>();
  private readonly explicitlyClearedAgentIds = new Set<string>();
  private readonly pendingReloadAgentIds = new Set<string>();

  constructor(options: AttributionGuardOptions) {
    this.secretStore = options.secretStore;
    this.gitConfigurator = options.gitConfigurator;
    this.getPolicies = options.getPolicies;
    this.getSettingsMembers = options.getSettingsMembers;
    this.onKnownRepoDirectory = options.onKnownRepoDirectory;
  }

  private getRoster(): TeamMemberProfile[] {
    return this.secretStore.getEffectiveRoster(this.getSettingsMembers());
  }

  private cacheWorkspace(workspaceId: string, cwd: string, owner: WorkspaceOwnerMetadata | null) {
    const prev = this.workspaceById.get(workspaceId);
    const normalizedCwd = cwd ? normalizeFsPath(cwd) : "";

    if (prev && prev.normalizedCwd && prev.normalizedCwd !== normalizedCwd) {
      const oldSet = this.workspaceIdsByCwd.get(prev.normalizedCwd);
      if (oldSet) {
        oldSet.delete(workspaceId);
        if (oldSet.size === 0) {
          this.workspaceIdsByCwd.delete(prev.normalizedCwd);
        }
      }
    }

    this.workspaceById.set(workspaceId, { workspaceId, cwd, normalizedCwd, owner });
    if (normalizedCwd) {
      let idSet = this.workspaceIdsByCwd.get(normalizedCwd);
      if (!idSet) {
        idSet = new Set<string>();
        this.workspaceIdsByCwd.set(normalizedCwd, idSet);
      }
      idSet.add(workspaceId);
      this.onKnownRepoDirectory?.(cwd);
    }
  }

  forgetWorkspace(workspaceId: string): void {
    const existing = this.workspaceById.get(workspaceId);
    if (!existing) return;
    this.workspaceById.delete(workspaceId);
    if (existing.normalizedCwd) {
      const idSet = this.workspaceIdsByCwd.get(existing.normalizedCwd);
      if (idSet) {
        idSet.delete(workspaceId);
        if (idSet.size === 0) {
          this.workspaceIdsByCwd.delete(existing.normalizedCwd);
        }
      }
    }
  }

  private pickCachedWorkspaceForCwd(normalizedCwd: string): CachedWorkspaceEntry | null {
    const ids = this.workspaceIdsByCwd.get(normalizedCwd);
    if (!ids || ids.size === 0) return null;
    let fallback: CachedWorkspaceEntry | null = null;
    let claimedMatch: CachedWorkspaceEntry | null = null;
    for (const id of ids) {
      const ws = this.workspaceById.get(id);
      if (!ws) continue;
      fallback = ws;
      if (ws.owner !== null) {
        claimedMatch = ws;
      }
    }
    return claimedMatch ?? fallback;
  }

  private async syncWorkspaceOwnerLabel(
    workspaceId: string,
    nextOwner: WorkspaceOwnerMetadata | null,
    currentLabels: readonly unknown[] | undefined,
    paseo?: PaseoApiType | null,
  ): Promise<void> {
    if (!paseo?.workspaces?.ref) return;
    const handle = paseo.workspaces.ref(workspaceId) as {
      setLabel?: (name: string, options: { assigned: boolean }) => Promise<unknown>;
      refresh?: () => Promise<{ labels?: readonly unknown[] } | null>;
      current?: () => { labels?: readonly unknown[] } | null;
    };
    if (typeof handle.setLabel !== "function") return;

    let labelsList = currentLabels;
    if (!labelsList) {
      const snap = (await handle.refresh?.().catch(() => null)) ?? handle.current?.() ?? null;
      labelsList = snap?.labels ?? [];
    }

    const targetLabel = nextOwner ? formatOwnerWorkspaceLabel(nextOwner.id) : null;
    const targetKey = targetLabel ? targetLabel.toLowerCase() : null;

    let hasTarget = false;
    const staleOwnerLabels: string[] = [];

    for (const raw of labelsList ?? []) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (targetKey && trimmed.toLowerCase() === targetKey) {
        hasTarget = true;
      } else if (isOwnerWorkspaceLabel(trimmed)) {
        staleOwnerLabels.push(trimmed);
      }
    }

    for (const stale of staleOwnerLabels) {
      await handle.setLabel(stale, { assigned: false }).catch(() => {});
    }
    if (targetLabel && !hasTarget) {
      await handle.setLabel(targetLabel, { assigned: true }).catch(() => {});
    }
  }

  private async syncWorkspacesFromDaemon(paseo?: PaseoApiType | null): Promise<void> {
    if (!paseo?.workspaces?.list) return;
    try {
      const listed = await paseo.workspaces.list();
      for (const entry of listed.entries ?? []) {
        if (entry.archivingAt) {
          this.forgetWorkspace(entry.id);
          continue;
        }
        const wsCwd = entry.workspaceDirectory ?? entry.projectRootPath;
        if (!wsCwd) continue;
        const owner = parseWorkspaceOwnerMetadata(entry.metadata);
        this.cacheWorkspace(entry.id, wsCwd, owner);
        await this.syncWorkspaceOwnerLabel(
          entry.id,
          owner,
          (entry as { labels?: readonly unknown[] }).labels,
          paseo,
        );
      }
    } catch {
      // Ignore daemon workspace listing failure
    }
  }

  private async lookupWorkspaceById(
    workspaceId: string,
    paseo?: PaseoApiType | null,
  ): Promise<CachedWorkspaceEntry | null> {
    const cached = this.workspaceById.get(workspaceId);
    if (cached) {
      return cached;
    }
    if (!paseo?.workspaces?.ref) {
      return null;
    }
    try {
      const handle = paseo.workspaces.ref(workspaceId);
      const snap = (await handle.refresh().catch(() => null)) ?? handle.current?.() ?? null;
      if (!snap || snap.archivingAt) return null;
      const cwd = snap.workspaceDirectory ?? snap.projectRootPath ?? "";
      const owner = parseWorkspaceOwnerMetadata(snap.metadata);
      this.cacheWorkspace(workspaceId, cwd, owner);
      return this.workspaceById.get(workspaceId) ?? null;
    } catch {
      return null;
    }
  }

  private async lookupWorkspaceByCwd(
    cwd: string | undefined | null,
    paseo?: PaseoApiType | null,
  ): Promise<CachedWorkspaceEntry | null> {
    if (!cwd) return null;
    const normTarget = normalizeFsPath(cwd);
    const cached = this.pickCachedWorkspaceForCwd(normTarget);
    if (cached) {
      return cached;
    }
    await this.syncWorkspacesFromDaemon(paseo);
    return this.pickCachedWorkspaceForCwd(normTarget);
  }

  async resolveAgentEffectiveOwner(
    agent: {
      id: string;
      workspaceId?: string | null;
      cwd?: string | null;
      title?: string | null;
      metadata?: Readonly<Record<string, unknown>> | null;
      labels?: Readonly<Record<string, string>> | null;
    },
    paseo?: PaseoApiType | null,
  ): Promise<{
    owner: WorkspaceOwnerMetadata | null;
    workspaceId: string | null;
    cwd: string | null;
  }> {
    let resolvedWorkspaceId = agent.workspaceId ?? null;
    let resolvedCwd = agent.cwd ?? null;

    if (agent.labels && Object.keys(agent.labels).length > 0) {
      this.agentLabelsById.set(agent.id, { ...agent.labels });
    }
    const effectiveLabels = agent.labels ?? this.agentLabelsById.get(agent.id) ?? null;

    let ws: CachedWorkspaceEntry | null = null;
    if (resolvedWorkspaceId) {
      ws = await this.lookupWorkspaceById(resolvedWorkspaceId, paseo);
      if (ws && !resolvedCwd && ws.cwd) {
        resolvedCwd = ws.cwd;
      }
    }
    if (!ws && resolvedCwd) {
      ws = await this.lookupWorkspaceByCwd(resolvedCwd, paseo);
      if (ws && !resolvedWorkspaceId) {
        resolvedWorkspaceId = ws.workspaceId;
      }
    }

    // Only when the workspace itself has an active owner does it override agent-level attribution
    if (ws?.owner) {
      this.explicitlyClearedAgentIds.delete(agent.id);
      this.agentOwnerById.set(agent.id, ws.owner);
      return { owner: ws.owner, workspaceId: ws.workspaceId, cwd: resolvedCwd };
    }

    // Workspace is unclaimed (or absent): preserve agent-level attribution & unattended workflow signals
    // unless a human owner was explicitly unassigned from this workspace.
    if (!this.explicitlyClearedAgentIds.has(agent.id)) {
      const fromMeta = parseWorkspaceOwnerMetadata(agent.metadata);
      if (fromMeta) {
        this.agentOwnerById.set(agent.id, fromMeta);
        return { owner: fromMeta, workspaceId: resolvedWorkspaceId, cwd: resolvedCwd };
      }

      const cachedAgentOwner = this.agentOwnerById.get(agent.id);
      if (cachedAgentOwner) {
        return {
          owner: cachedAgentOwner,
          workspaceId: resolvedWorkspaceId,
          cwd: resolvedCwd,
        };
      }
    }

    if (
      isUnattendedWorkflowSignal({
        metadata: agent.metadata,
        labels: effectiveLabels,
        title: agent.title,
      })
    ) {
      const hints = extractAssigneeHints({
        metadata: agent.metadata,
        labels: effectiveLabels,
        title: agent.title,
      });
      const matched = matchMemberByHints(hints, this.getRoster());
      const autoOwner: WorkspaceOwnerMetadata = matched
        ? {
            id: matched.id,
            name: matched.name,
            email: matched.email,
            kind: "member",
            assignedAt: new Date().toISOString(),
          }
        : createSystemBotOwnerMetadata();
      this.agentOwnerById.set(agent.id, autoOwner);
      return { owner: autoOwner, workspaceId: resolvedWorkspaceId, cwd: resolvedCwd };
    }

    return { owner: null, workspaceId: resolvedWorkspaceId, cwd: resolvedCwd };
  }

  async refreshMemberWorktrees(memberId: string, paseo?: PaseoApiType | null): Promise<void> {
    const roster = this.getRoster();
    const member = roster.find((m) => m.id === memberId);
    if (!member) return;
    const secrets = this.secretStore.getMemberSecrets(memberId);
    this.gitConfigurator.ensureMemberShims(member, secrets);

    await this.syncWorkspacesFromDaemon(paseo);

    const policies = this.getPolicies();
    const updatedCwds = new Set<string>();
    for (const ws of this.workspaceById.values()) {
      if (ws.owner?.kind === "member" && ws.owner.id === memberId && ws.cwd) {
        const norm = ws.normalizedCwd || normalizeFsPath(ws.cwd);
        if (updatedCwds.has(norm)) continue;
        updatedCwds.add(norm);
        await this.gitConfigurator
          .applyOwnerToWorktree(ws.cwd, member, secrets, {
            allowMainCheckout: policies.allowSharedLocalCheckoutCommit,
          })
          .catch(() => {});
      }
    }
  }

  async handleAgentTurnAfterReloadIfNeeded(
    agentId: string,
    paseo?: PaseoApiType | null,
  ): Promise<boolean> {
    if (!this.pendingReloadAgentIds.has(agentId)) {
      return false;
    }
    this.pendingReloadAgentIds.delete(agentId);
    if (!paseo?.agents?.ref) {
      return false;
    }
    try {
      const ref = paseo.agents.ref(agentId);
      if (typeof ref.reload === "function") {
        await ref.reload();
        return true;
      }
    } catch {
      // Ignore reload failure if session already closed
    }
    return false;
  }

  async assignWorkspaceOwner(
    input: { workspaceId: string; memberId: string | null },
    paseo: PaseoApiType,
  ): Promise<{
    workspaceId: string;
    owner: WorkspaceOwnerMetadata | null;
    gitConfigured: boolean;
    isWorktree: boolean;
  }> {
    const handle = paseo.workspaces.ref(input.workspaceId);
    const snap = (await handle.refresh().catch(() => null)) ?? handle.current?.() ?? null;
    if (!snap) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }
    const workspaceCwd = snap.workspaceDirectory ?? snap.projectRootPath;
    const nowIso = new Date().toISOString();

    let nextOwner: WorkspaceOwnerMetadata | null = null;
    let targetMember: TeamMemberProfile | null = null;

    if (input.memberId === SYSTEM_BOT_MEMBER_ID) {
      nextOwner = createSystemBotOwnerMetadata(nowIso);
    } else if (input.memberId !== null) {
      const roster = this.getRoster();
      targetMember = roster.find((m) => m.id === input.memberId) ?? null;
      if (!targetMember) {
        throw new Error(`Unknown team member: ${input.memberId}`);
      }
      nextOwner = {
        id: targetMember.id,
        name: targetMember.name,
        email: targetMember.email,
        kind: "member",
        assignedAt: nowIso,
      };
    }

    await handle.setMetadata({
      [TEAM_COLLAB_OWNER_META_KEY]: nextOwner,
    });
    this.cacheWorkspace(input.workspaceId, workspaceCwd, nextOwner);
    await this.syncWorkspaceOwnerLabel(
      input.workspaceId,
      nextOwner,
      (snap as { labels?: readonly unknown[] }).labels,
      paseo,
    );

    const gitInfo = await this.gitConfigurator.inspectGitDirectory(workspaceCwd);
    const policies = this.getPolicies();
    let gitConfigured = false;

    if (nextOwner?.kind === "member" && targetMember) {
      const secrets = this.secretStore.getMemberSecrets(targetMember.id);
      const applyRes = await this.gitConfigurator.applyOwnerToWorktree(
        workspaceCwd,
        targetMember,
        secrets,
        { allowMainCheckout: policies.allowSharedLocalCheckoutCommit },
      );
      gitConfigured = applyRes.applied;
    } else if (gitInfo.isGitRepo) {
      await this.gitConfigurator.clearOwnerFromWorktree(workspaceCwd);
    }

    // Propagate updated owner metadata & reload live sessions (deferring reload if a turn is currently running)
    if (paseo.agents?.list) {
      try {
        const normWsCwd = workspaceCwd ? normalizeFsPath(workspaceCwd) : "";
        const agentList = await paseo.agents.list();
        const matchingAgents = (agentList.entries ?? []).filter((entry) => {
          const ag = entry.agent;
          if (!ag) return false;
          if (ag.workspaceId === input.workspaceId) return true;
          if (!ag.workspaceId && normWsCwd && ag.cwd && normalizeFsPath(ag.cwd) === normWsCwd) {
            return true;
          }
          return false;
        });

        await Promise.allSettled(
          matchingAgents.map(async (entry) => {
            const ag = entry.agent;
            const agLabels =
              ag.labels && Object.keys(ag.labels).length > 0
                ? ag.labels
                : (this.agentLabelsById.get(ag.id) ?? null);
            const isUnattended = isUnattendedWorkflowSignal({
              metadata: ag.metadata,
              labels: agLabels,
              title: ag.title,
            });

            if (nextOwner === null) {
              if (!isUnattended) {
                this.explicitlyClearedAgentIds.add(ag.id);
                this.agentOwnerById.delete(ag.id);
                await paseo.agents.ref(ag.id).setMetadata({
                  [TEAM_COLLAB_OWNER_META_KEY]: null,
                });
              }
            } else {
              this.explicitlyClearedAgentIds.delete(ag.id);
              this.agentOwnerById.set(ag.id, nextOwner);
              await paseo.agents.ref(ag.id).setMetadata({
                [TEAM_COLLAB_OWNER_META_KEY]: nextOwner,
              });
            }

            const isRunning = ag.status === "running" || Boolean(ag.activeTurn);
            const isClosedOrArchived = ag.status === "closed" || Boolean(ag.archivedAt);
            if (isRunning) {
              this.pendingReloadAgentIds.add(ag.id);
            } else if (!isClosedOrArchived) {
              this.pendingReloadAgentIds.delete(ag.id);
              const ref = paseo.agents.ref(ag.id);
              if (typeof ref.reload === "function") {
                void ref.reload().catch(() => {});
              }
            }
          }),
        );
      } catch {
        // Ignore agent list propagation error
      }
    }

    return {
      workspaceId: input.workspaceId,
      owner: nextOwner,
      gitConfigured,
      isWorktree: gitInfo.isWorktree,
    };
  }

  async handleWorkspaceCreateBefore(
    payload: PluginHookPayload<"workspace.create.before">,
    _context: PluginHookContext,
  ): Promise<PluginHookResult<"workspace.create.before">> {
    const request = payload.request;
    const policies = this.getPolicies();
    let nextMetadata = request.metadata ? { ...request.metadata } : undefined;
    let nextSource = request.source;
    let mutated = false;

    const existingOwner = parseWorkspaceOwnerMetadata(request.metadata);
    const agentLabels =
      request.agent && typeof request.agent === "object" && "labels" in request.agent
        ? (request.agent.labels as Record<string, string> | undefined)
        : undefined;
    const branchName = request.source.kind === "worktree" ? request.source.branchName : undefined;

    if (
      !existingOwner &&
      isUnattendedWorkflowSignal({
        metadata: request.metadata,
        labels: agentLabels,
        title: request.title,
        branchName,
      })
    ) {
      const hints = extractAssigneeHints({
        metadata: request.metadata,
        labels: agentLabels,
        title: request.title,
        branchName,
      });
      const matchedMember = matchMemberByHints(hints, this.getRoster());
      const resolvedOwner: WorkspaceOwnerMetadata = matchedMember
        ? {
            id: matchedMember.id,
            name: matchedMember.name,
            email: matchedMember.email,
            kind: "member",
            assignedAt: new Date().toISOString(),
          }
        : createSystemBotOwnerMetadata();
      nextMetadata = {
        ...nextMetadata,
        [TEAM_COLLAB_OWNER_META_KEY]: resolvedOwner,
      };
      mutated = true;
    }

    if (policies.enforceWorktreeOnCreate && request.source.kind === "directory") {
      const dirPath = request.source.path;
      const gitInfo = await this.gitConfigurator.inspectGitDirectory(dirPath);
      if (gitInfo.isGitRepo && gitInfo.hasCommits && !gitInfo.isWorktree) {
        nextSource = {
          kind: "worktree",
          cwd: dirPath,
          ...(request.source.projectId ? { projectId: request.source.projectId } : {}),
          action: "branch-off",
        };
        mutated = true;
      }
    }

    if (!mutated) {
      return;
    }
    return {
      ...request,
      ...(nextMetadata ? { metadata: nextMetadata } : {}),
      source: nextSource,
    };
  }

  async handleWorkspaceCreateAfter(
    payload: PluginHookPayload<"workspace.create.after">,
    context: PluginHookContext,
  ): Promise<void> {
    const { workspace } = payload;
    const owner = parseWorkspaceOwnerMetadata(workspace.metadata);
    this.cacheWorkspace(workspace.id, workspace.cwd, owner);
    if (owner) {
      await this.syncWorkspaceOwnerLabel(workspace.id, owner, undefined, context.paseo);
    }

    if (owner?.kind === "member" && workspace.cwd) {
      const roster = this.getRoster();
      const member = roster.find((m) => m.id === owner.id) ?? {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        enabled: true,
      };
      const secrets = this.secretStore.getMemberSecrets(owner.id);
      const policies = this.getPolicies();
      await this.gitConfigurator
        .applyOwnerToWorktree(workspace.cwd, member, secrets, {
          allowMainCheckout: policies.allowSharedLocalCheckoutCommit,
        })
        .catch(() => {});
    }
  }

  async handleWorkspaceArchiveAfter(
    payload: PluginHookPayload<"workspace.archive.after">,
    _context: PluginHookContext,
  ): Promise<void> {
    if (payload.workspace?.id) {
      this.forgetWorkspace(payload.workspace.id);
    }
  }

  async handleWorktreeCreateAfter(
    payload: PluginHookPayload<"worktree.create.after">,
    _context: PluginHookContext,
  ): Promise<void> {
    if (payload.worktree?.path) {
      this.onKnownRepoDirectory?.(payload.worktree.path);
    }
  }

  async handleAgentCreateBefore(
    payload: PluginHookPayload<"agent.create.before">,
    context: PluginHookContext,
  ): Promise<PluginHookResult<"agent.create.before">> {
    const { request } = payload;
    if (request.config?.cwd) {
      this.onKnownRepoDirectory?.(request.config.cwd);
    }

    const existingOwner = parseWorkspaceOwnerMetadata(request.metadata);
    if (existingOwner) {
      return;
    }

    let inheritedOwner: WorkspaceOwnerMetadata | null = null;
    if (request.config?.cwd) {
      const ws = await this.lookupWorkspaceByCwd(request.config.cwd, context.paseo);
      if (ws?.owner) {
        inheritedOwner = ws.owner;
      }
    }

    if (
      !inheritedOwner &&
      isUnattendedWorkflowSignal({
        metadata: request.metadata,
        labels: request.labels,
        title: request.config?.title,
      })
    ) {
      const hints = extractAssigneeHints({
        metadata: request.metadata,
        labels: request.labels,
        title: request.config?.title,
      });
      const matched = matchMemberByHints(hints, this.getRoster());
      inheritedOwner = matched
        ? {
            id: matched.id,
            name: matched.name,
            email: matched.email,
            kind: "member",
            assignedAt: new Date().toISOString(),
          }
        : createSystemBotOwnerMetadata();
    }

    if (!inheritedOwner) {
      return;
    }

    return {
      ...request,
      metadata: {
        ...request.metadata,
        [TEAM_COLLAB_OWNER_META_KEY]: inheritedOwner,
      },
    };
  }

  async handleAgentOpenBefore(
    payload: PluginHookPayload<"agent.open.before">,
    context: PluginHookContext,
  ): Promise<PluginHookResult<"agent.open.before">> {
    const { request } = payload;
    if (request.cwd) {
      this.onKnownRepoDirectory?.(request.cwd);
    }
    if (request.labels && Object.keys(request.labels).length > 0) {
      this.agentLabelsById.set(request.agentId, { ...request.labels });
    }

    const { owner } = await this.resolveAgentEffectiveOwner(
      {
        id: request.agentId,
        workspaceId: request.workspaceId,
        cwd: request.cwd,
        title: request.title,
        metadata: request.metadata,
        labels: request.labels,
      },
      context.paseo,
    );

    const policies = this.getPolicies();
    const nextEnv: Record<string, string> = { ...request.env };
    // Always purge stale identity/token/shim entries before applying the resolved owner
    stripManagedSessionEnv(nextEnv, this.secretStore.dataDir);

    let nextAppendPrompt = request.appendSystemPrompt ? [...request.appendSystemPrompt] : undefined;

    const gitInfo = await this.gitConfigurator.inspectGitDirectory(request.cwd);
    const isDisallowedSharedMainCheckout =
      gitInfo.isGitRepo && !gitInfo.isWorktree && !policies.allowSharedLocalCheckoutCommit;

    if (owner?.kind === "bot") {
      nextEnv.TEAM_COLLAB_OWNER_ID = SYSTEM_BOT_MEMBER_ID;
      return {
        ...request,
        env: nextEnv,
        ...(nextAppendPrompt ? { appendSystemPrompt: nextAppendPrompt } : {}),
      };
    }

    if (owner?.kind === "member") {
      const roster = this.getRoster();
      const member = roster.find((m) => m.id === owner.id) ?? {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        enabled: true,
      };
      const secrets = this.secretStore.getMemberSecrets(owner.id);
      const shims = this.gitConfigurator.ensureMemberShims(member, secrets);

      nextEnv.TEAM_COLLAB_OWNER_ID = member.id;
      nextEnv.GIT_AUTHOR_NAME = member.name;
      nextEnv.GIT_AUTHOR_EMAIL = member.email;
      nextEnv.GIT_COMMITTER_NAME = member.name;
      nextEnv.GIT_COMMITTER_EMAIL = member.email;

      if (secrets?.sshKeyPath) {
        try {
          nextEnv.GIT_SSH_COMMAND = buildSshCommand(secrets.sshKeyPath);
        } catch {
          // Ignore invalid sshKeyPath at open time
        }
      }
      const effectiveProvider = secrets?.gitProvider ?? member.gitProvider ?? "gitea";
      if (secrets?.githubToken) {
        nextEnv.GH_TOKEN = secrets.githubToken;
        nextEnv.GITHUB_TOKEN = secrets.githubToken;
      }
      if (secrets?.giteaToken) {
        if (effectiveProvider === "gitlab") {
          nextEnv.GITLAB_TOKEN = secrets.giteaToken;
          nextEnv.GITLAB_HOST =
            this.gitConfigurator.resolveEffectiveGiteaUrl(secrets.giteaUrl, "gitlab") ??
            "https://gitlab.com";
        } else if (effectiveProvider === "gitea") {
          nextEnv.GITEA_TOKEN = secrets.giteaToken;
        }
      }
      if (shims.teaShimDir) {
        const basePath = nextEnv.PATH || process.env.PATH || "";
        const parts = basePath.split(path.delimiter).filter(Boolean);
        nextEnv.PATH = [shims.teaShimDir, ...parts.filter((p) => p !== shims.teaShimDir)].join(
          path.delimiter,
        );
      }

      if (
        isDisallowedSharedMainCheckout &&
        policies.blockUnclaimedGitCommitPush &&
        request.purpose === "interactive"
      ) {
        nextAppendPrompt = [
          ...(nextAppendPrompt ?? []),
          buildUnclaimedGuardSystemPrompt("shared_main_checkout"),
        ];
      }

      return {
        ...request,
        env: nextEnv,
        ...(nextAppendPrompt ? { appendSystemPrompt: nextAppendPrompt } : {}),
      };
    }

    // Unclaimed session
    if (policies.blockUnclaimedGitCommitPush && request.purpose === "interactive") {
      const reason = isDisallowedSharedMainCheckout ? "shared_main_checkout" : "unclaimed";
      nextAppendPrompt = [...(nextAppendPrompt ?? []), buildUnclaimedGuardSystemPrompt(reason)];
    }

    return {
      ...request,
      env: nextEnv,
      ...(nextAppendPrompt ? { appendSystemPrompt: nextAppendPrompt } : {}),
    };
  }

  async handleAgentPermissionBefore(
    payload: PluginHookPayload<"agent.permission.before">,
    context: PluginHookContext,
  ): Promise<void> {
    const policies = this.getPolicies();
    if (!policies.blockUnclaimedGitCommitPush) {
      return;
    }

    const command = extractCommandFromPermissionRequest(payload.request);
    if (!command || !isProtectedGitWriteCommand(command)) {
      return;
    }

    const agent: PluginHookAgent = payload.agent;
    let labels = this.agentLabelsById.get(agent.id);
    let metadata: Readonly<Record<string, unknown>> | null = agent.metadata;

    if (!labels && context.paseo?.agents?.ref) {
      try {
        const handle = context.paseo.agents.ref(agent.id);
        const snap =
          handle.current?.() ?? (await handle.refresh().catch(() => null))?.agent ?? null;
        if (snap?.labels && Object.keys(snap.labels).length > 0) {
          labels = snap.labels;
          this.agentLabelsById.set(agent.id, { ...snap.labels });
        }
        if (
          (!metadata || Object.keys(metadata).length === 0) &&
          snap?.metadata &&
          Object.keys(snap.metadata).length > 0
        ) {
          metadata = snap.metadata;
        }
      } catch {
        // Ignore snapshot lookup failure
      }
    }

    const { owner, cwd } = await this.resolveAgentEffectiveOwner(
      {
        id: agent.id,
        workspaceId: agent.workspaceId,
        cwd: agent.cwd,
        title: agent.title,
        metadata,
        labels,
      },
      context.paseo,
    );

    if (owner?.kind === "bot") {
      return;
    }

    let denyReason: "unclaimed" | "shared_main_checkout" | null = null;
    if (!owner) {
      denyReason = "unclaimed";
    } else if (!policies.allowSharedLocalCheckoutCommit && (cwd || agent.cwd)) {
      const gitInfo = await this.gitConfigurator.inspectGitDirectory((cwd || agent.cwd)!);
      if (gitInfo.isGitRepo && !gitInfo.isWorktree) {
        denyReason = "shared_main_checkout";
      }
    }

    if (!denyReason || !context.paseo?.agents?.ref) {
      return;
    }

    try {
      await context.paseo.agents.ref(agent.id).respondToPermission({
        requestId: payload.request.id,
        response: {
          behavior: "deny",
          message: buildPermissionDenyMessage(denyReason),
        },
      });
    } catch {
      // Ignore permission race if already resolved
    }
  }

  forgetAgent(agentId: string): void {
    this.agentOwnerById.delete(agentId);
    this.agentLabelsById.delete(agentId);
    this.explicitlyClearedAgentIds.delete(agentId);
    this.pendingReloadAgentIds.delete(agentId);
  }
}
