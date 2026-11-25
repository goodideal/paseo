import type {
  PluginButtonRegistration,
  PluginClientContext,
  PluginText,
} from "@getpaseo/plugin/client";
import {
  parseWorkspaceOwnerMetadata,
  SYSTEM_BOT_MEMBER_ID,
  teamCollabWorkspaceAssignRpc,
} from "./shared/contracts.js";
import { messages, TEAM_SETTINGS_SCREEN_ID, TEAM_USAGE_SCREEN_ID } from "./client/messages.js";
import { NewWorkspaceOwnerItem } from "./client/new-workspace-owner.js";
import { WorkspaceOwnerPopover } from "./client/owner-popover.js";
import { TeamCollabSettingsScreen } from "./client/settings-screen.js";
import { TeamSidebarFooterItem, TeamUsageScreen } from "./client/usage-screen.js";
import { getDefaultMemberId, setDefaultMemberId } from "./client/web.js";
import { WorkspaceOwnerBadge } from "./client/workspace-indicators.js";
import {
  getLiveWorkspaceRecord,
  removeLiveWorkspace,
  replaceAllLiveWorkspaces,
  setLiveWorkspaceOwner,
  subscribeLiveWorkspaces,
  upsertLiveWorkspace,
} from "./client/workspace-store.js";

interface ObservedWorkspace {
  id: string;
  metadata?: unknown;
  workspaceKind?: string | null;
  gitRuntime?: { currentBranch?: string | null } | null;
  archivingAt?: string | null;
}

