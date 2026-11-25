import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MemberCredentialsInputSchema,
  teamCollabSyncHostAccountsRpc,
  TeamMemberIdSchema,
  TeamMemberProfileSchema,
  type DetectedServerHint,
  type DiscoveredHostAccount,
  type GitProviderKind,
  type MemberCredentialStatus,
  type MemberCredentialsInput,
  type RosterMemberStatus,
  type TeamCollabSyncHostAccountsInput,
  type TeamCollabSyncHostAccountsOutput,
  type TeamMemberProfile,
  type TeamMemberProfileInput,
} from "../shared/contracts.js";
import {
  discoverHostAccountsWithSecrets,
  findHostTeaLoginByName,
  isAlreadyInRoster,
  parseGiteaEndpoint,
  type HostDiscoveryOptions,
} from "./host-discovery.js";

export interface MemberSecretRecord {
  gitProvider?: GitProviderKind;
  httpUsername?: string;
  giteaToken?: string;
  giteaUrl?: string;
  githubToken?: string;
  sshKeyPath?: string;
  updatedAt: string;
}

interface SecretsFilePayload {
  version: 1;
  secrets: Record<string, MemberSecretRecord>;
}

interface RosterFilePayload {
  version: 1;
  members: TeamMemberProfile[];
  removedIds: string[];
}

export function resolveTeamCollabDataDir(customDataDir?: string): string {
  if (customDataDir) {
    return path.resolve(customDataDir);
  }
  const paseoHome = process.env.PASEO_HOME?.trim() || path.join(os.homedir(), ".paseo");
  return path.join(paseoHome, "plugin-data", "team-collab");
}

export function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Ignore chmod error on platforms without POSIX permission bits
  }
}

export function writeFileAtomicSecure(filePath: string, content: string, mode = 0o600): void {
  ensurePrivateDir(path.dirname(filePath));
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = `${filePath}.tmp.${suffix}`;
  fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode });
  try {
    fs.chmodSync(tmpPath, mode);
  } catch {
    // Ignore chmod error if unsupported
  }
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Ignore chmod error if unsupported
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

export function formatSshKeyPathPreview(rawPath: string | undefined): string | null {
  if (!rawPath) {
    return null;
  }
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  const home = os.homedir();
  if (home && trimmed.startsWith(home + path.sep)) {
    return `~${trimmed.slice(home.length)}`;
  }
  if (trimmed.length > 36) {
    return `…/${path.basename(trimmed)}`;
  }
  return trimmed;
}

export interface SecretStoreOptions {
  dataDir?: string;
  hostTeaConfigPaths?: readonly string[];
  hostDiscovery?: HostDiscoveryOptions;
}

export class SecretStore {
  readonly dataDir: string;
  readonly secretsPath: string;
  readonly rosterPath: string;
  private readonly hostTeaConfigPaths?: readonly string[];
  private readonly hostDiscoveryOptions?: HostDiscoveryOptions;
  private seedInFlight: Promise<{
    importedIds: string[];
    discoveredAccounts: DiscoveredHostAccount[];
  }> | null = null;

  constructor(options?: SecretStoreOptions) {
    this.dataDir = resolveTeamCollabDataDir(options?.dataDir);
    this.secretsPath = path.join(this.dataDir, "secrets.json");
    this.rosterPath = path.join(this.dataDir, "roster.json");
    this.hostTeaConfigPaths =
      options?.hostTeaConfigPaths ?? options?.hostDiscovery?.hostTeaConfigPaths;
    this.hostDiscoveryOptions = options?.hostDiscovery;
    ensurePrivateDir(this.dataDir);
  }

  private getMemberGiteaUrlsMap(): Record<string, string | null | undefined> {
    const secrets = this.readSecretsFile().secrets;
    const map: Record<string, string | null | undefined> = {};
    for (const [id, rec] of Object.entries(secrets)) {
      map[id] = rec.giteaUrl ?? null;
    }
    return map;
  }

