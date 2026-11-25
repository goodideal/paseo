import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  TeamMemberIdSchema,
  type DetectedServerHint,
  type GitProviderKind,
  type TeamMemberProfile,
} from "../shared/contracts.js";
import {
  getDefaultHostTeaConfigPaths,
  inferServerHintFromRemoteUrl,
  parseGiteaEndpoint,
  parseTeaLoginsFromYaml,
  type ParsedGiteaEndpoint,
} from "./host-discovery.js";
import {
  ensurePrivateDir,
  writeFileAtomicSecure,
  type MemberSecretRecord,
  type SecretStore,
} from "./secret-store.js";

export { parseGiteaEndpoint, type ParsedGiteaEndpoint };

const execFileAsync = promisify(execFile);

export interface GitDirectoryInspection {
  isGitRepo: boolean;
  isWorktree: boolean;
  hasCommits: boolean;
  gitDir: string | null;
  gitCommonDir: string | null;
  currentBranch: string | null;
}

export interface ApplyWorktreeOwnerResult {
  applied: boolean;
  isWorktree: boolean;
  credentialScriptPath: string | null;
  teaShimDir: string | null;
}

export interface MemberShimPaths {
  credentialScriptPath: string | null;
  teaShimDir: string | null;
  teaConfigPath: string | null;
}

const SHELL_INJECTION_CHARS = /[\x00-\x1f\x7f`$;&|><\n\r]/;

function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function safeRealpath(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function assertSubpathInsideDataDir(dataDir: string, candidatePath: string): string {
  const resolvedRoot = path.resolve(dataDir);
  const resolvedTarget = path.resolve(candidatePath);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Refusing path outside plugin dataDir: ${candidatePath}`);
  }
  return resolvedTarget;
}

export function normalizeAndValidateSshKeyPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("SSH key path cannot be empty");
  }
  if (SHELL_INJECTION_CHARS.test(trimmed)) {
    throw new Error("Unsafe characters detected in SSH key path");
  }
  if (trimmed === "~") {
    throw new Error("Invalid SSH key path");
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function buildSshCommand(sshKeyPath: string): string {
  const normalized = normalizeAndValidateSshKeyPath(sshKeyPath);
  return `ssh -i ${shellQuoteSingle(normalized)} -o IdentitiesOnly=yes`;
}

export function extractDefaultGiteaUrlFromTeaYaml(yamlContent: string): string | null {
  const logins = parseTeaLoginsFromYaml(yamlContent);
  const preferred =
    logins.find((entry) => entry.isDefault && entry.giteaUrl) ??
    logins.find((entry) => Boolean(entry.giteaUrl));
  return preferred?.giteaUrl ?? null;
}

const CREDENTIAL_HELPER_MJS_SOURCE = `import fs from "node:fs";

const [, , secretsPath, memberId, fallbackGiteaUrl = "", operation = "get"] = process.argv;
if (operation && operation !== "get") {
  process.exit(0);
}

let stdinText = "";
try {
  stdinText = fs.readFileSync(0, "utf8");
} catch {
  stdinText = "";
}

const attrs = {};
for (const line of stdinText.split(/\\r?\\n/)) {
  if (!line) break;
  const idx = line.indexOf("=");
  if (idx > 0) {
    attrs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
}

const targetHost = (attrs.host || "").toLowerCase();
const targetProto = (attrs.protocol || "").toLowerCase();
if (!targetHost || !secretsPath || !memberId) {
  process.exit(0);
}

let record = null;
try {
  const payload = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  record = payload?.secrets?.[memberId] ?? null;
} catch {
  process.exit(0);
}

if (!record) {
  process.exit(0);
}

const isSafeToken = (val) => typeof val === "string" && val.length > 0 && !/[\\r\\n\\0]/.test(val);
const isSafeUser = (val) => typeof val === "string" && val.trim().length > 0 && !/[\\r\\n\\0]/.test(val);

if (
  (targetHost === "github.com" || targetHost.endsWith(".github.com")) &&
  (!targetProto || targetProto === "https") &&
  isSafeToken(record.githubToken)
) {
  process.stdout.write(\`username=token\\npassword=\${record.githubToken}\\n\`);
  process.exit(0);
}

if (isSafeToken(record.giteaToken)) {
  const effectiveUrl = (record.giteaUrl || fallbackGiteaUrl || "").trim();
  if (!effectiveUrl || /[\\r\\n\\0]/.test(effectiveUrl)) {
    process.exit(0);
  }
  let giteaHost = "";
  let giteaProto = "";
  try {
    const parsed = new URL(effectiveUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      giteaHost = parsed.host.toLowerCase();
      giteaProto = parsed.protocol.slice(0, -1).toLowerCase();
    }
  } catch {
    process.exit(0);
  }
  const protoMatches = !targetProto || !giteaProto || targetProto === giteaProto;
  if (giteaHost && targetHost === giteaHost && protoMatches) {
    const provider = typeof record.gitProvider === "string" ? record.gitProvider.toLowerCase() : "gitea";
    const httpUser = isSafeUser(record.httpUsername) ? record.httpUsername.trim() : "";
    let username = "token";
    if (provider === "gitlab" || giteaHost.includes("gitlab")) {
      username = httpUser || "oauth2";
    } else if (provider === "generic") {
      username = httpUser || "token";
    }
    process.stdout.write(\`username=\${username}\\npassword=\${record.giteaToken}\\n\`);
    process.exit(0);
  }
}
`;

export function parseSshOriginRemote(remoteUrl: string): {
  user: string;
  host: string;
  port?: string;
} | null {
  const trimmed = remoteUrl.trim();
  const scpMatch = trimmed.match(/^(?:([^@:/\s]+)@)?([^:/\s]+):(?![/])(.+)$/);
  if (scpMatch && !trimmed.includes("://")) {
    return {
      user: scpMatch[1] || "git",
      host: scpMatch[2].toLowerCase(),
    };
  }
  const sshUrlMatch = trimmed.match(/^ssh:\/\/(?:([^@/\s]+)@)?([^:/\s]+)(?::(\d+))?\/(.+)$/i);
  if (sshUrlMatch) {
    return {
      user: sshUrlMatch[1] || "git",
      host: sshUrlMatch[2].toLowerCase(),
      port: sshUrlMatch[3],
    };
  }
  return null;
}

export interface GitConfiguratorOptions {
  secretStore: SecretStore;
  hostTeaConfigPaths?: string[];
  realTeaBin?: string;
}

interface GitRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function isUnsetOk(res: GitRunResult): boolean {
  // git config --unset-all exits with 5 when the key does not exist
  return res.ok || res.code === 5;
}

export class GitConfigurator {
  private readonly secretStore: SecretStore;
  private readonly hostTeaConfigPaths: string[];
  private readonly explicitRealTeaBin?: string;

  constructor(options: GitConfiguratorOptions) {
    this.secretStore = options.secretStore;
    this.explicitRealTeaBin = options.realTeaBin;
    this.hostTeaConfigPaths = options.hostTeaConfigPaths ?? getDefaultHostTeaConfigPaths();
  }

  private async runGit(cwd: string, args: string[]): Promise<GitRunResult> {
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

  async inspectGitDirectory(cwd: string): Promise<GitDirectoryInspection> {
    const empty: GitDirectoryInspection = {
      isGitRepo: false,
      isWorktree: false,
      hasCommits: false,
      gitDir: null,
      gitCommonDir: null,
      currentBranch: null,
    };
    if (!cwd) return empty;
    try {
      if (!fs.statSync(cwd).isDirectory()) {
        return empty;
      }
    } catch {
      return empty;
    }

    const revParse = await this.runGit(cwd, [
      "rev-parse",
      "--is-bare-repository",
      "--git-dir",
      "--git-common-dir",
    ]);
    if (!revParse.ok) {
      return empty;
    }
    const lines = revParse.stdout.split(/\r?\n/).map((s) => s.trim());
    if (lines.length < 3 || lines[0] === "true") {
      return empty;
    }
    const resolvedGitDir = safeRealpath(path.resolve(cwd, lines[1]));
    const resolvedCommonDir = safeRealpath(path.resolve(cwd, lines[2]));
    const isWorktree = resolvedGitDir !== resolvedCommonDir;

    const headCheck = await this.runGit(cwd, ["rev-parse", "--verify", "HEAD"]);
    const branchRes = await this.runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);

    return {
      isGitRepo: true,
      isWorktree,
      hasCommits: headCheck.ok,
      gitDir: resolvedGitDir,
      gitCommonDir: resolvedCommonDir,
      currentBranch: branchRes.ok && branchRes.stdout ? branchRes.stdout : null,
    };
  }

  async detectServerHintFromRepo(cwd: string): Promise<DetectedServerHint | null> {
    if (!cwd) return null;
    const originRes = await this.runGit(cwd, ["config", "--get", "remote.origin.url"]);
    if (!originRes.ok || !originRes.stdout) {
      return null;
    }
    return inferServerHintFromRemoteUrl(originRes.stdout);
  }

  resolveEffectiveGiteaUrl(
    explicitGiteaUrl?: string | null,
    gitProvider: GitProviderKind = "gitea",
  ): string | null {
    const explicitParsed = parseGiteaEndpoint(explicitGiteaUrl);
    if (explicitParsed) {
      return explicitParsed.baseUrl;
    }
    if (gitProvider === "gitlab") {
      return "https://gitlab.com";
    }
    if (gitProvider !== "gitea") {
      return null;
    }
    for (const candidatePath of this.hostTeaConfigPaths) {
      try {
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          const content = fs.readFileSync(candidatePath, "utf8");
          const extracted = extractDefaultGiteaUrlFromTeaYaml(content);
          if (extracted) {
            return extracted;
          }
        }
      } catch {
        // Ignore unreadable host tea config
      }
    }
    return null;
  }

  private resolveRealTeaBinary(excludeShimDir: string): string | null {
    if (this.explicitRealTeaBin) {
      return this.explicitRealTeaBin;
    }
    const normalizedExclude = safeRealpath(excludeShimDir);
    const shimsRoot = safeRealpath(path.join(this.secretStore.dataDir, "shims"));
    const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    const fallbackCandidates = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
    for (const dir of [...pathEntries, ...fallbackCandidates]) {
      const resolvedDir = safeRealpath(dir);
      if (resolvedDir === normalizedExclude || resolvedDir.startsWith(shimsRoot + path.sep)) {
        continue;
      }
      const binPath = path.join(dir, "tea");
      try {
        fs.accessSync(binPath, fs.constants.X_OK);
        if (fs.statSync(binPath).isFile()) {
          return binPath;
        }
      } catch {
        // Continue scanning PATH
      }
    }
    return null;
  }

  ensureMemberShims(
    member: TeamMemberProfile,
    secrets: MemberSecretRecord | null,
  ): MemberShimPaths {
    const memberId = TeamMemberIdSchema.parse(member.id);
    const dataRoot = this.secretStore.dataDir;

    const binDir = assertSubpathInsideDataDir(dataRoot, path.join(dataRoot, "bin"));
    const credScriptPath = assertSubpathInsideDataDir(
      dataRoot,
      path.join(binDir, `cred-${memberId}.sh`),
    );
    const xdgMemberDir = assertSubpathInsideDataDir(dataRoot, path.join(dataRoot, "xdg", memberId));
    const teaConfigPath = assertSubpathInsideDataDir(
      dataRoot,
      path.join(xdgMemberDir, "tea", "config.yml"),
    );
    const teaShimDir = assertSubpathInsideDataDir(dataRoot, path.join(dataRoot, "shims", memberId));
    const teaShimBin = assertSubpathInsideDataDir(dataRoot, path.join(teaShimDir, "tea"));

    const effectiveProvider: GitProviderKind =
      secrets?.gitProvider ?? member.gitProvider ?? "gitea";
    const effectiveGiteaUrl = this.resolveEffectiveGiteaUrl(secrets?.giteaUrl, effectiveProvider);
    const parsedGitea = parseGiteaEndpoint(effectiveGiteaUrl);
    let activeCredScript: string | null = null;
    let activeTeaShimDir: string | null = null;
    let activeTeaConfigPath: string | null = null;

    if (secrets?.giteaToken || secrets?.githubToken) {
      ensurePrivateDir(binDir);
      const helperMjsPath = assertSubpathInsideDataDir(
        dataRoot,
        path.join(binDir, "cred-helper.mjs"),
      );
      writeFileAtomicSecure(helperMjsPath, CREDENTIAL_HELPER_MJS_SOURCE, 0o700);

      const scriptBody = [
        "#!/bin/sh",
        `exec ${shellQuoteSingle(process.execPath)} ${shellQuoteSingle(helperMjsPath)} ${shellQuoteSingle(this.secretStore.secretsPath)} ${shellQuoteSingle(memberId)} ${shellQuoteSingle(parsedGitea?.baseUrl ?? "")} "\${1:-get}"`,
        "",
      ].join("\n");
      writeFileAtomicSecure(credScriptPath, scriptBody, 0o700);
      activeCredScript = credScriptPath;
    } else if (fs.existsSync(credScriptPath)) {
      fs.rmSync(credScriptPath, { force: true });
    }

    if (effectiveProvider === "gitea" && secrets?.giteaToken && parsedGitea) {
      const sshHost = parsedGitea.hostname;
      const teaUser = member.giteaUsername || member.gitUsername || memberId;
      const yamlLines = [
        "logins:",
        `- name: ${JSON.stringify(memberId)}`,
        `  url: ${JSON.stringify(parsedGitea.baseUrl)}`,
        `  token: ${JSON.stringify(secrets.giteaToken)}`,
        "  default: true",
        ...(sshHost ? [`  ssh_host: ${JSON.stringify(sshHost)}`] : []),
        `  user: ${JSON.stringify(teaUser)}`,
        "",
      ].join("\n");
      writeFileAtomicSecure(teaConfigPath, yamlLines, 0o600);
      activeTeaConfigPath = teaConfigPath;

      ensurePrivateDir(teaShimDir);
      const realTea = this.resolveRealTeaBinary(teaShimDir);
      const shimScript = realTea
        ? [
            "#!/bin/sh",
            `export XDG_CONFIG_HOME=${shellQuoteSingle(xdgMemberDir)}`,
            `exec ${shellQuoteSingle(realTea)} "$@"`,
            "",
          ].join("\n")
        : [
            "#!/bin/sh",
            `export XDG_CONFIG_HOME=${shellQuoteSingle(xdgMemberDir)}`,
            'echo "tea CLI binary not found on host" >&2',
            "exit 127",
            "",
          ].join("\n");
      writeFileAtomicSecure(teaShimBin, shimScript, 0o700);
      activeTeaShimDir = teaShimDir;
    } else {
      fs.rmSync(xdgMemberDir, { recursive: true, force: true });
      fs.rmSync(teaShimDir, { recursive: true, force: true });
    }

    return {
      credentialScriptPath: activeCredScript,
      teaShimDir: activeTeaShimDir,
      teaConfigPath: activeTeaConfigPath,
    };
  }

  removeMemberShims(memberIdRaw: string): void {
    const memberId = TeamMemberIdSchema.parse(memberIdRaw);
    const dataRoot = this.secretStore.dataDir;
    const credScriptPath = assertSubpathInsideDataDir(
      dataRoot,
      path.join(dataRoot, "bin", `cred-${memberId}.sh`),
    );
    const xdgMemberDir = assertSubpathInsideDataDir(dataRoot, path.join(dataRoot, "xdg", memberId));
    const teaShimDir = assertSubpathInsideDataDir(dataRoot, path.join(dataRoot, "shims", memberId));
    fs.rmSync(credScriptPath, { force: true });
    fs.rmSync(xdgMemberDir, { recursive: true, force: true });
    fs.rmSync(teaShimDir, { recursive: true, force: true });
  }

  private async clearWorktreeCredentialHelpers(cwd: string): Promise<boolean> {
    const existing = await this.runGit(cwd, [
      "config",
      "--worktree",
      "--name-only",
      "--get-regexp",
      "^credential(\\..+)?\\.helper$",
    ]);
    if (!existing.ok || !existing.stdout) {
      return true;
    }
    const keys = [
      ...new Set(
        existing.stdout
          .split(/\r?\n/)
          .map((k) => k.trim())
          .filter(Boolean),
      ),
    ];
    for (const key of keys) {
      const res = await this.runGit(cwd, ["config", "--worktree", "--unset-all", key]);
      if (!isUnsetOk(res)) {
        return false;
      }
    }
    return true;
  }

  private async clearWorktreePushInsteadOf(cwd: string): Promise<boolean> {
    const existing = await this.runGit(cwd, [
      "config",
      "--worktree",
      "--name-only",
      "--get-regexp",
      "^url\\..*\\.pushinsteadof$",
    ]);
    if (!existing.ok || !existing.stdout) {
      return true;
    }
    const keys = [
      ...new Set(
        existing.stdout
          .split(/\r?\n/)
          .map((k) => k.trim())
          .filter(Boolean),
      ),
    ];
    for (const key of keys) {
      const res = await this.runGit(cwd, ["config", "--worktree", "--unset-all", key]);
      if (!isUnsetOk(res)) {
        return false;
      }
    }
    return true;
  }

  async clearOwnerFromWorktree(cwd: string): Promise<boolean> {
    const info = await this.inspectGitDirectory(cwd);
    if (!info.isGitRepo) {
      return false;
    }
    const extRes = await this.runGit(cwd, [
      "config",
      "--bool",
      "--get",
      "extensions.worktreeConfig",
    ]);
    if (!extRes.ok || extRes.stdout !== "true") {
      return true;
    }

    const r1 = await this.runGit(cwd, ["config", "--worktree", "--unset-all", "user.name"]);
    const r2 = await this.runGit(cwd, ["config", "--worktree", "--unset-all", "user.email"]);
    const r3 = await this.runGit(cwd, ["config", "--worktree", "--unset-all", "core.sshCommand"]);
    const r4 = await this.clearWorktreeCredentialHelpers(cwd);
    const r5 = await this.clearWorktreePushInsteadOf(cwd);

    return isUnsetOk(r1) && isUnsetOk(r2) && isUnsetOk(r3) && r4 && r5;
  }

  async applyOwnerToWorktree(
    cwd: string,
    member: TeamMemberProfile,
    secrets: MemberSecretRecord | null,
    options?: { allowMainCheckout?: boolean },
  ): Promise<ApplyWorktreeOwnerResult> {
    const info = await this.inspectGitDirectory(cwd);
    if (!info.isGitRepo) {
      return {
        applied: false,
        isWorktree: false,
        credentialScriptPath: null,
        teaShimDir: null,
      };
    }
    if (!info.isWorktree && !options?.allowMainCheckout) {
      return {
        applied: false,
        isWorktree: false,
        credentialScriptPath: null,
        teaShimDir: null,
      };
    }

    const shims = this.ensureMemberShims(member, secrets);
    const failResult = (): ApplyWorktreeOwnerResult => ({
      applied: false,
      isWorktree: info.isWorktree,
      credentialScriptPath: shims.credentialScriptPath,
      teaShimDir: shims.teaShimDir,
    });

    // Enable per-worktree config extension and set author/committer identity
    const extRes = await this.runGit(cwd, ["config", "extensions.worktreeConfig", "true"]);
    if (!extRes.ok) return failResult();

    const nameRes = await this.runGit(cwd, ["config", "--worktree", "user.name", member.name]);
    if (!nameRes.ok) return failResult();

    const emailRes = await this.runGit(cwd, ["config", "--worktree", "user.email", member.email]);
    if (!emailRes.ok) return failResult();

    // Configure or clear SSH key command
    if (secrets?.sshKeyPath) {
      const sshCommand = buildSshCommand(secrets.sshKeyPath);
      const sshRes = await this.runGit(cwd, [
        "config",
        "--worktree",
        "core.sshCommand",
        sshCommand,
      ]);
      if (!sshRes.ok) return failResult();
    } else {
      const unsetSshRes = await this.runGit(cwd, [
        "config",
        "--worktree",
        "--unset-all",
        "core.sshCommand",
      ]);
      if (!isUnsetOk(unsetSshRes)) return failResult();
    }

    // Reset any prior worktree credential helpers first
    if (!(await this.clearWorktreeCredentialHelpers(cwd))) {
      return failResult();
    }

    // Configure HTTPS credential helper (with leading empty string to override global gh/tea/keychain helpers)
    const effectiveProvider: GitProviderKind =
      secrets?.gitProvider ?? member.gitProvider ?? "gitea";
    const effectiveGiteaUrl = this.resolveEffectiveGiteaUrl(secrets?.giteaUrl, effectiveProvider);
    const parsedGitea = parseGiteaEndpoint(effectiveGiteaUrl);

    if (shims.credentialScriptPath) {
      const helperValue = /\s/.test(shims.credentialScriptPath)
        ? `!${shellQuoteSingle(shims.credentialScriptPath)}`
        : shims.credentialScriptPath;
      const helperKeys = ["credential.helper"];
      if (secrets?.githubToken) {
        helperKeys.push("credential.https://github.com.helper");
      }
      if (secrets?.giteaToken && parsedGitea) {
        helperKeys.push(`credential.${parsedGitea.origin}.helper`);
        if (parsedGitea.baseUrl !== parsedGitea.origin) {
          helperKeys.push(`credential.${parsedGitea.baseUrl}.helper`);
        }
      }
      for (const key of helperKeys) {
        const rReset = await this.runGit(cwd, ["config", "--worktree", "--replace-all", key, ""]);
        const rAdd = await this.runGit(cwd, ["config", "--worktree", "--add", key, helperValue]);
        if (!rReset.ok || !rAdd.ok) {
          return failResult();
        }
      }
    }

    // Reset previous pushInsteadOf rules, then apply ONLY when explicit Forge host matches
    if (!(await this.clearWorktreePushInsteadOf(cwd))) {
      return failResult();
    }

    if (!secrets?.sshKeyPath && (secrets?.giteaToken || secrets?.githubToken)) {
      const originRes = await this.runGit(cwd, ["config", "--get", "remote.origin.url"]);
      const sshRemote =
        originRes.ok && originRes.stdout ? parseSshOriginRemote(originRes.stdout) : null;
      if (sshRemote) {
        let httpsBase: string | null = null;
        if (sshRemote.host === "github.com" && secrets.githubToken) {
          httpsBase = "https://github.com/";
        } else if (secrets.giteaToken && parsedGitea && sshRemote.host === parsedGitea.hostname) {
          httpsBase = `${parsedGitea.baseUrl}/`;
        }

        if (httpsBase) {
          const configKey = `url.${httpsBase}.pushInsteadOf`;
          const rScp = await this.runGit(cwd, [
            "config",
            "--worktree",
            "--replace-all",
            configKey,
            `${sshRemote.user}@${sshRemote.host}:`,
          ]);
          const sshPrefix = sshRemote.port
            ? `ssh://${sshRemote.user}@${sshRemote.host}:${sshRemote.port}/`
            : `ssh://${sshRemote.user}@${sshRemote.host}/`;
          const rUrl = await this.runGit(cwd, [
            "config",
            "--worktree",
            "--add",
            configKey,
            sshPrefix,
          ]);
          if (!rScp.ok || !rUrl.ok) {
            return failResult();
          }
        }
      }
    }

    return {
      applied: true,
      isWorktree: info.isWorktree,
      credentialScriptPath: shims.credentialScriptPath,
      teaShimDir: shims.teaShimDir,
    };
  }
}
