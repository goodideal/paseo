import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const watchdogSettings = defineSettings({
  id: "watchdog-settings",
  scope: "host",
  version: 1,
  schema: z.object({
    autoContinue: z.boolean().default(true),
    autoApprovePermissions: z.boolean().default(true),
    maxAutoTurns: z.number().int().min(1).max(20).default(5),
    heartbeatThresholdSeconds: z.number().int().min(5).max(120).default(15),
  }),
});
