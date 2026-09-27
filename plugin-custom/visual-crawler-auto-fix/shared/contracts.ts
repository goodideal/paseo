import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  CrawlTelemetrySchema,
  FixDirectiveSchema,
  FixDirectiveStatusSchema,
  SeveritySchema,
  WorkerSlotSchema,
} from "./types.js";

export const startCrawlRpc = defineRpc({
  name: "visual_crawler.crawl.start",
  input: z.object({
    targetUrl: z.string().url(),
    maxHops: z.number().min(1).max(200).default(50),
    seedRoutes: z.array(z.string()).default([]),
    maxConcurrency: z.number().min(1).max(10).default(3),
    autoApproveP0: z.boolean().default(false),
    allowedOrigins: z.array(z.string().url()).min(1),
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
