import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  CrawlConfigSchema,
  CrawlerTaskItemSchema,
  CrawlScheduleConfigSchema,
  CrawlTelemetrySchema,
  FixDirectiveSchema,
  FixDirectiveStatusSchema,
  SeveritySchema,
  TaskStatusSchema,
  TimeWindowConfigSchema,
  AuthCredentialsSchema,
  WorkerSlotSchema,
} from "./types.js";

export const startCrawlRpc = defineRpc({
  name: "visual_crawler.crawl.start",
  input: z.object({
    targetUrl: z.string().url(),
    maxHops: z.number().min(1).max(500).default(50),
    maxDepth: z.number().min(1).max(100).default(10),
    seedRoutes: z.array(z.string()).default([]),
    maxConcurrency: z.number().min(1).max(10).default(3),
    autoApproveP0: z.boolean().default(false),
    allowedOrigins: z.array(z.string().url()).min(1),
    authHeaders: z.record(z.string(), z.string()).optional(),
    timeWindow: TimeWindowConfigSchema.optional(),
    credentials: AuthCredentialsSchema.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const stopCrawlRpc = defineRpc({
  name: "visual_crawler.crawl.stop",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
  }),
});

export const getCrawlStatusRpc = defineRpc({
  name: "visual_crawler.crawl.status",
  input: z.object({}),
  output: z.object({
    telemetry: CrawlTelemetrySchema,
  }),
});

export const saveScheduleRpc = defineRpc({
  name: "visual_crawler.schedule.save",
  input: CrawlScheduleConfigSchema,
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const getScheduleRpc = defineRpc({
  name: "visual_crawler.schedule.get",
  input: z.object({}),
  output: z.object({
    schedule: CrawlScheduleConfigSchema,
  }),
});

export const listTasksRpc = defineRpc({
  name: "visual_crawler.tasks.list",
  input: z.object({
    severity: SeveritySchema.optional(),
    status: TaskStatusSchema.optional(),
  }),
  output: z.object({
    tasks: z.array(CrawlerTaskItemSchema),
  }),
});

export const updateTaskStatusRpc = defineRpc({
  name: "visual_crawler.tasks.update_status",
  input: z.object({
    taskId: z.string(),
    status: TaskStatusSchema,
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const listDirectivesRpc = defineRpc({
  name: "visual_crawler.directives.list",
  input: z.object({
    severity: SeveritySchema.optional(),
    status: FixDirectiveStatusSchema.optional(),
  }),
  output: z.object({
    directives: z.array(FixDirectiveSchema),
  }),
});

export const approveDirectiveRpc = defineRpc({
  name: "visual_crawler.directives.approve",
  input: z.object({
    directiveId: z.string(),
    projectId: z.string().min(1),
    workspaceId: z.string().min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    workflowRunId: z.string().optional(),
    error: z.string().optional(),
  }),
});

export const batchApproveRpc = defineRpc({
  name: "visual_crawler.directives.batch_approve",
  input: z.object({
    minSeverity: SeveritySchema,
    projectId: z.string().min(1),
    workspaceId: z.string().min(1),
  }),
  output: z.object({
    approvedCount: z.number(),
  }),
});

export const rejectDirectiveRpc = defineRpc({
  name: "visual_crawler.directives.reject",
  input: z.object({
    directiveId: z.string(),
    reason: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
});

export const getWorkerPoolStatusRpc = defineRpc({
  name: "visual_crawler.workers.status",
  input: z.object({}),
  output: z.object({
    maxConcurrency: z.number(),
    activeCount: z.number(),
    slots: z.array(WorkerSlotSchema),
  }),
});
