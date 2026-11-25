import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  DiscoveredHostAccountSchema,
  SYSTEM_BOT_MEMBER_ID,
  TeamMemberIdSchema,
  type DetectedServerHint,
  type DiscoveredHostAccount,
  type GitProviderKind,
  type TeamMemberProfile,
} from "../shared/contracts.js";
import { formatSshKeyPathPreview, maskSecret } from "./secret-store.js";

const execFileAsync = promisify(execFile);

const UNSAFE_SSH_PATH_CHARS = /[\x00-\x1f\x7f`$;&|><\n\r]/;
const CONTROL_CHAR_REGEX = /[\r\n\0]/;

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

export interface ParsedTeaLogin {
  source?: "tea" | "glab" | "gh";
  gitProvider?: GitProviderKind;
  loginName: string;
  giteaUrl: string | null;
  giteaHostname: string | null;
  giteaUsername: string | null;
  token: string | null;
  sshKeyPath: string | null;
  isDefault: boolean;
}

export interface GitGlobalIdentity {
  name: string | null;
  email: string | null;
}

export interface GiteaUserProfileResponse {
  login?: string | null;
  full_name?: string | null;
  email?: string | null;
}

export type FetchGiteaUserProfileFn = (params: {
  baseUrl: string;
  token: string;
  loginName: string;
  signal?: AbortSignal;
}) => Promise<GiteaUserProfileResponse | null>;

export interface HostDiscoveryOptions {
  hostTeaConfigPaths?: readonly string[];
  hostGlabConfigPaths?: readonly string[];
  hostGhConfigPaths?: readonly string[];
  homeDir?: string;
  existingRosterMembers?: readonly TeamMemberProfile[];
  existingMemberGiteaUrls?: Readonly<Record<string, string | null | undefined>>;
  gitGlobalIdentity?: GitGlobalIdentity | (() => Promise<GitGlobalIdentity>);
  gitGlobalConfigPath?: string;
  fetchUserProfile?: FetchGiteaUserProfileFn | null;
  skipNetworkFetch?: boolean;
  timeoutMs?: number;
}

export interface DiscoveredHostAccountInternal {
  publicAccount: DiscoveredHostAccount;
  rawToken: string | null;
  rawSshKeyPath: string | null;
}

export function getDefaultHostTeaConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string[] {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const candidates = [
    path.join(homeDir, "Library", "Application Support", "tea", "config.yml"),
    ...(xdgConfigHome ? [path.join(xdgConfigHome, "tea", "config.yml")] : []),
    path.join(homeDir, ".config", "tea", "config.yml"),
  ];
  return [...new Set(candidates.map((p) => path.resolve(p)))];
}

export function getDefaultHostGlabConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string[] {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const candidates = [
    path.join(homeDir, "Library", "Application Support", "glab-cli", "config.yml"),
    ...(xdgConfigHome ? [path.join(xdgConfigHome, "glab-cli", "config.yml")] : []),
    path.join(homeDir, ".config", "glab-cli", "config.yml"),
  ];
  return [...new Set(candidates.map((p) => path.resolve(p)))];
}

export function getDefaultHostGhConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string[] {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const candidates = [
    ...(xdgConfigHome ? [path.join(xdgConfigHome, "gh", "hosts.yml")] : []),
    path.join(homeDir, ".config", "gh", "hosts.yml"),
  ];
  return [...new Set(candidates.map((p) => path.resolve(p)))];
}

function getSshKeyFilenamePriority(filename: string): number {
  const lower = filename.toLowerCase();
  if (lower === "id_ed25519") return 0;
  if (lower.startsWith("id_ed25519")) return 1;
  if (lower === "id_rsa") return 2;
  if (lower.startsWith("id_rsa")) return 3;
  if (lower === "id_ecdsa") return 4;
  if (lower.startsWith("id_ecdsa")) return 5;
  if (lower.endsWith("_ed25519")) return 6;
  if (lower.endsWith("_rsa")) return 7;
  if (lower.endsWith("_ecdsa")) return 8;
  return 9;
}

function isExcludedSshFilename(filename: string): boolean {
  if (!filename || filename.startsWith(".")) {
    return true;
  }
  const lower = filename.toLowerCase();
  if (
    lower.endsWith(".pub") ||
    lower.endsWith(".cert") ||
    lower.endsWith(".old") ||
    lower.endsWith(".bak") ||
    lower.startsWith("known_hosts") ||
    lower.startsWith("authorized_keys") ||
    lower.startsWith("config") ||
    lower.startsWith("agent") ||
    lower === "environment" ||
    lower === "rc"
  ) {
    return true;
  }
  return false;
}

export function discoverHostSshKeys(sshDir: string = path.join(os.homedir(), ".ssh")): string[] {
  if (!sshDir || UNSAFE_SSH_PATH_CHARS.test(sshDir)) {
    return [];
  }
  const resolvedDir = path.resolve(sshDir);
  let entries: string[];
  try {
    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      return [];
    }
    entries = fs.readdirSync(resolvedDir);
  } catch {
    return [];
  }

  const validNames: string[] = [];
  for (const name of entries) {
    if (isExcludedSshFilename(name)) {
      continue;
    }
    const candidatePath = path.join(resolvedDir, name);
    if (UNSAFE_SSH_PATH_CHARS.test(candidatePath)) {
      continue;
    }
    try {
      if (fs.statSync(candidatePath).isFile()) {
        validNames.push(name);
      }
    } catch {
      // Ignore broken symlinks or inaccessible files
    }
  }

  validNames.sort((a, b) => {
    const rankDiff = getSshKeyFilenamePriority(a) - getSshKeyFilenamePriority(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.localeCompare(b);
  });

  return validNames.map((name) => path.join(resolvedDir, name));
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

function resolveExistingSshKeyPath(
  rawPath: string | undefined,
  homeDir: string,
  checkExists?: (candidatePath: string) => boolean,
): string | null {
  if (!rawPath) {
    return null;
  }
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === "~" || UNSAFE_SSH_PATH_CHARS.test(trimmed)) {
    return null;
  }
  const expanded =
    trimmed.startsWith("~/") || trimmed.startsWith("~\\")
      ? path.join(homeDir, trimmed.slice(2))
      : trimmed;
  try {
    if (checkExists) {
      return checkExists(expanded) ? expanded : null;
    }
    return fs.existsSync(expanded) && fs.statSync(expanded).isFile() ? expanded : null;
  } catch {
    return null;
  }
}

export function parseTeaLoginsFromYaml(
  yamlContent: string,
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const lines = yamlContent.split(/\r?\n/);

  interface RawLoginItem {
    name?: string;
    url?: string;
    token?: string;
    default?: string;
    user?: string;
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

  const results: ParsedTeaLogin[] = [];
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
    const token = rawToken && !CONTROL_CHAR_REGEX.test(rawToken) ? rawToken : null;
    const sshKeyPath = resolveExistingSshKeyPath(raw.ssh_key, homeDir, options?.checkSshKeyExists);
    const isDefault = (raw.default?.trim().toLowerCase() ?? "") === "true";

    results.push({
      source: "tea",
      gitProvider: "gitea",
      loginName,
      giteaUrl: parsedEndpoint?.baseUrl ?? null,
      giteaHostname: parsedEndpoint?.hostname ?? null,
      giteaUsername,
      token,
      sshKeyPath,
      isDefault,
    });
  }

  return results;
}

export function parseGlabLoginsFromYaml(
  yamlContent: string,
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const lines = yamlContent.split(/\r?\n/);

  interface RawGlabHostItem {
    hostKey: string;
    token?: string;
    user?: string;
    api_protocol?: string;
    http_protocol?: string;
    ssh_key?: string;
    default?: string;
  }

  const rawItems: RawGlabHostItem[] = [];
  let current: RawGlabHostItem | null = null;
  let inHosts = false;
  let hostKeyIndent: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;

    if (indent === 0) {
      if (/^hosts\s*:/.test(trimmed)) {
        inHosts = true;
        current = null;
        hostKeyIndent = null;
      } else if (/^[a-zA-Z0-9_.-]+\s*:/.test(trimmed)) {
        inHosts = false;
        current = null;
      }
      continue;
    }

    if (!inHosts) {
      continue;
    }

    const uncommented = trimmed.replace(/\s+#.*$/, "").trim();
    if (uncommented.endsWith(":") && (hostKeyIndent === null || indent <= hostKeyIndent)) {
      const rawHostKey = stripYamlScalar(uncommented.slice(0, -1));
      if (!rawHostKey) {
        continue;
      }
      hostKeyIndent = indent;
      current = { hostKey: rawHostKey };
      rawItems.push(current);
      continue;
    }

    if (current && hostKeyIndent !== null && indent > hostKeyIndent) {
      const match = uncommented.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (!match) {
        continue;
      }
      const key = match[1].toLowerCase();
      const val = stripYamlScalar(match[2]);
      if (key === "token" || key === "oauth_token" || key === "job_token") {
        if (!current.token && val) {
          current.token = val;
        }
      } else if (key === "user" || key === "username") {
        if (!current.user && val) {
          current.user = val;
        }
      } else if (key === "api_protocol") {
        current.api_protocol = val;
      } else if (key === "http_protocol") {
        current.http_protocol = val;
      } else if (key === "ssh_key") {
        current.ssh_key = val;
      } else if (key === "default") {
        current.default = val;
      }
    }
  }

  const results: ParsedTeaLogin[] = [];
  for (const raw of rawItems) {
    const proto =
      raw.api_protocol?.toLowerCase() === "http" || raw.http_protocol?.toLowerCase() === "http"
        ? "http"
        : "https";
    const candidateUrl =
      raw.hostKey.startsWith("http://") || raw.hostKey.startsWith("https://")
        ? raw.hostKey
        : `${proto}://${raw.hostKey}`;
    const parsedEndpoint = parseGiteaEndpoint(candidateUrl);
    const user = raw.user?.trim() || "";
    const rawToken = raw.token?.trim() || "";
    const token = rawToken && !CONTROL_CHAR_REGEX.test(rawToken) ? rawToken : null;
    const sshKeyPath = resolveExistingSshKeyPath(raw.ssh_key, homeDir, options?.checkSshKeyExists);
    if (!user && !token && !parsedEndpoint) {
      continue;
    }
    const loginName = raw.hostKey || user || parsedEndpoint?.hostname || "gitlab";
    results.push({
      source: "glab",
      gitProvider: "gitlab",
      loginName,
      giteaUrl: parsedEndpoint?.baseUrl ?? "https://gitlab.com",
      giteaHostname: parsedEndpoint?.hostname ?? "gitlab.com",
      giteaUsername: user || null,
      token,
      sshKeyPath,
      isDefault: raw.default?.toLowerCase() === "true" || results.length === 0,
    });
  }

  return results;
}

