import { z } from "zod";

export const PetTaskStateSchema = z.enum([
  "STARTING",
  "RUNNING",
  "WAITING_DECISION",
  "STOPPED",
  "IDLE",
  "ERROR",
]);
export type PetTaskState = z.infer<typeof PetTaskStateSchema>;

export const PetPrioritySchema = z.enum(["P0", "P1", "P2"]);
export type PetPriority = z.infer<typeof PetPrioritySchema>;

export function computeTaskPriority(task: {
  state: string;
  pendingDecision?: unknown;
}): PetPriority {
  if (task.state === "WAITING_DECISION" || Boolean(task.pendingDecision)) {
    return "P0";
  }
  if (task.state === "RUNNING" || task.state === "STARTING") {
    return "P1";
  }
  return "P2";
}

export const PendingDecisionSchema = z.object({
  requestId: z.string(),
  actionRequested: z.string().optional(),
  riskHint: z.enum(["low", "medium", "high"]).default("medium"),
  requestedAt: z.number(),
  timeoutSeconds: z.number().min(10).max(1800).optional(),
  expiresAt: z.number().optional(),
});
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;

export const TrackedTaskSchema = z.object({
  agentId: z.string(),
  taskTitle: z.string(),
  state: PetTaskStateSchema,
  priority: PetPrioritySchema.default("P2"),
  startedAt: z.number().nullable(),
  activeDurationMs: z.number().min(0).nullable(),
  pendingDecision: PendingDecisionSchema.optional(),
});
export type TrackedTask = z.infer<typeof TrackedTaskSchema>;

export const PetDashboardSnapshotSchema = z.object({
  petMood: z.enum(["idle", "running", "waiting", "urgent", "celebrating", "dizzy"]).default("idle"),
  runningCount: z.number().int().min(0),
  waitingCount: z.number().int().min(0),
  stoppedCount: z.number().int().min(0),
  petXp: z.number().int().min(0),
  petLevel: z.number().int().min(1),
  xpToNextLevel: z.number().int().min(1).default(500),
  tasks: z.array(TrackedTaskSchema),
});
export type PetDashboardSnapshot = z.infer<typeof PetDashboardSnapshotSchema>;

export const CompanionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("decision.respond"),
    agentId: z.string(),
    requestId: z.string(),
    behavior: z.enum(["ALLOW", "DENY"]),
  }),
  z.object({
    type: z.literal("agent.focus"),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("pet.interact"),
  }),
]);
export type CompanionAction = z.infer<typeof CompanionActionSchema>;

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
