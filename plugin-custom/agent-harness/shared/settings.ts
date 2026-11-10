import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const AgentHarnessSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  overrideIfDefaultOnly: z.boolean().default(true),
  debugLogs: z.boolean().default(false),
});

export type AgentHarnessSettings = z.infer<typeof AgentHarnessSettingsSchema>;

export const agentHarnessSettings = defineSettings({
  id: "agent-harness-settings",
  scope: "host",
  version: 1,
  schema: AgentHarnessSettingsSchema,
});