export function parseGhLoginsFromYaml(
  yamlContent: string,
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const lines = yamlContent.split(/\r?\n/);

  interface RawGhHostItem {
    hostKey: string;
    user?: string;
    hostToken?: string;
    userTokens: Record<string, string>;
    ssh_key?: string;
  }

  const rawItems: RawGhHostItem[] = [];
  let current: RawGhHostItem | null = null;
  let inUsersBlock = false;
  let usersIndent = 0;
  let currentSubUser: string | null = null;
  let subUserIndent: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    const uncommented = trimmed.replace(/\s+#.*$/, "").trim();

    if (indent === 0 && uncommented.endsWith(":")) {
      const rawHostKey = stripYamlScalar(uncommented.slice(0, -1));
      inUsersBlock = false;
      currentSubUser = null;
      subUserIndent = null;
      if (!rawHostKey) {
        current = null;
        continue;
      }
      current = { hostKey: rawHostKey, userTokens: {} };
      rawItems.push(current);
      continue;
    }

    if (current && indent > 0) {
      if (inUsersBlock && indent <= usersIndent) {
        inUsersBlock = false;
        currentSubUser = null;
        subUserIndent = null;
      }

      if (inUsersBlock) {
        if (uncommented.endsWith(":") && (subUserIndent === null || indent <= subUserIndent)) {
          const parsedSubUser = stripYamlScalar(uncommented.slice(0, -1));
          if (parsedSubUser) {
            subUserIndent = indent;
            currentSubUser = parsedSubUser;
          }
          continue;
        }
        if (currentSubUser && subUserIndent !== null && indent > subUserIndent) {
          const match = uncommented.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
          if (match) {
            const key = match[1].toLowerCase();
            const val = stripYamlScalar(match[2]);
            if (
              (key === "oauth_token" || key === "token") &&
              val &&
              !current.userTokens[currentSubUser]
            ) {
              current.userTokens[currentSubUser] = val;
            }
          }
        }
        continue;
      }

      if (/^users\s*:\s*$/i.test(uncommented)) {
        inUsersBlock = true;
        usersIndent = indent;
        currentSubUser = null;
        subUserIndent = null;
        continue;
      }

      const match = uncommented.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (!match) {
        continue;
      }
      const key = match[1].toLowerCase();
      const val = stripYamlScalar(match[2]);
      if ((key === "user" || key === "username") && val && !current.user) {
        current.user = val;
      } else if ((key === "oauth_token" || key === "token") && val && !current.hostToken) {
        current.hostToken = val;
      } else if (key === "ssh_key" && val && !current.ssh_key) {
        current.ssh_key = val;
      }
    }
  }

  const results: ParsedTeaLogin[] = [];
  for (const raw of rawItems) {
    const user = raw.user?.trim() || Object.keys(raw.userTokens)[0] || "";
    const matchedUserToken = user ? raw.userTokens[user] : undefined;
    const rawToken = (
      matchedUserToken ??
      raw.hostToken ??
      Object.values(raw.userTokens)[0] ??
      ""
    ).trim();
    const token = rawToken && !CONTROL_CHAR_REGEX.test(rawToken) ? rawToken : null;
    if (!user && !token) {
      continue;
    }
    const candidateUrl =
      raw.hostKey.startsWith("http://") || raw.hostKey.startsWith("https://")
        ? raw.hostKey
        : `https://${raw.hostKey}`;
    const parsedEndpoint = parseGiteaEndpoint(candidateUrl);
    const sshKeyPath = resolveExistingSshKeyPath(raw.ssh_key, homeDir, options?.checkSshKeyExists);
    results.push({
      source: "gh",
      gitProvider: "github",
      loginName: raw.hostKey,
      giteaUrl: parsedEndpoint?.baseUrl ?? "https://github.com",
      giteaHostname: parsedEndpoint?.hostname ?? "github.com",
      giteaUsername: user || null,
      token,
      sshKeyPath,
      isDefault: raw.hostKey.toLowerCase() === "github.com" || results.length === 0,
    });
  }

  return results;
}

