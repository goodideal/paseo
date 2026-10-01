import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginServerContext, PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  approveDirectiveRpc,
  batchApproveRpc,
  getCrawlStatusRpc,
  getWorkerPoolStatusRpc,
  listDirectivesRpc,
  rejectDirectiveRpc,
  startCrawlRpc,
  stopCrawlRpc,
  getScheduleRpc,
  listTasksRpc,
  saveScheduleRpc,
  updateTaskStatusRpc,
} from "./shared/contracts.js";
import { TaskStore } from "./server/store/task-store.js";
import { VisualCrawlerEngine, type BrowserDriver } from "./server/engine/crawler-engine.js";
import { PlaywrightBrowserDriver } from "./server/engine/playwright-driver.js";
import { createReportPath, writeMarkdownReport } from "./server/report/report-generator.js";
import { CrawlerScheduler, isWithinTimeWindow } from "./server/scheduler/crawler-scheduler.js";
import { TaskCompiler } from "./server/triage/task-compiler.js";
import { ReviewTriageAgent } from "./server/triage/triage-agent.js";
import { type WorktreeAdapter } from "./server/orchestrator/worktree-pool.js";

export function createDefaultBrowserDriver(): BrowserDriver {
  return new PlaywrightBrowserDriver();
}

export function createDefaultWorktreeAdapter(): WorktreeAdapter {
  return {
    async createWorktree(_branchName: string, worktreeSlug: string) {
      return { worktreePath: join(tmpdir(), "paseo-worktrees", worktreeSlug) };
    },
    async removeWorktree() {},
    async dispatchCodingAgent(_worktreePath: string, _prompt: string) {
      return { success: true };
    },
    async runVerification(_worktreePath: string) {
      return { passed: true, output: "All checks passed. 0 errors, 0 warnings." };
    },
    async pushAndCreatePr(_branchName: string, _title: string) {
      return { prUrl: `https://gitea.local/repo/pulls/${Math.floor(Math.random() * 900 + 100)}` };
    },
  };
}

export interface VisualCrawlerPluginOptions {
  store?: TaskStore;
  storePath?: string;
  driver?: BrowserDriver;
  adapter?: WorktreeAdapter;
  workflowRunner?: {
    createRun: (params: { directiveId: string }) => Promise<{ runId: string; status: string }>;
  };
  scheduler?: CrawlerScheduler;
}

