import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { GiteaWorkflowTaskSchema } from "./types.js";

export const listTasksRpc = defineRpc({
  name: "gitea.tasks.list",
  input: z.object({
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