function readLoginsFromYamlFiles(
  paths: readonly string[],
  parser: (
    content: string,
    options?: {
      homeDir?: string;
      checkSshKeyExists?: (candidatePath: string) => boolean;
    },
  ) => ParsedTeaLogin[],
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const seenFiles = new Set<string>();
  const seenLogins = new Set<string>();
  const allLogins: ParsedTeaLogin[] = [];

  for (const candidatePath of paths) {
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
      const parsed = parser(content, options);
      for (const login of parsed) {
        const key = `${login.source ?? "tea"}:${login.loginName.toLowerCase()}`;
        if (seenLogins.has(key)) {
          continue;
        }
        seenLogins.add(key);
        allLogins.push(login);
      }
    } catch {
      // Ignore unreadable config files
    }
  }

  return allLogins;
}

export function readHostTeaLogins(
  hostTeaConfigPaths?: readonly string[],
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const paths = hostTeaConfigPaths ?? getDefaultHostTeaConfigPaths(process.env, homeDir);
  return readLoginsFromYamlFiles(paths, parseTeaLoginsFromYaml, options);
}

export function readHostGlabLogins(
  hostGlabConfigPaths?: readonly string[],
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const paths = hostGlabConfigPaths ?? getDefaultHostGlabConfigPaths(process.env, homeDir);
  return readLoginsFromYamlFiles(paths, parseGlabLoginsFromYaml, options);
}