  private getEffectiveDiscoveryOptions(
    settingsMembers: readonly TeamMemberProfile[] = [],
    overrideOptions?: HostDiscoveryOptions,
  ): HostDiscoveryOptions {
    return {
      ...this.hostDiscoveryOptions,
      ...(this.hostTeaConfigPaths ? { hostTeaConfigPaths: this.hostTeaConfigPaths } : {}),
      ...overrideOptions,
      existingRosterMembers:
        overrideOptions?.existingRosterMembers ?? this.getEffectiveRoster(settingsMembers),
      existingMemberGiteaUrls:
        overrideOptions?.existingMemberGiteaUrls ?? this.getMemberGiteaUrlsMap(),
    };
  }

  private readSecretsFile(): SecretsFilePayload {
    if (!fs.existsSync(this.secretsPath)) {
      return { version: 1, secrets: {} };
    }
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.secretsPath, "utf8"),
      ) as Partial<SecretsFilePayload>;
      if (parsed && typeof parsed.secrets === "object" && parsed.secrets !== null) {
        return { version: 1, secrets: { ...parsed.secrets } };
      }
    } catch {
      // Fall back to empty store on corrupted JSON
    }
    return { version: 1, secrets: {} };
  }

  private writeSecretsFile(payload: SecretsFilePayload): void {
    writeFileAtomicSecure(this.secretsPath, `${JSON.stringify(payload, null, 2)}\n`, 0o600);
  }

  private readRosterFile(): RosterFilePayload {
    if (!fs.existsSync(this.rosterPath)) {
      return { version: 1, members: [], removedIds: [] };
    }
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.rosterPath, "utf8"),
      ) as Partial<RosterFilePayload>;
      const validMembers: TeamMemberProfile[] = [];
      if (Array.isArray(parsed?.members)) {
        for (const item of parsed.members) {
          const check = TeamMemberProfileSchema.safeParse(item);
          if (check.success) {
            validMembers.push(check.data);
          }
        }
      }
      const removedIds = Array.isArray(parsed?.removedIds)
        ? parsed.removedIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      return { version: 1, members: validMembers, removedIds };
    } catch {
      return { version: 1, members: [], removedIds: [] };
    }
  }

  private writeRosterFile(payload: RosterFilePayload): void {
    writeFileAtomicSecure(this.rosterPath, `${JSON.stringify(payload, null, 2)}\n`, 0o600);
  }

  upsertMember(
    memberInput: TeamMemberProfileInput,
    credentials?: MemberCredentialsInput,
  ): RosterMemberStatus {
    let member = TeamMemberProfileSchema.parse(memberInput);
    const validatedCredentials =
      credentials !== undefined ? MemberCredentialsInputSchema.parse(credentials) : undefined;

    const roster = this.readRosterFile();
    const existingIdx = roster.members.findIndex((m) => m.id === member.id);
    const existingMember = existingIdx >= 0 ? roster.members[existingIdx] : undefined;

    const secretsData = this.readSecretsFile();
    const prevSecret = secretsData.secrets[member.id];

    let effectiveGiteaToken = validatedCredentials?.giteaToken;
    let effectiveGiteaUrl = validatedCredentials?.giteaUrl;
    let effectiveGithubToken = validatedCredentials?.githubToken;
    let effectiveSshKeyPath = validatedCredentials?.sshKeyPath;
    let discoveredProvider: GitProviderKind | undefined;

    if (validatedCredentials?.useDiscoveredTeaLogin) {
      const matchedTeaLogin = findHostTeaLoginByName(
        validatedCredentials.useDiscoveredTeaLogin,
        this.hostTeaConfigPaths,
        {
          homeDir: this.hostDiscoveryOptions?.homeDir,
          hostGlabConfigPaths: this.hostDiscoveryOptions?.hostGlabConfigPaths,
          hostGhConfigPaths: this.hostDiscoveryOptions?.hostGhConfigPaths,
        },
      );
      if (!matchedTeaLogin) {
        throw new Error(
          `Host tea login "${validatedCredentials.useDiscoveredTeaLogin}" not found in tea/config.yml`,
        );
      }
      discoveredProvider = matchedTeaLogin.gitProvider ?? "gitea";
      const inferredUsername = matchedTeaLogin.giteaUsername || matchedTeaLogin.loginName;
      if (discoveredProvider === "github") {
        if (!member.githubUsername && inferredUsername) {
          member = { ...member, githubUsername: inferredUsername };
        }
        if (!member.gitUsername && inferredUsername) {
          member = { ...member, gitUsername: inferredUsername };
        }
        if (effectiveGithubToken === undefined && matchedTeaLogin.token) {
          effectiveGithubToken = matchedTeaLogin.token;
        }
      } else {
        if (!member.giteaUsername && inferredUsername) {
          member = { ...member, giteaUsername: inferredUsername };
        }
        if (!member.gitUsername && inferredUsername) {
          member = { ...member, gitUsername: inferredUsername };
        }
        if (effectiveGiteaToken === undefined && matchedTeaLogin.token) {
          effectiveGiteaToken = matchedTeaLogin.token;
        }
        if (effectiveGiteaUrl === undefined && matchedTeaLogin.giteaUrl) {
          effectiveGiteaUrl = matchedTeaLogin.giteaUrl;
        }
      }
      if (effectiveSshKeyPath === undefined && matchedTeaLogin.sshKeyPath) {
        effectiveSshKeyPath = matchedTeaLogin.sshKeyPath;
      }
    }

    const parsedHttpServerUrl = parseGiteaEndpoint(validatedCredentials?.httpServerUrl);
    const isGithubServerUrl =
      parsedHttpServerUrl?.hostname === "github.com" ||
      Boolean(parsedHttpServerUrl?.hostname.endsWith(".github.com"));

    const explicitProvider =
      validatedCredentials?.gitProvider ??
      member.gitProvider ??
      discoveredProvider ??
      (isGithubServerUrl ? "github" : undefined);

    const resolvedProvider: GitProviderKind | undefined =
      explicitProvider ?? prevSecret?.gitProvider ?? existingMember?.gitProvider;

    if (resolvedProvider) {
      member = { ...member, gitProvider: resolvedProvider };
    }

    // Bidirectional sync between gitUsername and giteaUsername / githubUsername
    const targetProvider = resolvedProvider ?? "gitea";
    if (member.gitUsername) {
      if (targetProvider === "github") {
        if (!member.githubUsername) {
          member = { ...member, githubUsername: member.gitUsername };
        }
      } else {
        if (!member.giteaUsername) {
          member = { ...member, giteaUsername: member.gitUsername };
        }
      }
    } else {
      const fallbackUser =
        targetProvider === "github"
          ? (member.githubUsername ?? member.giteaUsername)
          : (member.giteaUsername ?? member.githubUsername);
      if (fallbackUser) {
        member = { ...member, gitUsername: fallbackUser };
      }
    }

    if (validatedCredentials !== undefined) {
      if (targetProvider === "github" || isGithubServerUrl) {
        if (validatedCredentials.httpToken !== undefined && effectiveGithubToken === undefined) {
          effectiveGithubToken = validatedCredentials.httpToken;
        }
        if (
          validatedCredentials.httpServerUrl !== undefined &&
          effectiveGiteaUrl === undefined &&
          !isGithubServerUrl
        ) {
          effectiveGiteaUrl = validatedCredentials.httpServerUrl;
        }
      } else {
        if (validatedCredentials.httpToken !== undefined && effectiveGiteaToken === undefined) {
          effectiveGiteaToken = validatedCredentials.httpToken;
        }
        if (validatedCredentials.httpServerUrl !== undefined && effectiveGiteaUrl === undefined) {
          effectiveGiteaUrl = validatedCredentials.httpServerUrl;
        }
        const hasEffectiveToken = Boolean(
          (effectiveGiteaToken === undefined
            ? prevSecret?.giteaToken
            : effectiveGiteaToken
          )?.trim(),
        );
        const isUrlMissingOrCleared =
          effectiveGiteaUrl === null ||
          (typeof effectiveGiteaUrl === "string" && effectiveGiteaUrl.trim() === "") ||
          (effectiveGiteaUrl === undefined && !prevSecret?.giteaUrl);
        if (targetProvider === "gitlab" && isUrlMissingOrCleared && hasEffectiveToken) {
          effectiveGiteaUrl = "https://gitlab.com";
        }
      }
    }

    // 1. Update public roster.json
    if (existingIdx >= 0) {
      roster.members[existingIdx] = member;
    } else {
      roster.members.push(member);
    }
    roster.removedIds = roster.removedIds.filter((id) => id !== member.id);
    this.writeRosterFile(roster);

    // 2. Update secrets.json (ensure file exists with 0600 permissions)
    const baseSecret = prevSecret ?? { updatedAt: new Date().toISOString() };
    const nextSecret: MemberSecretRecord = { ...baseSecret, updatedAt: new Date().toISOString() };

    if (validatedCredentials !== undefined) {
      const applyField = (
        key: "giteaToken" | "giteaUrl" | "githubToken" | "sshKeyPath",
        raw: string | null | undefined,
      ) => {
        if (raw === undefined) {
          return;
        }
        if (raw === null || raw.trim() === "") {
          delete nextSecret[key];
          return;
        }
        const trimmed = raw.trim();
        if (key === "giteaUrl") {
          const parsed = new URL(trimmed);
          const cleanPath = parsed.pathname.replace(/\/+$/, "");
          nextSecret[key] = `${parsed.origin}${cleanPath}`;
          return;
        }
        nextSecret[key] = trimmed;
      };
      applyField("giteaToken", effectiveGiteaToken);
      applyField("giteaUrl", effectiveGiteaUrl);
      applyField("githubToken", effectiveGithubToken);
      applyField("sshKeyPath", effectiveSshKeyPath);
    }

    if (resolvedProvider) {
      nextSecret.gitProvider = resolvedProvider;
    }
    const effectiveHttpUsername =
      member.gitUsername || member.giteaUsername || member.githubUsername;
    if (effectiveHttpUsername) {
      nextSecret.httpUsername = effectiveHttpUsername;
    } else {
      delete nextSecret.httpUsername;
    }

    const hasAnyValue = Boolean(
      nextSecret.giteaToken ||
      nextSecret.giteaUrl ||
      nextSecret.githubToken ||
      nextSecret.sshKeyPath,
    );
    if (hasAnyValue) {
      secretsData.secrets[member.id] = nextSecret;
    } else {
      delete secretsData.secrets[member.id];
    }
    this.writeSecretsFile(secretsData);

    return {
      ...member,
      credentials: this.toCredentialStatus(secretsData.secrets[member.id], member),
    };
  }

  removeMember(memberIdRaw: string): boolean {
    const memberId = TeamMemberIdSchema.parse(memberIdRaw);
    const roster = this.readRosterFile();
    const secretsData = this.readSecretsFile();

    const beforeLen = roster.members.length;
    roster.members = roster.members.filter((m) => m.id !== memberId);
    const wasInRoster = roster.members.length !== beforeLen;
    const wasInSecrets = Object.prototype.hasOwnProperty.call(secretsData.secrets, memberId);
    const alreadyRemoved = roster.removedIds.includes(memberId);

    if (!alreadyRemoved) {
      roster.removedIds.push(memberId);
    }
    this.writeRosterFile(roster);

    if (wasInSecrets) {
      delete secretsData.secrets[memberId];
      this.writeSecretsFile(secretsData);
    }

    return wasInRoster || wasInSecrets || !alreadyRemoved;
  }

  getEffectiveRoster(settingsMembers: readonly TeamMemberProfile[] = []): TeamMemberProfile[] {
    const roster = this.readRosterFile();
    const removedSet = new Set(roster.removedIds);
    const rosterById = new Map<string, TeamMemberProfile>();
    for (const m of roster.members) {
      rosterById.set(m.id, m);
    }

    const result: TeamMemberProfile[] = [];
    const seen = new Set<string>();

    // Preserve ordering of settingsMembers where not removed, applying roster overrides
    for (const sm of settingsMembers) {
      const parsed = TeamMemberProfileSchema.safeParse(sm);
      if (!parsed.success) continue;
      const id = parsed.data.id;
      if (removedSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(rosterById.get(id) ?? parsed.data);
    }

    // Append members added via roster.json that weren't in settingsMembers
    for (const rm of roster.members) {
      if (removedSet.has(rm.id) || seen.has(rm.id)) continue;
      seen.add(rm.id);
      result.push(rm);
    }

    return result;
  }

  getRosterStatuses(settingsMembers: readonly TeamMemberProfile[] = []): RosterMemberStatus[] {
    const members = this.getEffectiveRoster(settingsMembers);
    const secretsData = this.readSecretsFile();
    return members.map((member) => ({
      ...member,
      credentials: this.toCredentialStatus(secretsData.secrets[member.id], member),
    }));
  }

  getCredentialStatus(memberId: string): MemberCredentialStatus {
    const secretsData = this.readSecretsFile();
    const roster = this.readRosterFile();
    const member = roster.members.find((m) => m.id === memberId);
    return this.toCredentialStatus(secretsData.secrets[memberId], member);
  }

  getMemberSecrets(memberId: string): MemberSecretRecord | null {
    const secretsData = this.readSecretsFile();
    const rec = secretsData.secrets[memberId];
    return rec ? { ...rec } : null;
  }

  getRemovedIds(): string[] {
    return this.readRosterFile().removedIds;
  }

  async discoverHostAccounts(
    settingsMembers: readonly TeamMemberProfile[] = [],
    overrideOptions?: HostDiscoveryOptions,
  ): Promise<DiscoveredHostAccount[]> {
    const discovered = await discoverHostAccountsWithSecrets(
      this.getEffectiveDiscoveryOptions(settingsMembers, overrideOptions),
    );
    return discovered.map((item) => item.publicAccount);
  }

  async seedHostAccountsIfNeeded(
    settingsMembers: readonly TeamMemberProfile[] = [],
    overrideOptions?: HostDiscoveryOptions,
  ): Promise<{ importedIds: string[]; discoveredAccounts: DiscoveredHostAccount[] }> {
    if (this.seedInFlight) {
      return this.seedInFlight;
    }
    this.seedInFlight = this.runSeedHostAccountsIfNeeded(settingsMembers, overrideOptions).finally(
      () => {
        this.seedInFlight = null;
      },
    );
    return this.seedInFlight;
  }

  private async runSeedHostAccountsIfNeeded(
    settingsMembers: readonly TeamMemberProfile[] = [],
    overrideOptions?: HostDiscoveryOptions,
  ): Promise<{ importedIds: string[]; discoveredAccounts: DiscoveredHostAccount[] }> {
    const discovered = await discoverHostAccountsWithSecrets(
      this.getEffectiveDiscoveryOptions(settingsMembers, overrideOptions),
    );

    // Re-read latest roster & removedIds from disk AFTER async discovery completes to prevent TOCTOU races
    let latestRoster = this.getEffectiveRoster(settingsMembers);
    const latestRemovedSet = new Set(this.getRemovedIds());
    let latestGiteaUrls = this.getMemberGiteaUrlsMap();

    const importedIds: string[] = [];

    if (latestRoster.length === 0) {
      for (const item of discovered) {
        const acc = item.publicAccount;
        if (acc.source !== "tea" && acc.source !== "glab" && acc.source !== "gh") {
          continue;
        }
        const alreadyPresent = isAlreadyInRoster(acc.suggestedId, acc.giteaUsername, latestRoster, {
          giteaUrl: acc.giteaUrl,
          memberGiteaUrls: latestGiteaUrls,
        });
        if (alreadyPresent || latestRemovedSet.has(acc.suggestedId)) {
          continue;
        }
        const accProvider = acc.gitProvider ?? "gitea";
        this.upsertMember(
          {
            id: acc.suggestedId,
            name: acc.suggestedName,
            email: acc.suggestedEmail,
            ...(accProvider !== "gitea" ? { gitProvider: accProvider } : {}),
            ...(acc.giteaUsername
              ? accProvider === "github"
                ? { githubUsername: acc.giteaUsername, gitUsername: acc.giteaUsername }
                : { giteaUsername: acc.giteaUsername }
              : {}),
            enabled: true,
          },
          accProvider === "github"
            ? {
                gitProvider: "github",
                githubToken: item.rawToken ?? undefined,
                sshKeyPath: item.rawSshKeyPath ?? undefined,
              }
            : {
                ...(accProvider !== "gitea" ? { gitProvider: accProvider } : {}),
                giteaToken: item.rawToken ?? undefined,
                giteaUrl: acc.giteaUrl ?? undefined,
                sshKeyPath: item.rawSshKeyPath ?? undefined,
              },
        );
        importedIds.push(acc.suggestedId);
        latestRoster = this.getEffectiveRoster(settingsMembers);
        latestGiteaUrls = this.getMemberGiteaUrlsMap();
      }
    }

    const finalRoster = this.getEffectiveRoster(settingsMembers);
    const finalGiteaUrls = this.getMemberGiteaUrlsMap();
    const discoveredAccounts = discovered.map((item) => ({
      ...item.publicAccount,
      alreadyInRoster: isAlreadyInRoster(
        item.publicAccount.suggestedId,
        item.publicAccount.giteaUsername,
        finalRoster,
        {
          giteaUrl: item.publicAccount.giteaUrl,
          memberGiteaUrls: finalGiteaUrls,
        },
      ),
    }));

    return {
      importedIds,
      discoveredAccounts,
    };
  }

  private findMatchingRosterMember(
    acc: DiscoveredHostAccount,
    roster: readonly TeamMemberProfile[],
    memberGiteaUrls: Readonly<Record<string, string | null | undefined>>,
  ): TeamMemberProfile | undefined {
    const byId = roster.find((m) => m.id === acc.suggestedId);
    if (byId) {
      return byId;
    }
    if (!acc.giteaUsername) {
      return undefined;
    }
    const lowerUser = acc.giteaUsername.toLowerCase();
    const accProvider = acc.gitProvider ?? "gitea";
    const normalizedAccUrl = parseGiteaEndpoint(acc.giteaUrl)?.baseUrl ?? null;
    return roster.find((m) => {
      const candidateUser = (m.gitUsername || m.giteaUsername || m.githubUsername)?.toLowerCase();
      const matchesUser =
        candidateUser === lowerUser ||
        m.gitUsername?.toLowerCase() === lowerUser ||
        m.giteaUsername?.toLowerCase() === lowerUser ||
        m.githubUsername?.toLowerCase() === lowerUser;
      if (!matchesUser) {
        return false;
      }
      if (accProvider === "github") {
        return m.gitProvider === "github" || Boolean(m.githubUsername);
      }
      const normalizedExistingUrl = parseGiteaEndpoint(memberGiteaUrls[m.id])?.baseUrl ?? null;
      if (normalizedExistingUrl && normalizedAccUrl && normalizedExistingUrl !== normalizedAccUrl) {
        return false;
      }
      return true;
    });
  }

  async syncHostAccounts(
    rawInput?: TeamCollabSyncHostAccountsInput,
    settingsMembers: readonly TeamMemberProfile[] = [],
    overrideOptions?: HostDiscoveryOptions,
  ): Promise<TeamCollabSyncHostAccountsOutput> {
    const input = teamCollabSyncHostAccountsRpc.input.parse(rawInput);
    const discovered = await discoverHostAccountsWithSecrets(
      this.getEffectiveDiscoveryOptions(settingsMembers, overrideOptions),
    );

    // Re-read latest roster & removedIds from disk AFTER async discovery completes to prevent TOCTOU races
    let latestRoster = this.getEffectiveRoster(settingsMembers);
    const latestRemovedSet = new Set(this.getRemovedIds());
    let latestGiteaUrls = this.getMemberGiteaUrlsMap();

    const hasExplicitFilter = input.loginNames !== undefined;
    const requestedSet = new Set(
      (input.loginNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
    );

    const importedIds: string[] = [];

    for (const item of discovered) {
      const acc = item.publicAccount;
      const currentlyInRoster = isAlreadyInRoster(
        acc.suggestedId,
        acc.giteaUsername,
        latestRoster,
        {
          giteaUrl: acc.giteaUrl,
          memberGiteaUrls: latestGiteaUrls,
        },
      );

      if (hasExplicitFilter) {
        const lowerLogin = acc.loginName.toLowerCase();
        const lowerSuggestedId = acc.suggestedId.toLowerCase();
        const lowerUser = acc.giteaUsername?.toLowerCase();
        const lowerSource = acc.source.toLowerCase();
        const matchesRequested =
          requestedSet.has(lowerLogin) ||
          requestedSet.has(lowerSuggestedId) ||
          (lowerUser ? requestedSet.has(lowerUser) : false) ||
          requestedSet.has(`${lowerSource}:${lowerLogin}`) ||
          requestedSet.has(`${lowerSource}:${lowerSuggestedId}`) ||
          (lowerUser ? requestedSet.has(`${lowerSource}:${lowerUser}`) : false) ||
          (acc.source === "git-global" && requestedSet.has("git-global"));
        if (!matchesRequested) {
          continue;
        }
      } else {
        if (latestRemovedSet.has(acc.suggestedId)) {
          continue;
        }
        if (currentlyInRoster && !input.overwriteExistingCredentials) {
          continue;
        }
      }

      const existingMember = this.findMatchingRosterMember(acc, latestRoster, latestGiteaUrls);
      const accProvider = acc.gitProvider ?? "gitea";

      if (existingMember) {
        const existingSecrets = this.getMemberSecrets(existingMember.id);
        const shouldOverwrite = input.overwriteExistingCredentials;
        const nextProfile: TeamMemberProfileInput = { ...existingMember };
        if (!existingMember.gitProvider && accProvider !== "gitea") {
          nextProfile.gitProvider = accProvider;
        }
        if (acc.giteaUsername) {
          if (!existingMember.gitUsername) {
            nextProfile.gitUsername = acc.giteaUsername;
          }
          if (accProvider === "github") {
            if (!existingMember.githubUsername) {
              nextProfile.githubUsername = acc.giteaUsername;
            }
          } else if (!existingMember.giteaUsername) {
            nextProfile.giteaUsername = acc.giteaUsername;
          }
        }
        this.upsertMember(
          nextProfile,
          accProvider === "github"
            ? {
                gitProvider: "github",
                githubToken:
                  shouldOverwrite || !existingSecrets?.githubToken
                    ? (item.rawToken ?? undefined)
                    : undefined,
                sshKeyPath:
                  shouldOverwrite || !existingSecrets?.sshKeyPath
                    ? (item.rawSshKeyPath ?? undefined)
                    : undefined,
              }
            : {
                ...(accProvider !== "gitea" ? { gitProvider: accProvider } : {}),
                giteaToken:
                  shouldOverwrite || !existingSecrets?.giteaToken
                    ? (item.rawToken ?? undefined)
                    : undefined,
                giteaUrl:
                  shouldOverwrite || !existingSecrets?.giteaUrl
                    ? (acc.giteaUrl ?? undefined)
                    : undefined,
                sshKeyPath:
                  shouldOverwrite || !existingSecrets?.sshKeyPath
                    ? (item.rawSshKeyPath ?? undefined)
                    : undefined,
              },
        );
        importedIds.push(existingMember.id);
      } else {
        this.upsertMember(
          {
            id: acc.suggestedId,
            name: acc.suggestedName,
            email: acc.suggestedEmail,
            ...(accProvider !== "gitea" ? { gitProvider: accProvider } : {}),
            ...(acc.giteaUsername
              ? accProvider === "github"
                ? { githubUsername: acc.giteaUsername, gitUsername: acc.giteaUsername }
                : { giteaUsername: acc.giteaUsername }
              : {}),
            enabled: true,
          },
          accProvider === "github"
            ? {
                gitProvider: "github",
                githubToken: item.rawToken ?? undefined,
                sshKeyPath: item.rawSshKeyPath ?? undefined,
              }
            : {
                ...(accProvider !== "gitea" ? { gitProvider: accProvider } : {}),
                giteaToken: item.rawToken ?? undefined,
                giteaUrl: acc.giteaUrl ?? undefined,
                sshKeyPath: item.rawSshKeyPath ?? undefined,
              },
        );
        importedIds.push(acc.suggestedId);
      }
      latestRoster = this.getEffectiveRoster(settingsMembers);
      latestGiteaUrls = this.getMemberGiteaUrlsMap();
    }

    const finalRoster = this.getEffectiveRoster(settingsMembers);
    const finalGiteaUrls = this.getMemberGiteaUrlsMap();
    const members = this.getRosterStatuses(settingsMembers);
    const discoveredAccounts = discovered.map((item) => ({
      ...item.publicAccount,
      alreadyInRoster: isAlreadyInRoster(
        item.publicAccount.suggestedId,
        item.publicAccount.giteaUsername,
        finalRoster,
        {
          giteaUrl: item.publicAccount.giteaUrl,
          memberGiteaUrls: finalGiteaUrls,
        },
      ),
    }));

    return {
      importedIds,
      members,
      discoveredAccounts,
    };
  }

  detectServerHint(
    discoveredAccounts: readonly DiscoveredHostAccount[] = [],
    rosterStatuses: readonly RosterMemberStatus[] = [],
  ): DetectedServerHint | null {
    const defaultDiscovered =
      discoveredAccounts.find((a) => a.isDefault && a.giteaUrl) ??
      discoveredAccounts.find((a) => Boolean(a.giteaUrl));
    if (defaultDiscovered?.giteaUrl) {
      return {
        gitProvider: defaultDiscovered.gitProvider ?? "gitea",
        serverUrl: defaultDiscovered.giteaUrl,
      };
    }
    for (const member of rosterStatuses) {
      if (member.credentials.httpServerUrl) {
        return {
          gitProvider: member.credentials.gitProvider ?? member.gitProvider ?? "gitea",
          serverUrl: member.credentials.httpServerUrl,
        };
      }
    }
    return null;
  }

  private toCredentialStatus(
    rec?: MemberSecretRecord,
    member?: TeamMemberProfile,
  ): MemberCredentialStatus {
    const giteaTokenPreview = maskSecret(rec?.giteaToken);
    const githubTokenPreview = maskSecret(rec?.githubToken);
    const sshKeyPathPreview = formatSshKeyPathPreview(rec?.sshKeyPath);
    const hasGiteaToken = giteaTokenPreview !== null;
    const hasGithubToken = githubTokenPreview !== null;
    const hasSshKey = sshKeyPathPreview !== null;

    const gitProvider: GitProviderKind =
      rec?.gitProvider ??
      member?.gitProvider ??
      (hasGithubToken && !hasGiteaToken && !rec?.giteaUrl ? "github" : "gitea");

    const hasHttpToken = hasGiteaToken || hasGithubToken;
    const httpTokenPreview =
      gitProvider === "github"
        ? (githubTokenPreview ?? giteaTokenPreview)
        : (giteaTokenPreview ?? githubTokenPreview);

    let httpServerUrl: string | null = rec?.giteaUrl ?? null;
    if (!httpServerUrl) {
      if (gitProvider === "github" || (hasGithubToken && !hasGiteaToken)) {
        httpServerUrl = "https://github.com";
      } else if (gitProvider === "gitlab" && hasGiteaToken) {
        httpServerUrl = "https://gitlab.com";
      }
    }

    return {
      gitProvider,
      hasHttpToken,
      httpTokenPreview,
      httpServerUrl,
      hasGiteaToken,
      giteaTokenPreview,
      giteaUrl: rec?.giteaUrl ?? null,
      hasGithubToken,
      githubTokenPreview,
      hasSshKey,
      sshKeyPathPreview,
    };
  }
}
