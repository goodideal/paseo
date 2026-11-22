import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";

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

export const WorkflowStepAdapterManifestInputSchema = z.object({
  type: z.string().min(1),
  version: z.string().min(1),
  executionRisk: z.enum([
    "read",
    "workspace_observe",
    "workspace_write",
    "external_write",
    "privileged",
  ]),
  requiredPermissions: z.array(z.string()),
  repositoryCallable: z.boolean(),
  idempotency: z.enum(["none", "required"]),
  cancellation: z.enum(["unsupported", "supported", "best_effort"]),
  recovery: z.enum(["not_resumable", "resumable", "inspect_before_retry"]),
  supportedPlatforms: z.array(z.enum(["darwin", "linux", "win32"])),
  resourceConflictKey: z.string().min(1),
});

export const WorkflowPresetRegistrationSchema = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1),
  sourcePreset: z.string().min(1),
  definition: z.record(z.string(), z.unknown()),
});

export const workflowDefinitionListRpc = defineRpc({
  name: "workflow.definition.list",
  input: WorkflowScopeSchema,
  output: z.object({
    definitions: z.array(WorkflowDefinitionSummarySchema),
    error: z.string().nullable(),
  }),
});

export const workflowDefinitionInspectRpc = defineRpc({
  name: "workflow.definition.inspect",
  input: WorkflowScopeSchema.extend({
    workflowId: z.string().min(1),
  }),
  output: z.object({
    definition: WorkflowDefinitionSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowRunCreateRpc = defineRpc({
  name: "workflow.run.create",
  input: WorkflowScopeSchema.extend({
    workflowId: z.string().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    runId: z.string().nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowRunListRpc = defineRpc({
  name: "workflow.run.list",
  input: WorkflowScopeSchema.extend({
    status: WorkflowRunStatusSchema.optional(),
  }),
  output: z.object({
    runs: z.array(WorkflowRunSummarySchema),
    error: z.string().nullable(),
  }),
});

export const workflowRunInspectRpc = defineRpc({
  name: "workflow.run.inspect",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
  }),
  output: z.object({
    runId: z.string().nullable(),
    run: WorkflowRunDetailSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowRunCancelRpc = defineRpc({
  name: "workflow.run.cancel",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
  output: z.object({
    runId: z.string().nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowRunRetryRpc = defineRpc({
  name: "workflow.run.retry",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
    stepId: z.string().min(1),
  }),
  output: z.object({
    runId: z.string().nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowRunResumeRpc = defineRpc({
  name: "workflow.run.resume",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
  }),
  output: z.object({
    runId: z.string().nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowApprovalListRpc = defineRpc({
  name: "workflow.approval.list",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1).optional(),
  }),
  output: z.object({
    runId: z.string().nullable(),
    approvals: z.array(WorkflowApprovalSchema),
    error: z.string().nullable(),
  }),
});

export const workflowApprovalApproveRpc = defineRpc({
  name: "workflow.approval.approve",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
    approvalId: z.string().min(1),
  }),
  output: z.object({
    runId: z.string().nullable(),
    approval: WorkflowApprovalSchema.nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowApprovalDenyRpc = defineRpc({
  name: "workflow.approval.deny",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
    approvalId: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
  output: z.object({
    runId: z.string().nullable(),
    approval: WorkflowApprovalSchema.nullable(),
    run: WorkflowRunSummarySchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowArtifactListRpc = defineRpc({
  name: "workflow.artifact.list",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
  }),
  output: z.object({
    runId: z.string().nullable(),
    artifacts: z.array(WorkflowArtifactSchema),
    error: z.string().nullable(),
  }),
});

export const workflowArtifactGetRpc = defineRpc({
  name: "workflow.artifact.get",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
    artifactId: z.string().min(1),
  }),
  output: z.object({
    runId: z.string().nullable(),
    artifact: WorkflowArtifactSchema.nullable(),
    content: z.unknown().nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowInteractionRespondRpc = defineRpc({
  name: "workflow.interaction.respond",
  input: WorkflowScopeSchema.extend({
    runId: z.string().min(1),
    interactionId: z.string().min(1),
    answer: z.string().trim().min(1).max(16_384),
  }),
  output: z.object({
    runId: z.string().nullable(),
    interaction: WorkflowInteractionSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const workflowRegistryRegisterRpc = defineRpc({
  name: "workflow.registry.register",
  input: z.object({
    pluginId: z.string().min(1),
    presets: z.array(WorkflowPresetRegistrationSchema).default([]),
    stepAdapters: z.array(WorkflowStepAdapterManifestInputSchema).default([]),
  }),
  output: z.object({
    ok: z.boolean(),
    registeredPresets: z.number().int().nonnegative(),
    registeredAdapters: z.number().int().nonnegative(),
  }),
});