export function readHostGhLogins(
  hostGhConfigPaths?: readonly string[],
  options?: {
    homeDir?: string;
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin[] {
  const homeDir = options?.homeDir ?? os.homedir();
  const paths = hostGhConfigPaths ?? getDefaultHostGhConfigPaths(process.env, homeDir);
  return readLoginsFromYamlFiles(paths, parseGhLoginsFromYaml, options);
}

function resolveEffectiveCliPaths(options?: {
  hostTeaConfigPaths?: readonly string[];
  hostGlabConfigPaths?: readonly string[];
  hostGhConfigPaths?: readonly string[];
  homeDir?: string;
}): {
  glabPaths: readonly string[] | undefined;
  ghPaths: readonly string[] | undefined;
} {
  const isIsolatedTeaOverride =
    options?.hostTeaConfigPaths !== undefined && options?.homeDir === undefined;
  return {
    glabPaths: options?.hostGlabConfigPaths ?? (isIsolatedTeaOverride ? [] : undefined),
    ghPaths: options?.hostGhConfigPaths ?? (isIsolatedTeaOverride ? [] : undefined),
  };
}

export function findHostTeaLoginByName(
  requestedLoginName: string,
  hostTeaConfigPaths?: readonly string[],
  options?: {
    homeDir?: string;
    hostGlabConfigPaths?: readonly string[];
    hostGhConfigPaths?: readonly string[];
    checkSshKeyExists?: (candidatePath: string) => boolean;
  },
): ParsedTeaLogin | null {
  const needle = requestedLoginName.trim();
  if (!needle) {
    return null;
  }
  const prefixMatch = needle.match(/^(tea|glab|gh):(.+)$/i);
  const requestedSource = prefixMatch
    ? (prefixMatch[1].toLowerCase() as "tea" | "glab" | "gh")
    : null;
  const targetName = prefixMatch ? prefixMatch[2].trim() : needle;
  if (!targetName) {
    return null;
  }

  const { glabPaths, ghPaths } = resolveEffectiveCliPaths({
    hostTeaConfigPaths,
    hostGlabConfigPaths: options?.hostGlabConfigPaths,
    hostGhConfigPaths: options?.hostGhConfigPaths,
    homeDir: options?.homeDir,
  });
  const allLogins = [
    ...readHostTeaLogins(hostTeaConfigPaths, options),
    ...readHostGlabLogins(glabPaths, options),
    ...readHostGhLogins(ghPaths, options),
  ];
  const logins = requestedSource
    ? allLogins.filter((l) => (l.source ?? "tea") === requestedSource)
    : allLogins;

  const exact = logins.find((l) => l.loginName === targetName);
  if (exact) {
    return exact;
  }
  const lower = targetName.toLowerCase();
  return (
    logins.find((l) => l.loginName.toLowerCase() === lower) ??
    logins.find((l) => l.giteaUsername?.toLowerCase() === lower) ??
    logins.find((l) => l.giteaHostname?.toLowerCase() === lower) ??
    null
  );
}

export function normalizeMemberIdSlug(raw: string, fallback = "member"): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-._]+$/, "");
  const candidate = (cleaned || fallback).slice(0, 64);
  if (candidate === SYSTEM_BOT_MEMBER_ID) {
    return "system-bot-user";
  }
  const parsed = TeamMemberIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : fallback;
}

