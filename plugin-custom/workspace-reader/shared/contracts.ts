import { z } from "zod";
import { defineRpc, defineSubscription } from "@getpaseo/plugin";

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

export const getWorkspaceDigestRpc = defineRpc({
  name: "workspace_reader.digest.get.request",
  input: z.object({
    workspaceId: z.string(),
    forceRefresh: z.boolean().optional(),
  }),
  output: z.object({
    workspaceId: z.string(),
    digest: WorkspaceEvolutionDigestSchema.nullable(),
    isAnalyzing: z.boolean().optional(),
    error: z.string().optional(),
  }),
});

export const subscribeWorkspaceDigest = defineSubscription({
  name: "workspace_reader.digest.subscribe",
  input: z.object({
    workspaceId: z.string(),
  }),
  event: z.object({
    workspaceId: z.string(),
    digest: WorkspaceEvolutionDigestSchema,
  }),
});
