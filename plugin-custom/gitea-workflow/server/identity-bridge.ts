import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ActiveGiteaIdentity, GiteaIdentitySummary } from "../shared/types.js";
import type { GiteaIssueAssigneeDto } from "./gitea-client.js";

const execFileAsync = promisify(execFile);

export const SHELL_INJECTION_CHARS = /[\x00-\x1f\x7f`$;&|><\n\r]/;
export const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
export const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface ParsedGiteaEndpoint {
  origin: string;
  baseUrl: string;
  hostname: string;
  host: string;
}

export function parseGiteaEndpoint(rawUrl: string | null | undefined): ParsedGiteaEndpoint | null {
  if (!rawUrl || !rawUrl.trim() || CONTROL_CHAR_REGEX.test(rawUrl)) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return null;
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return {
      origin: parsed.origin,
      baseUrl: `${parsed.origin}${cleanPath}`,
      hostname: parsed.hostname.toLowerCase(),
      host: parsed.host.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function maskSecret(val: string | null | undefined): string | null {
  if (typeof val !== "string") {
    return null;
  }
  const trimmed = val.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length >= 8) {
    return `••••${trimmed.slice(-4)}`;
  }
  return "••••";
}

export function formatSshKeyPathPreview(
  rawPath: string | null | undefined,
  homeDir: string = os.homedir(),
): string | null {
  if (!rawPath) {
    return null;
  }
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  if (homeDir && trimmed.startsWith(homeDir + path.sep)) {
    return `~${trimmed.slice(homeDir.length)}`;
  }
  if (trimmed.length > 36) {
    return `…/${path.basename(trimmed)}`;
  }
  return trimmed;
}

export function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function normalizeAndValidateSshKeyPath(
  rawPath: string | null | undefined,
  homeDir: string = os.homedir(),
): string | null {
  if (typeof rawPath !== "string") {
    return null;
  }
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === "~" || SHELL_INJECTION_CHARS.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homeDir, trimmed.slice(2));
  }
  return trimmed;
}

export function buildSshCommand(
  sshKeyPath: string | null | undefined,
  homeDir: string = os.homedir(),
): string | null {
  const normalized = normalizeAndValidateSshKeyPath(sshKeyPath, homeDir);
  if (!normalized) {
    return null;
  }
  return `ssh -i ${shellQuoteSingle(normalized)} -o IdentitiesOnly=yes`;
}

export interface ParsedTeaConfigLogin {
  loginName: string;
  giteaUrl: string | null;
  giteaHostname: string | null;
  giteaUsername: string | null;
  sshHost: string | null;
  token: string;
  sshKeyPath: string | null;
  isDefault: boolean;
}

function stripYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") {
        return parsed.trim();
      }
    } catch {
      // Fall back to simple quote slicing
    }
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'").trim();
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

export function parseTeaConfigYaml(
  yamlContent: string,
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaConfigLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const lines = yamlContent.split(/\r?\n/);

  interface RawLoginItem {
    name?: string;
    url?: string;
    token?: string;
    default?: string;
    user?: string;
    ssh_host?: string;
    ssh_key?: string;
  }

  const rawItems: RawLoginItem[] = [];
  let current: RawLoginItem | null = null;
  let inLogins = false;

  const applyKeyVal = (target: RawLoginItem, text: string) => {
    const match = text.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      return;
    }
    const key = match[1].toLowerCase();
    const val = stripYamlScalar(match[2]);
    if (
      key === "name" ||
      key === "url" ||
      key === "token" ||
      key === "default" ||
      key === "user" ||
      key === "ssh_host" ||
      key === "ssh_key"
    ) {
      target[key] = val;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (/^logins\s*:/.test(trimmed) && !line.startsWith(" ") && !line.startsWith("\t")) {
      inLogins = true;
      current = null;
      continue;
    }

    if (!inLogins) {
      continue;
    }

    if (
      /^[a-zA-Z0-9_-]+\s*:/.test(line) &&
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      !line.startsWith("-")
    ) {
      inLogins = false;
      current = null;
      break;
    }

    if (trimmed === "-" || trimmed.startsWith("- ")) {
      current = {};
      rawItems.push(current);
      if (trimmed.startsWith("- ")) {
        const rest = trimmed.slice(2).trim();
        if (rest) {
          applyKeyVal(current, rest);
        }
      }
      continue;
    }

    if (current) {
      applyKeyVal(current, trimmed);
    }
  }

  const results: ParsedTeaConfigLogin[] = [];
  for (const raw of rawItems) {
    const parsedEndpoint = parseGiteaEndpoint(raw.url);
    const name = raw.name?.trim() || "";
    const user = raw.user?.trim() || "";
    const loginName = name || user || parsedEndpoint?.hostname || "";
    if (!loginName) {
      continue;
    }
    const giteaUsername = user || null;
    const rawToken = raw.token?.trim() || "";
    const token = rawToken && !CONTROL_CHAR_REGEX.test(rawToken) ? rawToken : "";
    const normalizedSsh = normalizeAndValidateSshKeyPath(raw.ssh_key, homeDir);
    let sshKeyPath: string | null = null;
    if (normalizedSsh) {
      if (options?.checkSshKeyExists) {
        sshKeyPath = options.checkSshKeyExists(normalizedSsh) ? normalizedSsh : null;
      } else {
        try {
          if (fs.existsSync(normalizedSsh) && fs.statSync(normalizedSsh).isFile()) {
            sshKeyPath = normalizedSsh;
          }
        } catch {
          sshKeyPath = null;
        }
      }
    }
    const sshHost = raw.ssh_host?.trim() || null;
    const isDefault = (raw.default?.trim().toLowerCase() ?? "") === "true";

    results.push({
      loginName,
      giteaUrl: parsedEndpoint?.baseUrl ?? null,
      giteaHostname: parsedEndpoint?.hostname ?? null,
      giteaUsername,
      sshHost,
      token,
      sshKeyPath,
      isDefault,
    });
  }

  return results;
}

export function getDefaultTeaConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string[] {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const appData = env.APPDATA?.trim();
  const candidates = [
    path.join(homeDir, "Library", "Application Support", "tea", "config.yml"),
    ...(xdgConfigHome ? [path.join(xdgConfigHome, "tea", "config.yml")] : []),
    path.join(homeDir, ".config", "tea", "config.yml"),
    ...(appData ? [path.join(appData, "tea", "config.yml")] : []),
  ];
  return [...new Set(candidates.map((p) => path.resolve(p)))];
}

export interface GiteaUserProfile {
  login?: string | null;
  full_name?: string | null;
  email?: string | null;
}

export type FetchGiteaUserProfileFn = (params: {
  baseUrl: string;
  token: string;
  loginName: string;
  signal?: AbortSignal;
}) => Promise<GiteaUserProfile | null>;

export async function defaultFetchGiteaUserProfile(params: {
  baseUrl: string;
  token: string;
  loginName: string;
  signal?: AbortSignal;
}): Promise<GiteaUserProfile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const endpoint = `${params.baseUrl.replace(/\/+$/, "")}/api/v1/user`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `token ${params.token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (!data || typeof data !== "object") {
      return null;
    }
    const cleanField = (val: unknown): string | null => {
      if (typeof val !== "string") {
        return null;
      }
      const trimmed = val.trim();
      if (!trimmed || CONTROL_CHAR_REGEX.test(trimmed)) {
        return null;
      }
      return trimmed;
    };
    return {
      login: cleanField(data.login),
      full_name: cleanField(data.full_name),
      email: cleanField(data.email),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onAbort);
  }
}