function isValidEmailAddress(email: string | null | undefined): email is string {
  if (typeof email !== "string") {
    return false;
  }
  const trimmed = email.trim();
  return trimmed.length >= 3 && trimmed.includes("@") && !/\s/.test(trimmed);
}

function normalizeEmailLocalPart(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-zA-Z0-9._+-]/g, "");
  return cleaned || "user";
}

export async function readHostGitGlobalIdentity(options?: {
  timeoutMs?: number;
  gitConfigFile?: string;
}): Promise<GitGlobalIdentity> {
  const timeoutMs = options?.timeoutMs ?? 1500;
  const scopeArgs = options?.gitConfigFile ? ["--file", options.gitConfigFile] : ["--global"];

  const readKey = async (key: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync("git", ["config", ...scopeArgs, "--get", key], {
        timeout: timeoutMs,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      const val = stdout.trim();
      return val.length > 0 ? val : null;
    } catch {
      return null;
    }
  };

  const [name, email] = await Promise.all([readKey("user.name"), readKey("user.email")]);
  return { name, email };
}

export async function defaultFetchGiteaUserProfile(params: {
  baseUrl: string;
  token: string;
  loginName: string;
  signal?: AbortSignal;
}): Promise<GiteaUserProfileResponse | null> {
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
    return {
      login: typeof data.login === "string" ? data.login : null,
      full_name: typeof data.full_name === "string" ? data.full_name : null,
      email: typeof data.email === "string" ? data.email : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onAbort);
  }
}

