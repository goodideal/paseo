import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const AgentHarnessSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  overrideIfDefaultOnly: z.boolean().default(true),
  debugLogs: z.boolean().default(false),
  llmFallbackEnabled: z.boolean().default(true),
  llmFallbackEndpoint: z.string().default(""),
  llmFallbackApiKey: z.string().default(""),
  llmFallbackModel: z.string().default("lite"),
  llmFallbackTimeoutMs: z.number().int().min(100).max(5000).default(450),
  phaseLifecycleEnabled: z.boolean().default(true),
  planTurnSoftLimit: z.number().int().min(1).max(20).default(3),
  autoDowngradePlanOnExec: z.boolean().default(true),
  enforceNativePlanMode: z.boolean().default(true),
  emitTimelineTransitions: z.boolean().default(true),
});

export type AgentHarnessSettings = z.infer<typeof AgentHarnessSettingsSchema>;

export const DEFAULT_AGENT_HARNESS_SETTINGS: AgentHarnessSettings =
  AgentHarnessSettingsSchema.parse({});

export const agentHarnessSettings = defineSettings({
  id: "agent-harness-settings",
  scope: "host",
  version: 1,
  schema: AgentHarnessSettingsSchema,
});
