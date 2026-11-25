import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PluginHookAgent,
  PluginHookContext,
  PluginHookRequests,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import {
  DEFAULT_TEAM_COLLAB_SETTINGS,
  SYSTEM_BOT_MEMBER_ID,
  TEAM_COLLAB_OWNER_META_KEY,
  type TeamCollabPolicies,
  type WorkspaceOwnerMetadata,
} from "../shared/contracts.js";
import { AttributionGuard, isProtectedGitWriteCommand } from "../server/attribution-guard.js";
import { GitConfigurator } from "../server/git-configurator.js";
import { SecretStore } from "../server/secret-store.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

interface FakeWorkspaceState {
  id: string;
  cwd: string;
  metadata: Record<string, unknown>;
  labels?: string[];
}

interface FakeAgentState {
  id: string;
  workspaceId: string | null;
  cwd: string;
  status?: "idle" | "running" | "closed";
  labels?: Record<string, string>;
  metadata: Record<string, unknown>;
  reloadCount?: number;
  permissionResponses: Array<{
    requestId: string;
    response: { behavior: "allow" | "deny"; message?: string };
  }>;
}

function createFakeHookContext(
  workspaces: Map<string, FakeWorkspaceState>,
  agents: Map<string, FakeAgentState>,
): PluginHookContext {
  const signal = new AbortController().signal;
  const paseo = {
    workspaces: {
      list: async () => ({
        requestId: "req_ws_list",
        entries: Array.from(workspaces.values()).map((ws) => ({
          id: ws.id,
          projectId: "proj_1",
          projectDisplayName: "Demo",
          projectRootPath: ws.cwd,
          workspaceDirectory: ws.cwd,
          projectKind: "git" as const,
          workspaceKind: "worktree" as const,
          name: ws.id,
          archivingAt: null,
          status: "active" as const,
          statusEnteredAt: null,
          activityAt: null,
          scripts: [],
          labels: ws.labels ?? [],
          metadata: ws.metadata,
          gitRuntime: null,
          githubRuntime: null,
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      ref: (idOrObj: string | { id: string }) => {
        const id = typeof idOrObj === "string" ? idOrObj : idOrObj.id;
        const getWs = () => {
          const ws = workspaces.get(id);
          if (!ws) return null;
          return {
            id: ws.id,
            projectId: "proj_1",
            projectDisplayName: "Demo",
            projectRootPath: ws.cwd,
            workspaceDirectory: ws.cwd,
            projectKind: "git" as const,
            workspaceKind: "worktree" as const,
            name: ws.id,
            archivingAt: null,
            status: "active" as const,
            statusEnteredAt: null,
            activityAt: null,
            scripts: [],
            labels: ws.labels ?? [],
            metadata: ws.metadata,
            gitRuntime: null,
            githubRuntime: null,
          };
        };
        return {
          id,
          current: () => getWs(),
          refresh: async () => getWs(),
          setLabel: async (name: string, options: { assigned: boolean }) => {
            const ws = workspaces.get(id);
            if (!ws) throw new Error(`Workspace ${id} not found`);
            const set = new Set(ws.labels ?? []);
            if (options.assigned) set.add(name);
            else set.delete(name);
            ws.labels = Array.from(set);
          },
          setMetadata: async (patch: Record<string, unknown>) => {
            const ws = workspaces.get(id);
            if (!ws) throw new Error(`Workspace ${id} not found`);
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete ws.metadata[k];
              else ws.metadata[k] = v;
            }
          },
        };
      },
    },
    agents: {
      list: async () => ({
        requestId: "req_ag_list",
        entries: Array.from(agents.values()).map((ag) => ({
          agent: {
            id: ag.id,
            workspaceId: ag.workspaceId ?? undefined,
            cwd: ag.cwd,
            status: ag.status ?? "idle",
            labels: ag.labels ?? {},
            metadata: ag.metadata,
          },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      ref: (idOrObj: string | { id: string }) => {
        const id = typeof idOrObj === "string" ? idOrObj : idOrObj.id;
        const getAg = () => {
          const ag = agents.get(id);
          if (!ag) return null;
          return {
            id: ag.id,
            workspaceId: ag.workspaceId ?? undefined,
            cwd: ag.cwd,
            status: ag.status ?? "idle",
            labels: ag.labels ?? {},
            metadata: ag.metadata,
          };
        };
        return {
          id,
          current: () => getAg(),
          refresh: async () => {
            const snap = getAg();
            return snap ? { agent: snap, project: null } : null;
          },
          reload: async () => {
            const ag = agents.get(id);
            if (ag) {
              ag.reloadCount = (ag.reloadCount ?? 0) + 1;
            }
            const snap = getAg();
            return snap ? { agent: snap, project: null } : null;
          },
          setMetadata: async (patch: Record<string, unknown>) => {
            const ag = agents.get(id);
            if (!ag) return;
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete ag.metadata[k];
              else ag.metadata[k] = v;
            }
          },
          respondToPermission: async (opts: {
            requestId: string;
            response: { behavior: "allow" | "deny"; message?: string };
          }) => {
            const ag = agents.get(id);
            if (ag) {
              ag.permissionResponses.push(opts);
            }
          },
        };
      },
    },
  };
  return {
    signal,
    paseo: paseo as unknown as PluginHookContext["paseo"],
  };
}

describe("AttributionGuard & command classifier", () => {
  let tempRoot: string;
  let dataDir: string;
  let mainRepoDir: string;
  let worktreeDir: string;
  let store: SecretStore;
  let gitConfigurator: GitConfigurator;
  let policies: TeamCollabPolicies;
  let workspaces: Map<string, FakeWorkspaceState>;
  let agents: Map<string, FakeAgentState>;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "team-collab-guard-"));
    dataDir = path.join(tempRoot, "plugin-data");
    mainRepoDir = path.join(tempRoot, "main-repo");
    worktreeDir = path.join(tempRoot, "wt-alice");
    store = new SecretStore({ dataDir });
    gitConfigurator = new GitConfigurator({ secretStore: store });
    policies = {
      enforceWorktreeOnCreate: true,
      blockUnclaimedGitCommitPush: true,
      allowSharedLocalCheckoutCommit: false,
      retentionDays: DEFAULT_TEAM_COLLAB_SETTINGS.retentionDays,
    };
    workspaces = new Map();
    agents = new Map();

    fs.mkdirSync(mainRepoDir, { recursive: true });
    git(mainRepoDir, ["init", "-b", "main"]);
    git(mainRepoDir, ["config", "user.name", "Host Default"]);
    git(mainRepoDir, ["config", "user.email", "host@local"]);
    fs.writeFileSync(path.join(mainRepoDir, "index.ts"), "export const x = 1;\n");
    git(mainRepoDir, ["add", "index.ts"]);
    git(mainRepoDir, ["commit", "-m", "init"]);
    git(mainRepoDir, ["worktree", "add", "-b", "feat/alice", worktreeDir]);

    store.upsertMember(
      {
        id: "alice",
        name: "Alice Chen",
        email: "alice@corp.local",
        giteaUsername: "alice-gitea",
        githubUsername: "alice-gh",
        enabled: true,
      },
      {
        giteaToken: "gta_alice_secret_1234",
        giteaUrl: "https://gitea.corp.local",
        githubToken: "ghp_alice_secret_5678",
      },
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("precisely detects git commit/push and PR creation while allowing read-only git commands", () => {
    expect(isProtectedGitWriteCommand("git commit -m 'feat: init'")).toBe(true);
    expect(isProtectedGitWriteCommand("git -C /tmp/repo -c user.name=a push origin main")).toBe(
      true,
    );
    expect(isProtectedGitWriteCommand("npm test && git push --force-with-lease")).toBe(true);
    expect(isProtectedGitWriteCommand("gh pr create --fill")).toBe(true);
    expect(isProtectedGitWriteCommand("tea pulls create --title 'Fix bug'")).toBe(true);
    expect(isProtectedGitWriteCommand("bash -lc \"git add . && git commit -m 'msg'\"")).toBe(true);

    expect(isProtectedGitWriteCommand("git status --short")).toBe(false);
    expect(isProtectedGitWriteCommand("git diff HEAD~1")).toBe(false);
    expect(isProtectedGitWriteCommand("git log -n 5 --oneline")).toBe(false);
    expect(isProtectedGitWriteCommand('git log --grep="git commit"')).toBe(false);
    expect(isProtectedGitWriteCommand('echo "do not run git push"')).toBe(false);
    expect(isProtectedGitWriteCommand("tea pr list")).toBe(false);
    expect(isProtectedGitWriteCommand("gh pr view 12")).toBe(false);

    // Prefix wrappers with value arguments & eval/shell recursion ([MEDIUM-05])
    expect(
      isProtectedGitWriteCommand("env -u GIT_AUTHOR_NAME -C /tmp/repo git commit -m 'x'"),
    ).toBe(true);
    expect(isProtectedGitWriteCommand('env -S "FOO=1 git push origin main"')).toBe(true);
    expect(isProtectedGitWriteCommand("sudo -u dev -g wheel -D /tmp/repo git push")).toBe(true);
    expect(isProtectedGitWriteCommand("timeout -k 5s -s TERM 30s git push origin HEAD")).toBe(true);
    expect(isProtectedGitWriteCommand("timeout 60 gh pr create --fill")).toBe(true);
    expect(
      isProtectedGitWriteCommand("nice -n 10 stdbuf -o L nohup command git commit -m 'bg'"),
    ).toBe(true);
    expect(isProtectedGitWriteCommand('eval "git add . && git push"')).toBe(true);
    expect(isProtectedGitWriteCommand('zsh -c "tea pr create --title test"')).toBe(true);

    expect(isProtectedGitWriteCommand("command -v git")).toBe(false);
    expect(isProtectedGitWriteCommand("timeout 10s git status")).toBe(false);
    expect(isProtectedGitWriteCommand("env -u FOO git diff")).toBe(false);
  });

  it("converts main git checkout directory workspace creation into worktree, while skipping empty or non-git directories", async () => {
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    // 1. Main checkout with commit -> converted to worktree branch-off
    const converted = await guard.handleWorkspaceCreateBefore(
      {
        request: {
          source: { kind: "directory", path: mainRepoDir, projectId: "proj_1" },
        },
      },
      ctx,
    );
    expect(converted?.source).toEqual({
      kind: "worktree",
      cwd: mainRepoDir,
      projectId: "proj_1",
      action: "branch-off",
    });

    // 2. Non-git directory -> untouched
    const plainDir = path.join(tempRoot, "plain-folder");
    fs.mkdirSync(plainDir);
    const nonGitRes = await guard.handleWorkspaceCreateBefore(
      {
        request: {
          source: { kind: "directory", path: plainDir },
        },
      },
      ctx,
    );
    expect(nonGitRes?.source ?? { kind: "directory", path: plainDir }).toEqual({
      kind: "directory",
      path: plainDir,
    });

    // 3. Empty git repository with no HEAD commit -> untouched
    const emptyGitDir = path.join(tempRoot, "empty-git");
    fs.mkdirSync(emptyGitDir);
    git(emptyGitDir, ["init"]);
    const emptyGitRes = await guard.handleWorkspaceCreateBefore(
      {
        request: {
          source: { kind: "directory", path: emptyGitDir },
        },
      },
      ctx,
    );
    expect(emptyGitRes?.source ?? { kind: "directory", path: emptyGitDir }).toEqual({
      kind: "directory",
      path: emptyGitDir,
    });

    // 4. Existing linked worktree -> untouched
    const existingWtRes = await guard.handleWorkspaceCreateBefore(
      {
        request: {
          source: { kind: "directory", path: worktreeDir },
        },
      },
      ctx,
    );
    expect(existingWtRes?.source ?? { kind: "directory", path: worktreeDir }).toEqual({
      kind: "directory",
      path: worktreeDir,
    });
  });

  it("matches gitea-workflow assignee to member or falls back to system-bot, and inherits workspace owner on child agents", async () => {
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    // Automation workspace with gitea assignee matching alice-gitea
    const matchedWsReq = await guard.handleWorkspaceCreateBefore(
      {
        request: {
          title: "Workflow Issue #42 (@alice-gitea)",
          metadata: {
            "gitea.workflow": true,
            "gitea.assignee": "alice-gitea",
          },
          source: { kind: "worktree", cwd: mainRepoDir, action: "branch-off" },
        },
      },
      ctx,
    );
    expect(matchedWsReq?.metadata?.[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({
      id: "alice",
      email: "alice@corp.local",
      kind: "member",
    });

    // Automation workspace with unknown assignee -> system-bot
    const botWsReq = await guard.handleWorkspaceCreateBefore(
      {
        request: {
          title: "Workflow Issue #99",
          metadata: {
            "gitea.workflow": true,
            "gitea.assignee": "nobody",
          },
          source: { kind: "worktree", cwd: mainRepoDir, action: "branch-off" },
        },
      },
      ctx,
    );
    expect(botWsReq?.metadata?.[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({
      id: SYSTEM_BOT_MEMBER_ID,
      kind: "bot",
    });

    // Register workspace owned by Alice and spawn a child agent in worktreeDir
    const aliceOwner: WorkspaceOwnerMetadata = {
      id: "alice",
      name: "Alice Chen",
      email: "alice@corp.local",
      kind: "member",
      assignedAt: "2026-11-24T00:00:00.000Z",
    };
    workspaces.set("wks_alice", {
      id: "wks_alice",
      cwd: worktreeDir,
      metadata: { [TEAM_COLLAB_OWNER_META_KEY]: aliceOwner },
    });

    const agentCreateReq: PluginHookRequests["agent.create.before"] = {
      config: { provider: "claude", cwd: worktreeDir },
      metadata: {},
    };
    const inheritedAgentReq = await guard.handleAgentCreateBefore({ request: agentCreateReq }, ctx);
    expect(inheritedAgentReq?.metadata?.[TEAM_COLLAB_OWNER_META_KEY]).toEqual(aliceOwner);

    // Unattended workflow agent in unclaimed directory -> system-bot
    const unattendedAgentReq = await guard.handleAgentCreateBefore(
      {
        request: {
          config: { provider: "codex", cwd: path.join(tempRoot, "other-wt") },
          labels: {
            "paseo.workflow": "gitea-workflow",
            "paseo.workflow.unattended": "1",
          },
          metadata: {},
        },
      },
      ctx,
    );
    expect(unattendedAgentReq?.metadata?.[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({
      id: SYSTEM_BOT_MEMBER_ID,
      kind: "bot",
    });
  });

  it("injects member env + tea PATH on claimed worktree, exempts system-bot, and blocks unclaimed git commit/push while allowing git status/diff", async () => {
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    // 1. Claimed workspace via assignWorkspaceOwner
    workspaces.set("wks_claimed", {
      id: "wks_claimed",
      cwd: worktreeDir,
      metadata: {},
    });
    agents.set("ag_claimed", {
      id: "ag_claimed",
      workspaceId: "wks_claimed",
      cwd: worktreeDir,
      metadata: {},
      permissionResponses: [],
    });

    const assignRes = await guard.assignWorkspaceOwner(
      { workspaceId: "wks_claimed", memberId: "alice" },
      ctx.paseo,
    );
    expect(assignRes.gitConfigured).toBe(true);
    expect(assignRes.isWorktree).toBe(true);
    expect(agents.get("ag_claimed")?.metadata[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({
      id: "alice",
      kind: "member",
    });

    const baseOpenReq: PluginSessionOpenRequest = {
      agentId: "ag_claimed",
      workspaceId: "wks_claimed",
      provider: "claude",
      cwd: worktreeDir,
      reason: "create",
      purpose: "interactive",
      title: "Feature work",
      background: false,
      labels: {},
      metadata: agents.get("ag_claimed")!.metadata as Record<string, string>,
      tools: [],
      env: { PATH: "/usr/bin:/bin" },
      mcpServers: {},
    };
    const openedClaimed = await guard.handleAgentOpenBefore({ request: baseOpenReq }, ctx);
    expect(openedClaimed?.env).toMatchObject({
      GIT_AUTHOR_NAME: "Alice Chen",
      GIT_AUTHOR_EMAIL: "alice@corp.local",
      GIT_COMMITTER_NAME: "Alice Chen",
      GIT_COMMITTER_EMAIL: "alice@corp.local",
      GH_TOKEN: "ghp_alice_secret_5678",
      GITEA_TOKEN: "gta_alice_secret_1234",
      TEAM_COLLAB_OWNER_ID: "alice",
    });
    expect(openedClaimed?.env.PATH.startsWith(path.join(dataDir, "shims", "alice"))).toBe(true);
    expect(openedClaimed?.appendSystemPrompt ?? []).toHaveLength(0);

    // 2. Unclaimed workspace -> appends prohibition prompt & denies git commit/push, allows git status/diff
    const unclaimedWt = path.join(tempRoot, "wt-unclaimed");
    git(mainRepoDir, ["worktree", "add", "-b", "feat/unclaimed", unclaimedWt]);
    workspaces.set("wks_unclaimed", {
      id: "wks_unclaimed",
      cwd: unclaimedWt,
      metadata: {},
    });
    agents.set("ag_unclaimed", {
      id: "ag_unclaimed",
      workspaceId: "wks_unclaimed",
      cwd: unclaimedWt,
      metadata: {},
      permissionResponses: [],
    });

    const openedUnclaimed = await guard.handleAgentOpenBefore(
      {
        request: {
          ...baseOpenReq,
          agentId: "ag_unclaimed",
          workspaceId: "wks_unclaimed",
          cwd: unclaimedWt,
          metadata: {},
        },
      },
      ctx,
    );
    expect(openedUnclaimed?.appendSystemPrompt?.join("\n")).toContain("/iam");
    expect(openedUnclaimed?.appendSystemPrompt?.join("\n")).toContain("git commit");

    const unclaimedAgentHook: PluginHookAgent = {
      id: "ag_unclaimed",
      workspaceId: "wks_unclaimed",
      parentAgentId: null,
      provider: "claude",
      cwd: unclaimedWt,
      title: "Unclaimed session",
      background: false,
      metadata: {},
    };

    // Allowed: git status & git diff
    await guard.handleAgentPermissionBefore(
      {
        agent: unclaimedAgentHook,
        request: {
          id: "perm_status",
          provider: "claude",
          name: "Bash",
          kind: "tool",
          input: { command: "git status && git diff" },
        },
      },
      ctx,
    );
    expect(agents.get("ag_unclaimed")!.permissionResponses).toHaveLength(0);

    // Blocked: git commit
    await guard.handleAgentPermissionBefore(
      {
        agent: unclaimedAgentHook,
        request: {
          id: "perm_commit",
          provider: "claude",
          name: "Bash",
          kind: "tool",
          input: { command: 'git commit -m "sneaky commit"' },
        },
      },
      ctx,
    );
    expect(agents.get("ag_unclaimed")!.permissionResponses).toHaveLength(1);
    expect(agents.get("ag_unclaimed")!.permissionResponses[0]).toMatchObject({
      requestId: "perm_commit",
      response: { behavior: "deny" },
    });

    // 3. System-bot workspace -> exempted from prompt block and permission block
    workspaces.set("wks_bot", {
      id: "wks_bot",
      cwd: unclaimedWt,
      metadata: {},
    });
    agents.set("ag_bot", {
      id: "ag_bot",
      workspaceId: "wks_bot",
      cwd: unclaimedWt,
      metadata: {},
      permissionResponses: [],
    });
    await guard.assignWorkspaceOwner(
      { workspaceId: "wks_bot", memberId: SYSTEM_BOT_MEMBER_ID },
      ctx.paseo,
    );

    const openedBot = await guard.handleAgentOpenBefore(
      {
        request: {
          ...baseOpenReq,
          agentId: "ag_bot",
          workspaceId: "wks_bot",
          cwd: unclaimedWt,
          metadata: {},
        },
      },
      ctx,
    );
    expect(openedBot?.env.TEAM_COLLAB_OWNER_ID).toBe(SYSTEM_BOT_MEMBER_ID);
    expect(openedBot?.appendSystemPrompt ?? []).toHaveLength(0);

    await guard.handleAgentPermissionBefore(
      {
        agent: { ...unclaimedAgentHook, id: "ag_bot", workspaceId: "wks_bot" },
        request: {
          id: "perm_bot_push",
          provider: "codex",
          name: "Bash",
          kind: "tool",
          input: { command: "git push origin HEAD" },
        },
      },
      ctx,
    );
    expect(agents.get("ag_bot")!.permissionResponses).toHaveLength(0);
  });

  it("preserves unattended workflow & bot attribution inside an unclaimed workspace ([CRITICAL-01])", async () => {
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    // Workspace exists but is unclaimed (owner === null)
    workspaces.set("wks_unclaimed_host", {
      id: "wks_unclaimed_host",
      cwd: worktreeDir,
      metadata: {},
    });

    // Unattended workflow spawns an agent inside wks_unclaimed_host
    const createdReq = await guard.handleAgentCreateBefore(
      {
        request: {
          config: { provider: "codex", cwd: worktreeDir },
          labels: {
            "paseo.workflow": "gitea-workflow",
            "paseo.workflow.unattended": "1",
          },
          metadata: {},
        },
      },
      ctx,
    );
    expect(createdReq?.metadata?.[TEAM_COLLAB_OWNER_META_KEY]).toMatchObject({
      id: SYSTEM_BOT_MEMBER_ID,
      kind: "bot",
    });

    agents.set("ag_wf_in_unclaimed", {
      id: "ag_wf_in_unclaimed",
      workspaceId: "wks_unclaimed_host",
      cwd: worktreeDir,
      labels: {
        "paseo.workflow": "gitea-workflow",
        "paseo.workflow.unattended": "1",
      },
      metadata: (createdReq?.metadata ?? {}) as Record<string, unknown>,
      permissionResponses: [],
    });

    const openedWf = await guard.handleAgentOpenBefore(
      {
        request: {
          agentId: "ag_wf_in_unclaimed",
          workspaceId: "wks_unclaimed_host",
          provider: "codex",
          cwd: worktreeDir,
          reason: "create",
          purpose: "interactive",
          title: "Workflow step",
          background: false,
          labels: {
            "paseo.workflow": "gitea-workflow",
            "paseo.workflow.unattended": "1",
          },
          metadata: createdReq?.metadata ?? {},
          tools: [],
          env: { PATH: "/usr/bin" },
          mcpServers: {},
        },
      },
      ctx,
    );
    expect(openedWf?.env.TEAM_COLLAB_OWNER_ID).toBe(SYSTEM_BOT_MEMBER_ID);
    expect(openedWf?.appendSystemPrompt ?? []).toHaveLength(0);

    // Permission check even if payload.agent.metadata is empty (resolved via agent labels)
    await guard.handleAgentPermissionBefore(
      {
        agent: {
          id: "ag_wf_in_unclaimed",
          workspaceId: "wks_unclaimed_host",
          parentAgentId: null,
          provider: "codex",
          cwd: worktreeDir,
          title: "Workflow step",
          background: false,
          metadata: {},
        },
        request: {
          id: "perm_wf_push",
          provider: "codex",
          name: "Bash",
          kind: "tool",
          input: { command: "git push origin feat/alice" },
        },
      },
      ctx,
    );
    expect(agents.get("ag_wf_in_unclaimed")!.permissionResponses).toHaveLength(0);
  });

  it("strips stale launchEnv on open and reloads idle agents immediately while deferring running agents to turn.after ([HIGH-03])", async () => {
    store.upsertMember({
      id: "bob",
      name: "Bob Bare",
      email: "bob@corp.local",
      enabled: true,
    });

    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    workspaces.set("wks_swap", {
      id: "wks_swap",
      cwd: worktreeDir,
      metadata: {},
    });
    agents.set("ag_idle", {
      id: "ag_idle",
      workspaceId: "wks_swap",
      cwd: worktreeDir,
      status: "idle",
      metadata: {},
      reloadCount: 0,
      permissionResponses: [],
    });
    agents.set("ag_running", {
      id: "ag_running",
      workspaceId: "wks_swap",
      cwd: worktreeDir,
      status: "running",
      metadata: {},
      reloadCount: 0,
      permissionResponses: [],
    });

    // Assign to Alice -> idle agent reloads immediately; running agent defers reload!
    await guard.assignWorkspaceOwner({ workspaceId: "wks_swap", memberId: "alice" }, ctx.paseo);
    expect(agents.get("ag_idle")!.reloadCount).toBe(1);
    expect(agents.get("ag_running")!.reloadCount).toBe(0);

    // When ag_running finishes its turn, deferred reload fires once
    const reloaded = await guard.handleAgentTurnAfterReloadIfNeeded("ag_running", ctx.paseo);
    expect(reloaded).toBe(true);
    expect(agents.get("ag_running")!.reloadCount).toBe(1);
    expect(await guard.handleAgentTurnAfterReloadIfNeeded("ag_running", ctx.paseo)).toBe(false);

    // Now reassign workspace to Bob (no tokens, no SSH key) and reopen with Alice's stale env
    await guard.assignWorkspaceOwner({ workspaceId: "wks_swap", memberId: "bob" }, ctx.paseo);

    const aliceShimDir = path.join(dataDir, "shims", "alice");
    const reopenedForBob = await guard.handleAgentOpenBefore(
      {
        request: {
          agentId: "ag_idle",
          workspaceId: "wks_swap",
          provider: "claude",
          cwd: worktreeDir,
          reason: "resume",
          purpose: "interactive",
          title: "Session",
          background: false,
          labels: {},
          metadata: {},
          tools: [],
          env: {
            PATH: `${aliceShimDir}${path.delimiter}/usr/bin`,
            GIT_AUTHOR_NAME: "Alice Chen",
            GIT_AUTHOR_EMAIL: "alice@corp.local",
            GIT_COMMITTER_NAME: "Alice Chen",
            GIT_COMMITTER_EMAIL: "alice@corp.local",
            GIT_SSH_COMMAND: "ssh -i '/tmp/alice' -o IdentitiesOnly=yes",
            GH_TOKEN: "ghp_alice_secret_5678",
            GITEA_TOKEN: "gta_alice_secret_1234",
            TEAM_COLLAB_OWNER_ID: "alice",
          },
          mcpServers: {},
        },
      },
      ctx,
    );

    expect(reopenedForBob?.env.TEAM_COLLAB_OWNER_ID).toBe("bob");
    expect(reopenedForBob?.env.GIT_AUTHOR_NAME).toBe("Bob Bare");
    expect(reopenedForBob?.env.GIT_AUTHOR_EMAIL).toBe("bob@corp.local");
    expect(reopenedForBob?.env.GH_TOKEN).toBeUndefined();
    expect(reopenedForBob?.env.GITEA_TOKEN).toBeUndefined();
    expect(reopenedForBob?.env.GIT_SSH_COMMAND).toBeUndefined();
    expect(reopenedForBob?.env.PATH).toBe("/usr/bin");

    // Unassign workspace -> strips all identity env vars as well
    await guard.assignWorkspaceOwner({ workspaceId: "wks_swap", memberId: null }, ctx.paseo);
    const reopenedUnclaimed = await guard.handleAgentOpenBefore(
      {
        request: {
          agentId: "ag_idle",
          workspaceId: "wks_swap",
          provider: "claude",
          cwd: worktreeDir,
          reason: "resume",
          purpose: "interactive",
          title: "Session",
          background: false,
          labels: {},
          metadata: {
            // Even if stale agent metadata still had bob before async propagation
            [TEAM_COLLAB_OWNER_META_KEY]: {
              id: "bob",
              name: "Bob Bare",
              email: "bob@corp.local",
              kind: "member",
              assignedAt: "2026-11-24T00:00:00.000Z",
            },
          },
          tools: [],
          env: reopenedForBob!.env,
          mcpServers: {},
        },
      },
      ctx,
    );
    expect(reopenedUnclaimed?.env.TEAM_COLLAB_OWNER_ID).toBeUndefined();
    expect(reopenedUnclaimed?.env.GIT_AUTHOR_NAME).toBeUndefined();
    expect(reopenedUnclaimed?.env.GIT_COMMITTER_EMAIL).toBeUndefined();
  });

  it("discovers uncached workspaces in refreshMemberWorktrees and maintains multi-workspace cwd sets across archive ([MEDIUM-07])", async () => {
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    const aliceOwner: WorkspaceOwnerMetadata = {
      id: "alice",
      name: "Alice Chen",
      email: "alice@corp.local",
      kind: "member",
      assignedAt: "2026-11-24T00:00:00.000Z",
    };

    // Two workspaces pointing to the same directory (one unclaimed, one claimed by Alice)
    workspaces.set("wks_dup_unclaimed", {
      id: "wks_dup_unclaimed",
      cwd: worktreeDir,
      metadata: {},
    });
    workspaces.set("wks_dup_alice", {
      id: "wks_dup_alice",
      cwd: worktreeDir,
      metadata: { [TEAM_COLLAB_OWNER_META_KEY]: aliceOwner },
    });

    // Update Alice's display name and call refreshMemberWorktrees on cold cache WITH ctx.paseo
    store.upsertMember({
      id: "alice",
      name: "Alice Renamed",
      email: "alice@corp.local",
      enabled: true,
    });
    await guard.refreshMemberWorktrees("alice", ctx.paseo);
    expect(git(worktreeDir, ["config", "--worktree", "--get", "user.name"])).toBe("Alice Renamed");

    // Archive wks_dup_alice -> evicted from cache so cwd lookup now sees only wks_dup_unclaimed (unclaimed)
    workspaces.delete("wks_dup_alice");
    await guard.handleWorkspaceArchiveAfter(
      {
        workspace: {
          id: "wks_dup_alice",
          projectId: "proj_1",
          cwd: worktreeDir,
          name: "wks_dup_alice",
          archivedAt: "2026-11-24T01:00:00.000Z",
          metadata: { [TEAM_COLLAB_OWNER_META_KEY]: aliceOwner },
        },
      },
      ctx,
    );

    const resolvedAfterArchive = await guard.resolveAgentEffectiveOwner(
      { id: "ag_new", cwd: worktreeDir, metadata: {} },
      ctx.paseo,
    );
    expect(resolvedAfterArchive.owner).toBeNull();
    expect(resolvedAfterArchive.workspaceId).toBe("wks_dup_unclaimed");
  });

  it("automatically syncs @<memberId> workspace labels on create, ownership transfer, and unclaim while preserving non-owner labels", async () => {
    const guard = new AttributionGuard({
      secretStore: store,
      gitConfigurator,
      getPolicies: () => policies,
      getSettingsMembers: () => [],
    });
    const ctx = createFakeHookContext(workspaces, agents);

    store.upsertMember({
      id: "bob",
      name: "Bob Li",
      email: "bob@corp.local",
      enabled: true,
    });

    workspaces.set("wks_labeled", {
      id: "wks_labeled",
      cwd: worktreeDir,
      metadata: {},
      labels: ["WT", "feature"],
    });

    // 1. Claim as Alice -> adds @alice while preserving WT and feature
    await guard.assignWorkspaceOwner({ workspaceId: "wks_labeled", memberId: "alice" }, ctx.paseo);
    expect(workspaces.get("wks_labeled")!.labels).toEqual(["WT", "feature", "@alice"]);

    // 2. Transfer to Bob -> removes @alice and adds @bob
    await guard.assignWorkspaceOwner({ workspaceId: "wks_labeled", memberId: "bob" }, ctx.paseo);
    expect(workspaces.get("wks_labeled")!.labels).toEqual(["WT", "feature", "@bob"]);

    // 3. Unclaim -> removes @bob while preserving WT and feature
    await guard.assignWorkspaceOwner({ workspaceId: "wks_labeled", memberId: null }, ctx.paseo);
    expect(workspaces.get("wks_labeled")!.labels).toEqual(["WT", "feature"]);
  });
});