export interface ResolvedGiteaIdentityRecord {
  id: string;
  source: "team-collab" | "tea";
  name: string;
  email: string;
  giteaUsername: string | null;
  giteaUrl: string | null;
  sshHost?: string | null;
  token: string;
  sshKeyPath: string | null;
  isDefault: boolean;
}

export interface TeamCollabOwnerMetadata {
  id: string;
  name: string;
  email: string;
  kind: "member";
  assignedAt: string;
}

export interface GitRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ExecGitFn = (cwd: string, args: string[]) => Promise<GitRunResult>;

async function defaultExecGit(cwd: string, args: string[]): Promise<GitRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: 5_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return { ok: true, code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const err = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      ok: false,
      code: typeof err?.code === "number" ? err.code : null,
      stdout: typeof err?.stdout === "string" ? err.stdout.trim() : "",
      stderr: typeof err?.stderr === "string" ? err.stderr.trim() : "",
    };
  }
}

function safeRealpath(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

interface RawTeamCollabRosterMember {
  id?: unknown;
  name?: unknown;
  email?: unknown;
  gitProvider?: unknown;
  gitUsername?: unknown;
  giteaUsername?: unknown;
  githubUsername?: unknown;
  enabled?: unknown;
}

interface RawTeamCollabSecretRecord {
  gitProvider?: unknown;
  httpUsername?: unknown;
  giteaToken?: unknown;
  giteaUrl?: unknown;
  githubToken?: unknown;
  sshKeyPath?: unknown;
}

export type ResolveIdentityForHostResult =
  | {
      kind: "matched";
      identity: ResolvedGiteaIdentityRecord;
    }
  | {
      kind: "missing_identity";
      reason: string;
    }
  | {
      kind: "host_mismatch";
      identity: ResolvedGiteaIdentityRecord;
      reason: string;
    }
  | {
      kind: "missing_token";
      identity: ResolvedGiteaIdentityRecord;
      reason: string;
    }
  | {
      kind: "no_match";
    };

export interface GiteaIdentityBridgeOptions {
  paseoHome?: string;
  teamCollabDataDir?: string;
  teaConfigPaths?: readonly string[];
  homeDir?: string;
  fetchUserProfile?: FetchGiteaUserProfileFn | null;
  execGit?: ExecGitFn;
  checkSshKeyExists?: (candidatePath: string) => boolean;
}

export function buildTeamCollabOwnerMetadata(
  identity:
    | {
        id?: string | null;
        source?: string | null;
        name?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
  assignedAt: string = new Date().toISOString(),
): TeamCollabOwnerMetadata | null {
  if (!identity || identity.source !== "team-collab") {
    return null;
  }
  const id = typeof identity.id === "string" ? identity.id.trim() : "";
  const name = typeof identity.name === "string" ? identity.name.trim() : "";
  const email = typeof identity.email === "string" ? identity.email.trim() : "";
  if (
    !id ||
    !MEMBER_ID_PATTERN.test(id) ||
    !name ||
    !email ||
    CONTROL_CHAR_REGEX.test(name) ||
    CONTROL_CHAR_REGEX.test(email)
  ) {
    return null;
  }
  return {
    id,
    name,
    email,
    kind: "member",
    assignedAt,
  };
}

export function toActiveGiteaIdentity(identity: ResolvedGiteaIdentityRecord): ActiveGiteaIdentity {
  return {
    id: identity.id,
    source: identity.source,
    name: identity.name,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.giteaUsername ? { giteaUsername: identity.giteaUsername } : {}),
  };
}

export class GiteaIdentityBridge {
  private readonly homeDir: string;
  private readonly teamCollabDataDir: string;
  private readonly teaConfigPaths: readonly string[];
  private readonly fetchUserProfile: FetchGiteaUserProfileFn | null;
  private readonly execGit: ExecGitFn;
  private readonly checkSshKeyExists?: (candidatePath: string) => boolean;
  private readonly profileCache = new Map<string, GiteaUserProfile>();

  constructor(options: GiteaIdentityBridgeOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    const paseoHome =
      options.paseoHome?.trim() ||
      process.env.PASEO_HOME?.trim() ||
      path.join(this.homeDir, ".paseo");
    this.teamCollabDataDir = options.teamCollabDataDir
      ? path.resolve(options.teamCollabDataDir)
      : path.join(paseoHome, "plugin-data", "team-collab");
    this.teaConfigPaths =
      options.teaConfigPaths ?? getDefaultTeaConfigPaths(process.env, this.homeDir);
    this.fetchUserProfile =
      options.fetchUserProfile === undefined
        ? defaultFetchGiteaUserProfile
        : options.fetchUserProfile;
    this.execGit = options.execGit ?? defaultExecGit;
    this.checkSshKeyExists = options.checkSshKeyExists;
  }

  toIdentitySummary(rec: ResolvedGiteaIdentityRecord): GiteaIdentitySummary {
    const tokenPreview = maskSecret(rec.token);
    const sshKeyPathPreview = formatSshKeyPathPreview(rec.sshKeyPath, this.homeDir);
    return {
      id: rec.id,
      source: rec.source,
      name: rec.name,
      email: rec.email,
      giteaUsername: rec.giteaUsername,
      giteaUrl: rec.giteaUrl,
      hasToken: Boolean(rec.token),
      tokenPreview,
      hasSshKey: Boolean(rec.sshKeyPath),
      sshKeyPathPreview,
      isDefault: rec.isDefault,
    };
  }

  private readTeaLogins(): ParsedTeaConfigLogin[] {
    const seenFiles = new Set<string>();
    const seenLogins = new Set<string>();
    const results: ParsedTeaConfigLogin[] = [];

    for (const candidatePath of this.teaConfigPaths) {
      let realCandidate = path.resolve(candidatePath);
      try {
        if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
          continue;
        }
        realCandidate = fs.realpathSync(candidatePath);
      } catch {
        continue;
      }
      if (seenFiles.has(realCandidate)) {
        continue;
      }
      seenFiles.add(realCandidate);

      try {
        const content = fs.readFileSync(realCandidate, "utf8");
        const parsed = parseTeaConfigYaml(content, {
          homeDir: this.homeDir,
          checkSshKeyExists: this.checkSshKeyExists,
        });
        for (const login of parsed) {
          const key = login.loginName.toLowerCase();
          if (seenLogins.has(key)) {
            continue;
          }
          seenLogins.add(key);
          results.push(login);
        }
      } catch {
        // Ignore unreadable config file
      }
    }

    return results;
  }

  private async invokeTeamCollabStatus(
    paseo: unknown,
  ): Promise<{ invokedOk: boolean; rpcMembers: RawTeamCollabRosterMember[] }> {
    const invoke = (
      paseo as { plugins?: { invoke?: (...args: unknown[]) => Promise<unknown> } } | null
    )?.plugins?.invoke;
    if (typeof invoke !== "function") {
      return { invokedOk: false, rpcMembers: [] };
    }
    const raw = await withTimeout(
      invoke
        .call(
          (paseo as { plugins: unknown }).plugins,
          "team-collab",
          "team_collab.roster.status.request",
          {},
        )
        .catch(() => null),
      1500,
      null,
    );
    if (!raw || typeof raw !== "object") {
      return { invokedOk: false, rpcMembers: [] };
    }
    const record = raw as { members?: unknown };
    const rpcMembers = Array.isArray(record.members)
      ? (record.members as RawTeamCollabRosterMember[])
      : [];
    return { invokedOk: true, rpcMembers };
  }

  private readTeamCollabFiles(): {
    fileExists: boolean;
    members: RawTeamCollabRosterMember[];
    removedIds: Set<string>;
    secrets: Record<string, RawTeamCollabSecretRecord>;
  } {
    const rosterPath = path.join(this.teamCollabDataDir, "roster.json");
    const secretsPath = path.join(this.teamCollabDataDir, "secrets.json");
    let fileExists = false;
    const members: RawTeamCollabRosterMember[] = [];
    const removedIds = new Set<string>();
    const secrets: Record<string, RawTeamCollabSecretRecord> = {};

    if (fs.existsSync(rosterPath)) {
      fileExists = true;
      try {
        const parsed = JSON.parse(fs.readFileSync(rosterPath, "utf8")) as {
          members?: unknown;
          removedIds?: unknown;
        };
        if (Array.isArray(parsed?.members)) {
          for (const item of parsed.members) {
            if (item && typeof item === "object") {
              members.push(item as RawTeamCollabRosterMember);
            }
          }
        }
        if (Array.isArray(parsed?.removedIds)) {
          for (const id of parsed.removedIds) {
            if (typeof id === "string" && id.trim()) {
              removedIds.add(id.trim());
            }
          }
        }
      } catch {
        // Ignore corrupted roster.json
      }
    }

    if (fs.existsSync(secretsPath)) {
      fileExists = true;
      try {
        const parsed = JSON.parse(fs.readFileSync(secretsPath, "utf8")) as {
          secrets?: unknown;
        };
        if (parsed?.secrets && typeof parsed.secrets === "object") {
          for (const [key, val] of Object.entries(parsed.secrets as Record<string, unknown>)) {
            if (val && typeof val === "object") {
              secrets[key] = val as RawTeamCollabSecretRecord;
            }
          }
        }
      } catch {
        // Ignore corrupted secrets.json
      }
    }

    return { fileExists, members, removedIds, secrets };
  }

  async loadIdentities(paseo?: unknown): Promise<{
    identities: ResolvedGiteaIdentityRecord[];
    teamCollabAvailable: boolean;
    teamCollabMembersCount: number;
  }> {
    const { invokedOk, rpcMembers } = await this.invokeTeamCollabStatus(paseo);
    const { fileExists, members: fileMembers, removedIds, secrets } = this.readTeamCollabFiles();

    const combinedMembers: RawTeamCollabRosterMember[] = [];
    const seenMemberIds = new Set<string>();

    for (const item of [...fileMembers, ...rpcMembers]) {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || !MEMBER_ID_PATTERN.test(id) || removedIds.has(id) || seenMemberIds.has(id)) {
        continue;
      }
      seenMemberIds.add(id);
      combinedMembers.push(item);
    }

    const identities: ResolvedGiteaIdentityRecord[] = [];
    let teamCollabMembersCount = 0;

    for (const member of combinedMembers) {
      if (member.enabled === false) {
        continue;
      }
      const id = (member.id as string).trim();
      const name = typeof member.name === "string" ? member.name.trim() : "";
      const email = typeof member.email === "string" ? member.email.trim() : "";
      if (!name || !email || CONTROL_CHAR_REGEX.test(name) || CONTROL_CHAR_REGEX.test(email)) {
        continue;
      }

      const secret = secrets[id];
      let rawProvider = "gitea";
      if (typeof member.gitProvider === "string" && member.gitProvider.trim()) {
        rawProvider = member.gitProvider.trim().toLowerCase();
      } else if (typeof secret?.gitProvider === "string" && secret.gitProvider.trim()) {
        rawProvider = secret.gitProvider.trim().toLowerCase();
      }

      const rawGiteaToken =
        typeof secret?.giteaToken === "string" && !CONTROL_CHAR_REGEX.test(secret.giteaToken)
          ? secret.giteaToken.trim()
          : "";
      const parsedGiteaUrl = parseGiteaEndpoint(
        typeof secret?.giteaUrl === "string" ? secret.giteaUrl : null,
      );
      const isGithubOrGitlabUrl =
        parsedGiteaUrl?.hostname === "github.com" ||
        Boolean(parsedGiteaUrl?.hostname.endsWith(".github.com")) ||
        parsedGiteaUrl?.hostname === "gitlab.com";

      if (rawProvider === "github" || rawProvider === "gitlab") {
        if (!rawGiteaToken || isGithubOrGitlabUrl) {
          continue;
        }
      }

      const giteaUsernameCandidate =
        (typeof member.giteaUsername === "string" && member.giteaUsername.trim()) ||
        (typeof member.gitUsername === "string" && member.gitUsername.trim()) ||
        (typeof secret?.httpUsername === "string" && secret.httpUsername.trim()) ||
        null;

      const sshKeyPath = normalizeAndValidateSshKeyPath(
        typeof secret?.sshKeyPath === "string" ? secret.sshKeyPath : null,
        this.homeDir,
      );

      identities.push({
        id,
        source: "team-collab",
        name,
        email,
        giteaUsername: giteaUsernameCandidate,
        giteaUrl: parsedGiteaUrl?.baseUrl ?? null,
        token: rawGiteaToken,
        sshKeyPath,
        isDefault: identities.length === 0,
      });
      teamCollabMembersCount += 1;
    }

    const teaLogins = this.readTeaLogins();
    const standaloneTeaLogins: ParsedTeaConfigLogin[] = [];

    for (const login of teaLogins) {
      const loginLower = login.loginName.toLowerCase();
      const teaUserLower = login.giteaUsername?.trim().toLowerCase() || "";
      const loginUserLower = teaUserLower || loginLower;
      const loginEndpoint = parseGiteaEndpoint(login.giteaUrl);

      const matchedTeamMember = identities.find((existing) => {
        if (existing.source !== "team-collab") {
          return false;
        }
        const existingEndpoint = parseGiteaEndpoint(existing.giteaUrl);
        const hostsConflict = Boolean(
          existingEndpoint && loginEndpoint && existingEndpoint.hostname !== loginEndpoint.hostname,
        );
        if (hostsConflict) {
          return false;
        }
        const existingUserLower = existing.giteaUsername?.trim().toLowerCase() || "";
        if (
          existing.id.toLowerCase() === loginLower &&
          (!existingUserLower || !teaUserLower || existingUserLower === teaUserLower)
        ) {
          return true;
        }
        if (existingUserLower && existingUserLower === loginUserLower) {
          return true;
        }
        return false;
      });

      if (matchedTeamMember) {
        if (!matchedTeamMember.giteaUrl && login.giteaUrl) {
          matchedTeamMember.giteaUrl = login.giteaUrl;
        }
        if (!matchedTeamMember.sshHost && login.sshHost) {
          matchedTeamMember.sshHost = login.sshHost;
        }
        if (!matchedTeamMember.giteaUsername && login.giteaUsername) {
          matchedTeamMember.giteaUsername = login.giteaUsername;
        }
        continue;
      }

      standaloneTeaLogins.push(login);
    }

    const standaloneRecords = await Promise.all(
      standaloneTeaLogins.map(async (login): Promise<ResolvedGiteaIdentityRecord> => {
        let profile: GiteaUserProfile | null = null;
        if (this.fetchUserProfile && login.giteaUrl && login.token) {
          const normalizedBaseUrl = login.giteaUrl.replace(/\/+$/, "");
          const sha256Prefix = createHash("sha256").update(login.token).digest("hex").slice(0, 12);
          const cacheKey = `${normalizedBaseUrl}::${login.loginName}::${sha256Prefix}`;
          const cached = this.profileCache.get(cacheKey);
          if (cached) {
            profile = cached;
          } else {
            profile = await withTimeout(
              this.fetchUserProfile({
                baseUrl: login.giteaUrl,
                token: login.token,
                loginName: login.loginName,
              }).catch(() => null),
              2000,
              null,
            );
            if (profile) {
              this.profileCache.set(cacheKey, profile);
            }
          }
        }

        const apiLogin =
          typeof profile?.login === "string" && !CONTROL_CHAR_REGEX.test(profile.login)
            ? profile.login.trim() || null
            : null;
        const apiFullName =
          typeof profile?.full_name === "string" && !CONTROL_CHAR_REGEX.test(profile.full_name)
            ? profile.full_name.trim() || null
            : null;
        const apiEmail =
          typeof profile?.email === "string" &&
          !CONTROL_CHAR_REGEX.test(profile.email) &&
          profile.email.trim().includes("@") &&
          !/\s/.test(profile.email.trim())
            ? profile.email.trim()
            : null;

        const effectiveUsername = login.giteaUsername || apiLogin || login.loginName;
        const rawName = apiFullName || effectiveUsername || login.loginName;
        const name = CONTROL_CHAR_REGEX.test(rawName) ? login.loginName : rawName;
        const hostPart = login.giteaHostname || "gitea.local";
        const cleanLocalPart =
          (effectiveUsername || login.loginName).replace(/[^a-zA-Z0-9._+-]/g, "") || "user";
        const email = apiEmail || `${cleanLocalPart}@${hostPart}`;

        return {
          id: `tea:${login.loginName}`,
          source: "tea",
          name,
          email,
          giteaUsername: effectiveUsername,
          giteaUrl: login.giteaUrl,
          sshHost: login.sshHost,
          token: login.token,
          sshKeyPath: login.sshKeyPath,
          isDefault: login.isDefault,
        };
      }),
    );

    identities.push(...standaloneRecords);

    let hasDefault = false;
    for (const item of identities) {
      if (item.isDefault) {
        if (hasDefault) {
          item.isDefault = false;
        } else {
          hasDefault = true;
        }
      }
    }
    if (identities.length > 0 && !hasDefault) {
      identities[0].isDefault = true;
    }

    return {
      identities,
      teamCollabAvailable: invokedOk || fileExists,
      teamCollabMembersCount,
    };
  }

  async syncHostIdentities(paseo?: unknown): Promise<{
    syncedCount: number;
    identities: GiteaIdentitySummary[];
  }> {
    let importedCount: number | null = null;
    const invoke = (
      paseo as { plugins?: { invoke?: (...args: unknown[]) => Promise<unknown> } } | null
    )?.plugins?.invoke;
    if (typeof invoke === "function") {
      const syncRes = await withTimeout(
        invoke
          .call(
            (paseo as { plugins: unknown }).plugins,
            "team-collab",
            "team_collab.roster.sync_host.request",
            { overwriteExistingCredentials: false },
          )
          .catch(() => null),
        3000,
        null,
      );
      if (syncRes && typeof syncRes === "object") {
        const importedIds = (syncRes as { importedIds?: unknown }).importedIds;
        if (Array.isArray(importedIds)) {
          importedCount = importedIds.length;
        }
      }
    }

    const loaded = await this.loadIdentities(paseo);
    const summaries = loaded.identities.map((item) => this.toIdentitySummary(item));
    const syncedCount = importedCount !== null ? importedCount : summaries.length;

    return {
      syncedCount,
      identities: summaries,
    };
  }

  identityMatchesHost(
    identity: ResolvedGiteaIdentityRecord,
    effectiveHost: string,
    locationPort?: string,
  ): boolean {
    const cleanHost = effectiveHost.trim().toLowerCase();
    if (!cleanHost) {
      return false;
    }
    const hostCandidates = new Set<string>([cleanHost]);
    if (locationPort) {
      hostCandidates.add(`${cleanHost}:${locationPort}`);
    }
    const [hostWithoutPort] = cleanHost.split(":");
    if (hostWithoutPort) {
      hostCandidates.add(hostWithoutPort);
    }

    if (identity.sshHost) {
      const sshHostLower = identity.sshHost.trim().toLowerCase();
      const [sshWithoutPort] = sshHostLower.split(":");
      if (
        hostCandidates.has(sshHostLower) ||
        (sshWithoutPort ? hostCandidates.has(sshWithoutPort) : false)
      ) {
        return true;
      }
    }

    if (identity.giteaUrl) {
      const parsed = parseGiteaEndpoint(identity.giteaUrl);
      if (!parsed) {
        return false;
      }
      return hostCandidates.has(parsed.hostname) || hostCandidates.has(parsed.host);
    }

    if (identity.sshHost) {
      return false;
    }

    return Boolean(identity.token || identity.sshKeyPath);
  }

  resolveIdentityForHost(params: {
    effectiveHost: string;
    locationPort?: string;
    preferredIdentityId?: string;
    identities: readonly ResolvedGiteaIdentityRecord[];
  }): ResolveIdentityForHostResult {
    const { effectiveHost, locationPort, identities } = params;
    const rawPreferred = params.preferredIdentityId?.trim() || "";
    const isAuto = !rawPreferred || rawPreferred.toLowerCase() === "auto";

    if (!isAuto) {
      const stripped = rawPreferred.startsWith("@") ? rawPreferred.slice(1).trim() : rawPreferred;
      const lowerStripped = stripped.toLowerCase();

      const found = identities.find((item) => {
        const idLower = item.id.toLowerCase();
        if (idLower === lowerStripped || idLower === `tea:${lowerStripped}`) {
          return true;
        }
        if (item.source === "tea" && idLower.startsWith("tea:")) {
          return idLower.slice(4) === lowerStripped;
        }
        return false;
      });

      if (!found) {
        return {
          kind: "missing_identity",
          reason: `未找到所选 Gitea 身份: ${rawPreferred}`,
        };
      }

      const hasExplicitServerBinding = Boolean(found.giteaUrl || found.sshHost);
      if (
        hasExplicitServerBinding &&
        !this.identityMatchesHost(found, effectiveHost, locationPort)
      ) {
        return {
          kind: "host_mismatch",
          identity: found,
          reason: `所选身份 ${found.name} (@${found.id}) 绑定的服务端与当前仓库 (${effectiveHost}) 不一致`,
        };
      }

      if (!found.token) {
        return {
          kind: "missing_token",
          identity: found,
          reason: `所选身份 ${found.name} (@${found.id}) 未配置 Gitea HTTP Token，无法拉取 Issue 或创建 PR`,
        };
      }

      return {
        kind: "matched",
        identity: found,
      };
    }

    const matchingWithToken = identities.filter(
      (item) => Boolean(item.token) && this.identityMatchesHost(item, effectiveHost, locationPort),
    );

    const teamCollabExactHost = matchingWithToken.find(
      (item) => item.source === "team-collab" && Boolean(item.giteaUrl || item.sshHost),
    );
    if (teamCollabExactHost) {
      return { kind: "matched", identity: teamCollabExactHost };
    }

    const teamCollabAny = matchingWithToken.find((item) => item.source === "team-collab");
    if (teamCollabAny) {
      return { kind: "matched", identity: teamCollabAny };
    }

    const teaDefault = matchingWithToken.find((item) => item.source === "tea" && item.isDefault);
    if (teaDefault) {
      return { kind: "matched", identity: teaDefault };
    }

    const teaAny = matchingWithToken.find((item) => item.source === "tea");
    if (teaAny) {
      return { kind: "matched", identity: teaAny };
    }

    return { kind: "no_match" };
  }

  matchIdentityForIssueAssignees(params: {
    assignees: ReadonlyArray<GiteaIssueAssigneeDto | null | undefined>;
    effectiveHost: string;
    locationPort?: string;
    baseUrl?: string;
    identities: readonly ResolvedGiteaIdentityRecord[];
  }): ResolvedGiteaIdentityRecord | null {
    const { assignees, effectiveHost, locationPort, baseUrl, identities } = params;
    if (!assignees || assignees.length === 0) {
      return null;
    }

    const parsedBase = parseGiteaEndpoint(baseUrl);
    const compatible = identities.filter((item) => {
      if (!item.token) {
        return false;
      }
      if (effectiveHost && this.identityMatchesHost(item, effectiveHost, locationPort)) {
        return true;
      }
      if (parsedBase) {
        if (
          this.identityMatchesHost(item, parsedBase.host) ||
          this.identityMatchesHost(item, parsedBase.hostname)
        ) {
          return true;
        }
      }
      return false;
    });
    if (compatible.length === 0) {
      return null;
    }

    // Prioritize team-collab over standalone tea when matching assignees
    const orderedCompatible = [
      ...compatible.filter((item) => item.source === "team-collab"),
      ...compatible.filter((item) => item.source === "tea"),
    ];

    for (const assignee of assignees) {
      if (!assignee) {
        continue;
      }
      const loginLower = assignee.login?.trim().toLowerCase() || "";
      const usernameLower = assignee.username?.trim().toLowerCase() || "";
      const emailLower = assignee.email?.trim().toLowerCase() || "";
      if (!loginLower && !usernameLower && !emailLower) {
        continue;
      }

      const matched = orderedCompatible.find((identity) => {
        const idStripped = identity.id.replace(/^tea:/i, "").toLowerCase();
        const giteaUserLower = identity.giteaUsername?.trim().toLowerCase() || "";
        const identityEmailLower = identity.email?.trim().toLowerCase() || "";

        if (
          loginLower &&
          (giteaUserLower === loginLower || (!giteaUserLower && idStripped === loginLower))
        ) {
          return true;
        }
        if (
          usernameLower &&
          (giteaUserLower === usernameLower || (!giteaUserLower && idStripped === usernameLower))
        ) {
          return true;
        }
        if (emailLower && identityEmailLower && identityEmailLower === emailLower) {
          return true;
        }
        return false;
      });

      if (matched) {
        return matched;
      }
    }

    return null;
  }

  buildTeamCollabOwnerMetadata(
    identity:
      | {
          id?: string | null;
          source?: string | null;
          name?: string | null;
          email?: string | null;
        }
      | null
      | undefined,
    assignedAt?: string,
  ): TeamCollabOwnerMetadata | null {
    return buildTeamCollabOwnerMetadata(identity, assignedAt);
  }

  async applyIdentityToWorktree(
    cwd: string,
    identity: {
      name: string;
      email: string;
      sshKeyPath?: string | null;
      source?: string | null;
    },
  ): Promise<{ applied: boolean; isWorktree: boolean }> {
    if (
      !cwd ||
      !identity.name?.trim() ||
      !identity.email?.trim() ||
      CONTROL_CHAR_REGEX.test(identity.name) ||
      CONTROL_CHAR_REGEX.test(identity.email)
    ) {
      return { applied: false, isWorktree: false };
    }
    try {
      if (!fs.statSync(cwd).isDirectory()) {
        return { applied: false, isWorktree: false };
      }
    } catch {
      return { applied: false, isWorktree: false };
    }

    const revParse = await this.execGit(cwd, [
      "rev-parse",
      "--is-bare-repository",
      "--git-dir",
      "--git-common-dir",
    ]);
    if (!revParse.ok) {
      return { applied: false, isWorktree: false };
    }
    const lines = revParse.stdout.split(/\r?\n/).map((line) => line.trim());
    if (lines.length < 3 || lines[0] === "true") {
      return { applied: false, isWorktree: false };
    }

    const resolvedGitDir = safeRealpath(path.resolve(cwd, lines[1]));
    const resolvedCommonDir = safeRealpath(path.resolve(cwd, lines[2]));
    const isWorktree = resolvedGitDir !== resolvedCommonDir;

    if (!isWorktree) {
      return { applied: false, isWorktree: false };
    }

    const extRes = await this.execGit(cwd, ["config", "extensions.worktreeConfig", "true"]);
    if (!extRes.ok) {
      return { applied: false, isWorktree: true };
    }

    const nameRes = await this.execGit(cwd, [
      "config",
      "--worktree",
      "user.name",
      identity.name.trim(),
    ]);
    if (!nameRes.ok) {
      return { applied: false, isWorktree: true };
    }

    const emailRes = await this.execGit(cwd, [
      "config",
      "--worktree",
      "user.email",
      identity.email.trim(),
    ]);
    if (!emailRes.ok) {
      return { applied: false, isWorktree: true };
    }

    if (identity.sshKeyPath) {
      const sshCommand = buildSshCommand(identity.sshKeyPath, this.homeDir);
      if (sshCommand) {
        const sshRes = await this.execGit(cwd, [
          "config",
          "--worktree",
          "core.sshCommand",
          sshCommand,
        ]);
        if (!sshRes.ok) {
          return { applied: false, isWorktree: true };
        }
      }
    }

    return { applied: true, isWorktree: true };
  }
}
