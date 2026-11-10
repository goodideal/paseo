import type { PluginServerContext } from "@getpaseo/plugin";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  quickPromptsSettings,
} from "./shared/contracts.js";
import { QuickPromptsStore } from "./server/quick-prompts-store.js";
import { tagWorkspace, syncAllWorkspaces } from "./server/workspace-tagger.js";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(quickPromptsSettings);
  const store = new QuickPromptsStore();

  server.handle(quickPromptsGlobalGetRpc, async () => {
    const items = store.getGlobal();
    return { items };
  });

  server.handle(quickPromptsGlobalSetRpc, async (input) => {
    const items = store.setGlobal(input.items);
    return { items, success: true };
  });

  server.handle(quickPromptsProjectGetRpc, async (input) => {
    const record = store.getProject(input.projectId);
    return {
      projectId: record.projectId,
      items: record.items,
      disabledGlobalIds: record.disabledGlobalIds,
      order: record.order,
    };
  });

  server.handle(quickPromptsProjectSetRpc, async (input) => {
    const record = store.setProject(input.projectId, {
      items: input.items,
      disabledGlobalIds: input.disabledGlobalIds,
      order: input.order,
    });
    return {
      projectId: record.projectId,
      items: record.items,
      disabledGlobalIds: record.disabledGlobalIds,
      order: record.order,
      success: true,
    };
  });

  if (server.paseo?.workspaces) {
    void syncAllWorkspaces(server.paseo.workspaces).catch((error) => {
      console.error("[QuickPrompts] Startup workspace tagger sync failed:", error);
    });
  }

  const removeHook = server.addHook("workspace.create.after", async ({ workspace }, context) => {
    try {
      const handle = context.paseo.workspaces.ref(workspace.id);
      const snapshot = await handle.refresh();
      if (snapshot?.workspaceKind) {
        await tagWorkspace(
          workspace.id,
          snapshot.workspaceKind,
          snapshot.labels ?? [],
          context.paseo.workspaces,
        );
      }
    } catch (error) {
      console.error(`[QuickPrompts] Failed to auto-tag created workspace ${workspace.id}:`, error);
    }
  });

  return () => {
    removeHook?.();
  };
}
