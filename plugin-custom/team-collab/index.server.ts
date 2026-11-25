import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AttributionGuard } from "./server/attribution-guard.js";
import { GitConfigurator } from "./server/git-configurator.js";
import { discoverHostSshKeys, type HostDiscoveryOptions } from "./server/host-discovery.js";
import { SecretStore } from "./server/secret-store.js";
import { extractTurnPromptPreview, UsageLedger } from "./server/usage-ledger.js";
import {
  DEFAULT_TEAM_COLLAB_SETTINGS,
  teamCollabMemberRemoveRpc,
  teamCollabMemberUpsertRpc,
  teamCollabRosterStatusRpc,
  teamCollabSettings,
  teamCollabSyncHostAccountsRpc,
  teamCollabUsageExportRpc,
  teamCollabUsageQueryRpc,
  teamCollabWorkspaceAssignRpc,
  type TeamCollabPolicies,
  type TeamCollabSettings,
} from "./shared/contracts.js";

export interface ContributeTeamCollabOptions {
  dataDir?: string;
  hostDiscovery?: HostDiscoveryOptions;
}

export default function contribute(
  server: PluginServerContext,
  options?: ContributeTeamCollabOptions,
) {
  const settingsHandle = server.registerSettings(teamCollabSettings);
  let cachedSettings: TeamCollabSettings = { ...DEFAULT_TEAM_COLLAB_SETTINGS };
  let hasLiveSubscriptionState = false;

  const unsubscribeSettings = settingsHandle.subscribe((state) => {
    if (state.status === "ready") {
      hasLiveSubscriptionState = true;
      cachedSettings = { ...DEFAULT_TEAM_COLLAB_SETTINGS, ...state.values };
    }
  });

  const initialSettingsReady = settingsHandle
    .read()
    .then((state) => {
      if (!hasLiveSubscriptionState && state.status === "ready") {
        cachedSettings = { ...DEFAULT_TEAM_COLLAB_SETTINGS, ...state.values };
      }
    })
    .catch((error) => {
      console.error("[TeamCollab] Failed to read initial settings:", error);
    });

  const getPolicies = (): TeamCollabPolicies => ({
    enforceWorktreeOnCreate: cachedSettings.enforceWorktreeOnCreate,
    blockUnclaimedGitCommitPush: cachedSettings.blockUnclaimedGitCommitPush,
    allowSharedLocalCheckoutCommit: cachedSettings.allowSharedLocalCheckoutCommit,
    retentionDays: cachedSettings.retentionDays,
  });

  const secretStore = new SecretStore({
    dataDir: options?.dataDir,
    hostDiscovery: options?.hostDiscovery,
  });
  const gitConfigurator = new GitConfigurator({
    secretStore,
    hostTeaConfigPaths: options?.hostDiscovery?.hostTeaConfigPaths
      ? [...options.hostDiscovery.hostTeaConfigPaths]
      : undefined,
  });
  const usageLedger = new UsageLedger({
    dataDir: secretStore.dataDir,
    getRetentionDays: () => cachedSettings.retentionDays,
    getRosterMembers: () => secretStore.getEffectiveRoster(cachedSettings.members),
  });
  const knownRepoDirs = new Set<string>();
  const trackRepoDir = (cwd: string) => {
    if (cwd) {
      knownRepoDirs.add(cwd);
      usageLedger.registerRepoDirectory(cwd);
    }
  };
  const attributionGuard = new AttributionGuard({
    secretStore,
    gitConfigurator,
    getPolicies,
    getSettingsMembers: () => cachedSettings.members,
    onKnownRepoDirectory: (cwd) => trackRepoDir(cwd),
  });

  // Background auto-seed on startup so host tea / Git accounts are pre-populated before first UI open
  void initialSettingsReady
    .then(() => secretStore.seedHostAccountsIfNeeded(cachedSettings.members))
    .catch(() => {});

  // 1. Roster & Policy Status RPC (auto-seeds host tea logins when roster is empty and not removed)
  server.handle(teamCollabRosterStatusRpc, async () => {
    await initialSettingsReady;
    const { discoveredAccounts } = await secretStore.seedHostAccountsIfNeeded(
      cachedSettings.members,
    );
    const members = secretStore.getRosterStatuses(cachedSettings.members);
    const discoveredSshKeys = discoverHostSshKeys(
      options?.hostDiscovery?.homeDir
        ? path.join(options.hostDiscovery.homeDir, ".ssh")
        : undefined,
    );
    let detectedServerHint = secretStore.detectServerHint(discoveredAccounts, members);
    if (!detectedServerHint) {
      for (const repoDir of knownRepoDirs) {
        detectedServerHint = await gitConfigurator.detectServerHintFromRepo(repoDir);
        if (detectedServerHint) {
          break;
        }
      }
    }
    return {
      members,
      policies: getPolicies(),
      discoveredAccounts,
      discoveredSshKeys,
      detectedServerHint,
    };
  });

  // 1b. Sync Host Accounts RPC (imports selected or all unimported host tea / git-global accounts)
  server.handle(teamCollabSyncHostAccountsRpc, async (input, { paseo }) => {
    await initialSettingsReady;
    const synced = await secretStore.syncHostAccounts(input, cachedSettings.members);
    for (const importedId of synced.importedIds) {
      await attributionGuard.refreshMemberWorktrees(importedId, paseo);
    }
    return synced;
  });

  // 2. Member Upsert RPC (atomic profile + masked credentials + full workspace discovery & refresh)
  server.handle(teamCollabMemberUpsertRpc, async (input, { paseo }) => {
    const updated = secretStore.upsertMember(input.member, input.credentials);
    await attributionGuard.refreshMemberWorktrees(updated.id, paseo);
    return {
      member: updated,
      success: true,
    };
  });

  // 3. Member Remove RPC (removes roster entry, secrets, and shims)
  server.handle(teamCollabMemberRemoveRpc, async (input) => {
    const removed = secretStore.removeMember(input.memberId);
    gitConfigurator.removeMemberShims(input.memberId);
    return {
      memberId: input.memberId,
      removed,
    };
  });

  // 4. Workspace Owner Assignment RPC
  server.handle(teamCollabWorkspaceAssignRpc, async (input, { paseo }) => {
    return attributionGuard.assignWorkspaceOwner(input, paseo);
  });

  // 5. Usage Query RPC
  server.handle(teamCollabUsageQueryRpc, async (input, { paseo }) => {
    if (paseo?.workspaces?.list) {
      try {
        const listed = await paseo.workspaces.list();
        for (const ws of listed.entries ?? []) {
          if (ws.archivingAt) continue;
          const dir = ws.workspaceDirectory ?? ws.projectRootPath;
          if (dir) {
            usageLedger.registerRepoDirectory(dir);
          }
        }
      } catch {
        // Ignore workspace discovery errors during query
      }
    }
    return usageLedger.queryUsage(input);
  });

  // 6. Usage Export RPC
  server.handle(teamCollabUsageExportRpc, async (input) => {
    return usageLedger.exportUsage(input);
  });

  // Lifecycle Hooks
  const removeWorkspaceCreateBefore = server.addHook("workspace.create.before", (payload, ctx) =>
    attributionGuard.handleWorkspaceCreateBefore(payload, ctx),
  );
  const removeWorkspaceCreateAfter = server.addHook("workspace.create.after", (payload, ctx) =>
    attributionGuard.handleWorkspaceCreateAfter(payload, ctx),
  );
  const removeWorkspaceArchiveAfter = server.addHook("workspace.archive.after", (payload, ctx) =>
    attributionGuard.handleWorkspaceArchiveAfter(payload, ctx),
  );
  const removeWorktreeCreateAfter = server.addHook("worktree.create.after", (payload, ctx) =>
    attributionGuard.handleWorktreeCreateAfter(payload, ctx),
  );
  const removeAgentCreateBefore = server.addHook("agent.create.before", (payload, ctx) =>
    attributionGuard.handleAgentCreateBefore(payload, ctx),
  );
  const removeAgentOpenBefore = server.addHook("agent.open.before", (payload, ctx) =>
    attributionGuard.handleAgentOpenBefore(payload, ctx),
  );
  const removeAgentPermissionBefore = server.addHook("agent.permission.before", (payload, ctx) =>
    attributionGuard.handleAgentPermissionBefore(payload, ctx),
  );

  const removeAgentTurnBefore = server.addHook("agent.turn.before", async (payload, context) => {
    const { agent, turnId } = payload;
    if (!agent) return;
    if (agent.cwd) {
      usageLedger.registerRepoDirectory(agent.cwd);
    }

    let baselineUsage = undefined;
    if (context.paseo?.agents?.ref) {
      try {
        const handle = context.paseo.agents.ref(agent.id);
        const snap = handle.current?.() ?? (await handle.refresh().catch(() => null))?.agent;
        baselineUsage = snap?.lastUsage ?? undefined;
      } catch {
        // Ignore snapshot lookup error
      }
    }

    usageLedger.recordTurnStart({
      agentId: agent.id,
      turnId,
      baselineUsage,
    });
  });

  const removeAgentTurnAfter = server.addHook("agent.turn.after", async (payload, context) => {
    const { agent, turnId, outcome } = payload;
    if (!agent) return;

    let currentUsage = undefined;
    let model: string | null = null;
    let promptPreview: string | null = null;
    let snapLabels: Readonly<Record<string, string>> | null = null;
    let snapMetadata: Readonly<Record<string, unknown>> | null = agent.metadata;
    let snapTitle: string | null = agent.title;

    if (context.paseo?.agents?.ref) {
      try {
        const handle = context.paseo.agents.ref(agent.id);
        const refreshed = await handle.refresh().catch(() => null);
        const snap = refreshed?.agent ?? handle.current?.() ?? null;
        currentUsage = snap?.lastUsage ?? undefined;
        model = snap?.model ?? snap?.runtimeInfo?.model ?? null;
        if (snap?.labels && Object.keys(snap.labels).length > 0) {
          snapLabels = snap.labels;
        }
        if (snap?.metadata && Object.keys(snap.metadata).length > 0) {
          snapMetadata = snap.metadata;
        }
        if (snap?.title) {
          snapTitle = snap.title;
        }

        if (handle.timeline?.refetch) {
          const timelinePage = await handle.timeline
            .refetch({ direction: "tail", limit: 1, wholeTurns: true })
            .catch(() => null);
          promptPreview = extractTurnPromptPreview(timelinePage, turnId);
        }
      } catch {
        // Ignore snapshot/timeline inspection errors
      }
    }

    const { owner, workspaceId, cwd } = await attributionGuard.resolveAgentEffectiveOwner(
      {
        id: agent.id,
        workspaceId: agent.workspaceId,
        cwd: agent.cwd,
        title: snapTitle,
        metadata: snapMetadata,
        labels: snapLabels,
      },
      context.paseo,
    );

    const effectiveCwd = cwd || agent.cwd;
    let branch: string | null = null;
    if (effectiveCwd) {
      usageLedger.registerRepoDirectory(effectiveCwd);
      const gitInfo = await gitConfigurator.inspectGitDirectory(effectiveCwd);
      branch = gitInfo.currentBranch;
    }

    try {
      usageLedger.recordTurnEnd({
        agentId: agent.id,
        turnId,
        owner,
        workspaceId: workspaceId ?? agent.workspaceId,
        branch,
        provider: agent.provider,
        model,
        currentUsage,
        outcome: outcome?.kind ?? "completed",
        promptPreview,
      });
    } catch (error) {
      console.error("[TeamCollab] Failed to record turn usage:", error);
    }

    // If workspace owner changed while this turn was running, reload session now for the next turn
    await attributionGuard.handleAgentTurnAfterReloadIfNeeded(agent.id, context.paseo);
  });

  const removeAgentCloseAfter = server.addHook("agent.close.after", async ({ agent }) => {
    if (!agent) return;
    attributionGuard.forgetAgent(agent.id);
    usageLedger.forgetAgent(agent.id);
  });

  const removeAgentArchiveAfter = server.addHook("agent.archive.after", async ({ agent }) => {
    if (!agent) return;
    attributionGuard.forgetAgent(agent.id);
    usageLedger.forgetAgent(agent.id);
  });

  return () => {
    unsubscribeSettings();
    removeWorkspaceCreateBefore();
    removeWorkspaceCreateAfter();
    removeWorkspaceArchiveAfter();
    removeWorktreeCreateAfter();
    removeAgentCreateBefore();
    removeAgentOpenBefore();
    removeAgentPermissionBefore();
    removeAgentTurnBefore();
    removeAgentTurnAfter();
    removeAgentCloseAfter();
    removeAgentArchiveAfter();
    usageLedger.close();
  };
}
