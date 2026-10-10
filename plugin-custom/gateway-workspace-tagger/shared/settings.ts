import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const GatewayTaggerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  source: z.string().default("paseo"),
  workspaceParamName: z.string().default("workspace_id"),
  sourceParamName: z.string().default("source"),
  includeAgentId: z.boolean().default(true),
  agentParamName: z.string().default("agent_id"),
  includeWorkspaceName: z.boolean().default(true),
  workspaceNameParamName: z.string().default("workspace_name"),
  targetHosts: z.array(z.string()).default([]),
  extraEnvKeys: z.array(z.string()).default([]),
});

export type GatewayTaggerSettings = z.infer<typeof GatewayTaggerSettingsSchema>;

export const gatewayTaggerSettings = defineSettings({
  id: "gateway-workspace-tagger-settings",
  scope: "host",
  version: 1,
  schema: GatewayTaggerSettingsSchema,
});