export function isAlreadyInRoster(
  suggestedId: string,
  giteaUsername: string | null,
  existingRosterMembers: readonly TeamMemberProfile[],
  options?: {
    giteaUrl?: string | null;
    memberGiteaUrls?: Readonly<Record<string, string | null | undefined>>;
  },
): boolean {
  const lowerGiteaUser = giteaUsername?.toLowerCase() ?? null;
  const normalizedAccUrl = parseGiteaEndpoint(options?.giteaUrl)?.baseUrl ?? null;
  return existingRosterMembers.some((m) => {
    if (m.id === suggestedId) {
      return true;
    }
    const existingUsername = (m.gitUsername || m.giteaUsername || m.githubUsername)?.toLowerCase();
    if (lowerGiteaUser !== null && existingUsername === lowerGiteaUser) {
      const normalizedExistingUrl =
        parseGiteaEndpoint(options?.memberGiteaUrls?.[m.id])?.baseUrl ?? null;
      if (normalizedExistingUrl && normalizedAccUrl && normalizedExistingUrl !== normalizedAccUrl) {
        return false;
      }
      return true;
    }
    return false;
  });
}

export function inferServerHintFromRemoteUrl(remoteUrl: string): DetectedServerHint | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed || CONTROL_CHAR_REGEX.test(trimmed)) {
    return null;
  }
  let serverUrl: string | null = null;
  let hostname = "";

  const parsedHttp = parseGiteaEndpoint(trimmed);
  if (parsedHttp) {
    serverUrl = parsedHttp.origin;
    hostname = parsedHttp.hostname;
  } else {
    const scpMatch = trimmed.match(/^(?:[^@:/\s]+@)?([^:/\s]+):(?![/]).+$/);
    if (scpMatch && !trimmed.includes("://")) {
      hostname = scpMatch[1].toLowerCase();
      serverUrl = `https://${hostname}`;
    } else {
      const sshUrlMatch = trimmed.match(/^ssh:\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/.+$/i);
      if (sshUrlMatch) {
        hostname = sshUrlMatch[1].toLowerCase();
        serverUrl = `https://${hostname}`;
      }
    }
  }

  if (!serverUrl || !hostname) {
    return null;
  }

  let gitProvider: GitProviderKind = "gitea";
  if (hostname === "github.com" || hostname.endsWith(".github.com")) {
    gitProvider = "github";
    serverUrl = "https://github.com";
  } else if (hostname === "gitlab.com" || hostname.includes("gitlab")) {
    gitProvider = "gitlab";
  } else if (
    hostname === "gitee.com" ||
    hostname.endsWith(".gitee.com") ||
    hostname.includes("codeup") ||
    hostname.includes("bitbucket")
  ) {
    gitProvider = "generic";
  }

  return { gitProvider, serverUrl };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          onTimeout?.();
          resolve(fallback);
        }, timeoutMs);
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

