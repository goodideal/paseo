import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  DEFAULT_LOCAL_LABEL_COLOR,
  DEFAULT_WORKTREE_LABEL_COLOR,
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  quickPromptsSettings,
  quickPromptsWorkspaceLabelsSyncRpc,
  type WorkspaceLabelColor,
} from "./shared/contracts.js";
import { QuickPromptsStore } from "./server/quick-prompts-store.js";
import { syncAllWorkspaces, tagWorkspace } from "./server/workspace-tagger.js";

interface ResolvedWorkspaceLabelSettings {
  autoLabelWorkspaces: boolean;
  localLabelColor: WorkspaceLabelColor;
  worktreeLabelColor: WorkspaceLabelColor;
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(quickPromptsSettings);
  const store = new QuickPromptsStore();

  async function readWorkspaceLabelSettings(): Promise<ResolvedWorkspaceLabelSettings> {
    try {
      const state = await settings.read();
      if (state.status === "ready") {
        return {
          autoLabelWorkspaces: state.values.autoLabelWorkspaces,
          localLabelColor: state.values.localLabelColor ?? DEFAULT_LOCAL_LABEL_COLOR,
          worktreeLabelColor: state.values.worktreeLabelColor ?? DEFAULT_WORKTREE_LABEL_COLOR,
        };
      }
    } catch {
      // Fall back to defaults when settings store is unavailable
    }
    return {
      autoLabelWorkspaces: true,
      localLabelColor: DEFAULT_LOCAL_LABEL_COLOR,
      worktreeLabelColor: DEFAULT_WORKTREE_LABEL_COLOR,
    };
  }

  let inFlightSync: Promise<{ tagged: number; skipped: number }> | null = null;

  async function runWorkspaceLabelSync(
    workspaces: PluginHandlerContext["paseo"]["workspaces"],
    options: {
      force?: boolean;
      syncColor?: boolean;
      localLabelColor?: WorkspaceLabelColor;
      worktreeLabelColor?: WorkspaceLabelColor;
    } = {},
  ): Promise<{ tagged: number; skipped: number }> {
    const force = Boolean(options.force);
    const syncColor = Boolean(options.syncColor || force);

    while (inFlightSync) {
      if (!force && !syncColor) {
        return inFlightSync;
      }
      await inFlightSync.catch(() => {});
    }

    const syncPromise = (async () => {
      const current = await readWorkspaceLabelSettings();
      if (!force && !current.autoLabelWorkspaces && !syncColor) {
        return { tagged: 0, skipped: 0 };
      }

      const colorOptions = {
        localLabelColor: options.localLabelColor ?? current.localLabelColor,
        worktreeLabelColor: options.worktreeLabelColor ?? current.worktreeLabelColor,
        syncColor,
        onlyExisting: !force && !current.autoLabelWorkspaces,
      };

      return syncAllWorkspaces(workspaces, colorOptions);
    })().finally(() => {
      if (inFlightSync === syncPromise) {
        inFlightSync = null;
      }
    });
    inFlightSync = syncPromise;
    return syncPromise;
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
    return runWorkspaceLabelSync(paseo.workspaces, {
      force: Boolean(input.force),
      syncColor: Boolean(input.syncColor),
      localLabelColor: input.localLabelColor,
      worktreeLabelColor: input.worktreeLabelColor,
    });
  });

  const removeWorkspaceCreateHook = server.addHook(
    "workspace.create.after",
    async ({ workspace }, { paseo }) => {
      try {
        const current = await readWorkspaceLabelSettings();
        if (!current.autoLabelWorkspaces) return;
        const detail = await paseo.workspaces.ref(workspace.id).refresh();
        if (!detail || detail.background || detail.archivingAt) return;
        await tagWorkspace(detail.id, detail.workspaceKind, detail.labels ?? [], paseo.workspaces, {
          localLabelColor: current.localLabelColor,
          worktreeLabelColor: current.worktreeLabelColor,
        });
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
