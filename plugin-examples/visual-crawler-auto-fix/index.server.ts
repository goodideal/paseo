import { join } from "node:path";
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
} from "./shared/contracts.js";
import { TaskStore } from "./server/store/task-store.js";
import { VisualCrawlerEngine, type BrowserDriver } from "./server/engine/crawler-engine.js";
import { ReviewTriageAgent } from "./server/triage/triage-agent.js";
import { type WorktreeAdapter } from "./server/orchestrator/worktree-pool.js";

export function createDefaultBrowserDriver(): BrowserDriver {
  let step = 0;
  return {
    async navigate(url: string) {
      step++;
      return {
        url,
        domFingerprint: `fp-${url.replace(/[^a-z0-9]/gi, "_")}-${step}`,
        title: `Page ${url}`,
      };
    },
    async getConsoleLogs() {
      if (step % 4 === 0) {
        return [
          {
            level: "error",
            text: "Uncaught TypeError: Cannot read properties of undefined (reading 'items')",
          },
        ];
      }
      return [];
    },
    async getNetworkFailures() {
      if (step % 7 === 0) {
        return [{ url: "/api/v1/telemetry", status: 500, statusText: "Internal Server Error" }];
      }
      return [];
    },
    async getInteractiveElements() {
      return [
        { selector: "button.submit-btn", tag: "button", text: "Submit" },
        {
          selector: "a.nav-link-dashboard",
          tag: "a",
          text: "Dashboard",
          href: "http://localhost:3000/dashboard",
        },
        {
          selector: "a.nav-link-settings",
          tag: "a",
          text: "Settings",
          href: "http://localhost:3000/settings",
        },
      ];
    },
    async click(selector: string) {
      step++;
      return {
        domFingerprint: `fp-click-${selector}-${step}`,
        url: "http://localhost:3000/dashboard",
      };
    },
    async checkVisualAnomalies() {
      if (step % 5 === 0) {
        return [
          {
            selector: "div.header-nav",
            reason: "overlap",
            boundingBox: { x: 0, y: 0, width: 800, height: 60 },
            sourceHint: {
              filePath: "src/components/HeaderNav.tsx",
              componentName: "HeaderNav",
              line: 42,
            },
          },
        ];
      }
      return [];
    },
    async captureScreenshot() {
      return `.evidence/screenshots/crawl-step-${step}.png`;
    },
  };
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
      void (async () => {
        await crawler.start({
          targetUrl: input.targetUrl,
          maxHops: input.maxHops,
          seedRoutes: input.seedRoutes,
          maxConcurrency: input.maxConcurrency,
          autoApproveP0: input.autoApproveP0,
          allowedOrigins: input.allowedOrigins,
        });

        // Automatically triage detected anomalies after crawl finishes
        const telemetry = store.getTelemetry();
        if (telemetry.totalAnomalies > 0) {
          const rawAnomalies = store.getAnomalies();
          triageAgent.triageAnomalies(rawAnomalies, { autoApproveP0: input.autoApproveP0 });
          if (input.autoApproveP0) {
            const approved = store.getDirectives({ status: "approved" });
            for (const dir of approved) {
              // Auto-approved directives still need a concrete workspace scope from the user action.
              dir.status = "approved";
              dir.updatedAt = Date.now();
              store.upsertDirective(dir);
            }
          }
        }
      })();

      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
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
    crawler.stop();
    return { ok: true };
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
    crawler.stop();
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
