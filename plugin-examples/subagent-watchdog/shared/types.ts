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
