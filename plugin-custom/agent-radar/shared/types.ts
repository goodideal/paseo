import { z } from "zod";

export const WatchdogIntentSchema = z.enum([
  "AUTO_CONTINUE",
  "COMPLETED",
  "BLOCKER_ESCALATE",
  "NEUTRAL",
]);
export type WatchdogIntent = z.infer<typeof WatchdogIntentSchema>;

export const DecisionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  actionType: z.enum(["retry_with_tip", "single_thread", "pause", "custom_prompt"]),
  promptPayload: z.string().optional(),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const BlockerReportSchema = z.object({
  agentId: z.string(),
  parentAgentId: z.string().nullable().optional(),
  subagentNickname: z.string().nullable().optional(),
  summary: z.string(),
  rootCause: z.string(),
  errorCode: z.string().optional(),
  options: z.array(DecisionOptionSchema),
  timestamp: z.string(),
});
export type BlockerReport = z.infer<typeof BlockerReportSchema>;

export const InFlightHeartbeatSchema = z.object({
  agentId: z.string(),
  subagentNickname: z.string().nullable().optional(),
  currentToolName: z.string(),
  elapsedSeconds: z.number(),
  statusDescription: z.string(),
});
export type InFlightHeartbeat = z.infer<typeof InFlightHeartbeatSchema>;

export const ResolveDecisionInputSchema = z.object({
  agentId: z.string(),
  optionId: z.string(),
  customFeedback: z.string().optional(),
});
export type ResolveDecisionInput = z.infer<typeof ResolveDecisionInputSchema>;

export const ResolveDecisionOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type ResolveDecisionOutput = z.infer<typeof ResolveDecisionOutputSchema>;

export const WatchdogStatusOutputSchema = z.object({
  inFlight: InFlightHeartbeatSchema.nullable(),
  blocker: BlockerReportSchema.nullable(),
  autoTurnCount: z.number(),
});
export type WatchdogStatusOutput = z.infer<typeof WatchdogStatusOutputSchema>;

// Radar Specific Schemas
export const RadarNodeStatusSchema = z.enum([
  "pending",
  "running",
  "reviewing",
  "fixing",
  "completed",
  "blocked",
  "error",
]);
export type RadarNodeStatus = z.infer<typeof RadarNodeStatusSchema>;

export const SuperpowerTaskStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: RadarNodeStatusSchema,
  currentRound: z.number().optional(),
  maxRounds: z.number().optional(),
  agentId: z.string().optional(),
  commits: z.array(z.string()).optional(),
  rulings: z.array(z.string()).optional(),
  durationMs: z.number().optional(),
});
export type SuperpowerTaskStep = z.infer<typeof SuperpowerTaskStepSchema>;

export const AgentTopologyNodeSchema = z.object({
  agentId: z.string(),
  parentAgentId: z.string().nullable().optional(),
  title: z.string(),
  status: z.enum(["initializing", "idle", "running", "error", "closed"]),
  runningTool: z.string().optional(),
  durationMs: z.number().optional(),
  childAgentIds: z.array(z.string()),
});
export type AgentTopologyNode = z.infer<typeof AgentTopologyNodeSchema>;

export const RadarSnapshotSchema = z.object({
  mode: z.enum(["superpower", "generic"]),
  superpower: z
    .object({
      planSlug: z.string(),
      planPath: z.string(),
      tasks: z.array(SuperpowerTaskStepSchema),
      currentTaskId: z.string().optional(),
    })
    .optional(),
  topology: z.object({
    rootAgentId: z.string(),
    nodes: z.record(z.string(), AgentTopologyNodeSchema),
  }),
  watchdog: z.object({
    activeHeartbeat: InFlightHeartbeatSchema.nullable().optional(),
    activeBlocker: BlockerReportSchema.nullable().optional(),
    autoTurnCount: z.number(),
    maxAutoTurns: z.number(),
  }),
});
export type RadarSnapshot = z.infer<typeof RadarSnapshotSchema>;
