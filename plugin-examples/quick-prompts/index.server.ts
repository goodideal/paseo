import type { PluginServerContext } from "@getpaseo/plugin";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  quickPromptsSettings,
} from "./shared/contracts.js";
import { QuickPromptsStore } from "./server/quick-prompts-store.js";

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

  return () => {};
}
