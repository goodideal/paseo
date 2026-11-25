import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiteaIdentityBridge } from "../server/identity-bridge.js";
import { ProjectGiteaResolver } from "../server/resolver.js";
import { MultiProjectPoller } from "../server/poller.js";
import { IssueRunIndexStore } from "../server/store.js";
import { GiteaClientPool } from "../server/client-pool.js";
import { createFetchIssueAdapter } from "../server/adapters/fetch-issue.js";
import { createClaimIssueAdapter } from "../server/adapters/claim-issue.js";
import { createAgentExecuteAdapter } from "../server/adapters/agent-execute.js";
import { createDeliverPrAdapter, defaultPushBranch } from "../server/adapters/deliver-pr.js";
import { createPluginStepExecutorHost } from "../server/workflow-executor-runtime.js";

describe("GiteaIdentityBridge & Multi-User Identity Integration", () => {
  let tmpDir: string;
  let teamCollabDir: string;
  let teaConfigPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitea-identity-bridge-"));
    teamCollabDir = path.join(tmpDir, "plugin-data", "team-collab");
    fs.mkdirSync(teamCollabDir, { recursive: true });
    teaConfigPath = path.join(tmpDir, "tea-config.yml");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers identities from Team Collab roster/secrets, deduplicates overlapping tea logins, and supplements standalone tea accounts with masked previews", async () => {
    const aliceToken = "gitea_tok_alice_12345678";
    const bobToken = "gitea_tok_bob_87654321";
    const charlieToken = "gitea_tok_charlie_99990000";
    const aliceSshKey = path.join(tmpDir, "id_ed25519_alice");
    fs.writeFileSync(aliceSshKey, "PRIVATE KEY STUB", "utf8");

    fs.writeFileSync(
      path.join(teamCollabDir, "roster.json"),
      JSON.stringify(
        {
          version: 1,
          members: [
            {
              id: "alice",
              name: "Alice Chen",
              email: "alice@corp.local",
              gitProvider: "gitea",
              giteaUsername: "alice_c",
              enabled: true,
            },
            {
              id: "bob",
              name: "Bob Wang",
              email: "bob@corp.local",
              gitProvider: "gitea",
              giteaUsername: "bob_w",
              enabled: true,
            },
            {
              id: "gh-user",
              name: "GitHub Only",
              email: "gh@github.com",
              gitProvider: "github",
              githubUsername: "ghuser",
              enabled: true,
            },
          ],
          removedIds: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(
      path.join(teamCollabDir, "secrets.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: {
            alice: {
              gitProvider: "gitea",
              giteaToken: aliceToken,
              // Intentionally omit giteaUrl to verify enrichment from overlapping tea login
              sshKeyPath: aliceSshKey,
              updatedAt: "2026-11-25T00:00:00.000Z",
            },
            bob: {
              gitProvider: "gitea",
              giteaToken: bobToken,
              giteaUrl: "https://git.corp.local",
              updatedAt: "2026-11-25T00:00:00.000Z",
            },
            "gh-user": {
              gitProvider: "github",
              githubToken: "ghp_12345678901234567890",
              updatedAt: "2026-11-25T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // tea/config.yml has an overlapping login for alice_c and a standalone login for charlie
    fs.writeFileSync(
      teaConfigPath,
      [
        "logins:",
        "  - name: corp-alice",
        "    url: https://git.corp.local",
        `    token: ${aliceToken}`,
        "    user: alice_c",
        "    ssh_host: git.corp.local",
        "    default: true",
        "  - name: charlie-ops",
        "    url: https://git.corp.local",
        `    token: ${charlieToken}`,
        "    user: charlie",
        "    default: false",
      ].join("\n"),
      "utf8",
    );

    const fetchUserProfile = vi.fn().mockResolvedValue({
      login: "charlie",
      full_name: "Charlie Ops",
      email: "charlie@corp.local",
    });

    const bridge = new GiteaIdentityBridge({
      teamCollabDataDir: teamCollabDir,
      teaConfigPaths: [teaConfigPath],
      homeDir: tmpDir,
      fetchUserProfile,
    });

    const loaded = await bridge.loadIdentities();
    expect(loaded.teamCollabAvailable).toBe(true);
    expect(loaded.teamCollabMembersCount).toBe(2);
    expect(loaded.identities.map((i) => i.id)).toEqual(["alice", "bob", "tea:charlie-ops"]);

    // Verify alice was enriched with giteaUrl & sshHost from overlapping tea login instead of duplicated
    const aliceRec = loaded.identities.find((i) => i.id === "alice")!;
    expect(aliceRec.giteaUrl).toBe("https://git.corp.local");
    expect(aliceRec.sshHost).toBe("git.corp.local");

    // Verify charlie profile was resolved via fetchUserProfile
    const charlieRec = loaded.identities.find((i) => i.id === "tea:charlie-ops")!;
    expect(charlieRec.name).toBe("Charlie Ops");
    expect(charlieRec.email).toBe("charlie@corp.local");
    expect(fetchUserProfile).toHaveBeenCalledTimes(1);

    // Verify public summary masks secrets and never leaks raw tokens
    const summaries = loaded.identities.map((i) => bridge.toIdentitySummary(i));
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toContain(aliceToken);
    expect(serialized).not.toContain(bobToken);
    expect(serialized).not.toContain(charlieToken);
    expect(summaries[0]).toMatchObject({
      id: "alice",
      source: "team-collab",
      hasToken: true,
      tokenPreview: "••••5678",
      hasSshKey: true,
      sshKeyPathPreview: "~/id_ed25519_alice",
    });
  });

  it("picks explicit preferredIdentityId (@bob) in ProjectGiteaResolver and fails closed without leaking @alice token on missing token or host mismatch", async () => {
    fs.writeFileSync(
      path.join(teamCollabDir, "roster.json"),
      JSON.stringify({
        version: 1,
        members: [
          {
            id: "alice",
            name: "Alice Chen",
            email: "alice@corp.local",
            giteaUsername: "alice",
            enabled: true,
          },
          {
            id: "bob",
            name: "Bob Wang",
            email: "bob@corp.local",
            giteaUsername: "bob",
            enabled: true,
          },
          {
            id: "notoken",
            name: "No Token User",
            email: "notoken@corp.local",
            giteaUsername: "notoken",
            enabled: true,
          },
          {
            id: "otherhost",
            name: "Other Host User",
            email: "other@other.local",
            giteaUsername: "other",
            enabled: true,
          },
        ],
        removedIds: [],
      }),
      "utf8",
    );

    fs.writeFileSync(
      path.join(teamCollabDir, "secrets.json"),
      JSON.stringify({
        version: 1,
        secrets: {
          alice: {
            giteaToken: "tok_alice_secret",
            giteaUrl: "https://git.corp.local",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
          bob: {
            giteaToken: "tok_bob_secret",
            giteaUrl: "https://git.corp.local",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
          notoken: {
            sshKeyPath: "/Users/notoken/.ssh/id_ed25519",
            giteaUrl: "https://git.corp.local",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
          otherhost: {
            giteaToken: "tok_other_secret",
            giteaUrl: "https://git.other-company.com",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );

    const bridge = new GiteaIdentityBridge({
      teamCollabDataDir: teamCollabDir,
      teaConfigPaths: [],
      fetchUserProfile: null,
    });

    const resolver = new ProjectGiteaResolver({
      resolveGitRemote: async () => "git@git.corp.local:org/backend.git",
      resolveSshHost: async (h) => h,
      runTea: async () => ({ stdout: "[]", stderr: "" }),
      probeUrl: async () => true,
      env: { GITEA_TOKEN: "env_fallback_should_not_leak" },
      identityBridge: bridge,
    });

    // 1. Selecting bob picks bob's token & identity even though alice is first
    const resolvedBob = await resolver.resolveProject(
      { projectId: "proj-1", projectRootPath: "/repo" },
      { preferredIdentityId: "bob" },
    );
    expect(resolvedBob).toMatchObject({
      authSource: "team-collab",
      token: "tok_bob_secret",
      baseUrl: "https://git.corp.local",
      activeIdentity: {
        id: "bob",
        source: "team-collab",
        name: "Bob Wang",
        email: "bob@corp.local",
        giteaUsername: "bob",
      },
    });

    // 2. Selecting notoken fails closed with anonymous authSource and clear reason (never leaks alice or env token)
    const resolvedNoToken = await resolver.resolveProject(
      { projectId: "proj-1", projectRootPath: "/repo" },
      { preferredIdentityId: "notoken" },
    );
    expect(resolvedNoToken?.authSource).toBe("anonymous");
    expect(resolvedNoToken?.token).toBe("");
    expect(resolvedNoToken?.errorMessage).toContain("未配置 Gitea HTTP Token");
    expect(resolvedNoToken?.activeIdentity?.id).toBe("notoken");

    // 3. Selecting otherhost fails closed on host mismatch
    const resolvedMismatch = await resolver.resolveProject(
      { projectId: "proj-1", projectRootPath: "/repo" },
      { preferredIdentityId: "otherhost" },
    );
    expect(resolvedMismatch?.authSource).toBe("anonymous");
    expect(resolvedMismatch?.token).toBe("");
    expect(resolvedMismatch?.errorMessage).toContain("绑定的服务端与当前仓库");

    // 4. Selecting non-existent identity fails closed
    const resolvedMissing = await resolver.resolveProject(
      { projectId: "proj-1", projectRootPath: "/repo" },
      { preferredIdentityId: "ghost-user" },
    );
    expect(resolvedMissing?.authSource).toBe("anonymous");
    expect(resolvedMissing?.token).toBe("");
    expect(resolvedMissing?.errorMessage).toContain("未找到所选 Gitea 身份: ghost-user");
  });

  it("dynamically switches workflow run identity to Issue Assignee when preferIssueAssignee is enabled", async () => {
    fs.writeFileSync(
      path.join(teamCollabDir, "roster.json"),
      JSON.stringify({
        version: 1,
        members: [
          {
            id: "alice",
            name: "Alice Chen",
            email: "alice@corp.local",
            giteaUsername: "alice",
            enabled: true,
          },
          {
            id: "bob",
            name: "Bob Wang",
            email: "bob@corp.local",
            giteaUsername: "bob_dev",
            enabled: true,
          },
        ],
        removedIds: [],
      }),
      "utf8",
    );

    fs.writeFileSync(
      path.join(teamCollabDir, "secrets.json"),
      JSON.stringify({
        version: 1,
        secrets: {
          alice: {
            giteaToken: "tok_alice",
            giteaUrl: "https://git.corp.local",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
          bob: {
            giteaToken: "tok_bob",
            giteaUrl: "https://git.corp.local",
            sshKeyPath: "/Users/bob/.ssh/id_ed25519",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );

    const bridge = new GiteaIdentityBridge({
      teamCollabDataDir: teamCollabDir,
      teaConfigPaths: [],
      fetchUserProfile: null,
    });

    let preferIssueAssignee = true;
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("direct_pr"),
      getBaseBranch: vi.fn().mockReturnValue("main"),
      getGiteaIdentityId: vi.fn().mockReturnValue("alice"),
      getPreferIssueAssignee: vi.fn().mockImplementation(() => preferIssueAssignee),
    };

    const resolver = new ProjectGiteaResolver({
      resolveGitRemote: async () => "git@git.corp.local:org/repo.git",
      resolveSshHost: async (h) => h,
      runTea: async () => ({ stdout: "[]", stderr: "" }),
      identityBridge: bridge,
    });

    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([
        {
          number: 88,
          title: "Assigned to Bob",
          body: "Implement feature",
          labels: [{ name: "agent-ready" }],
          assignee: { login: "bob_dev", email: "bob@corp.local" },
        },
        {
          number: 89,
          title: "Unassigned task",
          body: "Fix typo",
          labels: [{ name: "agent-ready" }],
          assignee: null,
        },
      ]),
    };

    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue(null),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
      listEntries: vi.fn().mockResolvedValue([]),
    };

    const mockWorkflows = {
      runCreate: vi
        .fn()
        .mockImplementation(async (req: any) => ({ runId: `run-${req.input.issueNumber}` })),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      identityBridge: bridge,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () =>
        [{ projectId: "proj-1", projectRootPath: "/repo", projectKind: "git" }] as any,
      resolveWorkspace: async () => "wks-1",
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenCalledTimes(2);
    // Issue #88 (assigned to bob_dev) runs as bob
    expect(mockWorkflows.runCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        input: expect.objectContaining({
          issueNumber: 88,
          token: "tok_bob",
          identityId: "bob",
          identitySource: "team-collab",
          authorName: "Bob Wang",
          authorEmail: "bob@corp.local",
          giteaUsername: "bob_dev",
          sshKeyPath: "/Users/bob/.ssh/id_ed25519",
        }),
      }),
    );
    expect(mockIndexStore.recordRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        issueNumber: 88,
        token: "tok_bob",
        identityId: "bob",
        identitySource: "team-collab",
        authorName: "Bob Wang",
        authorEmail: "bob@corp.local",
        giteaUsername: "bob_dev",
      }),
    );

    // Issue #89 (unassigned) uses project default alice
    expect(mockWorkflows.runCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          issueNumber: 89,
          token: "tok_alice",
          identityId: "alice",
          identitySource: "team-collab",
          authorName: "Alice Chen",
          authorEmail: "alice@corp.local",
          giteaUsername: "alice",
        }),
      }),
    );

    // When preferIssueAssignee is false, Issue #88 stays pinned to alice
    preferIssueAssignee = false;
    mockWorkflows.runCreate.mockClear();
    mockIndexStore.recordRun.mockClear();

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        input: expect.objectContaining({
          issueNumber: 88,
          token: "tok_alice",
          identityId: "alice",
          authorName: "Alice Chen",
        }),
      }),
    );
  });

  it("applies worktree git identity only on worktrees, propagates team-collab.owner metadata to worktrees and agents, and authenticates deliver_pr push", async () => {
    const gitCalls: Array<{ cwd: string; args: string[] }> = [];
    let isWorktree = true;

    const bridge = new GiteaIdentityBridge({
      teamCollabDataDir: teamCollabDir,
      teaConfigPaths: [],
      fetchUserProfile: null,
      execGit: async (cwd, args) => {
        gitCalls.push({ cwd, args });
        if (args[0] === "rev-parse") {
          return {
            ok: true,
            code: 0,
            stdout: isWorktree
              ? "false\n/repo/.git/worktrees/wt-1\n/repo/.git"
              : "false\n/repo/.git\n/repo/.git",
            stderr: "",
          };
        }
        return { ok: true, code: 0, stdout: "", stderr: "" };
      },
    });

    const wtDir = path.join(tmpDir, "wt-1");
    fs.mkdirSync(wtDir, { recursive: true });

    // 1. Refuses mutating main checkout when gitDir === gitCommonDir
    isWorktree = false;
    const mainRes = await bridge.applyIdentityToWorktree(wtDir, {
      name: "Bob Wang",
      email: "bob@corp.local",
      sshKeyPath: "/Users/bob/.ssh/id_ed25519",
      source: "tea",
    });
    expect(mainRes).toEqual({ applied: false, isWorktree: false });
    expect(gitCalls).toHaveLength(1);

    // 2. Configures worktree user.name, user.email, and core.sshCommand on isolated worktree
    gitCalls.length = 0;
    isWorktree = true;
    const wtRes = await bridge.applyIdentityToWorktree(wtDir, {
      name: "Bob Wang",
      email: "bob@corp.local",
      sshKeyPath: "/Users/bob/.ssh/id_ed25519",
      source: "tea",
    });
    expect(wtRes).toEqual({ applied: true, isWorktree: true });
    expect(gitCalls.map((c) => c.args)).toEqual([
      ["rev-parse", "--is-bare-repository", "--git-dir", "--git-common-dir"],
      ["config", "extensions.worktreeConfig", "true"],
      ["config", "--worktree", "user.name", "Bob Wang"],
      ["config", "--worktree", "user.email", "bob@corp.local"],
      [
        "config",
        "--worktree",
        "core.sshCommand",
        "ssh -i '/Users/bob/.ssh/id_ed25519' -o IdentitiesOnly=yes",
      ],
    ]);

    // 3. createPluginStepExecutorHost.createWorktree passes team-collab.owner metadata to workspaces.create
    const mockWorkspaceCreate = vi.fn().mockResolvedValue({
      id: "ws-wt-88",
      directory: wtDir,
      current: () => ({
        workspaceDirectory: wtDir,
        gitRuntime: { currentBranch: "agent/issue-88" },
      }),
    });
    const mockStore = {
      list: () => [
        {
          id: "run-88",
          projectId: "proj-1",
          workspaceId: "ws-main",
          workspaceRoot: tmpDir,
          status: "running",
          runInput: {
            branch: "agent/issue-88",
            identityId: "bob",
            identitySource: "team-collab",
            authorName: "Bob Wang",
            authorEmail: "bob@corp.local",
            giteaUsername: "bob_dev",
          },
        },
      ],
    };

    const host = createPluginStepExecutorHost({
      paseoHome: tmpDir,
      getPaseo: () => ({ workspaces: { create: mockWorkspaceCreate } }) as any,
      store: mockStore as any,
      service: {} as any,
      identityBridge: bridge,
    });

    await host.createWorktree!({
      workspaceId: "ws-main",
      workspaceRoot: tmpDir,
      branch: "agent/issue-88",
      baseBranch: "main",
      title: "✨ #88 Assigned to Bob",
    });

    expect(mockWorkspaceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "✨ #88 Assigned to Bob",
        metadata: expect.objectContaining({
          "gitea-workflow": true,
          "gitea.assignee": "bob_dev",
          "team-collab.owner": expect.objectContaining({
            id: "bob",
            name: "Bob Wang",
            email: "bob@corp.local",
            kind: "member",
          }),
        }),
      }),
    );

    // 4. agent_execute propagates team-collab.owner metadata and gitea.assignee label (preserving agentHarnessBypassed)
    const setMetadataMock = vi.fn().mockResolvedValue(undefined);
    const createAgentMock = vi.fn().mockResolvedValue({
      id: "agent-bob-88",
      waitForFinish: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
    });
    const mockPaseoForAgent = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [{ id: "ws-wt-88", workspaceKind: "worktree", workspaceDirectory: wtDir }],
        }),
        ref: vi.fn().mockReturnValue({
          current: () => ({ id: "ws-wt-88", workspaceDirectory: wtDir, metadata: {} }),
          setMetadata: setMetadataMock,
          agents: { create: createAgentMock },
        }),
      },
    };
    const mockSettingsForAgent = {
      getHarnessMode: () => "disabled",
      getAgentProvider: () => "claude",
      getAgentChangeMode: () => "auto",
    };
    const mockIndexForAgent = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 88,
        issueTitle: "Assigned to Bob",
        repoOwner: "org",
        repoName: "repo",
        identityId: "bob",
        identitySource: "team-collab",
        authorName: "Bob Wang",
        authorEmail: "bob@corp.local",
        giteaUsername: "bob_dev",
      }),
    };

    const agentAdapter = createAgentExecuteAdapter(
      mockSettingsForAgent as any,
      mockIndexForAgent as any,
      bridge,
    );
    await agentAdapter.execute({ phase: "implement" }, {
      paseo: mockPaseoForAgent as any,
      run: {
        runId: "run-88",
        projectId: "proj-1",
        workspaceRoot: wtDir,
        stepOutputs: {
          "worktree-create": { workspaceId: "ws-wt-88", worktreePath: wtDir },
        },
      },
    } as any);

    expect(setMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        "team-collab.owner": expect.objectContaining({
          id: "bob",
          name: "Bob Wang",
          email: "bob@corp.local",
          kind: "member",
        }),
      }),
    );
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining({
          "gitea.assignee": "bob_dev",
        }),
        metadata: expect.objectContaining({
          agentHarnessBypassed: true,
          "team-collab.owner": expect.objectContaining({
            id: "bob",
            name: "Bob Wang",
            email: "bob@corp.local",
            kind: "member",
          }),
        }),
      }),
    );

    // 5. defaultPushBranch injects isolated HTTP Basic extraHeader via GIT_CONFIG_COUNT env (not -c argv) even when both token and sshKeyPath are present on HTTPS remote, blocks https->http downgrade, and redacts token without raw cause
    const pushExecCalls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const mockPushExec = vi
      .fn()
      .mockImplementation(async (_file: string, args: readonly string[], opts: any) => {
        pushExecCalls.push({ args, env: opts.env });
        if (args.includes("remote.origin.url")) {
          return { stdout: "https://git.corp.local/org/repo.git\n", stderr: "" };
        }
        if (args.includes("credential.helper")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });

    await defaultPushBranch(
      wtDir,
      "agent/issue-88",
      {
        token: "tok_bob_secret_999",
        baseUrl: "https://git.corp.local",
        giteaUsername: "bob_dev",
        sshKeyPath: "/Users/bob/.ssh/id_ed25519",
      },
      mockPushExec,
    );

    const expectedBasic = Buffer.from("bob_dev:tok_bob_secret_999", "utf8").toString("base64");
    const finalPushCall = pushExecCalls.at(-1)!;
    expect(finalPushCall.args).toEqual(["push", "-u", "origin", "--", "agent/issue-88"]);
    expect(finalPushCall.env?.GIT_CONFIG_COUNT).toBe("1");
    expect(finalPushCall.env?.GIT_CONFIG_KEY_0).toBe("http.https://git.corp.local/.extraHeader");
    expect(finalPushCall.env?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expectedBasic}`);
    expect(finalPushCall.env?.GIT_SSH_COMMAND).toBeUndefined();

    // Blocks https -> http downgrade when remote is http:// but baseUrl is https://
    const downgradeCalls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const downgradePushExec = vi
      .fn()
      .mockImplementation(async (_file: string, args: readonly string[], opts: any) => {
        downgradeCalls.push({ args, env: opts.env });
        if (args.includes("remote.origin.url")) {
          return { stdout: "http://git.corp.local/org/repo.git\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });

    await defaultPushBranch(
      wtDir,
      "agent/issue-88",
      {
        token: "tok_bob_secret_999",
        baseUrl: "https://git.corp.local",
        giteaUsername: "bob_dev",
      },
      downgradePushExec,
    );
    expect(downgradeCalls.at(-1)?.env?.GIT_CONFIG_COUNT).toBeUndefined();
    expect(downgradeCalls.at(-1)?.env?.GIT_CONFIG_VALUE_0).toBeUndefined();

    // Verify error redaction hides both raw token and base64 basic auth and does NOT attach raw cause
    const failingPushExec = vi
      .fn()
      .mockImplementation(async (_file: string, args: readonly string[]) => {
        if (args.includes("remote.origin.url")) {
          return { stdout: "https://git.corp.local/org/repo.git\n", stderr: "" };
        }
        if (args.includes("credential.helper")) {
          return { stdout: "", stderr: "" };
        }
        throw new Error(
          `Push failed with Authorization: Basic ${expectedBasic} and token tok_bob_secret_999`,
        );
      });

    let caughtPushErr: Error | undefined;
    try {
      await defaultPushBranch(
        wtDir,
        "agent/issue-88",
        {
          token: "tok_bob_secret_999",
          baseUrl: "https://git.corp.local",
          giteaUsername: "bob_dev",
        },
        failingPushExec,
      );
    } catch (err) {
      caughtPushErr = err as Error;
    }
    expect(caughtPushErr).toBeDefined();
    expect(caughtPushErr?.message).toMatch(/\[redacted\]/);
    expect(caughtPushErr?.message).not.toContain("tok_bob_secret_999");
    expect(caughtPushErr?.message).not.toContain(expectedBasic);
    expect((caughtPushErr as { cause?: unknown })?.cause).toBeUndefined();

    // Verify deliver_pr adapter passes pushAuth to pushBranch when identity is present
    const pushBranchSpy = vi.fn().mockResolvedValue(undefined);
    const deliverAdapter = createDeliverPrAdapter(
      {
        getClient: () => ({
          createPullRequest: vi
            .fn()
            .mockResolvedValue({ url: "https://git.corp.local/org/repo/pulls/1" }),
          markReviewed: vi.fn().mockResolvedValue(undefined),
        }),
      } as any,
      mockIndexForAgent as any,
      undefined,
      {
        pushBranch: pushBranchSpy,
        getDefaultBaseBranch: async () => "main",
        identityBridge: bridge,
      },
    );

    await deliverAdapter.execute({}, {
      paseo: {} as any,
      run: {
        runId: "run-88",
        projectId: "proj-1",
        workspaceRoot: wtDir,
        runInput: {
          baseUrl: "https://git.corp.local",
          token: "tok_bob_secret_999",
          branch: "agent/issue-88",
          identityId: "bob",
          identitySource: "team-collab",
          giteaUsername: "bob_dev",
          sshKeyPath: "/Users/bob/.ssh/id_ed25519",
        },
      },
    } as any);

    expect(pushBranchSpy).toHaveBeenCalledWith(wtDir, "agent/issue-88", {
      token: "tok_bob_secret_999",
      baseUrl: "https://git.corp.local",
      giteaUsername: "bob_dev",
      sshKeyPath: "/Users/bob/.ssh/id_ed25519",
    });
  });

  it("enforces 0o600 permissions on issue-index.json in IssueRunIndexStore", async () => {
    const indexDir = path.join(tmpDir, "secure-store");
    const indexFile = path.join(indexDir, "issue-index.json");
    const store = new IssueRunIndexStore(indexFile);

    await store.recordRun({
      projectId: "proj-1",
      repoOwner: "org",
      repoName: "repo",
      issueNumber: 77,
      runId: "run-77",
      token: "tok_secret_77",
      identityId: "alice",
      sshKeyPath: "/Users/alice/.ssh/id_ed25519",
    });

    const fileStat = fs.statSync(indexFile);
    const dirStat = fs.statSync(indexDir);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("wires context.run.runInput into fetch_issue and claim_issue when indexStore is empty, and fails closed when identityId has empty token", async () => {
    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({
        number: 55,
        title: "Test runInput fallback",
        body: "Body",
        html_url: "https://git.corp.local/org/repo/issues/55",
        labels: [{ id: 10, name: "agent-ready" }],
      }),
      claimIssue: vi.fn().mockResolvedValue(undefined),
    };
    const getClientSpy = vi.fn().mockReturnValue(mockClient);
    const mockPool = { getClient: getClientSpy } as unknown as GiteaClientPool;
    const emptyIndexStore = new IssueRunIndexStore(path.join(tmpDir, "empty-index.json"));

    const fetchAdapter = createFetchIssueAdapter(mockPool, emptyIndexStore);
    const claimAdapter = createClaimIssueAdapter(mockPool, emptyIndexStore);

    const runContext = {
      paseo: {} as any,
      run: {
        runId: "run-not-yet-flushed",
        projectId: "proj-1",
        runInput: {
          baseUrl: "https://git.corp.local",
          token: "tok_from_run_input",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 55,
          identityId: "bob",
        },
      },
    };

    const fetched = await fetchAdapter.execute({}, runContext as any);
    expect(fetched.issueNumber).toBe(55);
    expect(getClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        giteaUrl: "https://git.corp.local",
        giteaToken: "tok_from_run_input",
        repoOwner: "org",
        repoName: "repo",
        identityId: "bob",
      }),
    );

    const claimed = await claimAdapter.execute({}, runContext as any);
    expect(claimed.claimed).toBe(true);
    expect(mockClient.claimIssue).toHaveBeenCalledWith(55, 10);

    // Fail-closed when identityId is set in runInput with empty token (never falls back to process.env.GITEA_TOKEN)
    const missingTokenContext = {
      paseo: {} as any,
      run: {
        runId: "run-no-token",
        projectId: "proj-1",
        runInput: {
          baseUrl: "https://git.corp.local",
          token: "",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 55,
          identityId: "bob",
        },
      },
    };

    await expect(fetchAdapter.execute({}, missingTokenContext as any)).rejects.toThrow(
      /Selected Gitea identity \(bob\) has no valid token for this run/,
    );
    await expect(claimAdapter.execute({}, missingTokenContext as any)).rejects.toThrow(
      /Selected Gitea identity \(bob\) has no valid token for this run/,
    );
  });

  it("does not inherit default identity sshKeyPath when switching to matchedAssigneeIdentity without sshKey, and matches assignees via baseUrl host when resolved.host is an SSH alias", async () => {
    fs.writeFileSync(
      path.join(teamCollabDir, "roster.json"),
      JSON.stringify({
        version: 1,
        members: [
          {
            id: "alice",
            name: "Alice Default",
            email: "alice@corp.local",
            giteaUsername: "alice",
            enabled: true,
          },
          {
            id: "bob",
            name: "Bob HTTP Only",
            email: "bob@corp.local",
            giteaUsername: "bob_http",
            enabled: true,
          },
        ],
        removedIds: [],
      }),
      "utf8",
    );

    fs.writeFileSync(
      path.join(teamCollabDir, "secrets.json"),
      JSON.stringify({
        version: 1,
        secrets: {
          alice: {
            giteaToken: "tok_alice",
            giteaUrl: "https://git.corp.local",
            sshKeyPath: "/Users/alice/.ssh/id_ed25519_alice",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
          bob: {
            giteaToken: "tok_bob",
            giteaUrl: "https://git.corp.local",
            // Bob has NO sshKeyPath!
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );

    const bridge = new GiteaIdentityBridge({
      teamCollabDataDir: teamCollabDir,
      teaConfigPaths: [],
      fetchUserProfile: null,
    });

    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-ssh-alias",
        projectPath: "/repo",
        projectName: "repo",
        host: "corp-gitea-ssh-alias",
        baseUrl: "https://git.corp.local",
        token: "tok_alice",
        repoOwner: "org",
        repoName: "repo",
        authSource: "team-collab",
        sshKeyPath: "/Users/alice/.ssh/id_ed25519_alice",
        activeIdentity: {
          id: "alice",
          source: "team-collab",
          name: "Alice Default",
          email: "alice@corp.local",
          giteaUsername: "alice",
        },
      }),
    };

    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("direct_pr"),
      getBaseBranch: vi.fn().mockReturnValue("main"),
      getGiteaIdentityId: vi.fn().mockReturnValue("alice"),
      getPreferIssueAssignee: vi.fn().mockReturnValue(true),
    };

    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([
        {
          number: 92,
          title: "Assigned to Bob via SSH alias repo",
          body: "Should match Bob via baseUrl and clear sshKeyPath",
          labels: [{ name: "agent-ready" }],
          assignee: { login: "bob_http", email: "bob@corp.local" },
        },
      ]),
    };

    const mockIndexStore = {
      getRunIdForIssue: vi.fn().mockResolvedValue(null),
      recordRun: vi.fn().mockResolvedValue(undefined),
      removeRun: vi.fn().mockResolvedValue(undefined),
      listEntries: vi.fn().mockResolvedValue([]),
    };

    const mockWorkflows = {
      runCreate: vi.fn().mockResolvedValue({ runId: "run-92" }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      identityBridge: bridge,
      getWorkflows: () => mockWorkflows as any,
      getProjects: async () =>
        [{ projectId: "proj-ssh-alias", projectRootPath: "/repo", projectKind: "git" }] as any,
      resolveWorkspace: async () => "wks-1",
    });

    await poller.poll();

    expect(mockWorkflows.runCreate).toHaveBeenCalledTimes(1);
    const createdInput = mockWorkflows.runCreate.mock.calls[0][0].input;
    expect(createdInput).toMatchObject({
      issueNumber: 92,
      token: "tok_bob",
      identityId: "bob",
      authorName: "Bob HTTP Only",
      authorEmail: "bob@corp.local",
      giteaUsername: "bob_http",
    });
    expect(createdInput.sshKeyPath).toBeUndefined();
  });
});
