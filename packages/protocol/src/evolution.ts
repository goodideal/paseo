import { z } from "zod";

export const AgentMilestoneStatusSchema = z.enum(["running", "completed", "error", "cancelled"]);
export type AgentMilestoneStatus = z.infer<typeof AgentMilestoneStatusSchema>;

export const MilestoneCommitSchema = z.object({
  hash: z.string(),
  message: z.string(),
});
export type MilestoneCommit = z.infer<typeof MilestoneCommitSchema>;

export const AgentMilestoneRecordSchema = z.object({
  agentId: z.string(),
  provider: z.string(),
  model: z.string().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  durationMs: z.number(),
  status: AgentMilestoneStatusSchema,
  intentPrompt: z.string(),
  executiveSummary: z.string(),
  keyDecisions: z.array(z.string()),
  blockersResolved: z.array(z.string()).optional(),
  modifiedFiles: z.array(z.string()),
  createdArtifacts: z.array(z.string()).optional(),
  commits: z.array(MilestoneCommitSchema).optional(),
});
export type AgentMilestoneRecord = z.infer<typeof AgentMilestoneRecordSchema>;

export const OverallEvolutionStatusSchema = z.enum([
  "in_progress",
  "ready_for_review",
  "blocked",
  "completed",
]);
export type OverallEvolutionStatus = z.infer<typeof OverallEvolutionStatusSchema>;

export const WorkspaceEvolutionDigestSchema = z.object({
  workspaceId: z.string(),
  workspaceTitle: z.string(),
  branch: z.string(),
  executiveSummary: z.string(),
  currentStage: z.string(),
  overallStatus: OverallEvolutionStatusSchema,
  updatedAt: z.string(),
  milestones: z.array(AgentMilestoneRecordSchema),
});
export type WorkspaceEvolutionDigest = z.infer<typeof WorkspaceEvolutionDigestSchema>;

export const WorkspaceEvolutionGetDigestRequestSchema = z.object({
  type: z.literal("workspace.evolution.get_digest.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  forceRefresh: z.boolean().optional(),
});
export type WorkspaceEvolutionGetDigestRequest = z.infer<
  typeof WorkspaceEvolutionGetDigestRequestSchema
>;

export const WorkspaceEvolutionGetDigestResponsePayloadSchema = z.object({
  requestId: z.string(),
  workspaceId: z.string(),
  digest: WorkspaceEvolutionDigestSchema.nullable(),
  isAnalyzing: z.boolean().optional(),
  error: z.string().optional(),
});
export type WorkspaceEvolutionGetDigestResponsePayload = z.infer<
  typeof WorkspaceEvolutionGetDigestResponsePayloadSchema
>;

export const WorkspaceEvolutionGetDigestResponseSchema = z.object({
  type: z.literal("workspace.evolution.get_digest.response"),
  payload: WorkspaceEvolutionGetDigestResponsePayloadSchema,
});
export type WorkspaceEvolutionGetDigestResponse = z.infer<
  typeof WorkspaceEvolutionGetDigestResponseSchema
>;

export const WorkspaceEvolutionUpdatedPayloadSchema = z.object({
  workspaceId: z.string(),
  digest: WorkspaceEvolutionDigestSchema,
});
export type WorkspaceEvolutionUpdatedPayload = z.infer<
  typeof WorkspaceEvolutionUpdatedPayloadSchema
>;

export const WorkspaceEvolutionUpdatedMessageSchema = z.object({
  type: z.literal("workspace.evolution.updated"),
  payload: WorkspaceEvolutionUpdatedPayloadSchema,
});
export type WorkspaceEvolutionUpdatedMessage = z.infer<
  typeof WorkspaceEvolutionUpdatedMessageSchema
>;