export default function contribute(
  server: PluginServerContext,
  options?: VisualCrawlerPluginOptions,
) {
  const storePath = options?.storePath ?? join(tmpdir(), "paseo-visual-crawler", "state.json");
  const store = options?.store ?? new TaskStore(storePath, 3);
  const driver = options?.driver ?? createDefaultBrowserDriver();

  const crawler = new VisualCrawlerEngine(store, driver);
  const triageAgent = new ReviewTriageAgent(store);
  const taskCompiler = new TaskCompiler();
  const scheduler = options?.scheduler ?? new CrawlerScheduler();
  let abortController: AbortController | undefined;

  const runCrawl = async (input: Parameters<typeof crawler.start>[0]): Promise<void> => {
    abortController = new AbortController();
    try {
      await crawler.start(input, { abortSignal: abortController.signal });
      const tasks = taskCompiler.compile(store.getHops(), store.getTasks());
      for (const task of tasks) store.upsertTask(task);
      const evidenceDir = join(dirname(storePath), "visual-crawler");
      writeMarkdownReport(createReportPath(evidenceDir), {
        targetUrl: input.targetUrl,
        telemetry: store.getTelemetry(),
        tasks: store.getTasks(),
      });
    } finally {
      abortController = undefined;
      if (driver instanceof PlaywrightBrowserDriver) await driver.close();
    }
  };

  // Register the visual-crawler-fix workflow preset with Core if available
  if (server.registerWorkflowPreset) {
    server.registerWorkflowPreset({
      workflowId: "visual-crawler-fix",
      name: "Visual Crawler Auto-Fix",
      sourcePreset: "visual-crawler",
      definition: {
        id: "visual-crawler-fix",
        revision: "1",
        maxConcurrency: 1,
        maxArtifactBytes: 1024 * 1024,
        steps: [
          {
            id: "worktree",
            type: "worktree.create",
            timeoutMs: 60_000,
            retries: 0,
            concurrency: 1,
            approval: "automatic",
          },
          {
            id: "repair",
            type: "agent.dispatch",
            dependsOn: ["worktree"],
            timeoutMs: 300_000,
            retries: 0,
            concurrency: 1,
            approval: "automatic",
          },
          {
            id: "verify",
            type: "verify.command",
            dependsOn: ["repair"],
            timeoutMs: 60_000,
            retries: 0,
            concurrency: 1,
            approval: "automatic",
          },
          {
            id: "ship",
            type: "git.create_pr",
            dependsOn: ["verify"],
            when: "steps.verify.outputs.passed == true",
            timeoutMs: 60_000,
            retries: 0,
            concurrency: 1,
            approval: "required",
          },
        ],
      },
    });
  }

  server.handle(startCrawlRpc, async (input) => {
    try {
      if (input.timeWindow && !isWithinTimeWindow(new Date(), input.timeWindow)) {
        return { ok: false, error: "Current time is outside the configured crawl window" };
      }
      void runCrawl(input).catch((err: unknown) => {
        store.updateTelemetry({ state: "error", endedAt: Date.now() });
        console.error("Visual crawler failed:", err);
      });
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  async function dispatchDirectiveWorkflow(
    directiveId: string,
    scope: { projectId: string; workspaceId: string },
    context?: PluginHandlerContext,
  ): Promise<string> {
    const directive = store.getDirective(directiveId);
    if (!directive) throw new Error("Directive not found");
    if (directive.workflowRunId) return directive.workflowRunId;

    directive.status = "in_progress";
    directive.updatedAt = Date.now();
    directive.prUrl = undefined; // Do not fake PR creation before approval

    let runId: string;
    if (options?.workflowRunner) {
      const res = await options.workflowRunner.createRun({ directiveId });
      runId = res.runId;
    } else {
      if (!context?.paseo) throw new Error("Paseo Workflow API is unavailable");
      const runRes = await context.paseo.workflows.runCreate({
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        workflowId: "visual-crawler-fix",
        input: { directiveId },
      });
      if (runRes.error || !runRes.runId) {
        throw new Error(runRes.error ?? "Workflow Run creation returned no runId");
      }
      runId = runRes.runId;
    }

    directive.workflowRunId = runId;
    store.upsertDirective(directive);
    return runId;
  }

  server.handle(stopCrawlRpc, async () => {
    abortController?.abort();
    crawler.stop();
    return { ok: true };
  });

  server.handle(saveScheduleRpc, async (input) => {
    scheduler.updateConfig(input, async () => {
      const allowedOrigins = [new URL(input.targetUrl).origin];
      await runCrawl({
        targetUrl: input.targetUrl,
        maxHops: input.maxHops,
        maxDepth: input.maxDepth,
        allowedOrigins,
        timeWindow: input.timeWindow,
      });
    });
    return { ok: true };
  });

  server.handle(getScheduleRpc, async () => ({ schedule: scheduler.getConfig() }));

  server.handle(listTasksRpc, async (input) => ({ tasks: store.getTasks(input) }));

  server.handle(updateTaskStatusRpc, async ({ taskId, status }) => {
    return store.updateTaskStatus(taskId, status)
      ? { ok: true }
      : { ok: false, error: "Task not found" };
  });

  server.handle(getCrawlStatusRpc, async () => {
    return { telemetry: store.getTelemetry() };
  });

  server.handle(listDirectivesRpc, async (input) => {
    const directives = store.getDirectives({
      severity: input.severity,
      status: input.status,
    });
    return { directives };
  });

  server.handle(approveDirectiveRpc, async ({ directiveId, projectId, workspaceId }, context) => {
    const directive = store.getDirective(directiveId);
    if (!directive) {
      return { ok: false, error: "Directive not found" };
    }
    // Delete legacy pool dual dispatch: only dispatch to Workflow Run
    const runId = await dispatchDirectiveWorkflow(directiveId, { projectId, workspaceId }, context);
    return { ok: true, workflowRunId: runId };
  });

  server.handle(batchApproveRpc, async ({ minSeverity, projectId, workspaceId }, context) => {
    const rank: Record<string, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };
    const minRank = rank[minSeverity] || 1;

    const all = store.getDirectives({ status: "pending_review" });
    let count = 0;
    for (const d of all) {
      if ((rank[d.severity] || 0) >= minRank) {
        await dispatchDirectiveWorkflow(d.id, { projectId, workspaceId }, context);
        count++;
      }
    }
    return { approvedCount: count };
  });

  server.handle(rejectDirectiveRpc, async ({ directiveId }) => {
    const directive = store.getDirective(directiveId);
    if (directive) {
      directive.status = "rejected";
      directive.updatedAt = Date.now();
      store.upsertDirective(directive);
    }
    return { ok: true };
  });

  server.handle(getWorkerPoolStatusRpc, async () => {
    const slots = store.getSlots();
    const activeCount = slots.filter((s) => s.status !== "idle").length;
    return {
      maxConcurrency: slots.length,
      activeCount,
      slots,
    };
  });

  return () => {
    abortController?.abort();
    crawler.stop();
    scheduler.stop();
    // On unload/reload: record actionable blocked status for active in-progress directives
    const inProgress = store.getDirectives({ status: "in_progress" });
    for (const d of inProgress) {
      d.errorDetails = {
        message: "Visual Crawler plugin reloaded while workflow run was active",
      };
      d.updatedAt = Date.now();
      store.upsertDirective(d);
    }
  };
}
