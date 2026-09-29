import { defineSettings } from "@getpaseo/plugin";
import { GiteaHostSettingsSchema } from "./types.js";

export const giteaSettingsDefinition = defineSettings({
  id: "config",
  scope: "host",
  version: 1,
  schema: GiteaHostSettingsSchema,
});
