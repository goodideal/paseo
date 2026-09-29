import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { GiteaWorkflowTaskSchema, GiteaProjectDiagnosticSchema } from "./types.js";

export const listTasksRpc = defineRpc({
  name: "gitea.tasks.list",
  input: z.object({
    projectId: z.string().optional(),
    workspaceId: z.string().optional(),
  }),
  output: z.object({
    tasks: z.array(GiteaWorkflowTaskSchema),
  }),
});

export const getTaskDetailRpc = defineRpc({
  name: "gitea.tasks.get",
  input: z.object({
    taskId: z.string(),
  }),
  output: z.object({
    task: GiteaWorkflowTaskSchema.nullable(),
  }),
});

export const approveTaskRpc = defineRpc({
  name: "gitea.tasks.approve",
  input: z.object({
    taskId: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    prUrl: z.string().optional(),
    error: z.string().optional(),
  }),
});

export const rejectTaskRpc = defineRpc({
  name: "gitea.tasks.reject",
  input: z.object({
    taskId: z.string(),
    feedback: z.string().min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const diagnoseProjectsRpc = defineRpc({
  name: "gitea.diagnostics.list",
  input: z.object({}),
  output: z.object({
    diagnostics: z.array(GiteaProjectDiagnosticSchema),
  }),
});

export const pruneEvidenceRpc = defineRpc({
  name: "gitea.evidence.prune",
  input: z.object({
    olderThanDays: z.number().int().positive().optional(),
  }),
  output: z.object({
    prunedCount: z.number().int(),
    freedBytes: z.number().int(),
  }),
});
