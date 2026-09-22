import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  parseGitRemoteLocation,
  parseGitHubRemoteIdentity,
  type GitRemoteLocation,
  type GitHubRemoteIdentity,
} from "@getpaseo/protocol/git-remote";
import type { ResolvedProjectGitea } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export interface ProjectGiteaResolverOptions {
  resolveGitRemote?: (cwd: string) => Promise<string | null>;
  runTea?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  resolveSshHost?: (host: string) => Promise<string | null>;
  probeUrl?: (url: string) => Promise<boolean>;
  readTeaConfig?: () => TeaLoginEntry[];
  env?: NodeJS.ProcessEnv;
}

interface TeaLoginEntry {
  name?: string;
  url?: string;
  ssh_host?: string;
  token?: string;
}

export class ProjectGiteaResolver {
  private readonly resolveGitRemote: (cwd: string) => Promise<string | null>;
  private readonly runTea: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  private readonly resolveSshHost: (host: string) => Promise<string | null>;
  private readonly probeUrl: (url: string) => Promise<boolean>;
  private readonly readTeaConfig?: () => TeaLoginEntry[];
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: ProjectGiteaResolverOptions = {}) {
    this.env = options.env ?? process.env;

    this.resolveGitRemote =
      options.resolveGitRemote ??
      (async (cwd: string) => {
        try {
          const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
            cwd,
            timeout: 5000,
          });
          return stdout.trim() || null;
        } catch {
          return null;
        }
      });

    this.runTea =
      options.runTea ??
      (async (args: string[]) => {
        const { stdout, stderr } = await execFileAsync("tea", args, {
          timeout: 5000,
        });
        return { stdout, stderr };
      });

    this.resolveSshHost =
      options.resolveSshHost ??
      (async (host: string) => {
        try {
          const { stdout } = await execFileAsync("ssh", ["-G", host], {
            timeout: 5000,
          });
          for (const line of stdout.split(/\r?\n/u)) {
            const trimmed = line.trim();
            const [key, value] = trimmed.split(/\s+/u);
            if (key?.toLowerCase() === "hostname" && value) {
              return value.toLowerCase();
            }
          }
        } catch {
          // ignore ssh error
        }
        return host.toLowerCase();
      });

    this.readTeaConfig = options.readTeaConfig;
    this.probeUrl =
      options.probeUrl ??
      (async (url: string) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`${url.replace(/\/+$/, "")}/api/v1/version`, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          }).finally(() => clearTimeout(timer));
          if (res.ok) {
            const data = (await res.json()) as { version?: string };
            return typeof data.version === "string";
          }
          return false;
        } catch {
          return false;
        }
      });
  }

  private readTeaConfigLogins(): TeaLoginEntry[] {
    const home = homedir();
    const configCandidates = [
      join(home, "Library/Application Support/tea/config.yml"),
      join(home, ".config/tea/config.yml"),
      join(this.env.APPDATA || home, "tea/config.yml"),
    ];

    for (const p of configCandidates) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf8");
          const logins: TeaLoginEntry[] = [];
          const blocks = raw.split(/\n\s*-\s+name:\s*/);
          for (let i = 1; i < blocks.length; i++) {
            const b = blocks[i];
            const name = b
              .split("\n")[0]
              .trim()
              .replace(/^["'`]|["'`]$/g, "");
            const urlMatch = b.match(/url:\s*(.+)/);
            const tokenMatch = b.match(/token:\s*(.+)/);
            const sshMatch = b.match(/ssh_host:\s*(.+)/);
            logins.push({
              name,
              url: urlMatch ? urlMatch[1].trim().replace(/^["'`]|["'`]$/g, "") : undefined,
              token: tokenMatch ? tokenMatch[1].trim().replace(/^["'`]|["'`]$/g, "") : undefined,
              ssh_host: sshMatch ? sshMatch[1].trim().replace(/^["'`]|["'`]$/g, "") : undefined,
            });
          }
          if (logins.length > 0) return logins;
        } catch {
          // ignore read error
        }
      }
    }
    return [];
  }

  private async fetchTeaLogins(): Promise<TeaLoginEntry[]> {
    const results: TeaLoginEntry[] = [];
    // 1. Direct zero-config read from tea's config.yml (contains the actual auth token)
    const fileLogins = this.readTeaConfig ? this.readTeaConfig() : this.readTeaConfigLogins();
    results.push(...fileLogins);

    // 2. CLI output fallback or supplement (when config file is not at standard path or mock runner is provided)
    try {
      const { stdout } = await this.runTea(["login", "list", "-o", "json"]);
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            !results.some((r) => (r.name && r.name === item.name) || (r.url && r.url === item.url))
          ) {
            results.push(item);
          }
        }
      }
    } catch {
      // ignore cli error
    }

    return results;
  }

  private async resolveEffectiveHost(location: GitRemoteLocation): Promise<string> {
    let effectiveHost = location.host.toLowerCase();
    if (location.transport === "ssh" || location.transport === "scp") {
      const sshResolved = await this.resolveSshHost(effectiveHost);
      if (sshResolved) {
        effectiveHost = sshResolved;
      }
    }
    return effectiveHost;
  }

  private async findMatchingTeaLogin(effectiveHost: string): Promise<TeaLoginEntry | null> {
    const teaLogins = await this.fetchTeaLogins();
    return (
      teaLogins.find((login) => {
        const candidates: string[] = [];
        if (login.ssh_host) candidates.push(login.ssh_host.toLowerCase());
        if (login.name) candidates.push(login.name.toLowerCase());
        if (login.url) {
          try {
            candidates.push(new URL(login.url).hostname.toLowerCase());
          } catch {
            // ignore invalid url
          }
        }
        return candidates.includes(effectiveHost);
      }) ?? null
    );
  }

  private async probeCandidateUrls(host: string): Promise<string | null> {
    const candidates = [`https://${host}`, `http://${host}`, `http://${host}:3000`];
    for (const candidate of candidates) {
      if (await this.probeUrl(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private async determineBaseUrl(
    effectiveHost: string,
    location: GitRemoteLocation,
    matchedLogin: TeaLoginEntry | null,
  ): Promise<string | null> {
    if (location.transport === "http" || location.transport === "https") {
      const portPart = location.port ? `:${location.port}` : "";
      return `${location.transport}://${location.host}${portPart}`;
    }
    if (matchedLogin?.url) {
      return matchedLogin.url.replace(/\/+$/, "");
    }
    return this.probeCandidateUrls(effectiveHost);
  }

  private resolveToken(effectiveHost: string, matchedLogin: TeaLoginEntry | null): string {
    const normalizedHostKey = effectiveHost.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return (
      this.env[`GITEA_TOKEN_${normalizedHostKey}`] ||
      this.env.GITEA_TOKEN ||
      matchedLogin?.token ||
      ""
    );
  }

  async resolveProject(project: {
    projectId: string;
    projectRootPath: string;
    projectDisplayName?: string;
  }): Promise<ResolvedProjectGitea | null> {
    const remoteUrl = await this.resolveGitRemote(project.projectRootPath);
    if (!remoteUrl) return null;

    const location = parseGitRemoteLocation(remoteUrl);
    if (!location) return null;

    const identity: GitHubRemoteIdentity | null = parseGitHubRemoteIdentity(location.path);
    if (!identity) return null;

    const effectiveHost = await this.resolveEffectiveHost(location);
    if (effectiveHost === "github.com" || effectiveHost === "gitlab.com") {
      return null;
    }

    const matchedLogin = await this.findMatchingTeaLogin(effectiveHost);
    if (matchedLogin?.url && matchedLogin.token) {
      return {
        projectId: project.projectId,
        projectPath: project.projectRootPath,
        projectName: project.projectDisplayName || identity.name,
        host: effectiveHost,
        baseUrl: matchedLogin.url.replace(/\/+$/, ""),
        token: matchedLogin.token,
        repoOwner: identity.owner,
        repoName: identity.name,
        authSource: "tea",
      };
    }

    const baseUrl = await this.determineBaseUrl(effectiveHost, location, matchedLogin);
    if (!baseUrl) return null;

    const token = this.resolveToken(effectiveHost, matchedLogin);

    return {
      projectId: project.projectId,
      projectPath: project.projectRootPath,
      projectName: project.projectDisplayName || identity.name,
      host: effectiveHost,
      baseUrl,
      token,
      repoOwner: identity.owner,
      repoName: identity.name,
      authSource: token ? "env" : "anonymous",
    };
  }
}
