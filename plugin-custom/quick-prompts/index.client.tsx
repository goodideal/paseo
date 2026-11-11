import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { QuickPromptsSettingsScreen } from "./client/settings-screen.js";
import { QuickPromptsPopover } from "./client/popover.js";
import { WorkspaceKindPopover } from "./client/workspace-kind-popover.js";
import { quickPromptsGlobalGetRpc, type QuickPromptItem } from "./shared/contracts.js";
import { setCachedGlobalItems } from "./client/use-quick-prompts.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // 1. Register Composer Pill using native Paseo API
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  const lifetime = new AbortController();

  const registerPill = (agent: { id: string; workspaceId?: string | null }) => {
    if (stopped || !agent.workspaceId) return;
    pills.get(agent.id)?.remove();
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const pill = client.addComposerPill({
      id: "quick-prompts",
      workspaceId,
      agentId,
      button: {
        title: "Quick Prompts",
        label: "​",
        icon: "Sparkles",
        behavior: {
          kind: "popover",
          Content: (props) => (
            <QuickPromptsPopover
              {...props}
              workspaceId={workspaceId}
              agentId={agentId}
              onOpenSettings={() => client.openSettings("quick-prompts")}
            />
          ),
        },
      },
    });
    pills.set(agent.id, pill);
  };

  const removePill = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  if (client.paseo?.agents) {
    void client.paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            for (const pill of pills.values()) pill.remove();
            pills.clear();
            for (const { agent } of entries) registerPill(agent);
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "remove") removePill(update.agentId);
            else registerPill(update.agent);
          },
        });
        return undefined;
      })
      .catch((error) => {
        if (!stopped) console.error("[QuickPrompts] Agent observation failed", error);
      });
  }

  cleanups.push(() => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  });

  // 2. Register Workspace Kind Header Button (Worktree vs Local) using native Paseo API
  const workspaceButtons = new Map<string, PluginButtonRegistration>();

  const registerWorkspaceButton = (workspace: {
    id: string;
    workspaceKind?: string;
    name?: string;
    currentBranch?: string | null;
    workspaceDirectory?: string;
    projectDisplayName?: string;
  }) => {
    if (stopped) return;
    workspaceButtons.get(workspace.id)?.remove();

    const isWorktree = workspace.workspaceKind === "worktree";
    const isLocal =
      workspace.workspaceKind === "local_checkout" || workspace.workspaceKind === "checkout";

    if (!isWorktree && !isLocal) return;

    const title = isWorktree ? "Git Worktree" : "Local Checkout";
    const label = isWorktree ? "Worktree" : "Local";
    const icon = isWorktree ? "FolderGit2" : "Monitor";

    const button = client.addHeaderButton({
      id: "workspace-kind",
      workspaceId: workspace.id,
      button: {
        title,
        label,
        icon,
        behavior: {
          kind: "popover",
          Content: (props) => (
            <WorkspaceKindPopover {...props} workspace={workspace} isWorktree={isWorktree} />
          ),
        },
      },
    });
    workspaceButtons.set(workspace.id, button);
  };

  const removeWorkspaceButton = (workspaceId: string) => {
    workspaceButtons.get(workspaceId)?.remove();
    workspaceButtons.delete(workspaceId);
  };

  if (client.paseo?.workspaces) {
    void client.paseo.workspaces
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            for (const btn of workspaceButtons.values()) btn.remove();
            workspaceButtons.clear();
            for (const ws of entries) registerWorkspaceButton(ws);
          },
          update: (message) => {
            if (message.type !== "workspace_update") return;
            const update = message.payload;
            if (update.kind === "remove") removeWorkspaceButton(update.id);
            else if (update.kind === "upsert") registerWorkspaceButton(update.workspace);
          },
        });
        return undefined;
      })
      .catch((error) => {
        if (!stopped) console.error("[QuickPrompts] Workspace observation failed", error);
      });
  }

  cleanups.push(() => {
    for (const btn of workspaceButtons.values()) btn.remove();
    workspaceButtons.clear();
  });

  // 3. Register settings screen
  cleanups.push(
    client.addSettingsScreen({
      id: "quick-prompts",
      title: "Quick Prompts",
      icon: "Sparkles",
      Component: QuickPromptsSettingsScreen,
    }),
  );

  // 4. Register Command Center item to easily open settings
  cleanups.push(
    client.addCommandCenterItem({
      id: "quick-prompts-settings",
      title: "Configure Quick Prompts",
      icon: "Sparkles",
      context: "global",
      onSelect({ openSettings }) {
        openSettings("quick-prompts");
      },
    }),
  );

  // 5. Register client slash commands for global prompt shortcuts asynchronously
  let slashCleanups: Array<() => void> = [];

  function registerSlashCommands(items: QuickPromptItem[]) {
    for (const cleanup of slashCleanups) cleanup();
    slashCleanups = [];

    for (const item of items) {
      if (!item.shortcut || !item.enabled) continue;
      slashCleanups.push(
        client.addSlashCommand({
          name: item.shortcut,
          description: item.content,
          argumentHint: "",
          context: "agent",
          async onSubmit(context) {
            const text = context.args?.trim()
              ? `${item.content}\n${context.args.trim()}`
              : item.content;
            await context.paseo.agents.ref(context.agent.id).send(text);
          },
        }),
      );
    }
  }

  // Initial load
  client
    .rpc(quickPromptsGlobalGetRpc, {})
    .then((res) => {
      setCachedGlobalItems(res.items);
      registerSlashCommands(res.items);
    })
    .catch(() => {
      // Ignored
    });

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    for (const cleanup of slashCleanups) {
      cleanup();
    }
  };
}
