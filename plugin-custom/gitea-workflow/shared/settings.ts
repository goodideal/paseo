import { defineSettings } from "@getpaseo/plugin";
import { GiteaHostSettingsSchema } from "./types.js";

export const giteaSettingsDefinition = defineSettings({
  id: "config",
  scope: "host",
  version: 2,
  schema: GiteaHostSettingsSchema,
  migrate: (values: unknown, fromVersion: number) => {
    const nextValues: Record<string, unknown> =
      values && typeof values === "object" && !Array.isArray(values)
        ? { ...(values as Record<string, unknown>) }
        : {};
    if (fromVersion < 2 && nextValues.workflowPolicy === "full_superpowers") {
      nextValues.workflowPolicy = "direct_pr";
    }
    try {
      return GiteaHostSettingsSchema.parse(nextValues);
    } catch {
      return GiteaHostSettingsSchema.parse({});
    }
  },
});
