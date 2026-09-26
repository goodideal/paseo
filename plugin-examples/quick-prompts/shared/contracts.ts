import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const QuickPromptTriggerTypeSchema = z.enum(["fixed", "rule", "ephemeral"]);
export type QuickPromptTriggerType = z.infer<typeof QuickPromptTriggerTypeSchema>;

export const QuickPromptAgentStatusSchema = z.enum(["idle", "running", "error"]);
export type QuickPromptAgentStatus = z.infer<typeof QuickPromptAgentStatusSchema>;

export const QuickPromptRuleConditionSchema = z.object({
  keywords: z.array(z.string()).optional(),
  regex: z.string().optional(),
  agentStatuses: z.array(QuickPromptAgentStatusSchema).optional(),
  agentProfiles: z.array(z.string()).optional(),
});
export type QuickPromptRuleCondition = z.infer<typeof QuickPromptRuleConditionSchema>;

export const QuickPromptItemSchema = z.object({
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

export const GlobalQuickPromptsRecordSchema = z.object({
  version: z.literal(1).optional(),
  items: z.array(QuickPromptItemSchema),
});
export type GlobalQuickPromptsRecord = z.infer<typeof GlobalQuickPromptsRecordSchema>;

export const ProjectQuickPromptsRecordSchema = z.object({
  version: z.literal(1).optional(),
  projectId: z.string(),
  items: z.array(QuickPromptItemSchema),
  disabledGlobalIds: z.array(z.string()),
  order: z.array(z.string()).optional(),
});
export type ProjectQuickPromptsRecord = z.infer<typeof ProjectQuickPromptsRecordSchema>;

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

export const quickPromptsGlobalGetRpc = defineRpc({
  name: "quick_prompts.global.get.request",
  input: z.object({}).optional().default({}),
  output: z.object({
    items: z.array(QuickPromptItemSchema),
  }),
});

export const quickPromptsGlobalSetRpc = defineRpc({
  name: "quick_prompts.global.set.request",
  input: z.object({
    items: z.array(QuickPromptItemSchema),
  }),
  output: z.object({
    items: z.array(QuickPromptItemSchema),
    success: z.boolean(),
  }),
});

export const quickPromptsProjectGetRpc = defineRpc({
  name: "quick_prompts.project.get.request",
  input: z.object({
    projectId: z.string(),
  }),
  output: z.object({
    projectId: z.string(),
    items: z.array(QuickPromptItemSchema),
    disabledGlobalIds: z.array(z.string()),
    order: z.array(z.string()).optional(),
  }),
});

export const quickPromptsProjectSetRpc = defineRpc({
  name: "quick_prompts.project.set.request",
  input: z.object({
    projectId: z.string(),
    items: z.array(QuickPromptItemSchema).optional(),
    disabledGlobalIds: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
  }),
  output: z.object({
    projectId: z.string(),
    items: z.array(QuickPromptItemSchema),
    disabledGlobalIds: z.array(z.string()),
    order: z.array(z.string()).optional(),
    success: z.boolean(),
  }),
});

export type QuickPromptsGlobalGetInput = z.infer<typeof quickPromptsGlobalGetRpc.input>;
export type QuickPromptsGlobalGetOutput = z.infer<typeof quickPromptsGlobalGetRpc.output>;
export type QuickPromptsGlobalSetInput = z.infer<typeof quickPromptsGlobalSetRpc.input>;
export type QuickPromptsGlobalSetOutput = z.infer<typeof quickPromptsGlobalSetRpc.output>;
export type QuickPromptsProjectGetInput = z.infer<typeof quickPromptsProjectGetRpc.input>;
export type QuickPromptsProjectGetOutput = z.infer<typeof quickPromptsProjectGetRpc.output>;
export type QuickPromptsProjectSetInput = z.infer<typeof quickPromptsProjectSetRpc.input>;
export type QuickPromptsProjectSetOutput = z.infer<typeof quickPromptsProjectSetRpc.output>;

export const quickPromptsSettings = defineSettings({
  id: "quick-prompts",
  scope: "host",
  version: 1,
  schema: z.object({
    aiSuggestions: z.boolean().default(true),
  }),
});
