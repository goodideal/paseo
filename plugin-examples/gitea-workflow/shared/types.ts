import { z } from "zod";

export const TaskStateSchema = z.enum([
  "queued",
  "worktree_creating",
  "coding",
  "self_review",
  "screenshotting",
  "pending_human_review",
  "pr_creating",
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
});

export type ScreenshotMetadata = z.infer<typeof ScreenshotMetadataSchema>;

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
});

export type GiteaSettings = z.infer<typeof GiteaSettingsSchema>;
