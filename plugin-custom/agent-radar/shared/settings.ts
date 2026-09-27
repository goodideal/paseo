import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const watchdogSettings = defineSettings({
  id: "watchdog-settings",
  scope: "host",
  version: 1,
  schema: z.object({
    maxAutoTurns: z.number().int().min(1).max(20).default(5),
    heartbeatThresholdSeconds: z.number().int().min(5).max(120).default(15),
  }),
});
