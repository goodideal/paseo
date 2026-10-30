import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const SuperpowersMatrixRouterSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  overrideIfDefaultOnly: z.boolean().default(true),
  debugLogs: z.boolean().default(true),
});

export type SuperpowersMatrixRouterSettings = z.infer<typeof SuperpowersMatrixRouterSettingsSchema>;

export const superpowersMatrixRouterSettings = defineSettings({
  id: "superpowers-matrix-router-settings",
  scope: "host",
  version: 1,
  schema: SuperpowersMatrixRouterSettingsSchema,
});
