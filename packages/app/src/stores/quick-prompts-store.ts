import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { generateMessageId } from "@/types/stream";

export const QuickPromptTriggerTypeSchema = z.enum(["fixed", "rule", "ephemeral"]);
export type QuickPromptTriggerType = z.infer<typeof QuickPromptTriggerTypeSchema>;

export const QuickPromptAgentStatusSchema = z.enum(["idle", "running", "error"]);
export type QuickPromptAgentStatus = z.infer<typeof QuickPromptAgentStatusSchema>;

export const QuickPromptRuleConditionSchema = z.strictObject({
  keywords: z.array(z.string()).optional(),
  regex: z.string().optional(),
  agentStatuses: z.array(QuickPromptAgentStatusSchema).optional(),
  agentProfiles: z.array(z.string()).optional(),
});
export type QuickPromptRuleCondition = z.infer<typeof QuickPromptRuleConditionSchema>;

export const QuickPromptItemSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  content: z.string(),
  shortcut: z.string().optional(),
  triggerType: QuickPromptTriggerTypeSchema,
  ruleCondition: QuickPromptRuleConditionSchema.optional(),
  enabled: z.boolean(),
  builtIn: z.boolean().optional(),
  ephemeral: z.boolean().optional(),
  createdAt: z.number(),
  order: z.number(),
});
export type QuickPromptItem = z.infer<typeof QuickPromptItemSchema>;

export const QuickPromptsPersistedStateSchema = z.strictObject({
  items: z.array(QuickPromptItemSchema),
});
export type QuickPromptsPersistedState = z.infer<typeof QuickPromptsPersistedStateSchema>;

export const DEFAULT_QUICK_PROMPT_ITEMS: readonly QuickPromptItem[] = [
  {
    id: "builtin-continue",
    label: "Continue",
    content: "Please continue to the next step.",
    shortcut: "continue",
    triggerType: "fixed",
    enabled: true,
    builtIn: true,
    createdAt: 1,
    order: 0,
  },
  {
    id: "builtin-review",
    label: "Review",
    content:
      "Please review my recent code changes for potential edge cases, type safety, and performance issues.",
    shortcut: "review",
    triggerType: "fixed",
    enabled: true,
    builtIn: true,
    createdAt: 2,
    order: 1,
  },
  {
    id: "builtin-fix",
    label: "Fix Error",
    content:
      "Please analyze the error message above, identify the root cause, fix the issues, and re-run verification.",
    shortcut: "fix",
    triggerType: "rule",
    ruleCondition: {
      keywords: ["error", "exception", "failed", "failure", "报错", "失败"],
    },
    enabled: true,
    builtIn: true,
    createdAt: 3,
    order: 2,
  },
  {
    id: "builtin-test",
    label: "Run Tests",
    content: "Please run the relevant unit tests and ensure they all pass.",
    shortcut: "test",
    triggerType: "rule",
    ruleCondition: {
      keywords: ["test", "vitest", "jest", "spec", "测试"],
    },
    enabled: true,
    builtIn: true,
    createdAt: 4,
    order: 3,
  },
  {
    id: "builtin-approve",
    label: "Proceed",
    content: "Confirmed, please proceed with the proposed plan.",
    shortcut: "yes",
    triggerType: "rule",
    ruleCondition: {
      keywords: ["(y/n)", "proceed?", "approve", "confirm", "确认", "是否继续", "请选择"],
    },
    enabled: true,
    builtIn: true,
    createdAt: 5,
    order: 4,
  },
];

export type CreateQuickPromptInput = Omit<QuickPromptItem, "id" | "createdAt" | "order">;
export type UpdateQuickPromptInput = Partial<Omit<QuickPromptItem, "id" | "createdAt">>;

export interface QuickPromptsStoreState {
  items: QuickPromptItem[];
  addItem: (input: CreateQuickPromptInput) => string;
  updateItem: (id: string, patch: UpdateQuickPromptInput) => void;
  deleteItem: (id: string) => void;
  toggleItem: (id: string, enabled?: boolean) => void;
  reorderItems: (ids: string[]) => void;
  resetToDefaults: () => void;
}

export function createQuickPromptsStore(storage: StateStorage = AsyncStorage) {
  return create<QuickPromptsStoreState>()(
    persist(
      (set, get) => ({
        items: [...DEFAULT_QUICK_PROMPT_ITEMS],

        addItem: (input) => {
          const id = `qp_${generateMessageId()}`;
          const currentItems = get().items;
          const maxOrder = currentItems.reduce((max, item) => Math.max(max, item.order), -1);
          const newItem: QuickPromptItem = {
            ...input,
            id,
            createdAt: Date.now(),
            order: maxOrder + 1,
          };
          set({ items: [...currentItems, newItem] });
          return id;
        },

        updateItem: (id, patch) => {
          set((state) => ({
            items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          }));
        },

        deleteItem: (id) => {
          set((state) => ({
            items: state.items.filter((item) => item.id !== id),
          }));
        },

        toggleItem: (id, enabled) => {
          set((state) => ({
            items: state.items.map((item) =>
              item.id === id ? { ...item, enabled: enabled ?? !item.enabled } : item,
            ),
          }));
        },

        reorderItems: (ids) => {
          const currentItems = get().items;
          const itemMap = new Map(currentItems.map((item) => [item.id, item]));
          const reordered: QuickPromptItem[] = [];
          const seen = new Set<string>();

          ids.forEach((id, index) => {
            const item = itemMap.get(id);
            if (item && !seen.has(id)) {
              seen.add(id);
              reordered.push({ ...item, order: index });
            }
          });

          // Append any remaining items that were not in ids
          currentItems.forEach((item) => {
            if (!seen.has(item.id)) {
              reordered.push({ ...item, order: reordered.length });
            }
          });

          set({ items: reordered });
        },

        resetToDefaults: () => {
          set({ items: [...DEFAULT_QUICK_PROMPT_ITEMS] });
        },
      }),
      {
        name: "paseo-quick-prompts",
        storage: createValidatedPersistStorage(storage, QuickPromptsPersistedStateSchema),
        partialize: (state) => ({
          items: state.items,
        }),
      },
    ),
  );
}

export const useQuickPromptsStore = createQuickPromptsStore();