export async function discoverHostAccountsWithSecrets(
  options?: HostDiscoveryOptions,
): Promise<DiscoveredHostAccountInternal[]> {
  const budgetMs = options?.timeoutMs ?? 2500;
  const homeDir = options?.homeDir ?? os.homedir();
  const existingRoster = options?.existingRosterMembers ?? [];
  const existingMemberGiteaUrls = options?.existingMemberGiteaUrls;
  const { glabPaths, ghPaths } = resolveEffectiveCliPaths(options);
  const teaLogins = readHostTeaLogins(options?.hostTeaConfigPaths, { homeDir });
  const glabLogins = readHostGlabLogins(glabPaths, { homeDir });
  const ghLogins = readHostGhLogins(ghPaths, { homeDir });
  const allCliLogins = [...teaLogins, ...glabLogins, ...ghLogins];

  const resolveGitGlobal = async (): Promise<GitGlobalIdentity> => {
    if (options?.gitGlobalIdentity) {
      if (typeof options.gitGlobalIdentity === "function") {
        return options.gitGlobalIdentity();
      }
      return options.gitGlobalIdentity;
    }
    return readHostGitGlobalIdentity({
      timeoutMs: Math.min(1500, budgetMs),
      gitConfigFile: options?.gitGlobalConfigPath,
    });
  };

  const fetchProfileFn: FetchGiteaUserProfileFn | null =
    options?.skipNetworkFetch || options?.fetchUserProfile === null
      ? null
      : (options?.fetchUserProfile ?? defaultFetchGiteaUserProfile);

  const overallController = new AbortController();

  const [gitGlobal, apiProfiles] = await withTimeout(
    Promise.all([
      resolveGitGlobal().catch((): GitGlobalIdentity => ({ name: null, email: null })),
      Promise.all(
        allCliLogins.map(async (login) => {
          const isTeaSource = (login.source ?? "tea") === "tea";
          if (!isTeaSource || !fetchProfileFn || !login.token || !login.giteaUrl) {
            return null;
          }
          const reqController = new AbortController();
          const onOverallAbort = () => reqController.abort();
          overallController.signal.addEventListener("abort", onOverallAbort, { once: true });
          try {
            return await withTimeout(
              fetchProfileFn({
                baseUrl: login.giteaUrl,
                token: login.token,
                loginName: login.loginName,
                signal: reqController.signal,
              }).catch(() => null),
              Math.min(2000, budgetMs),
              null,
              () => reqController.abort(),
            );
          } finally {
            overallController.signal.removeEventListener("abort", onOverallAbort);
          }
        }),
      ),
    ]),
    budgetMs,
    [{ name: null, email: null }, allCliLogins.map(() => null)] as const,
    () => overallController.abort(),
  );

  const gitGlobalName = gitGlobal.name?.trim() || null;
  const gitGlobalEmail = isValidEmailAddress(gitGlobal.email) ? gitGlobal.email.trim() : null;
  const gitGlobalEmailPrefix = gitGlobalEmail ? gitGlobalEmail.split("@")[0].trim() : null;

  const results: DiscoveredHostAccountInternal[] = [];
  const usedSuggestedIds = new Set<string>();

  const allocateUniqueSuggestedId = (primaryRaw: string, secondaryRaw: string): string => {
    const base = normalizeMemberIdSlug(primaryRaw);
    if (!usedSuggestedIds.has(base)) {
      usedSuggestedIds.add(base);
      return base;
    }
    const alt = normalizeMemberIdSlug(secondaryRaw);
    if (!usedSuggestedIds.has(alt)) {
      usedSuggestedIds.add(alt);
      return alt;
    }
    const combined = normalizeMemberIdSlug(`${base}-${alt}`);
    if (!usedSuggestedIds.has(combined)) {
      usedSuggestedIds.add(combined);
      return combined;
    }
    let counter = 2;
    while (true) {
      const suffix = `-${counter}`;
      const truncatedBase = base.slice(0, Math.max(1, 64 - suffix.length)).replace(/[-._]+$/, "");
      const candidate = normalizeMemberIdSlug(`${truncatedBase || "member"}${suffix}`);
      if (!usedSuggestedIds.has(candidate)) {
        usedSuggestedIds.add(candidate);
        return candidate;
      }
      counter += 1;
    }
  };

  if (allCliLogins.length > 0) {
    const isSingleCliLogin = allCliLogins.length === 1;

    for (let i = 0; i < allCliLogins.length; i += 1) {
      const login = allCliLogins[i];
      const apiProfile = apiProfiles[i] ?? null;
      const apiLogin = apiProfile?.login?.trim() || null;
      const apiFullName = apiProfile?.full_name?.trim() || null;
      const apiEmail = isValidEmailAddress(apiProfile?.email) ? apiProfile.email.trim() : null;

      const effectiveGiteaUsername = login.giteaUsername || apiLogin || login.loginName;
      const suggestedId = allocateUniqueSuggestedId(effectiveGiteaUsername, login.loginName);

      const matchTokens = [effectiveGiteaUsername, login.loginName, apiLogin]
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase());

      const matchesGitGlobal = Boolean(
        (gitGlobalName && matchTokens.includes(gitGlobalName.toLowerCase())) ||
        (gitGlobalEmailPrefix && matchTokens.includes(gitGlobalEmailPrefix.toLowerCase())),
      );

      let suggestedEmail: string;
      if (apiEmail) {
        suggestedEmail = apiEmail;
      } else if (matchesGitGlobal && gitGlobalEmail) {
        suggestedEmail = gitGlobalEmail;
      } else if (isSingleCliLogin && gitGlobalEmail) {
        suggestedEmail = gitGlobalEmail;
      } else {
        const localPart = normalizeEmailLocalPart(effectiveGiteaUsername || suggestedId);
        const hostPart = login.giteaHostname || "gitea.local";
        suggestedEmail = `${localPart}@${hostPart}`;
      }

      let suggestedName: string;
      if (apiFullName) {
        suggestedName = apiFullName;
      } else if ((matchesGitGlobal || isSingleCliLogin) && gitGlobalName) {
        suggestedName = gitGlobalName;
      } else if (apiLogin) {
        suggestedName = apiLogin;
      } else {
        suggestedName = effectiveGiteaUsername || login.loginName || suggestedId;
      }

      const tokenPreview = maskSecret(login.token);
      const sshKeyPathPreview = formatSshKeyPathPreview(login.sshKeyPath ?? undefined);

      const publicAccount = DiscoveredHostAccountSchema.parse({
        source: login.source ?? "tea",
        gitProvider: login.gitProvider ?? "gitea",
        loginName: login.loginName,
        suggestedId,
        suggestedName,
        suggestedEmail,
        giteaUrl: login.giteaUrl,
        giteaUsername: effectiveGiteaUsername,
        hasToken: tokenPreview !== null,
        tokenPreview,
        hasSshKey: sshKeyPathPreview !== null,
        sshKeyPathPreview,
        isDefault: login.isDefault,
        alreadyInRoster: isAlreadyInRoster(suggestedId, effectiveGiteaUsername, existingRoster, {
          giteaUrl: login.giteaUrl,
          memberGiteaUrls: existingMemberGiteaUrls,
        }),
      });

      results.push({
        publicAccount,
        rawToken: login.token,
        rawSshKeyPath: login.sshKeyPath,
      });
    }

    return results;
  }

  // Fallback to git-global when no CLI logins exist on host
  if (gitGlobalName || gitGlobalEmail) {
    const suggestedId = allocateUniqueSuggestedId(
      gitGlobalEmailPrefix || gitGlobalName || "git-user",
      "git-global",
    );
    const suggestedName = gitGlobalName || gitGlobalEmailPrefix || suggestedId;
    const suggestedEmail = gitGlobalEmail || `${suggestedId}@git.local`;
    const loginName = gitGlobalEmailPrefix || suggestedId;

    const publicAccount = DiscoveredHostAccountSchema.parse({
      source: "git-global",
      gitProvider: "gitea",
      loginName,
      suggestedId,
      suggestedName,
      suggestedEmail,
      giteaUrl: null,
      giteaUsername: null,
      hasToken: false,
      tokenPreview: null,
      hasSshKey: false,
      sshKeyPathPreview: null,
      isDefault: true,
      alreadyInRoster: isAlreadyInRoster(suggestedId, null, existingRoster),
    });

    results.push({
      publicAccount,
      rawToken: null,
      rawSshKeyPath: null,
    });
  }

  return results;
}

export async function discoverHostAccounts(
  options?: HostDiscoveryOptions,
): Promise<DiscoveredHostAccount[]> {
  const internal = await discoverHostAccountsWithSecrets(options);
  return internal.map((item) => item.publicAccount);
}
