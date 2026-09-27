import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_SAFE_COMMANDS = [
  "git status",
  "git diff",
  "git log",
  "cat ",
  "ls ",
  "grep ",
  "npm test",
  "vitest",
];

export const watchdogSettings = defineSettings({
  id: "watchdog-settings",
  scope: "host",
  version: 1,
  schema: z.object({
    autoContinue: z.boolean().default(false),
    autoApprovePermissions: z.boolean().default(true),
    maxAutoTurns: z.number().int().min(1).max(20).default(5),
    heartbeatThresholdSeconds: z.number().int().min(5).max(120).default(15),
    autoContinuePrompt: z.string().default("请继续执行下一步任务，直到交付并验证完成。"),
    safeCommandWhitelist: z.array(z.string()).default(DEFAULT_SAFE_COMMANDS),
    consecutiveErrorTolerance: z.number().int().min(1).max(5).default(2),
  }),
});
