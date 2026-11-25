import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.js";
import { discoverHostAccounts, discoverHostSshKeys } from "../server/host-discovery.js";
import { maskSecret, SecretStore } from "../server/secret-store.js";
import {
  DEFAULT_TEAM_COLLAB_SETTINGS,
  DiscoveredHostAccountSchema,
  MemberCredentialsInputSchema,
  parseWorkspaceOwnerMetadata,
  SYSTEM_BOT_MEMBER_ID,
  teamCollabMemberRemoveRpc,
  teamCollabMemberUpsertRpc,
  teamCollabRosterStatusRpc,
  teamCollabSyncHostAccountsRpc,
  WorkspaceOwnerMetadataSchema,
} from "../shared/contracts.js";

describe("SecretStore & maskSecret", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-collab-secrets-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("masks secrets according to length thresholds without exposing raw tokens", () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
    expect(maskSecret("")).toBeNull();
    expect(maskSecret("   ")).toBeNull();
    expect(maskSecret("abc")).toBe("••••");
    expect(maskSecret("1234567")).toBe("••••");
    expect(maskSecret("12345678")).toBe("••••5678");
    expect(maskSecret("ghp_superSecretToken9876")).toBe("••••9876");
  });

  it("writes roster.json and secrets.json atomically with 0600 permissions inside a 0700 dataDir", () => {
    const dataDir = path.join(tempDir, "plugin-data", "team-collab");
    const store = new SecretStore({ dataDir });

    const created = store.upsertMember(
      {
        id: "alice",
        name: "Alice Chen",
        email: "alice@example.com",
        giteaUsername: "alice",
        githubUsername: "alice-gh",
        enabled: true,
      },
      {
        giteaToken: "gta_0123456789abcdef",
        giteaUrl: "https://git.example.com",
        githubToken: "ghp_fedcba9876543210",
        sshKeyPath: "/Users/alice/.ssh/id_ed25519_alice",
      },
    );

    expect(created.id).toBe("alice");
    expect(created.credentials).toEqual({
      gitProvider: "gitea",
      hasHttpToken: true,
      httpTokenPreview: "••••cdef",
      httpServerUrl: "https://git.example.com",
      hasGiteaToken: true,
      giteaTokenPreview: "••••cdef",
      giteaUrl: "https://git.example.com",
      hasGithubToken: true,
      githubTokenPreview: "••••3210",
      hasSshKey: true,
      sshKeyPathPreview: expect.any(String),
    });

    // Public status serialization must never leak raw secret strings
    const serialized = JSON.stringify(store.getRosterStatuses());
    expect(serialized).not.toContain("gta_0123456789abcdef");
    expect(serialized).not.toContain("ghp_fedcba9876543210");

    const dirMode = fs.statSync(dataDir).mode & 0o777;
    const secretsMode = fs.statSync(store.secretsPath).mode & 0o777;
    const rosterMode = fs.statSync(store.rosterPath).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(secretsMode).toBe(0o600);
    expect(rosterMode).toBe(0o600);

    // Public roster.json must also never contain secrets
    const rawRosterJson = fs.readFileSync(store.rosterPath, "utf8");
    expect(rawRosterJson).not.toContain("gta_0123456789abcdef");
    expect(rawRosterJson).not.toContain("ghp_fedcba9876543210");
  });

  it("preserves existing secrets when credential fields are undefined and clears them when null or empty", () => {
    const store = new SecretStore({ dataDir: path.join(tempDir, "data") });

    store.upsertMember(
      {
        id: "bob",
        name: "Bob Li",
        email: "bob@example.com",
      },
      {
        giteaToken: "gta_initial_secret_1111",
        githubToken: "ghp_initial_secret_2222",
        sshKeyPath: "/tmp/id_ed25519_bob",
      },
    );

    // Update profile with credentials omitted -> all secrets preserved
    const afterProfileEdit = store.upsertMember({
      id: "bob",
      name: "Bob Li Updated",
      email: "bob@example.com",
    });
    expect(afterProfileEdit.name).toBe("Bob Li Updated");
    expect(afterProfileEdit.credentials.giteaTokenPreview).toBe("••••1111");
    expect(afterProfileEdit.credentials.githubTokenPreview).toBe("••••2222");
    expect(afterProfileEdit.credentials.hasSshKey).toBe(true);

    // Pass undefined for giteaToken, "" for githubToken, null for sshKeyPath
    const afterPartialClear = store.upsertMember(
      {
        id: "bob",
        name: "Bob Li Updated",
        email: "bob@example.com",
      },
      {
        giteaToken: undefined,
        githubToken: "",
        sshKeyPath: null,
      },
    );
    expect(afterPartialClear.credentials.hasGiteaToken).toBe(true);
    expect(afterPartialClear.credentials.giteaTokenPreview).toBe("••••1111");
    expect(afterPartialClear.credentials.hasGithubToken).toBe(false);
    expect(afterPartialClear.credentials.githubTokenPreview).toBeNull();
    expect(afterPartialClear.credentials.hasSshKey).toBe(false);
    expect(afterPartialClear.credentials.sshKeyPathPreview).toBeNull();

    expect(store.getMemberSecrets("bob")).toMatchObject({
      giteaToken: "gta_initial_secret_1111",
    });
    expect(store.getMemberSecrets("bob")?.githubToken).toBeUndefined();
    expect(store.getMemberSecrets("bob")?.sshKeyPath).toBeUndefined();
  });

  it("merges settings members with roster.json and removes both profile and secrets on removeMember", () => {
    const store = new SecretStore({ dataDir: path.join(tempDir, "data") });

    const settingsMembers = [
      {
        id: "charlie",
        name: "Charlie From Settings",
        email: "charlie@example.com",
        enabled: true,
      },
      {
        id: "dana",
        name: "Dana From Settings",
        email: "dana@example.com",
        enabled: true,
      },
    ];

    store.upsertMember(
      {
        id: "charlie",
        name: "Charlie Overridden",
        email: "charlie@example.com",
        enabled: true,
      },
      { giteaToken: "gta_charlie_9999" },
    );

    const merged = store.getRosterStatuses(settingsMembers);
    expect(merged.map((m) => m.id)).toEqual(["charlie", "dana"]);
    expect(merged[0].name).toBe("Charlie Overridden");
    expect(merged[0].credentials.giteaTokenPreview).toBe("••••9999");

    // Removing both a roster-saved member and a settings-supplied member suppresses resurrection
    expect(store.removeMember("charlie")).toBe(true);
    expect(store.removeMember("dana")).toBe(true);
    expect(store.getMemberSecrets("charlie")).toBeNull();
    expect(store.getRosterStatuses(settingsMembers)).toEqual([]);
  });

  it("enforces strict slug / system-bot validation on WorkspaceOwnerMetadataSchema.id to block path traversal", () => {
    expect(
      WorkspaceOwnerMetadataSchema.safeParse({
        id: SYSTEM_BOT_MEMBER_ID,
        name: "System Bot",
        email: "bot@paseo.local",
        kind: "bot",
        assignedAt: "2026-11-24T00:00:00.000Z",
      }).success,
    ).toBe(true);

    expect(
      WorkspaceOwnerMetadataSchema.safeParse({
        id: "../escape",
        name: "Attacker",
        email: "evil@example.com",
        kind: "member",
        assignedAt: "2026-11-24T00:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      parseWorkspaceOwnerMetadata({
        "team-collab.owner": {
          id: "alice/../../etc",
          name: "Traversal",
          email: "evil@example.com",
          kind: "member",
          assignedAt: "2026-11-24T00:00:00.000Z",
        },
      }),
    ).toBeNull();
  });

  it("rejects control characters in credentials and requires valid http/https URLs for non-empty giteaUrl", () => {
    const store = new SecretStore({ dataDir: path.join(tempDir, "data-strict") });
    const baseMember = {
      id: "frank",
      name: "Frank",
      email: "frank@example.com",
    };

    expect(() =>
      store.upsertMember(baseMember, {
        giteaToken: "gta_bad\nprotocol=https",
      }),
    ).toThrow();

    expect(() =>
      store.upsertMember(baseMember, {
        githubToken: "ghp_bad\r\ninjected",
      }),
    ).toThrow();

    expect(() =>
      store.upsertMember(baseMember, {
        sshKeyPath: "/tmp/id_ed25519\0evil",
      }),
    ).toThrow();

    expect(() =>
      store.upsertMember(baseMember, {
        giteaUrl: "javascript:alert(1)",
      }),
    ).toThrow();

    expect(() =>
      store.upsertMember(baseMember, {
        giteaUrl: "not-a-valid-url",
      }),
    ).toThrow();

    expect(
      MemberCredentialsInputSchema.safeParse({ giteaUrl: "ftp://git.example.com" }).success,
    ).toBe(false);
    expect(
      MemberCredentialsInputSchema.safeParse({ giteaUrl: "https://git.example.com:3000/gitea" })
        .success,
    ).toBe(true);
    expect(MemberCredentialsInputSchema.safeParse({ giteaUrl: "" }).success).toBe(true);
    expect(MemberCredentialsInputSchema.safeParse({ giteaUrl: null }).success).toBe(true);
  });

  it("extracts DiscoveredHostAccount entries from multi-login tea/config.yml and git config --global with masked token previews", async () => {
    const existingSshKey = path.join(tempDir, "id_ed25519_jerry");
    fs.writeFileSync(existingSshKey, "PRIVATE KEY CONTENT", { mode: 0o600 });
    const missingSshKey = path.join(tempDir, "nonexistent_id_rsa");

    const teaConfigPath = path.join(tempDir, "tea-config.yml");
    fs.writeFileSync(
      teaConfigPath,
      [
        "logins:",
        "- name: Corp-Gitea",
        "  url: https://git.corp.example.com:8443/subpath/",
        "  token: gta_jerry_super_secret_token_9876",
        "  default: true",
        "  user: Jerry.Chen",
        `  ssh_key: ${existingSshKey}`,
        "- name: lab-bot",
        "  url: http://10.0.0.15:3000/",
        "  token: gta_bot_secret_token_5432",
        "  default: false",
        "  user: CI_Bot",
        `  ssh_key: ${missingSshKey}`,
      ].join("\n"),
      "utf8",
    );

    const accounts = await discoverHostAccounts({
      hostTeaConfigPaths: [teaConfigPath],
      gitGlobalIdentity: {
        name: "Jerry.Chen",
        email: "jerry.chen@corp.example.com",
      },
      skipNetworkFetch: true,
      existingRosterMembers: [],
    });

    expect(accounts).toHaveLength(2);
    for (const acc of accounts) {
      expect(DiscoveredHostAccountSchema.safeParse(acc).success).toBe(true);
    }

    const serialized = JSON.stringify(accounts);
    expect(serialized).not.toContain("gta_jerry_super_secret_token_9876");
    expect(serialized).not.toContain("gta_bot_secret_token_5432");

    expect(accounts[0]).toEqual({
      source: "tea",
      gitProvider: "gitea",
      loginName: "Corp-Gitea",
      suggestedId: "jerry.chen",
      suggestedName: "Jerry.Chen",
      suggestedEmail: "jerry.chen@corp.example.com",
      giteaUrl: "https://git.corp.example.com:8443/subpath",
      giteaUsername: "Jerry.Chen",
      hasToken: true,
      tokenPreview: "••••9876",
      hasSshKey: true,
      sshKeyPathPreview: expect.any(String),
      isDefault: true,
      alreadyInRoster: false,
    });

    expect(accounts[1]).toEqual({
      source: "tea",
      gitProvider: "gitea",
      loginName: "lab-bot",
      suggestedId: "ci_bot",
      suggestedName: "CI_Bot",
      suggestedEmail: "CI_Bot@10.0.0.15",
      giteaUrl: "http://10.0.0.15:3000",
      giteaUsername: "CI_Bot",
      hasToken: true,
      tokenPreview: "••••5432",
      hasSshKey: false,
      sshKeyPathPreview: null,
      isDefault: false,
      alreadyInRoster: false,
    });

    // When Gitea API fetchUserProfile returns full_name & email, it takes priority over git-global/fallback
    const apiEnriched = await discoverHostAccounts({
      hostTeaConfigPaths: [teaConfigPath],
      gitGlobalIdentity: {
        name: "Jerry.Chen",
        email: "jerry.chen@corp.example.com",
      },
      fetchUserProfile: async ({ loginName }) => {
        if (loginName === "lab-bot") {
          return {
            login: "ci_bot",
            full_name: "Lab Automation Bot",
            email: "ci-bot@lab.example.com",
          };
        }
        return null;
      },
      existingRosterMembers: [
        {
          id: "jerry.chen",
          name: "Jerry",
          email: "jerry.chen@corp.example.com",
          enabled: true,
        },
      ],
    });

    expect(apiEnriched[0].alreadyInRoster).toBe(true);
    expect(apiEnriched[1]).toMatchObject({
      suggestedId: "ci_bot",
      suggestedName: "Lab Automation Bot",
      suggestedEmail: "ci-bot@lab.example.com",
      alreadyInRoster: false,
    });
  });

  it("auto-seeds tea accounts into 0600 secrets.json on status query, prevents ghost resurrection after removeMember, and re-imports on explicit teamCollabSyncHostAccountsRpc", async () => {
    const sshKeyFile = path.join(tempDir, "id_ed25519_jerry");
    fs.writeFileSync(sshKeyFile, "PRIVATE KEY", { mode: 0o600 });

    const teaConfigPath = path.join(tempDir, "tea-config.yml");
    fs.writeFileSync(
      teaConfigPath,
      [
        "logins:",
        "- name: jerry-main",
        "  url: https://gitea.internal.example.com/",
        "  token: gta_jerry_seed_token_1122",
        "  default: true",
        "  user: jerry",
        `  ssh_key: ${sshKeyFile}`,
        "- name: release-bot",
        "  url: https://gitea.internal.example.com/",
        "  token: gta_release_seed_token_3344",
        "  default: false",
        "  user: release-bot",
      ].join("\n"),
      "utf8",
    );

    const rpcHandlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    const fakeServer: PluginServerContext = {
      registerSettings: () => ({
        subscribe: () => () => {},
        read: async () => ({ status: "ready" as const, values: DEFAULT_TEAM_COLLAB_SETTINGS }),
      }),
      handle: (contract: { name: string }, handler: (input: unknown, ctx: unknown) => unknown) => {
        rpcHandlers.set(contract.name, async (input, ctx) => handler(input, ctx));
      },
      addHook: () => () => {},
    } as unknown as PluginServerContext;

    const dataDir = path.join(tempDir, "auto-seed-data");
    const cleanup = contribute(fakeServer, {
      dataDir,
      hostDiscovery: {
        hostTeaConfigPaths: [teaConfigPath],
        gitGlobalIdentity: {
          name: "Jerry Chen",
          email: "jerry@internal.example.com",
        },
        skipNetworkFetch: true,
      },
    });

    const callRpc = async <TOut>(
      contract: {
        name: string;
        input: { parse: (v: unknown) => unknown };
        output: { parse: (v: unknown) => TOut };
      },
      rawInput: unknown,
    ): Promise<TOut> => {
      const handler = rpcHandlers.get(contract.name);
      expect(handler).toBeTypeOf("function");
      const parsedIn = contract.input.parse(rawInput);
      const rawOut = await handler!(parsedIn, { paseo: {} });
      return contract.output.parse(rawOut);
    };

    try {
      // 1. Initial status query auto-seeds both tea logins into roster.json and 0600 secrets.json
      const initialStatus = await callRpc(teamCollabRosterStatusRpc, undefined);
      expect(initialStatus.members.map((m) => m.id)).toEqual(["jerry", "release-bot"]);
      expect(initialStatus.members[0]).toMatchObject({
        id: "jerry",
        name: "Jerry Chen",
        email: "jerry@internal.example.com",
        giteaUsername: "jerry",
        credentials: {
          hasGiteaToken: true,
          giteaTokenPreview: "••••1122",
          giteaUrl: "https://gitea.internal.example.com",
          hasSshKey: true,
        },
      });
      expect(initialStatus.discoveredAccounts).toHaveLength(2);
      expect(initialStatus.discoveredAccounts.every((a) => a.alreadyInRoster)).toBe(true);

      const secretsPath = path.join(dataDir, "secrets.json");
      expect(fs.existsSync(secretsPath)).toBe(true);
      expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600);
      const rawSecrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
      expect(rawSecrets.secrets.jerry.giteaToken).toBe("gta_jerry_seed_token_1122");
      expect(rawSecrets.secrets["release-bot"].giteaToken).toBe("gta_release_seed_token_3344");

      // 2. Remove both members explicitly -> must NOT resurrect on subsequent status queries or unlabeled sync
      await callRpc(teamCollabMemberRemoveRpc, { memberId: "jerry" });
      await callRpc(teamCollabMemberRemoveRpc, { memberId: "release-bot" });

      const afterRemoveStatus = await callRpc(teamCollabRosterStatusRpc, undefined);
      expect(afterRemoveStatus.members).toEqual([]);
      expect(afterRemoveStatus.discoveredAccounts.map((a) => a.alreadyInRoster)).toEqual([
        false,
        false,
      ]);

      // Unlabeled sync without loginNames must also respect removedIds
      const unlabeledSync = await callRpc(teamCollabSyncHostAccountsRpc, {});
      expect(unlabeledSync.importedIds).toEqual([]);
      expect(unlabeledSync.members).toEqual([]);

      // 3. Explicit teamCollabSyncHostAccountsRpc with loginNames re-imports the requested login
      const explicitSync = await callRpc(teamCollabSyncHostAccountsRpc, {
        loginNames: ["jerry-main"],
      });
      expect(explicitSync.importedIds).toEqual(["jerry"]);
      expect(explicitSync.members.map((m) => m.id)).toEqual(["jerry"]);
      expect(
        explicitSync.discoveredAccounts.find((a) => a.loginName === "jerry-main")?.alreadyInRoster,
      ).toBe(true);
      expect(
        explicitSync.discoveredAccounts.find((a) => a.loginName === "release-bot")?.alreadyInRoster,
      ).toBe(false);
    } finally {
      if (typeof cleanup === "function") {
        await cleanup();
      }
    }
  });

  it("binds token, url, and ssh_key directly from host tea/config.yml when teamCollabMemberUpsertRpc passes credentials.useDiscoveredTeaLogin", async () => {
    const sshKeyFile = path.join(tempDir, "id_ed25519_bind");
    fs.writeFileSync(sshKeyFile, "PRIVATE KEY", { mode: 0o600 });

    const teaConfigPath = path.join(tempDir, "tea-bind.yml");
    fs.writeFileSync(
      teaConfigPath,
      [
        "logins:",
        "- name: work-gitea",
        "  url: https://git.work.example.com/",
        "  token: gta_work_bound_secret_7890",
        "  default: true",
        "  user: alice-work",
        `  ssh_key: ${sshKeyFile}`,
      ].join("\n"),
      "utf8",
    );

    const rpcHandlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    const fakeServer: PluginServerContext = {
      registerSettings: () => ({
        subscribe: () => () => {},
        read: async () => ({ status: "ready" as const, values: DEFAULT_TEAM_COLLAB_SETTINGS }),
      }),
      handle: (contract: { name: string }, handler: (input: unknown, ctx: unknown) => unknown) => {
        rpcHandlers.set(contract.name, async (input, ctx) => handler(input, ctx));
      },
      addHook: () => () => {},
    } as unknown as PluginServerContext;

    const dataDir = path.join(tempDir, "bind-tea-data");
    const cleanup = contribute(fakeServer, {
      dataDir,
      hostDiscovery: {
        hostTeaConfigPaths: [teaConfigPath],
        skipNetworkFetch: true,
      },
    });

    const callRpc = async <TOut>(
      contract: {
        name: string;
        input: { parse: (v: unknown) => unknown };
        output: { parse: (v: unknown) => TOut };
      },
      rawInput: unknown,
    ): Promise<TOut> => {
      const handler = rpcHandlers.get(contract.name);
      expect(handler).toBeTypeOf("function");
      const parsedIn = contract.input.parse(rawInput);
      const rawOut = await handler!(parsedIn, { paseo: {} });
      return contract.output.parse(rawOut);
    };

    try {
      const upserted = await callRpc(teamCollabMemberUpsertRpc, {
        member: {
          id: "alice",
          name: "Alice Work",
          email: "alice@work.example.com",
          enabled: true,
        },
        credentials: {
          useDiscoveredTeaLogin: "work-gitea",
        },
      });

      expect(upserted.success).toBe(true);
      expect(upserted.member).toMatchObject({
        id: "alice",
        name: "Alice Work",
        email: "alice@work.example.com",
        giteaUsername: "alice-work",
        credentials: {
          hasGiteaToken: true,
          giteaTokenPreview: "••••7890",
          giteaUrl: "https://git.work.example.com",
          hasSshKey: true,
        },
      });

      const store = new SecretStore({ dataDir, hostTeaConfigPaths: [teaConfigPath] });
      expect(store.getMemberSecrets("alice")).toMatchObject({
        giteaToken: "gta_work_bound_secret_7890",
        giteaUrl: "https://git.work.example.com",
        sshKeyPath: sshKeyFile,
      });

      expect(() =>
        store.upsertMember(
          {
            id: "alice",
            name: "Alice Work",
            email: "alice@work.example.com",
            enabled: true,
          },
          {
            useDiscoveredTeaLogin: "nonexistent-login",
          },
        ),
      ).toThrow(/not found/i);
    } finally {
      if (typeof cleanup === "function") {
        await cleanup();
      }
    }
  });

  it("falls back to git-global account when no tea logins exist and uses global email for a single tea login", async () => {
    const fakeGitConfig = path.join(tempDir, "fake-gitconfig");
    fs.writeFileSync(
      fakeGitConfig,
      ["[user]", "\tname = Solo Developer", "\temail = solo.dev@company.example.com", ""].join(
        "\n",
      ),
      "utf8",
    );

    // 1. Single tea login whose user ('dev_handle') differs from git user.name ('Solo Developer') still adopts global email
    const singleTeaPath = path.join(tempDir, "single-tea.yml");
    fs.writeFileSync(
      singleTeaPath,
      [
        "logins:",
        "- name: internal",
        "  url: https://git.company.example.com",
        "  token: gta_solo_token_9988",
        "  default: true",
        "  user: dev_handle",
      ].join("\n"),
      "utf8",
    );

    const singleTeaDiscovered = await discoverHostAccounts({
      hostTeaConfigPaths: [singleTeaPath],
      gitGlobalConfigPath: fakeGitConfig,
      skipNetworkFetch: true,
    });
    expect(singleTeaDiscovered).toHaveLength(1);
    expect(singleTeaDiscovered[0]).toMatchObject({
      source: "tea",
      suggestedId: "dev_handle",
      suggestedName: "Solo Developer",
      suggestedEmail: "solo.dev@company.example.com",
    });

    // 2. No tea logins on host -> discovers and syncs git-global account
    const store = new SecretStore({
      dataDir: path.join(tempDir, "git-global-only"),
      hostDiscovery: {
        hostTeaConfigPaths: [],
        gitGlobalConfigPath: fakeGitConfig,
        skipNetworkFetch: true,
      },
    });

    const synced = await store.syncHostAccounts();
    expect(synced.importedIds).toEqual(["solo.dev"]);
    expect(synced.members).toHaveLength(1);
    expect(synced.members[0]).toMatchObject({
      id: "solo.dev",
      name: "Solo Developer",
      email: "solo.dev@company.example.com",
    });
    expect(synced.discoveredAccounts).toEqual([
      {
        source: "git-global",
        gitProvider: "gitea",
        loginName: "solo.dev",
        suggestedId: "solo.dev",
        suggestedName: "Solo Developer",
        suggestedEmail: "solo.dev@company.example.com",
        giteaUrl: null,
        giteaUsername: null,
        hasToken: false,
        tokenPreview: null,
        hasSshKey: false,
        sshKeyPathPreview: null,
        isDefault: true,
        alreadyInRoster: true,
      },
    ]);
  });

  it("uses Gitea API login when tea/config.yml omits user field, degrades offline on HTTP error, and deduplicates 64-char IDs ([HIGH-2], [LOW-7])", async () => {
    const longUser = "a".repeat(64);
    const teaPath = path.join(tempDir, "no-user-tea.yml");
    fs.writeFileSync(
      teaPath,
      [
        "logins:",
        "- name: corp-alias",
        "  url: https://git.corp.example.com",
        "  token: gta_corp_alias_token_1111",
        "  default: true",
        `- name: ${longUser}`,
        "  url: https://git1.example.com",
        "  token: gta_long_token_2222",
        `  user: ${longUser}`,
        `- name: ${longUser}-second`,
        "  url: https://git2.example.com",
        "  token: gta_long_token_3333",
        `  user: ${longUser}`,
        `- name: ${longUser}`,
        "  url: https://git3.example.com",
        "  token: gta_long_token_4444",
      ].join("\n"),
      "utf8",
    );

    const longThirdPath = path.join(tempDir, "no-user-tea-2.yml");
    fs.writeFileSync(
      longThirdPath,
      [
        "logins:",
        "- name: third-long",
        "  url: https://git3.example.com",
        "  token: gta_long_token_4444",
        `  user: ${longUser}`,
      ].join("\n"),
      "utf8",
    );

    let observedSignal: AbortSignal | undefined;
    const discovered = await discoverHostAccounts({
      hostTeaConfigPaths: [teaPath, longThirdPath],
      gitGlobalIdentity: { name: null, email: null },
      fetchUserProfile: async ({ loginName, signal }) => {
        observedSignal = signal;
        if (loginName === "corp-alias") {
          return {
            login: "real_gitea_user",
            full_name: "Real Gitea User",
            email: "real@corp.example.com",
          };
        }
        throw new Error("Simulated HTTP 502 Bad Gateway");
      },
    });

    expect(observedSignal).toBeDefined();
    // 1. Entry without 'user' uses apiLogin ('real_gitea_user') instead of login alias ('corp-alias')
    expect(discovered[0]).toMatchObject({
      loginName: "corp-alias",
      giteaUsername: "real_gitea_user",
      suggestedId: "real_gitea_user",
      suggestedName: "Real Gitea User",
      suggestedEmail: "real@corp.example.com",
    });

    // 2. Remaining entries where fetchUserProfile threw degrade offline and get distinct 64-char IDs
    const ids = discovered.map((d) => d.suggestedId);
    expect(new Set(ids).size).toBe(discovered.length);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(64);
    }

    // 3. Control characters or whitespace-only useDiscoveredTeaLogin are rejected by schema
    expect(MemberCredentialsInputSchema.safeParse({ useDiscoveredTeaLogin: "   " }).success).toBe(
      false,
    );
    expect(
      MemberCredentialsInputSchema.safeParse({ useDiscoveredTeaLogin: "bad\nlogin" }).success,
    ).toBe(false);
  });

  it("coalesces concurrent seedHostAccountsIfNeeded calls, prevents TOCTOU resurrection on mid-discovery removeMember, and isolates same giteaUsername across different Gitea URLs ([HIGH-3], [MEDIUM-6])", async () => {
    const teaPath = path.join(tempDir, "multi-instance-tea.yml");
    fs.writeFileSync(
      teaPath,
      [
        "logins:",
        "- name: corp-instance",
        "  url: https://git.corp.example.com",
        "  token: gta_corp_token_1111",
        "  default: true",
        "  user: shareduser",
        "- name: lab-instance",
        "  url: https://git.lab.example.com",
        "  token: gta_lab_token_2222",
        "  default: false",
        "  user: shareduser",
      ].join("\n"),
      "utf8",
    );

    let fetchCalls = 0;
    let releaseDiscovery!: () => void;
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });

    const store = new SecretStore({
      dataDir: path.join(tempDir, "toctou-store"),
      hostDiscovery: {
        hostTeaConfigPaths: [teaPath],
        gitGlobalIdentity: { name: null, email: null },
        fetchUserProfile: async () => {
          fetchCalls += 1;
          await discoveryGate;
          return null;
        },
      },
    });

    // Launch two concurrent seedHostAccountsIfNeeded calls -> must coalesce into a single discovery pass
    const seedPromise1 = store.seedHostAccountsIfNeeded();
    const seedPromise2 = store.seedHostAccountsIfNeeded();

    // While discovery is in-flight, user explicitly removes "shareduser"
    store.removeMember("shareduser");

    releaseDiscovery();
    const [res1, res2] = await Promise.all([seedPromise1, seedPromise2]);

    // Coalesced: only 2 logins fetched once (not 4)
    expect(fetchCalls).toBe(2);
    // "shareduser" was removed mid-flight so it must NOT be resurrected; only "lab-instance" is imported
    expect(res1.importedIds).toEqual(["lab-instance"]);
    expect(res2.importedIds).toEqual(["lab-instance"]);
    expect(store.getRosterStatuses().map((m) => m.id)).toEqual(["lab-instance"]);

    // Because "lab-instance" is bound to https://git.lab.example.com, "corp-instance" (https://git.corp.example.com)
    // must NOT be falsely marked as alreadyInRoster even though both have giteaUsername === "shareduser"
    const corpDiscovered = res1.discoveredAccounts.find((a) => a.loginName === "corp-instance");
    const labDiscovered = res1.discoveredAccounts.find((a) => a.loginName === "lab-instance");
    expect(corpDiscovered?.alreadyInRoster).toBe(false);
    expect(labDiscovered?.alreadyInRoster).toBe(true);
  });

  it("discovers SSH private key paths in ~/.ssh while filtering out .pub, known_hosts, authorized_keys, config, and backup files", () => {
    const sshDir = path.join(tempDir, ".ssh");
    fs.mkdirSync(sshDir, { recursive: true });

    const shouldIgnore = [
      "id_ed25519.pub",
      "id_rsa.pub",
      "known_hosts",
      "known_hosts.old",
      "authorized_keys",
      "authorized_keys2",
      "config",
      "config.d",
      "id_ed25519-cert.pub",
      "key.cert",
      "id_rsa.old",
      "id_rsa.bak",
      ".DS_Store",
      "environment",
      "rc",
      "agent.1234",
    ];
    for (const file of shouldIgnore) {
      fs.writeFileSync(path.join(sshDir, file), "ignored", "utf8");
    }

    const validKeys = [
      "custom_deploy_key",
      "work_rsa",
      "corp_ed25519",
      "id_ecdsa",
      "id_rsa_legacy",
      "id_rsa",
      "id_ed25519_work",
      "id_ed25519",
    ];
    for (const key of validKeys) {
      fs.writeFileSync(path.join(sshDir, key), "PRIVATE KEY", { mode: 0o600 });
    }

    const discovered = discoverHostSshKeys(sshDir);
    expect(discovered).toEqual([
      path.join(sshDir, "id_ed25519"),
      path.join(sshDir, "id_ed25519_work"),
      path.join(sshDir, "id_rsa"),
      path.join(sshDir, "id_rsa_legacy"),
      path.join(sshDir, "id_ecdsa"),
      path.join(sshDir, "corp_ed25519"),
      path.join(sshDir, "work_rsa"),
      path.join(sshDir, "custom_deploy_key"),
    ]);
  });

  it("supports universal gitProvider, httpToken, httpServerUrl mapping, glab/gh CLI discovery, and bidirectional username sync", async () => {
    const homeDir = path.join(tempDir, "fake-home");
    const sshDir = path.join(homeDir, ".ssh");
    const glabDir = path.join(homeDir, ".config", "glab-cli");
    const ghDir = path.join(homeDir, ".config", "gh");
    fs.mkdirSync(sshDir, { recursive: true });
    fs.mkdirSync(glabDir, { recursive: true });
    fs.mkdirSync(ghDir, { recursive: true });

    const sshKeyPath = path.join(sshDir, "id_ed25519");
    fs.writeFileSync(sshKeyPath, "PRIVATE KEY", { mode: 0o600 });
    fs.writeFileSync(path.join(sshDir, "id_ed25519.pub"), "PUBLIC KEY", "utf8");

    fs.writeFileSync(
      path.join(glabDir, "config.yml"),
      [
        "hosts:",
        "  gitlab.corp.example.com:",
        "    token: glpat_corp_secret_1234",
        "    user: alice_gl",
        "    api_protocol: https",
        `    ssh_key: ${sshKeyPath}`,
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      path.join(ghDir, "hosts.yml"),
      [
        "github.com:",
        "    user: bob_gh",
        "    oauth_token: gho_bob_secret_5678",
        "    git_protocol: https",
      ].join("\n"),
      "utf8",
    );

    const discovered = await discoverHostAccounts({
      homeDir,
      hostTeaConfigPaths: [],
      gitGlobalIdentity: { name: "Alice GL", email: "alice@corp.example.com" },
      skipNetworkFetch: true,
    });

    expect(discovered).toHaveLength(2);
    expect(discovered[0]).toMatchObject({
      source: "glab",
      gitProvider: "gitlab",
      loginName: "gitlab.corp.example.com",
      giteaUrl: "https://gitlab.corp.example.com",
      giteaUsername: "alice_gl",
      hasToken: true,
      tokenPreview: "••••1234",
      hasSshKey: true,
    });
    expect(discovered[1]).toMatchObject({
      source: "gh",
      gitProvider: "github",
      loginName: "github.com",
      giteaUrl: "https://github.com",
      giteaUsername: "bob_gh",
      hasToken: true,
      tokenPreview: "••••5678",
    });

    const store = new SecretStore({
      dataDir: path.join(tempDir, "universal-store"),
      hostDiscovery: {
        homeDir,
        hostTeaConfigPaths: [],
        skipNetworkFetch: true,
      },
    });

    // 1. Bind discovered glab login via useDiscoveredTeaLogin
    const boundGlab = store.upsertMember(
      {
        id: "alice",
        name: "Alice GitLab",
        email: "alice@corp.example.com",
      },
      {
        useDiscoveredTeaLogin: "gitlab.corp.example.com",
      },
    );
    expect(boundGlab).toMatchObject({
      id: "alice",
      gitProvider: "gitlab",
      gitUsername: "alice_gl",
      giteaUsername: "alice_gl",
      credentials: {
        gitProvider: "gitlab",
        hasHttpToken: true,
        httpTokenPreview: "••••1234",
        httpServerUrl: "https://gitlab.corp.example.com",
        hasGiteaToken: true,
        giteaUrl: "https://gitlab.corp.example.com",
        hasSshKey: true,
      },
    });

    // 2. Upsert GitHub member via universal httpToken + gitProvider: "github"
    const ghMember = store.upsertMember(
      {
        id: "bob",
        name: "Bob GitHub",
        email: "bob@github.example.com",
        gitProvider: "github",
        gitUsername: "bob_gh_user",
      },
      {
        gitProvider: "github",
        httpToken: "ghp_universal_token_9999",
      },
    );
    expect(ghMember).toMatchObject({
      id: "bob",
      gitProvider: "github",
      gitUsername: "bob_gh_user",
      githubUsername: "bob_gh_user",
      credentials: {
        gitProvider: "github",
        hasHttpToken: true,
        httpTokenPreview: "••••9999",
        httpServerUrl: "https://github.com",
        hasGithubToken: true,
        githubTokenPreview: "••••9999",
      },
    });
    expect(store.getMemberSecrets("bob")?.githubToken).toBe("ghp_universal_token_9999");

    // 3. Upsert GitLab member without URL -> defaults httpServerUrl to https://gitlab.com
    const defaultGitlab = store.upsertMember(
      {
        id: "carol",
        name: "Carol GitLab Cloud",
        email: "carol@gitlab.example.com",
        gitUsername: "carol_gl",
      },
      {
        gitProvider: "gitlab",
        httpToken: "glpat_cloud_token_4444",
      },
    );
    expect(defaultGitlab.credentials).toMatchObject({
      gitProvider: "gitlab",
      hasHttpToken: true,
      httpTokenPreview: "••••4444",
      httpServerUrl: "https://gitlab.com",
      giteaUrl: "https://gitlab.com",
    });

    // 4. Upsert Generic Git (Gitee) member
    const giteeMember = store.upsertMember(
      {
        id: "dave",
        name: "Dave Gitee",
        email: "dave@gitee.example.com",
        gitProvider: "generic",
        gitUsername: "dave_gitee",
      },
      {
        gitProvider: "generic",
        httpServerUrl: "https://gitee.com",
        httpToken: "gitee_pat_token_7777",
      },
    );
    expect(giteeMember).toMatchObject({
      id: "dave",
      gitProvider: "generic",
      gitUsername: "dave_gitee",
      giteaUsername: "dave_gitee",
      credentials: {
        gitProvider: "generic",
        hasHttpToken: true,
        httpTokenPreview: "••••7777",
        httpServerUrl: "https://gitee.com",
      },
    });

    // 5. [HIGH-2], [MEDIUM-5], [LOW-6]: Multi-user gh/hosts.yml selects active user's token,
    // source:loginName format works in useDiscoveredTeaLogin & syncHostAccounts,
    // and syncHostAccounts matches existing gh/glab members with custom IDs without creating duplicates.
    fs.writeFileSync(
      path.join(ghDir, "hosts.yml"),
      [
        "github.com:",
        "    users:",
        "        other_user:",
        "            oauth_token: gho_wrong_other_token_0000",
        "        bob_gh_user:",
        "            oauth_token: gho_active_bob_token_8888",
        "    git_protocol: https",
        "    user: bob_gh_user",
        "    oauth_token: gho_stale_top_token_1111",
      ].join("\n"),
      "utf8",
    );

    // Bind via "gh:bob_gh_user" source-prefixed login key
    const boundPrefixedGh = store.upsertMember(
      {
        id: "bob-prefixed",
        name: "Bob Prefixed",
        email: "bob.prefixed@github.example.com",
      },
      {
        useDiscoveredTeaLogin: "gh:bob_gh_user",
      },
    );
    expect(boundPrefixedGh.credentials.githubTokenPreview).toBe("••••8888");
    expect(store.getMemberSecrets("bob-prefixed")?.githubToken).toBe("gho_active_bob_token_8888");
    store.removeMember("bob-prefixed");

    // Existing member "bob" has id: "bob" (!== suggestedId "bob_gh_user") and githubUsername: "bob_gh_user",
    // and existing member "alice" has id: "alice" (!== suggestedId "alice_gl") and gitUsername: "alice_gl".
    // Calling syncHostAccounts with overwriteExistingCredentials: true and source:loginName filter must update "bob" and "alice" in-place without duplicating!
    const syncResult = await store.syncHostAccounts({
      loginNames: ["gh:github.com", "glab:gitlab.corp.example.com"],
      overwriteExistingCredentials: true,
    });
    expect(syncResult.importedIds).toEqual(["alice", "bob"]);
    expect(syncResult.members.map((m) => m.id)).toEqual(["alice", "bob", "carol", "dave"]);
    expect(store.getMemberSecrets("bob")?.githubToken).toBe("gho_active_bob_token_8888");

    const badUrlCheck = MemberCredentialsInputSchema.safeParse({
      httpServerUrl: "ftp://invalid.example.com",
    });
    expect(badUrlCheck.success).toBe(false);
    if (!badUrlCheck.success) {
      expect(badUrlCheck.error.issues[0]?.message).toContain("Server URL");
    }
  });
});
