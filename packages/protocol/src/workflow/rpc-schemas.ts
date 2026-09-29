import { z } from "zod";

export const WorkflowScopeSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
});

export const WorkflowRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "unknown",
]);

export const WorkflowStepAttemptStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "retry_wait",
  "waiting_approval",
  "succeeded",
  "skipped",
  "failed",
  "cancelled",
  "blocked",
  "unknown",
]);

export const WorkflowExecutionRiskSchema = z.enum([
  "observe",
  "workspace_write",
  "external_side_effect",
  "privileged",
]);

export const WorkflowDefinitionSummarySchema = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1),
  sourcePreset: z.string().min(1),
  definitionRevision: z.string().min(1),
  definitionHash: z.string().min(1),
});

export const WorkflowStepAttemptSchema = z.object({
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  status: WorkflowStepAttemptStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  skipReason: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const WorkflowInteractionStatusSchema = z.enum([
  "pending",
  "answered",
  "expired",
  "cancelled",
]);

export const WorkflowInteractionSchema = z.object({
  id: z.string().min(1),
  interactionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  status: WorkflowInteractionStatusSchema.optional(),
  promptArtifactId: z.string().min(1).optional(),
  answerArtifactId: z.string().min(1).nullable().optional(),
  question: z.string().nullable().optional(),
  requestedAt: z.union([z.number(), z.string()]).optional(),
  answeredAt: z.union([z.number(), z.string()]).nullable().optional(),
  responderId: z.string().nullable().optional(),
  createdAt: z.union([z.number(), z.string()]).optional(),
});

export const DeliveryApprovalManifestSchema = z.object({
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  commitSha: z.string().min(1),
  pullRequestTitle: z.string().min(1),
  pullRequestBodyDigest: z.string().min(1),
  issueReference: z.string().min(1),
});

export const WorkflowRunSummarySchema = WorkflowScopeSchema.extend({
  runId: z.string().min(1),
  workflowId: z.string().min(1),
  name: z.string().min(1),
  sourcePreset: z.string().min(1),
  definitionRevision: z.string().min(1),
  definitionHash: z.string().min(1),
  status: WorkflowRunStatusSchema,
  currentStepId: z.string().nullable(),
  executionRisk: WorkflowExecutionRiskSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  pendingInteraction: WorkflowInteractionSchema.nullable().optional(),
});

export const WorkflowRunDetailSchema = WorkflowRunSummarySchema.extend({
  stepAttempts: z.array(WorkflowStepAttemptSchema),
  interactions: z.array(WorkflowInteractionSchema).optional(),
  deliveryApprovalManifest: DeliveryApprovalManifestSchema.nullable().optional(),
});

export const WorkflowApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);

export const WorkflowApprovalSchema = WorkflowScopeSchema.extend({
  approvalId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  status: WorkflowApprovalStatusSchema,
  action: z.string().min(1),
  target: z.string().min(1),
  policyReason: z.string().min(1),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  reason: z.string().nullable(),
  manifestDigest: z.string().nullable().optional(),
});

export const WorkflowArtifactSchema = WorkflowScopeSchema.extend({
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().nullable(),
  kind: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  redacted: z.boolean().optional(),
  createdAt: z.string(),
});

const WorkflowRequestScopeSchema = WorkflowScopeSchema.extend({
  requestId: z.string().min(1),
});

const WorkflowResponseScopeSchema = WorkflowRequestScopeSchema.extend({
  // Definition RPCs have no associated run. Run-scoped responses always populate this field.
  runId: z.string().min(1).nullable(),
});

export const WorkflowDefinitionListRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.definition.list.request"),
});

export const WorkflowDefinitionInspectRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.definition.inspect.request"),
  workflowId: z.string().min(1),
});

export const WorkflowRunCreateRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.run.create.request"),
  workflowId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
});

export const WorkflowRunListRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.run.list.request"),
  status: WorkflowRunStatusSchema.optional(),
});

export const WorkflowRunInspectRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.run.inspect.request"),
  runId: z.string().min(1),
});

export const WorkflowRunCancelRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.run.cancel.request"),
  runId: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const WorkflowRunRetryRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.run.retry.request"),
  runId: z.string().min(1),
  stepId: z.string().min(1),
});

