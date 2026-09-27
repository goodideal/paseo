import { z } from "zod";

export const TaskStateSchema = z.enum([
  "queued",
  "worktree_creating",
  "coding",
  "static_reviewing",
  "sandbox_provisioning",
  "dynamic_reviewing",
  "shipping",
  "self_review",
  "screenshotting",
  "pr_creating",
  "pending_human_review",
  "done",
  "failed",
]);

export type TaskState = z.infer<typeof TaskStateSchema>;

export const ScreenshotMetadataSchema = z.object({
  id: z.string(),
  label: z.string(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  relativePath: z.string(),
  capturedAt: z.string(),
  dataUri: z.string().optional(),
});

export type ScreenshotMetadata = z.infer<typeof ScreenshotMetadataSchema>;

export const TestCaseResultSchema = z.object({
  name: z.string(),
  input: z.string().default("-"),
  expected: z.string().default("-"),
  actual: z.string().default("-"),
  status: z.enum(["PASS", "FAIL"]),
  durationMs: z.number().optional(),
});

export type TestCaseResult = z.infer<typeof TestCaseResultSchema>;

export const TestMatrixEvidenceSchema = z.object({
  command: z.string().default("npm test"),
  exitCode: z.number().int().default(0),
  totalPassed: z.number().int().default(0),
  totalFailed: z.number().int().default(0),
  durationMs: z.number().default(0),
  cases: z.array(TestCaseResultSchema).default([]),
});

export type TestMatrixEvidence = z.infer<typeof TestMatrixEvidenceSchema>;

export const ReviewSignOffSchema = z.object({
  staticReview: z
    .object({
      passed: z.boolean(),
      model: z.string().optional(),
      summary: z.string().optional(),
      reviewedAt: z.string().optional(),
    })
    .optional(),
  dynamicReview: z
    .object({
      passed: z.boolean(),
      previewUrl: z.string().optional(),
      screenshotsCount: z.number().optional(),
      reviewedAt: z.string().optional(),
    })
    .optional(),
});

export type ReviewSignOff = z.infer<typeof ReviewSignOffSchema>;

export const GiteaWorkflowTaskSchema = z.object({
  id: z.string(),
  projectId: z.string().default("default-project"),
  projectPath: z.string().default(""),
  issueNumber: z.number().int(),
  issueTitle: z.string(),
  issueUrl: z.string(),
  issueBody: z.string(),
  giteaBaseUrl: z.string().default(""),
  giteaToken: z.string().optional(),
  repoOwner: z.string(),
  repoName: z.string(),
  branchName: z.string(),
  workspaceId: z.string().nullable(),
  agentId: z.string().nullable(),
  state: TaskStateSchema,
  screenshots: z.array(ScreenshotMetadataSchema),
  testMatrix: TestMatrixEvidenceSchema.nullable().optional(),
  reviewSignOff: ReviewSignOffSchema.nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  sandboxHibernated: z.boolean().optional(),
  diffSummary: z
    .object({
      additions: z.number().int(),
      deletions: z.number().int(),
      filesChanged: z.number().int(),
    })
    .nullable(),
  prUrl: z.string().optional(),
  prNumber: z.number().int().optional(),
  reviewFeedback: z.array(z.string()).optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GiteaWorkflowTask = z.infer<typeof GiteaWorkflowTaskSchema>;

export const ResolvedProjectGiteaSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  projectName: z.string(),
  host: z.string(),
  baseUrl: z.string().url(),
  token: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  authSource: z.enum(["tea", "env", "anonymous"]),
});

export type ResolvedProjectGitea = z.infer<typeof ResolvedProjectGiteaSchema>;

export const GiteaSettingsSchema = z.object({
  listenLabel: z.string().default("agent-ready"),
  inProgressLabel: z.string().default("agent-in-progress"),
  reviewedLabel: z.string().default("agent-reviewed"),
  pollIntervalSeconds: z.number().int().min(10).default(60),
  maxConcurrentWorktrees: z.number().int().min(1).max(10).default(3),
  sandboxIdleTimeoutHours: z.number().int().min(1).default(24),
});

export type GiteaSettings = z.infer<typeof GiteaSettingsSchema>;
