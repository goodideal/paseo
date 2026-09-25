import { z } from "zod";

export const WorkflowPermissionSchema = z.enum([
  "daemon.read",
  "daemon.manage",
  "tunnel.manage",
  "access.manage",
  "workspace.read",
  "workspace.write",
  "workspace.manage",
  "automation.manage",
  "hub.execute",
]);

export const WorkflowExecutionRiskSchema = z.enum([
  "read",
  "workspace_observe",
  "workspace_write",
  "external_write",
  "privileged",
]);

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

export const WorkflowApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);

const IdentifierSchema = z.string().trim().min(1).max(256);
const TimestampSchema = z.number().int().nonnegative();
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const JsonRecordSchema = z.record(z.string(), z.json());

export const WorkflowStepAttemptSchema = z
  .object({
    id: IdentifierSchema,
    stepId: IdentifierSchema,
    adapterType: IdentifierSchema,
    adapterVersion: IdentifierSchema,
    status: WorkflowStepAttemptStatusSchema,
    input: JsonRecordSchema,
    declaredOutputs: JsonRecordSchema.optional(),
    idempotencyKey: IdentifierSchema.optional(),
    startedAt: TimestampSchema.optional(),
    completedAt: TimestampSchema.optional(),
    skipReason: z.string().trim().min(1).max(4096).optional(),
    failureClassification: IdentifierSchema.optional(),
  })
  .strict();

export const WorkflowApprovalSchema = z
  .object({
    id: IdentifierSchema,
    stepId: IdentifierSchema,
    attemptId: IdentifierSchema,
    status: WorkflowApprovalStatusSchema,
    requesterId: IdentifierSchema,
    approverId: IdentifierSchema.optional(),
    requestedAt: TimestampSchema,
    decidedAt: TimestampSchema.optional(),
    expiresAt: TimestampSchema,
    reason: z.string().trim().min(1).max(4096),
    denialReason: z.string().trim().min(1).max(4096).optional(),
    consumedAt: TimestampSchema.optional(),
  })
  .strict();

export const WorkflowArtifactSchema = z
  .object({
    id: IdentifierSchema,
    kind: IdentifierSchema,
    path: z.string().trim().min(1).max(4096),
    contentHash: DigestSchema,
    bytes: z.number().int().nonnegative(),
    redacted: z.boolean(),
    createdAt: TimestampSchema,
  })
  .strict();

export const WorkflowIntentSchema = z
  .object({
    id: IdentifierSchema,
    stepId: IdentifierSchema,
    attemptId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    inputDigest: DigestSchema,
    createdAt: TimestampSchema,
  })
  .strict();

export const WorkflowReceiptSchema = z
  .object({
    id: IdentifierSchema,
    intentId: IdentifierSchema,
    stepId: IdentifierSchema,
    attemptId: IdentifierSchema,
    outputDigest: DigestSchema,
    createdAt: TimestampSchema,
  })
  .strict();

export const WorkflowLeaseSchema = z
  .object({
    id: IdentifierSchema,
    stepId: IdentifierSchema,
    attemptId: IdentifierSchema,
    holder: IdentifierSchema,
    expiresAt: TimestampSchema,
  })
  .strict();

export const WorkflowUnknownOutcomeSchema = z
  .object({
    id: IdentifierSchema,
    stepId: IdentifierSchema,
    attemptId: IdentifierSchema,
    intentId: IdentifierSchema,
    recordedAt: TimestampSchema,
    reason: z.string().trim().min(1).max(4096),
  })
  .strict();

export const WorkflowRunSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    workspaceId: IdentifierSchema,
    definitionId: IdentifierSchema,
    definitionRevision: IdentifierSchema,
    definitionHash: DigestSchema,
    workspaceRoot: z.string().trim().min(1).max(4096),
    principalId: IdentifierSchema,
    status: WorkflowRunStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    stepAttempts: z.array(WorkflowStepAttemptSchema),
    approvals: z.array(WorkflowApprovalSchema),
    artifacts: z.array(WorkflowArtifactSchema),
    runInput: JsonRecordSchema.optional(),
    resolvedDefinition: z.json().optional(),
    intents: z.array(WorkflowIntentSchema),
    receipts: z.array(WorkflowReceiptSchema),
    leases: z.array(WorkflowLeaseSchema),
    unknownOutcomes: z.array(WorkflowUnknownOutcomeSchema),
  })
  .strict();

export type WorkflowPermission = z.infer<typeof WorkflowPermissionSchema>;
export type WorkflowExecutionRisk = z.infer<typeof WorkflowExecutionRiskSchema>;
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;
export type WorkflowStepAttemptStatus = z.infer<typeof WorkflowStepAttemptStatusSchema>;
export type WorkflowApprovalStatus = z.infer<typeof WorkflowApprovalStatusSchema>;
export type WorkflowStepAttempt = z.infer<typeof WorkflowStepAttemptSchema>;
export type WorkflowApproval = z.infer<typeof WorkflowApprovalSchema>;
export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>;
export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>;
export type WorkflowReceipt = z.infer<typeof WorkflowReceiptSchema>;
export type WorkflowLease = z.infer<typeof WorkflowLeaseSchema>;
export type WorkflowUnknownOutcome = z.infer<typeof WorkflowUnknownOutcomeSchema>;
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
