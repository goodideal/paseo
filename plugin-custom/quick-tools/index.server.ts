import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  quickPromptsSettings,
  quickPromptsWorkspaceLabelsSyncRpc,
} from "./shared/contracts.js";
import { QuickPromptsStore } from "./server/quick-prompts-store.js";
import { syncAllWorkspaces, tagWorkspace } from "./server/workspace-tagger.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(quickPromptsSettings);
  const store = new QuickPromptsStore();

  async function isAutoLabelEnabled(): Promise<boolean> {
    try {
      const state = await settings.read();
      return state.status === "ready" ? state.values.autoLabelWorkspaces : true;
    } catch {
      return true;
    }
  }

  let inFlightSync: Promise<{ tagged: number; skipped: number }> | null = null;

  async function runWorkspaceLabelSync(
    workspaces: PluginHandlerContext["paseo"]["workspaces"],
    force = false,
  ): Promise<{ tagged: number; skipped: number }> {
    if (!force && !(await isAutoLabelEnabled())) {
      return { tagged: 0, skipped: 0 };
    }
    if (!inFlightSync) {
      inFlightSync = syncAllWorkspaces(workspaces).finally(() => {
        inFlightSync = null;
      });
    }
    return inFlightSync;
  }

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

  server.handle(quickPromptsWorkspaceLabelsSyncRpc, async (input, { paseo }) => {
    return runWorkspaceLabelSync(paseo.workspaces, Boolean(input.force));
  });

  const removeWorkspaceCreateHook = server.addHook(
    "workspace.create.after",
    async ({ workspace }, { paseo }) => {
      try {
        if (!(await isAutoLabelEnabled())) return;
        const detail = await paseo.workspaces.ref(workspace.id).refresh();
        if (!detail || detail.background || detail.archivingAt) return;
        await tagWorkspace(detail.id, detail.workspaceKind, detail.labels ?? [], paseo.workspaces);
      } catch (error) {
        console.error(
          `[QuickTools] Failed to auto-label created workspace ${workspace.id}:`,
          error,
        );
      }
    },
  );

  return () => {
    removeWorkspaceCreateHook();
  };
}
