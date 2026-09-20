import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createQuickPromptsStore,
  DEFAULT_QUICK_PROMPT_ITEMS,
  QuickPromptsPersistedStateSchema,
} from "./quick-prompts-store";

function createMemoryStorage(): StateStorage {
  const map = new Map<string, string>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
  };
}

describe("quick-prompts-store", () => {
  it("initializes with default quick prompt items", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    const items = store.getState().items;
    expect(items.length).toBe(DEFAULT_QUICK_PROMPT_ITEMS.length);
    expect(items.map((i) => i.label)).toEqual(DEFAULT_QUICK_PROMPT_ITEMS.map((i) => i.label));
  });

  it("adds a new item with auto-assigned order and id", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    const id = store.getState().addItem({
      label: "生成提交信息",
      content: "请根据当前 git status 和 diff 生成规范的 Git Commit message。",
      shortcut: "commit",
      triggerType: "fixed",
      enabled: true,
    });

    expect(id).toMatch(/^qp_/);
    const item = store.getState().items.find((i) => i.id === id);
    expect(item).toBeDefined();
    expect(item?.label).toBe("生成提交信息");
    expect(item?.order).toBe(DEFAULT_QUICK_PROMPT_ITEMS.length);
  });

  it("updates an existing item", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    const targetId = DEFAULT_QUICK_PROMPT_ITEMS[0].id;
    store.getState().updateItem(targetId, {
      label: "继续执行",
      content: "请继续，不要停。",
    });

    const updated = store.getState().items.find((i) => i.id === targetId);
    expect(updated?.label).toBe("继续执行");
    expect(updated?.content).toBe("请继续，不要停。");
  });

  it("deletes an item", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    const targetId = DEFAULT_QUICK_PROMPT_ITEMS[0].id;
    store.getState().deleteItem(targetId);

    const remaining = store.getState().items;
    expect(remaining.some((i) => i.id === targetId)).toBe(false);
  });

  it("toggles an item enabled state", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    const targetId = DEFAULT_QUICK_PROMPT_ITEMS[0].id;
    expect(store.getState().items.find((i) => i.id === targetId)?.enabled).toBe(true);

    store.getState().toggleItem(targetId);
    expect(store.getState().items.find((i) => i.id === targetId)?.enabled).toBe(false);

    store.getState().toggleItem(targetId, true);
    expect(store.getState().items.find((i) => i.id === targetId)?.enabled).toBe(true);
  });

  it("reorders items correctly", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    const initialIds = store.getState().items.map((i) => i.id);
    const reversed = initialIds.toReversed();

    store.getState().reorderItems(reversed);

    const newOrder = store.getState().items.map((i) => i.id);
    expect(newOrder).toEqual(reversed);
  });

  it("resets back to defaults", () => {
    const memory = createMemoryStorage();
    const store = createQuickPromptsStore(memory);

    store.getState().deleteItem(DEFAULT_QUICK_PROMPT_ITEMS[0].id);
    store.getState().addItem({
      label: "临时测试",
      content: "测试内容",
      triggerType: "fixed",
      enabled: true,
    });

    store.getState().resetToDefaults();

    expect(store.getState().items.map((i) => i.id)).toEqual(
      DEFAULT_QUICK_PROMPT_ITEMS.map((i) => i.id),
    );
  });

  it("validates state with QuickPromptsPersistedStateSchema", () => {
    const valid = {
      items: [
        {
          id: "item-1",
          label: "Test",
          content: "Prompt content",
          triggerType: "fixed" as const,
          enabled: true,
          createdAt: 100,
          order: 0,
        },
      ],
    };

    expect(QuickPromptsPersistedStateSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      items: [
        {
          id: "item-1",
          triggerType: "unknown-type",
        },
      ],
    };

    expect(QuickPromptsPersistedStateSchema.safeParse(invalid).success).toBe(false);
  });
});
