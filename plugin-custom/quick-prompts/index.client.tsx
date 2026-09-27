import type { PluginClientContext } from "@getpaseo/plugin/client";
import { QuickPromptsAccessory } from "./client/accessory.js";
import { QuickPromptsSettingsScreen } from "./client/settings-screen.js";
import { quickPromptsGlobalGetRpc, type QuickPromptItem } from "./shared/contracts.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // 1. Register composer accessory bar (safely guarded for compatible clients)
  if (typeof client.addComposerAccessory === "function") {
    cleanups.push(
      client.addComposerAccessory({
        id: "quick-prompts",
        order: 0,
        Component: (props) => <QuickPromptsAccessory {...props} />,
      }),
    );
  }

  // 2. Register settings screen
  cleanups.push(
    client.addSettingsScreen({
      id: "quick-prompts",
      title: "Quick Prompts",
      icon: "Sparkles",
      Component: QuickPromptsSettingsScreen,
    }),
  );

  // 3. Register Command Center item to easily open settings
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

  // 4. Register client slash commands for global prompt shortcuts asynchronously
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
      registerSlashCommands(res.items);
    })
    .catch(() => {
      // Ignored
    });

  // Note: Project-scoped shortcuts and dynamic rule-based ephemeral items
  // are deliberately not registered as global slash commands due to plugin lifecycle constraints.

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    for (const cleanup of slashCleanups) {
      cleanup();
    }
  };
}
