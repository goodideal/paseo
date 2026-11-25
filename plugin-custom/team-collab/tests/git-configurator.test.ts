import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginHookContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import { AttributionGuard } from "../server/attribution-guard.js";
import { buildSshCommand, GitConfigurator } from "../server/git-configurator.js";
import { SecretStore } from "../server/secret-store.js";
import { DEFAULT_TEAM_COLLAB_SETTINGS, TEAM_COLLAB_OWNER_META_KEY } from "../shared/contracts.js";

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
}

function collectAllFilesContent(dir: string): string {
  const chunks: string[] = [];
  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        chunks.push(fs.readFileSync(full, "utf8"));
      }
    }
  }
  walk(dir);
  return chunks.join("\n");
}

describe("GitConfigurator (real git init + git worktree)", () => {
  let tempRoot: string;
  let dataDir: string;
  let mainRepoDir: string;
  let worktreeDir: string;
  let store: SecretStore;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "team-collab-git-"));
    dataDir = path.join(tempRoot, "plugin-data");
    mainRepoDir = path.join(tempRoot, "main-repo");
    worktreeDir = path.join(tempRoot, "wt-feature");
    store = new SecretStore({ dataDir });

    fs.mkdirSync(mainRepoDir, { recursive: true });
    git(mainRepoDir, ["init", "-b", "main"]);
    git(mainRepoDir, ["config", "user.name", "Repo Default"]);
    git(mainRepoDir, ["config", "user.email", "default@repo.local"]);
    git(mainRepoDir, ["remote", "add", "origin", "git@git.corp.example.com:team/demo.git"]);
    fs.writeFileSync(path.join(mainRepoDir, "README.md"), "# Demo\n", "utf8");
    git(mainRepoDir, ["add", "README.md"]);
    git(mainRepoDir, ["commit", "-m", "initial commit"]);
    git(mainRepoDir, ["worktree", "add", "-b", "feat/alice", worktreeDir]);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("accurately distinguishes non-git directories, empty repos, main checkouts, and linked worktrees", async () => {
    const configurator = new GitConfigurator({ secretStore: store });

    const nonGitDir = path.join(tempRoot, "plain-dir");
    fs.mkdirSync(nonGitDir);
    expect(await configurator.inspectGitDirectory(nonGitDir)).toMatchObject({
      isGitRepo: false,
      isWorktree: false,
      hasCommits: false,
    });

    const emptyRepo = path.join(tempRoot, "empty-repo");
    fs.mkdirSync(emptyRepo);
    git(emptyRepo, ["init"]);
    expect(await configurator.inspectGitDirectory(emptyRepo)).toMatchObject({
      isGitRepo: true,
      isWorktree: false,
      hasCommits: false,
    });

    expect(await configurator.inspectGitDirectory(mainRepoDir)).toMatchObject({
      isGitRepo: true,
      isWorktree: false,
      hasCommits: true,
      currentBranch: "main",
    });

    expect(await configurator.inspectGitDirectory(worktreeDir)).toMatchObject({
      isGitRepo: true,
      isWorktree: true,
      hasCommits: true,
      currentBranch: "feat/alice",
    });
  });

  it("refuses shell injection in sshKeyPath and safely quotes valid paths", () => {
    expect(() => buildSshCommand("/tmp/key; rm -rf /")).toThrow();
    expect(() => buildSshCommand("/tmp/$(whoami)/id_ed25519")).toThrow();
    expect(() => buildSshCommand("/tmp/`id`/key")).toThrow();
    expect(() => buildSshCommand("/tmp/key\nProxyCommand=evil")).toThrow();

    expect(buildSshCommand("/Users/o'connor/.ssh/id_ed25519")).toBe(
      "ssh -i '/Users/o'\\''connor/.ssh/id_ed25519' -o IdentitiesOnly=yes",
    );
  });

  it("configures HTTPS credential.helper + pushInsteadOf in worktree without polluting main checkout or leaking raw tokens into .git", async () => {
    const aliceProfile = {
      id: "alice",
      name: "Alice Zhang",
      email: "alice@corp.example.com",
      giteaUsername: "alice",
      githubUsername: "alice-gh",
      enabled: true,
    };
    store.upsertMember(aliceProfile, {
      giteaToken: "gta_secret_alice_9999",
      giteaUrl: "https://git.corp.example.com",
      githubToken: "ghp_secret_alice_8888",
    });

    const configurator = new GitConfigurator({ secretStore: store });

    // Refuses to touch main checkout unless explicitly allowed
    const mainAttempt = await configurator.applyOwnerToWorktree(
      mainRepoDir,
      aliceProfile,
      store.getMemberSecrets("alice"),
    );
    expect(mainAttempt.applied).toBe(false);

    // Applies to linked worktree
    const wtResult = await configurator.applyOwnerToWorktree(
      worktreeDir,
      aliceProfile,
      store.getMemberSecrets("alice"),
    );
    expect(wtResult.applied).toBe(true);
    expect(wtResult.credentialScriptPath).toBe(path.join(dataDir, "bin", "cred-alice.sh"));
    expect(fs.statSync(wtResult.credentialScriptPath!).mode & 0o777).toBe(0o700);

    // Worktree sees Alice's identity while main checkout keeps Repo Default
    expect(git(worktreeDir, ["config", "extensions.worktreeConfig"])).toBe("true");
    expect(git(worktreeDir, ["config", "--worktree", "--get", "user.name"])).toBe("Alice Zhang");
    expect(git(worktreeDir, ["config", "--worktree", "--get", "user.email"])).toBe(
      "alice@corp.example.com",
    );
    expect(git(mainRepoDir, ["config", "user.name"])).toBe("Repo Default");
    expect(git(mainRepoDir, ["config", "user.email"])).toBe("default@repo.local");

    // Zero plaintext token inside .git directory (main & worktrees metadata)
    const allGitConfigContent = collectAllFilesContent(path.join(mainRepoDir, ".git"));
    expect(allGitConfigContent).not.toContain("gta_secret_alice_9999");
    expect(allGitConfigContent).not.toContain("ghp_secret_alice_8888");

    // Real git credential fill invokes cred-alice.sh and outputs host-matched credentials
    const giteaCredOut = git(
      worktreeDir,
      ["credential", "fill"],
      "protocol=https\nhost=git.corp.example.com\n\n",
    );
    expect(giteaCredOut).toContain("username=token");
    expect(giteaCredOut).toContain("password=gta_secret_alice_9999");

    const githubCredOut = git(
      worktreeDir,
      ["credential", "fill"],
      "protocol=https\nhost=github.com\n\n",
    );
    expect(githubCredOut).toContain("username=token");
    expect(githubCredOut).toContain("password=ghp_secret_alice_8888");

    // Rotating token in SecretStore takes effect immediately without rewriting .git
    store.upsertMember(aliceProfile, { giteaToken: "gta_rotated_alice_7777" });
    const rotatedCredOut = git(
      worktreeDir,
      ["credential", "fill"],
      "protocol=https\nhost=git.corp.example.com\n\n",
    );
    expect(rotatedCredOut).toContain("password=gta_rotated_alice_7777");

    // SSH origin remote is rewritten to HTTPS push URL inside worktree, untouched in main checkout
    expect(git(worktreeDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "https://git.corp.example.com/team/demo.git",
    );
    expect(git(mainRepoDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "git@git.corp.example.com:team/demo.git",
    );
  });

  it("overwrites worktree config cleanly on member handoff from HTTPS token user to SSH key user", async () => {
    const alice = {
      id: "alice",
      name: "Alice Zhang",
      email: "alice@corp.example.com",
      enabled: true,
    };
    const bobKeyPath = path.join(tempRoot, "id_ed25519_bob");
    fs.writeFileSync(bobKeyPath, "dummy-key", { mode: 0o600 });
    const bob = {
      id: "bob",
      name: "Bob Wang",
      email: "bob@corp.example.com",
      enabled: true,
    };

    store.upsertMember(alice, {
      giteaToken: "gta_alice_token_1234",
      giteaUrl: "https://git.corp.example.com",
    });
    store.upsertMember(bob, {
      sshKeyPath: bobKeyPath,
    });

    const configurator = new GitConfigurator({ secretStore: store });
    await configurator.applyOwnerToWorktree(worktreeDir, alice, store.getMemberSecrets("alice"));
    expect(git(worktreeDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "https://git.corp.example.com/team/demo.git",
    );

    // Handoff worktree to Bob (SSH key, no HTTPS token)
    await configurator.applyOwnerToWorktree(worktreeDir, bob, store.getMemberSecrets("bob"));

    expect(git(worktreeDir, ["config", "--worktree", "--get", "user.name"])).toBe("Bob Wang");
    expect(git(worktreeDir, ["config", "--worktree", "--get", "user.email"])).toBe(
      "bob@corp.example.com",
    );
    expect(git(worktreeDir, ["config", "--worktree", "--get", "core.sshCommand"])).toBe(
      `ssh -i '${bobKeyPath}' -o IdentitiesOnly=yes`,
    );
    expect(() =>
      git(worktreeDir, ["config", "--worktree", "--get", "credential.helper"]),
    ).toThrow();
    // Push remote URL reverts back to SSH origin
    expect(git(worktreeDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "git@git.corp.example.com:team/demo.git",
    );
  });

  it("generates isolated tea config (0600) and tea shim (0700) using fallback Gitea URL from host tea config", () => {
    const fakeHostTeaConfig = path.join(tempRoot, "host-tea-config.yml");
    fs.writeFileSync(
      fakeHostTeaConfig,
      [
        "logins:",
        "- name: secondary",
        "  url: https://secondary.gitea.local",
        "  default: false",
        "- name: primary",
        "  url: https://primary.gitea.local",
        "  default: true",
      ].join("\n"),
      "utf8",
    );

    const fakeRealTea = path.join(tempRoot, "fake-real-tea.sh");
    fs.writeFileSync(fakeRealTea, '#!/bin/sh\necho "XDG=$XDG_CONFIG_HOME ARGS=$*"\n', {
      mode: 0o755,
    });

    const eve = {
      id: "eve",
      name: "Eve Sun",
      email: "eve@gitea.local",
      giteaUsername: "eve",
      enabled: true,
    };
    store.upsertMember(eve, {
      giteaToken: "gta_eve_token_5555",
      // giteaUrl intentionally omitted to verify host tea config fallback
    });

    const configurator = new GitConfigurator({
      secretStore: store,
      hostTeaConfigPaths: [fakeHostTeaConfig],
      realTeaBin: fakeRealTea,
    });

    const shims = configurator.ensureMemberShims(eve, store.getMemberSecrets("eve"));
    expect(shims.teaConfigPath).toBe(path.join(dataDir, "xdg", "eve", "tea", "config.yml"));
    expect(shims.teaShimDir).toBe(path.join(dataDir, "shims", "eve"));

    expect(fs.statSync(shims.teaConfigPath!).mode & 0o777).toBe(0o600);
    const teaShimBin = path.join(shims.teaShimDir!, "tea");
    expect(fs.statSync(teaShimBin).mode & 0o777).toBe(0o700);

    const yamlContent = fs.readFileSync(shims.teaConfigPath!, "utf8");
    expect(yamlContent).toContain("https://primary.gitea.local");
    expect(yamlContent).toContain("gta_eve_token_5555");

    const shimExecOutput = execFileSync(teaShimBin, ["pr", "list"], { encoding: "utf8" }).trim();
    expect(shimExecOutput).toBe(`XDG=${path.join(dataDir, "xdg", "eve")} ARGS=pr list`);
  });

  it("blocks path traversal in ensureMemberShims and removeMemberShims", () => {
    const sentinelFile = path.join(tempRoot, "outside-sentinel");
    fs.mkdirSync(sentinelFile, { recursive: true });
    const configurator = new GitConfigurator({ secretStore: store, hostTeaConfigPaths: [] });

    expect(() =>
      configurator.ensureMemberShims(
        {
          id: "../outside-sentinel",
          name: "Evil",
          email: "evil@example.com",
          enabled: true,
        },
        { giteaToken: "gta_evil_12345678", updatedAt: new Date().toISOString() },
      ),
    ).toThrow();

    expect(() => configurator.removeMemberShims("../outside-sentinel")).toThrow();
    expect(fs.existsSync(sentinelFile)).toBe(true);
  });

  it("refuses to leak giteaToken to unconfigured hosts when giteaUrl is unknown and enforces exact host:port matching", async () => {
    const configurator = new GitConfigurator({
      secretStore: store,
      hostTeaConfigPaths: [], // No host tea config either
    });

    const mallory = {
      id: "mallory",
      name: "Mallory",
      email: "mallory@corp.example.com",
      enabled: true,
    };
    store.upsertMember(mallory, {
      giteaToken: "gta_mallory_secret_9999",
      // No giteaUrl!
    });

    await configurator.applyOwnerToWorktree(
      worktreeDir,
      mallory,
      store.getMemberSecrets("mallory"),
    );

    // Must NOT rewrite SSH origin when giteaUrl is unknown
    expect(git(worktreeDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "git@git.corp.example.com:team/demo.git",
    );

    // Direct execution of cred-mallory.sh against arbitrary host must NOT output password
    const credScript = path.join(dataDir, "bin", "cred-mallory.sh");
    const unknownHostOut = execFileSync(credScript, ["get"], {
      input: "protocol=https\nhost=attacker.invalid\n\n",
      encoding: "utf8",
    });
    expect(unknownHostOut).not.toContain("gta_mallory_secret_9999");

    // When configured with explicit custom port https://git.corp.example.com:3443, default port 443 must not match
    store.upsertMember(mallory, {
      giteaToken: "gta_mallory_secret_9999",
      giteaUrl: "https://git.corp.example.com:3443",
    });
    configurator.ensureMemberShims(mallory, store.getMemberSecrets("mallory"));

    const wrongPortOut = execFileSync(credScript, ["get"], {
      input: "protocol=https\nhost=git.corp.example.com\n\n",
      encoding: "utf8",
    });
    expect(wrongPortOut).not.toContain("gta_mallory_secret_9999");

    const exactPortOut = execFileSync(credScript, ["get"], {
      input: "protocol=https\nhost=git.corp.example.com:3443\n\n",
      encoding: "utf8",
    });
    expect(exactPortOut).toContain("password=gta_mallory_secret_9999");
  });

  it("preserves custom SSH user and Gitea subpath in pushInsteadOf, cleans main checkout worktree config, and reports git failures", async () => {
    const configurator = new GitConfigurator({ secretStore: store, hostTeaConfigPaths: [] });

    // Custom SSH user gitea@ and subpath /gitea/
    git(mainRepoDir, ["remote", "set-url", "origin", "gitea@git.corp.example.com:team/demo.git"]);
    const alice = {
      id: "alice",
      name: "Alice Subpath",
      email: "alice@corp.example.com",
      enabled: true,
    };
    store.upsertMember(alice, {
      giteaToken: "gta_subpath_token_1234",
      giteaUrl: "https://git.corp.example.com/gitea/",
    });

    const wtApply = await configurator.applyOwnerToWorktree(
      worktreeDir,
      alice,
      store.getMemberSecrets("alice"),
    );
    expect(wtApply.applied).toBe(true);
    expect(git(worktreeDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "https://git.corp.example.com/gitea/team/demo.git",
    );

    // Apply to main checkout with allowMainCheckout: true, then clearOwnerFromWorktree cleans it
    const mainApply = await configurator.applyOwnerToWorktree(
      mainRepoDir,
      alice,
      store.getMemberSecrets("alice"),
      { allowMainCheckout: true },
    );
    expect(mainApply.applied).toBe(true);
    expect(git(mainRepoDir, ["config", "--worktree", "--get", "user.name"])).toBe("Alice Subpath");

    const clearedMain = await configurator.clearOwnerFromWorktree(mainRepoDir);
    expect(clearedMain).toBe(true);
    expect(() => git(mainRepoDir, ["config", "--worktree", "--get", "user.name"])).toThrow();
    expect(git(mainRepoDir, ["config", "user.name"])).toBe("Repo Default");

    // Simulate git config write failure (lock file on worktree config) -> applied: false
    const wtGitDir = git(worktreeDir, ["rev-parse", "--git-dir"]);
    const lockPath = path.resolve(worktreeDir, wtGitDir, "config.worktree.lock");
    fs.writeFileSync(lockPath, "locked", "utf8");
    try {
      const failedApply = await configurator.applyOwnerToWorktree(
        worktreeDir,
        alice,
        store.getMemberSecrets("alice"),
      );
      expect(failedApply.applied).toBe(false);
    } finally {
      fs.rmSync(lockPath, { force: true });
    }
  });

  it("outputs oauth2/username for gitlab and gitUsername for generic providers (e.g. Gitee), skips tea shims for non-gitea providers, and injects GITLAB_TOKEN / GITLAB_HOST / GITHUB_TOKEN on session open", async () => {
    const configurator = new GitConfigurator({ secretStore: store, hostTeaConfigPaths: [] });

    // 1. GitLab member without username -> cred-helper outputs username=oauth2, no tea shim created
    const gitlabNoUser = store.upsertMember(
      {
        id: "gl-anon",
        name: "GitLab Anon",
        email: "anon@gitlab.example.com",
        gitProvider: "gitlab",
        enabled: true,
      },
      {
        gitProvider: "gitlab",
        httpServerUrl: "https://gitlab.corp.example.com",
        httpToken: "glpat_secret_token_1111",
      },
    );
    const glAnonShims = configurator.ensureMemberShims(
      gitlabNoUser,
      store.getMemberSecrets("gl-anon"),
    );
    expect(glAnonShims.credentialScriptPath).toBeTruthy();
    expect(glAnonShims.teaShimDir).toBeNull();
    expect(glAnonShims.teaConfigPath).toBeNull();

    const glAnonCredOut = execFileSync(glAnonShims.credentialScriptPath!, ["get"], {
      input: "protocol=https\nhost=gitlab.corp.example.com\n\n",
      encoding: "utf8",
    });
    expect(glAnonCredOut).toContain("username=oauth2");
    expect(glAnonCredOut).toContain("password=glpat_secret_token_1111");

    // 2. GitLab member WITH gitUsername -> cred-helper outputs username=<gitUsername>
    const gitlabWithUser = store.upsertMember(
      {
        id: "gl-user",
        name: "GitLab User",
        email: "user@gitlab.example.com",
        gitProvider: "gitlab",
        gitUsername: "alice_gitlab",
        enabled: true,
      },
      {
        gitProvider: "gitlab",
        httpServerUrl: "https://gitlab.corp.example.com",
        httpToken: "glpat_secret_token_2222",
      },
    );
    const glUserShims = configurator.ensureMemberShims(
      gitlabWithUser,
      store.getMemberSecrets("gl-user"),
    );
    const glUserCredOut = execFileSync(glUserShims.credentialScriptPath!, ["get"], {
      input: "protocol=https\nhost=gitlab.corp.example.com\n\n",
      encoding: "utf8",
    });
    expect(glUserCredOut).toContain("username=alice_gitlab");
    expect(glUserCredOut).toContain("password=glpat_secret_token_2222");

    // 3. Generic Git (Gitee) member WITH gitUsername -> cred-helper outputs username=<gitUsername>, no tea shim
    const giteeMember = store.upsertMember(
      {
        id: "gitee-dev",
        name: "Gitee Developer",
        email: "dev@gitee.example.com",
        gitProvider: "generic",
        gitUsername: "jerry_gitee",
        enabled: true,
      },
      {
        gitProvider: "generic",
        httpServerUrl: "https://gitee.com",
        httpToken: "gitee_pat_secret_3333",
      },
    );
    const giteeShims = configurator.ensureMemberShims(
      giteeMember,
      store.getMemberSecrets("gitee-dev"),
    );
    expect(giteeShims.teaShimDir).toBeNull();
    const giteeCredOut = execFileSync(giteeShims.credentialScriptPath!, ["get"], {
      input: "protocol=https\nhost=gitee.com\n\n",
      encoding: "utf8",
    });
    expect(giteeCredOut).toContain("username=jerry_gitee");
    expect(giteeCredOut).toContain("password=gitee_pat_secret_3333");

    // 4. Verify AttributionGuard.handleAgentOpenBefore injects GITLAB_TOKEN / GITLAB_HOST for GitLab
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator: configurator,
      getPolicies: () => ({
        enforceWorktreeOnCreate: true,
        blockUnclaimedGitCommitPush: true,
        allowSharedLocalCheckoutCommit: false,
        retentionDays: DEFAULT_TEAM_COLLAB_SETTINGS.retentionDays,
      }),
      getSettingsMembers: () => [],
    });

    const openReq: PluginSessionOpenRequest = {
      agentId: "ag_gitlab",
      workspaceId: "wks_gitlab",
      provider: "claude",
      cwd: worktreeDir,
      reason: "create",
      purpose: "interactive",
      title: "GitLab Session",
      background: false,
      labels: {},
      metadata: {
        [TEAM_COLLAB_OWNER_META_KEY]: {
          id: "gl-user",
          name: "GitLab User",
          email: "user@gitlab.example.com",
          kind: "member",
          assignedAt: "2026-11-24T00:00:00.000Z",
        },
      } as unknown as Record<string, string>,
      tools: [],
      env: { PATH: "/usr/bin:/bin" },
      mcpServers: {},
    };
    const dummyCtx: PluginHookContext = {
      signal: new AbortController().signal,
      paseo: {} as unknown as PluginHookContext["paseo"],
    };

    const openedGitlab = await guard.handleAgentOpenBefore({ request: openReq }, dummyCtx);
    expect(openedGitlab?.env).toMatchObject({
      TEAM_COLLAB_OWNER_ID: "gl-user",
      GITLAB_TOKEN: "glpat_secret_token_2222",
      GITLAB_HOST: "https://gitlab.corp.example.com",
    });
    expect(openedGitlab?.env.GITEA_TOKEN).toBeUndefined();
    expect(openedGitlab?.env.PATH).toBe("/usr/bin:/bin");

    // 5. [HIGH-1] GitLab member with httpServerUrl: null falls back to https://gitlab.com for cred-helper and pushInsteadOf
    git(mainRepoDir, ["remote", "set-url", "origin", "git@gitlab.com:team/cloud-repo.git"]);
    const gitlabNullUrl = store.upsertMember(
      {
        id: "gl-cloud",
        name: "GitLab Cloud User",
        email: "cloud@gitlab.com",
        gitProvider: "gitlab",
        gitUsername: "cloud_gl_user",
        enabled: true,
      },
      {
        gitProvider: "gitlab",
        httpServerUrl: null,
        httpToken: "glpat_cloud_null_url_9999",
      },
    );
    expect(gitlabNullUrl.credentials.httpServerUrl).toBe("https://gitlab.com");
    expect(configurator.resolveEffectiveGiteaUrl(null, "gitlab")).toBe("https://gitlab.com");

    const glCloudApply = await configurator.applyOwnerToWorktree(
      worktreeDir,
      gitlabNullUrl,
      store.getMemberSecrets("gl-cloud"),
    );
    expect(glCloudApply.applied).toBe(true);
    expect(git(worktreeDir, ["remote", "get-url", "--push", "origin"])).toBe(
      "https://gitlab.com/team/cloud-repo.git",
    );
    const glCloudCredOut = git(
      worktreeDir,
      ["credential", "fill"],
      "protocol=https\nhost=gitlab.com\n\n",
    );
    expect(glCloudCredOut).toContain("username=cloud_gl_user");
    expect(glCloudCredOut).toContain("password=glpat_cloud_null_url_9999");
  });
});