export const WorkflowRunResumeRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.run.resume.request"),
  runId: z.string().min(1),
});

export const WorkflowApprovalListRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.approval.list.request"),
  runId: z.string().min(1).optional(),
});

export const WorkflowApprovalApproveRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.approval.approve.request"),
  runId: z.string().min(1),
  approvalId: z.string().min(1),
});

export const WorkflowApprovalDenyRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.approval.deny.request"),
  runId: z.string().min(1),
  approvalId: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const WorkflowInteractionRespondRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.interaction.respond.request"),
  runId: z.string().min(1),
  interactionId: z.string().min(1),
  answer: z.string().trim().min(1).max(16_384),
});

export const WorkflowArtifactListRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.artifact.list.request"),
  runId: z.string().min(1),
});

export const WorkflowArtifactGetRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.artifact.get.request"),
  runId: z.string().min(1),
  artifactId: z.string().min(1),
});

export const WorkflowDefinitionListResponseSchema = z.object({
  type: z.literal("workflow.definition.list.response"),
  payload: WorkflowResponseScopeSchema.extend({
    definitions: z.array(WorkflowDefinitionSummarySchema),
    error: z.string().nullable(),
  }),
});

export const WorkflowDefinitionInspectResponseSchema = z.object({
  type: z.literal("workflow.definition.inspect.response"),
  payload: WorkflowResponseScopeSchema.extend({
    definition: WorkflowDefinitionSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowRunCreateResponseSchema = z.object({
  type: z.literal("workflow.run.create.response"),
  payload: WorkflowResponseScopeSchema.extend({
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowRunListResponseSchema = z.object({
  type: z.literal("workflow.run.list.response"),
  payload: WorkflowResponseScopeSchema.extend({
    runs: z.array(WorkflowRunSummarySchema),
    error: z.string().nullable(),
  }),
});

export const WorkflowRunInspectResponseSchema = z.object({
  type: z.literal("workflow.run.inspect.response"),
  payload: WorkflowResponseScopeSchema.extend({
    run: WorkflowRunDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowRunCancelResponseSchema = z.object({
  type: z.literal("workflow.run.cancel.response"),
  payload: WorkflowResponseScopeSchema.extend({
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowRunRetryResponseSchema = z.object({
  type: z.literal("workflow.run.retry.response"),
  payload: WorkflowResponseScopeSchema.extend({
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowRunResumeResponseSchema = z.object({
  type: z.literal("workflow.run.resume.response"),
  payload: WorkflowResponseScopeSchema.extend({
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowApprovalListResponseSchema = z.object({
  type: z.literal("workflow.approval.list.response"),
  payload: WorkflowResponseScopeSchema.extend({
    approvals: z.array(WorkflowApprovalSchema),
    error: z.string().nullable(),
  }),
});

export const WorkflowApprovalApproveResponseSchema = z.object({
  type: z.literal("workflow.approval.approve.response"),
  payload: WorkflowResponseScopeSchema.extend({
    approval: WorkflowApprovalSchema.nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowApprovalDenyResponseSchema = z.object({
  type: z.literal("workflow.approval.deny.response"),
  payload: WorkflowResponseScopeSchema.extend({
    approval: WorkflowApprovalSchema.nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowArtifactListResponseSchema = z.object({
  type: z.literal("workflow.artifact.list.response"),
  payload: WorkflowResponseScopeSchema.extend({
    artifacts: z.array(WorkflowArtifactSchema),
    error: z.string().nullable(),
  }),
});

export const WorkflowArtifactGetResponseSchema = z.object({
  type: z.literal("workflow.artifact.get.response"),
  payload: WorkflowResponseScopeSchema.extend({
    artifact: WorkflowArtifactSchema.nullable(),
    content: z.unknown().nullable(),
    error: z.string().nullable(),
  }),
});

export const WorkflowInteractionRespondResponseSchema = z.object({
  type: z.literal("workflow.interaction.respond.response"),
  payload: WorkflowResponseScopeSchema.extend({
    interaction: WorkflowInteractionSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type WorkflowScope = z.infer<typeof WorkflowScopeSchema>;
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;
export type WorkflowStepAttemptStatus = z.infer<typeof WorkflowStepAttemptStatusSchema>;
export type WorkflowExecutionRisk = z.infer<typeof WorkflowExecutionRiskSchema>;
export type WorkflowDefinitionSummary = z.infer<typeof WorkflowDefinitionSummarySchema>;
export type WorkflowStepAttempt = z.infer<typeof WorkflowStepAttemptSchema>;
export type WorkflowRunSummary = z.infer<typeof WorkflowRunSummarySchema>;
export type WorkflowRunDetail = z.infer<typeof WorkflowRunDetailSchema>;
export type WorkflowApprovalStatus = z.infer<typeof WorkflowApprovalStatusSchema>;
export type WorkflowApproval = z.infer<typeof WorkflowApprovalSchema>;
export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>;
export type WorkflowDefinitionListRequest = z.infer<typeof WorkflowDefinitionListRequestSchema>;
export type WorkflowDefinitionInspectRequest = z.infer<
  typeof WorkflowDefinitionInspectRequestSchema
>;
export type WorkflowRunCreateRequest = z.infer<typeof WorkflowRunCreateRequestSchema>;
export type WorkflowRunListRequest = z.infer<typeof WorkflowRunListRequestSchema>;
export type WorkflowRunInspectRequest = z.infer<typeof WorkflowRunInspectRequestSchema>;
export type WorkflowRunCancelRequest = z.infer<typeof WorkflowRunCancelRequestSchema>;
export type WorkflowRunRetryRequest = z.infer<typeof WorkflowRunRetryRequestSchema>;
export type WorkflowRunResumeRequest = z.infer<typeof WorkflowRunResumeRequestSchema>;
export type WorkflowApprovalListRequest = z.infer<typeof WorkflowApprovalListRequestSchema>;
export type WorkflowApprovalApproveRequest = z.infer<typeof WorkflowApprovalApproveRequestSchema>;
export type WorkflowApprovalDenyRequest = z.infer<typeof WorkflowApprovalDenyRequestSchema>;
export type WorkflowArtifactListRequest = z.infer<typeof WorkflowArtifactListRequestSchema>;
export type WorkflowArtifactGetRequest = z.infer<typeof WorkflowArtifactGetRequestSchema>;
export type WorkflowDefinitionListResponse = z.infer<typeof WorkflowDefinitionListResponseSchema>;
export type WorkflowDefinitionInspectResponse = z.infer<
  typeof WorkflowDefinitionInspectResponseSchema
>;
export type WorkflowRunCreateResponse = z.infer<typeof WorkflowRunCreateResponseSchema>;
export type WorkflowRunListResponse = z.infer<typeof WorkflowRunListResponseSchema>;
export type WorkflowRunInspectResponse = z.infer<typeof WorkflowRunInspectResponseSchema>;
export type WorkflowRunCancelResponse = z.infer<typeof WorkflowRunCancelResponseSchema>;
export type WorkflowRunRetryResponse = z.infer<typeof WorkflowRunRetryResponseSchema>;
export type WorkflowRunResumeResponse = z.infer<typeof WorkflowRunResumeResponseSchema>;
export type WorkflowApprovalListResponse = z.infer<typeof WorkflowApprovalListResponseSchema>;
export type WorkflowApprovalApproveResponse = z.infer<typeof WorkflowApprovalApproveResponseSchema>;
export type WorkflowApprovalDenyResponse = z.infer<typeof WorkflowApprovalDenyResponseSchema>;
export type WorkflowArtifactListResponse = z.infer<typeof WorkflowArtifactListResponseSchema>;
export type WorkflowArtifactGetResponse = z.infer<typeof WorkflowArtifactGetResponseSchema>;
export type WorkflowInteractionStatus = z.infer<typeof WorkflowInteractionStatusSchema>;
export type WorkflowInteraction = z.infer<typeof WorkflowInteractionSchema>;
export type DeliveryApprovalManifest = z.infer<typeof DeliveryApprovalManifestSchema>;
export type WorkflowInteractionRespondRequest = z.infer<
  typeof WorkflowInteractionRespondRequestSchema
>;
export type WorkflowInteractionRespondResponse = z.infer<
  typeof WorkflowInteractionRespondResponseSchema
>;
