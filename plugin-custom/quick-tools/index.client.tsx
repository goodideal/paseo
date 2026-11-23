import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { QuickPromptsSettingsScreen } from "./client/settings-screen.js";
import { QuickPromptsPopover } from "./client/popover.js";
import { QuickPromptsComposerItem } from "./client/composer-item.js";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsWorkspaceLabelsSyncRpc,
  type QuickPromptItem,
} from "./shared/contracts.js";
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
              onOpenSettings={() => client.openSettings("quick-tools")}
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
        if (!stopped) console.error("[QuickTools] Agent observation failed", error);
      });
  }

  cleanups.push(() => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  });

  // 2. Register composer item for Draft and New Workspace composers (non-intrusive SDK seam)
  if (typeof client.addComposerItem === "function") {
    cleanups.push(
      client.addComposerItem({
        id: "quick-prompts-draft",
        Component: QuickPromptsComposerItem,
      }),
    );
  }

  // 4. Register settings screen
  cleanups.push(
    client.addSettingsScreen({
      id: "quick-tools",
      title: "Quick Tools",
      icon: "Sparkles",
      Component: QuickPromptsSettingsScreen,
    }),
  );

  // 5. Register Command Center item to easily open settings
  cleanups.push(
    client.addCommandCenterItem({
      id: "quick-tools-settings",
      title: "Configure Quick Tools",
      icon: "Sparkles",
      context: "global",
      onSelect({ openSettings }) {
        openSettings("quick-tools");
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

  // Backfill Local / WT labels for existing workspaces when auto-labeling is enabled
  void client.rpc(quickPromptsWorkspaceLabelsSyncRpc, {}).catch((error) => {
    if (!stopped) {
      console.warn("[QuickTools] Initial workspace label sync failed:", error);
    }
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
