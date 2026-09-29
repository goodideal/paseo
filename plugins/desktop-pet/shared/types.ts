import { z } from "zod";

export const PetTaskStateSchema = z.enum(["RUNNING", "WAITING_DECISION", "STOPPED", "IDLE"]);
export type PetTaskState = z.infer<typeof PetTaskStateSchema>;

export const PendingDecisionSchema = z.object({
  requestId: z.string(),
  actionRequested: z.string(),
  riskHint: z.enum(["low", "medium", "high"]),
  requestedAt: z.number(),
  timeoutSeconds: z.number().min(10).max(1800),
  expiresAt: z.number(),
});
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const TrackedTaskSchema = z.object({
  agentId: z.string(),
  taskTitle: z.string(),
  state: PetTaskStateSchema,
  startedAt: z.number(),
  activeDurationMs: z.number().min(0),
  pendingDecision: PendingDecisionSchema.optional(),
});
export type TrackedTask = z.infer<typeof TrackedTaskSchema>;

export const PetDashboardSnapshotSchema = z.object({
  runningCount: z.number().int().min(0),
  waitingCount: z.number().int().min(0),
  stoppedCount: z.number().int().min(0),
  petXp: z.number().int().min(0),
  petLevel: z.number().int().min(1),
  tasks: z.array(TrackedTaskSchema),
});
export type PetDashboardSnapshot = z.infer<typeof PetDashboardSnapshotSchema>;

export const AuditRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  agentId: z.string(),
  taskTitle: z.string(),
  triggerType: z.enum(["TIMEOUT_AUTO_DECISION", "MANUAL_DECISION"]),
  requestedAction: z.string(),
  decision: z.enum(["ALLOW", "DENY"]),
  riskLevel: z.enum(["low", "medium", "high"]),
  aiReason: z.string(),
  reviewedByHuman: z.boolean().default(false),
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const DesktopPetSettingsSchema = z.object({
  autoDecisionEnabled: z.boolean().default(true),
  defaultTimeoutSeconds: z.number().int().min(10).max(1800).default(180),
  soundEnabled: z.boolean().default(true),
  soundVolume: z.number().min(0).max(1).default(0.7),
  riskThreshold: z.enum(["conservative", "balanced", "liberal"]).default("balanced"),
  skinTheme: z.enum(["pixel_cat", "cyber_bot", "shiba_inu"]).default("pixel_cat"),
});
export type DesktopPetSettings = z.infer<typeof DesktopPetSettingsSchema>;