interface ObservedAgent {
  id: string;
  workspaceId?: string | null;
  background?: boolean;
  archivedAt?: unknown;
  metadata?: unknown;
}

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  const openUsageScreen = () => {
    client.openScreen?.({ screenId: TEAM_USAGE_SCREEN_ID });
  };
  const openSettingsScreen = () => {
    client.openSettings?.(TEAM_SETTINGS_SCREEN_ID);
  };

  // 1. New Workspace Owner Picker & Worktree Guidance
  if (typeof client.addNewWorkspaceItem === "function") {
    cleanups.push(
      client.addNewWorkspaceItem({
        id: "team-collab-owner",
        Component: (props) => <NewWorkspaceOwnerItem {...props} />,
      }),
    );
  }

  // 2. Sidebar Workspace Row Attribution Badge
  if (typeof client.addWorkspaceRowBadgeItem === "function") {
    cleanups.push(
      client.addWorkspaceRowBadgeItem({
        id: "team-collab-owner-badge",
        title: messages.message("badge.title"),
        icon: "UserCheck",
        Component: (props) => <WorkspaceOwnerBadge {...props} />,
      }),
    );
  }

  // 3. Team Usage & Audit Ledger Screen + Sidebar Footer Entry
  if (typeof client.addScreen === "function") {
    cleanups.push(
      client.addScreen({
        id: TEAM_USAGE_SCREEN_ID,
        title: messages.message("screen.usageTitle"),
        Component: (props) => <TeamUsageScreen {...props} onOpenSettings={openSettingsScreen} />,
      }),
    );
  }

  if (typeof client.addSidebarFooterItem === "function") {
    cleanups.push(
      client.addSidebarFooterItem({
        id: "team-collab-usage-footer",
        title: messages.message("sidebar.teamUsage"),
        Component: (props) => <TeamSidebarFooterItem {...props} />,
      }),
    );
  }

  // 4. Plugin Settings & Write-Only Credential Management Screen
  if (typeof client.addSettingsScreen === "function") {
    cleanups.push(
      client.addSettingsScreen({
        id: TEAM_SETTINGS_SCREEN_ID,
        title: messages.message("settings.title"),
        icon: "Users",
        Component: (props) => <TeamCollabSettingsScreen {...props} onOpenUsage={openUsageScreen} />,
      }),
    );
  }

  // 5. Command Center Shortcuts
  if (typeof client.addCommandCenterItem === "function") {
    cleanups.push(
      client.addCommandCenterItem({
        id: "team-collab-open-usage",
        title: messages.message("command.openUsage"),
        icon: "BarChart3",
        context: "global",
        keywords: ["team", "usage", "tokens", "ledger", "commits", "audit"],
        onSelect({ openScreen }) {
          openScreen({ screenId: TEAM_USAGE_SCREEN_ID });
        },
      }),
    );
    cleanups.push(
      client.addCommandCenterItem({
        id: "team-collab-open-settings",
        title: messages.message("command.openSettings"),
        icon: "KeyRound",
        context: "global",
        keywords: ["team", "members", "gitea", "github", "ssh", "credentials"],
        onSelect({ openSettings }) {
          openSettings(TEAM_SETTINGS_SCREEN_ID);
        },
      }),
    );
  }

  // 6. /iam Workspace Slash Command
  if (typeof client.addSlashCommand === "function") {
    cleanups.push(
      client.addSlashCommand({
        name: "iam",
        description: messages.message("slash.iamDescription"),
        argumentHint: messages.message("slash.iamHint"),
        context: "workspace",
        async onSubmit(context) {
          const rawArg = context.args.trim();
          const cleaned = rawArg.replace(/^@/, "");

          if (cleaned.toLowerCase() === "clear" || cleaned.toLowerCase() === "none") {
            const res = await context.rpc(teamCollabWorkspaceAssignRpc, {
              workspaceId: context.workspace.id,
              memberId: null,
            });
            setLiveWorkspaceOwner(context.workspace.id, res.owner, {
              isWorktree: res.isWorktree,
            });
            return;
          }

          if (cleaned.length > 0) {
            const res = await context.rpc(teamCollabWorkspaceAssignRpc, {
              workspaceId: context.workspace.id,
              memberId: cleaned,
            });
            setLiveWorkspaceOwner(context.workspace.id, res.owner, {
              isWorktree: res.isWorktree,
            });
            if (cleaned !== SYSTEM_BOT_MEMBER_ID) {
              setDefaultMemberId(cleaned);
            }
            return;
          }

          const defaultMember = getDefaultMemberId();
          if (defaultMember) {
            const res = await context.rpc(teamCollabWorkspaceAssignRpc, {
              workspaceId: context.workspace.id,
              memberId: defaultMember,
            });
            setLiveWorkspaceOwner(context.workspace.id, res.owner, {
              isWorktree: res.isWorktree,
            });
          } else {
            context.openSettings(TEAM_SETTINGS_SCREEN_ID);
          }
        },
      }),
    );
  }

  // 7. Live Workspace & Agent Observation for Header Button + Unclaimed-Only Composer Pill
  let stopped = false;
  const lifetime = new AbortController();

  const knownWorkspaceIds = new Set<string>();
  const knownAgents = new Map<string, ObservedAgent>();

  const headerButtons = new Map<
    string,
    {
      signature: string;
      registration: PluginButtonRegistration<PluginText>;
    }
  >();
  const unclaimedPills = new Map<
    string,
    {
      workspaceId: string;
      registration: PluginButtonRegistration<PluginText>;
    }
  >();
  // Defer initial pill mount slightly past quick-tools (0ms) and agent-harness (120ms)
  // so team-collab's unclaimed warning pill always sits third in the composer pill bar.
  const PILL_REGISTRATION_DELAY_MS = 220;
  const pendingPills = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      agent: ObservedAgent;
    }
  >();

  const hasWorkspaceStream = Boolean(client.paseo?.workspaces?.list);
  let workspacesHydrated = !hasWorkspaceStream;

  const removeHeaderButton = (workspaceId: string) => {
    const existing = headerButtons.get(workspaceId);
    if (existing) {
      existing.registration.remove();
      headerButtons.delete(workspaceId);
    }
  };

  const cancelPendingPill = (agentId: string) => {
    const pending = pendingPills.get(agentId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPills.delete(agentId);
    }
  };

  const removeAgentPill = (agentId: string) => {
    cancelPendingPill(agentId);
    const existing = unclaimedPills.get(agentId);
    if (existing) {
      existing.registration.remove();
      unclaimedPills.delete(agentId);
    }
  };

  const syncHeaderButton = (workspaceId: string) => {
    if (stopped || typeof client.addHeaderButton !== "function") {
      return;
    }
    if (!knownWorkspaceIds.has(workspaceId)) {
      removeHeaderButton(workspaceId);
      return;
    }

    const owner = getLiveWorkspaceRecord(workspaceId)?.owner ?? null;
    const signature = owner ? `claimed:${owner.kind}:${owner.id}:${owner.name}` : "unclaimed";

    const icon = owner ? (owner.kind === "bot" ? "Bot" : "UserCheck") : "AlertTriangle";
    const title = owner
      ? messages.message("header.claimedTitle", {
          name: owner.name,
          id: owner.id,
        })
      : messages.message("header.unclaimedTitle");
    const label = owner ? owner.name : messages.message("header.unclaimedLabel");

    const existing = headerButtons.get(workspaceId);
    if (existing) {
      if (existing.signature !== signature) {
        existing.signature = signature;
        existing.registration.update({
          icon,
          title,
          label,
        });
      }
      return;
    }

    const registration = client.addHeaderButton({
      id: "team-collab-owner",
      workspaceId,
      button: {
        title,
        label,
        icon,
        behavior: {
          kind: "popover",
          Content: (props) => (
            <WorkspaceOwnerPopover
              {...props}
              workspaceId={workspaceId}
              onOpenSettings={openSettingsScreen}
              onOpenUsage={openUsageScreen}
            />
          ),
        },
      },
    });
    headerButtons.set(workspaceId, { signature, registration });
  };

  const syncAgentPill = (agent: ObservedAgent) => {
    if (stopped || typeof client.addComposerPill !== "function") {
      return;
    }
    if (!workspacesHydrated) {
      return;
    }
    if (
      !agent.workspaceId ||
      agent.background ||
      agent.archivedAt ||
      (hasWorkspaceStream && !knownWorkspaceIds.has(agent.workspaceId))
    ) {
      removeAgentPill(agent.id);
      return;
    }

    const workspaceId = agent.workspaceId;
    const liveWs = getLiveWorkspaceRecord(workspaceId);
    const effectiveOwner =
      liveWs !== undefined ? liveWs.owner : parseWorkspaceOwnerMetadata(agent.metadata);

    // Strictly mount the warning pill ONLY when the workspace is unclaimed;
    // remove immediately as soon as any member or system-bot owns the workspace.
    if (effectiveOwner !== null) {
      removeAgentPill(agent.id);
      return;
    }

    const existing = unclaimedPills.get(agent.id);
    if (existing) {
      if (existing.workspaceId === workspaceId) {
        cancelPendingPill(agent.id);
        return;
      }
      existing.registration.remove();
      unclaimedPills.delete(agent.id);
    }

    const pending = pendingPills.get(agent.id);
    if (pending) {
      pending.agent = agent;
      return;
    }

    const timer = setTimeout(() => {
      pendingPills.delete(agent.id);
      if (stopped) return;
      const latestWs = getLiveWorkspaceRecord(workspaceId);
      const latestOwner =
        latestWs !== undefined ? latestWs.owner : parseWorkspaceOwnerMetadata(agent.metadata);
      if (latestOwner !== null) {
        return;
      }
      const registration = client.addComposerPill({
        id: "team-collab-claim",
        workspaceId,
        agentId: agent.id,
        button: {
          title: messages.message("composer.claimTitle"),
          label: messages.message("composer.claimLabel"),
          icon: "AlertTriangle",
          behavior: {
            kind: "popover",
            Content: (props) => (
              <WorkspaceOwnerPopover
                {...props}
                workspaceId={workspaceId}
                onOpenSettings={openSettingsScreen}
                onOpenUsage={openUsageScreen}
              />
            ),
          },
        },
      });
      unclaimedPills.set(agent.id, { workspaceId, registration });
    }, PILL_REGISTRATION_DELAY_MS);
    pendingPills.set(agent.id, { timer, agent });
  };

  const reconcileAll = () => {
    if (stopped) return;
    for (const wsId of Array.from(headerButtons.keys())) {
      if (!knownWorkspaceIds.has(wsId)) {
        removeHeaderButton(wsId);
      }
    }
    for (const wsId of knownWorkspaceIds) {
      syncHeaderButton(wsId);
    }
    for (const agentId of Array.from(unclaimedPills.keys())) {
      if (!knownAgents.has(agentId)) {
        removeAgentPill(agentId);
      }
    }
    for (const agent of knownAgents.values()) {
      syncAgentPill(agent);
    }
  };

  const unsubLiveStore = subscribeLiveWorkspaces(() => {
    reconcileAll();
  });

  let workspaceSubHandle: { close?: () => void; release?: () => void } | null = null;
  let workspaceUnsub: (() => void) | undefined;

  if (client.paseo?.workspaces?.list) {
    type WorkspaceSubscribeArgs = Parameters<typeof client.paseo.workspaces.list>[0] & {
      subscribe: Record<string, never>;
      signal?: AbortSignal;
    };
    const workspaceListArgs: WorkspaceSubscribeArgs = {
      subscribe: {},
      signal: lifetime.signal,
    };
    void client.paseo.workspaces
      .list(workspaceListArgs)
      .then(({ entries, subscription }) => {
        const sub = subscription as unknown as {
          close?: () => void;
          release?: () => void;
        };
        if (stopped) {
          sub.close?.() ?? void sub.release?.();
          return undefined;
        }
        workspaceSubHandle = sub;

        const applyWorkspaceSnapshot = (list: readonly ObservedWorkspace[]) => {
          knownWorkspaceIds.clear();
          const activeList: ObservedWorkspace[] = [];
          for (const ws of list) {
            if (!ws || !ws.id || ws.archivingAt) continue;
            knownWorkspaceIds.add(ws.id);
            activeList.push(ws);
          }
          workspacesHydrated = true;
          // replaceAllLiveWorkspaces broadcasts to subscribeLiveWorkspaces -> reconcileAll()
          replaceAllLiveWorkspaces(activeList);
        };

        applyWorkspaceSnapshot((entries ?? []) as readonly ObservedWorkspace[]);

        if (typeof subscription.subscribe === "function") {
          workspaceUnsub = subscription.subscribe({
            snapshot: ({ entries: snapEntries }) => {
              applyWorkspaceSnapshot((snapEntries ?? []) as readonly ObservedWorkspace[]);
            },
            update: (message) => {
              if (message.type !== "workspace_update") return;
              const payload = message.payload;
              if (payload.kind === "remove") {
                knownWorkspaceIds.delete(payload.id);
                if (!removeLiveWorkspace(payload.id)) {
                  reconcileAll();
                }
              } else if (payload.kind === "upsert") {
                const ws = payload.workspace as ObservedWorkspace;
                if (ws.archivingAt) {
                  knownWorkspaceIds.delete(ws.id);
                  if (!removeLiveWorkspace(ws.id)) {
                    reconcileAll();
                  }
                } else {
                  const wasKnown = knownWorkspaceIds.has(ws.id);
                  knownWorkspaceIds.add(ws.id);
                  const changed = upsertLiveWorkspace(ws);
                  if (!changed && !wasKnown) {
                    reconcileAll();
                  }
                }
              }
            },
          });
        }

        return undefined;
      })
      .catch((error) => {
        if (!stopped) {
          workspacesHydrated = true;
          reconcileAll();
          console.error("[TeamCollab] Workspace observation failed:", error);
        }
      });
  }

  let agentSubHandle: { close?: () => void; release?: () => void } | null = null;
  let agentUnsub: (() => void) | undefined;

  if (client.paseo?.agents?.list) {
    void client.paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ entries, subscription }) => {
        const sub = subscription as unknown as {
          close?: () => void;
          release?: () => void;
        };
        if (stopped) {
          sub.close?.() ?? void sub.release?.();
          return undefined;
        }
        agentSubHandle = sub;

        const applyAgentSnapshot = (list: readonly { agent: ObservedAgent }[]) => {
          knownAgents.clear();
          for (const item of list) {
            if (item?.agent?.id) {
              knownAgents.set(item.agent.id, item.agent);
            }
          }
          reconcileAll();
        };

        applyAgentSnapshot((entries ?? []) as readonly { agent: ObservedAgent }[]);

        if (typeof subscription.subscribe === "function") {
          agentUnsub = subscription.subscribe({
            snapshot: ({ entries: snapEntries }) => {
              applyAgentSnapshot((snapEntries ?? []) as readonly { agent: ObservedAgent }[]);
            },
            update: (message) => {
              if (message.type !== "agent_update") return;
              const payload = message.payload;
              if (payload.kind === "remove") {
                knownAgents.delete(payload.agentId);
                removeAgentPill(payload.agentId);
              } else {
                const ag = payload.agent as ObservedAgent;
                knownAgents.set(ag.id, ag);
                syncAgentPill(ag);
              }
            },
          });
        }

        return undefined;
      })
      .catch((error) => {
        if (!stopped) {
          console.error("[TeamCollab] Agent observation failed:", error);
        }
      });
  }

  cleanups.push(() => {
    stopped = true;
    lifetime.abort();
    unsubLiveStore();
    workspaceUnsub?.();
    agentUnsub?.();
    workspaceSubHandle?.close?.() ?? void workspaceSubHandle?.release?.();
    agentSubHandle?.close?.() ?? void agentSubHandle?.release?.();

    for (const { registration } of headerButtons.values()) {
      registration.remove();
    }
    headerButtons.clear();

    for (const { timer } of pendingPills.values()) {
      clearTimeout(timer);
    }
    pendingPills.clear();

    for (const { registration } of unclaimedPills.values()) {
      registration.remove();
    }
    unclaimedPills.clear();
    knownWorkspaceIds.clear();
    knownAgents.clear();
  });

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
