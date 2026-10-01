import { z } from "zod";

export const SeveritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AnomalyCategorySchema = z.enum(["runtime_error", "visual_defect", "network_failure"]);
export type AnomalyCategory = z.infer<typeof AnomalyCategorySchema>;

export const CrawlStateSchema = z.enum(["idle", "running", "paused", "completed", "error"]);
export type CrawlState = z.infer<typeof CrawlStateSchema>;

export const TimeWindowConfigSchema = z.object({
  enabled: z.boolean(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type TimeWindowConfig = z.infer<typeof TimeWindowConfigSchema>;

export const CrawlScheduleConfigSchema = z.object({
  enabled: z.boolean(),
  cron: z.string().optional(),
  timeWindow: TimeWindowConfigSchema.optional(),
  targetUrl: z.string(),
  maxHops: z.number().min(1).default(50),
  maxDepth: z.number().min(1).default(10).optional(),
});
export type CrawlScheduleConfig = z.infer<typeof CrawlScheduleConfigSchema>;

export const CrawlConfigSchema = z.object({
  targetUrl: z.string(),
  maxHops: z.number().min(1).max(500).default(50),
  maxDepth: z.number().min(1).max(100).default(10).optional(),
  seedRoutes: z.array(z.string()).optional(),
  maxConcurrency: z.number().min(1).max(10).optional(),
  autoApproveP0: z.boolean().optional(),
  allowedOrigins: z.array(z.string()).optional(),
  authHeaders: z.record(z.string(), z.string()).optional(),
  timeWindow: TimeWindowConfigSchema.optional(),
});
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;

export const ActionBreadcrumbSchema = z.object({
  hopNumber: z.number(),
  url: z.string(),
  action: z.string(),
});
export type ActionBreadcrumb = z.infer<typeof ActionBreadcrumbSchema>;

export const TaskStatusSchema = z.enum(["todo", "in_review", "ignored", "resolved"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const CrawlerTaskItemSchema = z.object({
  id: z.string(),
  clusterKey: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  category: AnomalyCategorySchema,
  status: TaskStatusSchema,
  occurrenceCount: z.number(),
  affectedUrls: z.array(z.string()),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  reproductionBreadcrumbs: z.array(ActionBreadcrumbSchema),
  evidence: z.object({
    screenshotPath: z.string().optional(),
    consoleMessage: z.string().optional(),
    stackTrace: z.string().optional(),
    httpStatus: z.number().optional(),
    failedUrl: z.string().optional(),
    domSelector: z.string().optional(),
  }),
});
export type CrawlerTaskItem = z.infer<typeof CrawlerTaskItemSchema>;

export const SourceHintSchema = z.object({
  filePath: z.string(),
  componentName: z.string().optional(),
  line: z.number().optional(),
});
export type SourceHint = z.infer<typeof SourceHintSchema>;

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const AnomalyRecordSchema = z.object({
  id: z.string(),
  type: AnomalyCategorySchema,
  severity: SeveritySchema,
  message: z.string(),
  stack: z.string().optional(),
  httpStatus: z.number().optional(),
  domSelector: z.string().optional(),
  screenshotPath: z.string().optional(),
  sourceHint: SourceHintSchema.optional(),
  boundingBox: BoundingBoxSchema.optional(),
  timestamp: z.number(),
  url: z.string(),
});
export type AnomalyRecord = z.infer<typeof AnomalyRecordSchema>;

export const HopRecordSchema = z.object({
  hopNumber: z.number(),
  url: z.string(),
  action: z.string(),
  timestamp: z.number(),
  domFingerprint: z.string(),
  anomalies: z.array(AnomalyRecordSchema),
});
export type HopRecord = z.infer<typeof HopRecordSchema>;

export const FixDirectiveStatusSchema = z.enum([
  "pending_review",
  "approved",
  "in_progress",
  "resolved",
  "rejected",
]);
export type FixDirectiveStatus = z.infer<typeof FixDirectiveStatusSchema>;

export const FixDirectiveSchema = z.object({
  id: z.string(),
  clusterKey: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  category: AnomalyCategorySchema,
  affectedPages: z.array(z.string()),
  occurrenceCount: z.number(),
  sourceHint: SourceHintSchema.optional(),
  errorDetails: z.object({
    message: z.string(),
    stack: z.string().optional(),
    httpStatus: z.number().optional(),
  }),
  evidence: z.object({
    screenshotPath: z.string().optional(),
    domSnippet: z.string().optional(),
  }),
  suggestedFix: z.string(),
  status: FixDirectiveStatusSchema,
  workerId: z.string().optional(),
  prUrl: z.string().optional(),
  branchName: z.string().optional(),
  workflowRunId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type FixDirective = z.infer<typeof FixDirectiveSchema>;

export const WorkerStateSchema = z.enum([
  "idle",
  "provisioning",
  "coding",
  "verifying",
  "pr_created",
  "failed",
]);
export type WorkerState = z.infer<typeof WorkerStateSchema>;

export const WorkerSlotSchema = z.object({
  slotIndex: z.number(),
  status: WorkerStateSchema,
  currentDirectiveId: z.string().optional(),
  worktreePath: z.string().optional(),
  branchName: z.string().optional(),
  logMessage: z.string().optional(),
  prUrl: z.string().optional(),
  startedAt: z.number().optional(),
});
export type WorkerSlot = z.infer<typeof WorkerSlotSchema>;

export const CrawlTelemetrySchema = z.object({
  state: CrawlStateSchema,
  currentHop: z.number(),
  maxHops: z.number(),
  activeUrl: z.string(),
  totalAnomalies: z.number(),
  anomaliesBySeverity: z.record(SeveritySchema, z.number()),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});
export type CrawlTelemetry = z.infer<typeof CrawlTelemetrySchema>;
