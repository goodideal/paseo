import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.js";
import { TaskStore } from "../server/store/task-store.js";
import {
  approveDirectiveRpc,
  batchApproveRpc,
  getCrawlStatusRpc,
  getWorkerPoolStatusRpc,
  listDirectivesRpc,
  startCrawlRpc,
  stopCrawlRpc,
} from "../shared/contracts.js";
import type { FixDirective } from "../shared/types.js";

type RpcHandler = (input: unknown, context?: unknown) => Promise<unknown>;

describe("VisualCrawlerAutoFix Plugin Server Integration (Task 4.3)", () => {
  const handlers = new Map<string, RpcHandler>();
  let registeredPreset: unknown = null;
  let testStorePath: string;
  let store: TaskStore;

  const mockServerContext = {
    handle(rpcContract: { name: string }, handler: RpcHandler) {
      handlers.set(rpcContract.name, handler);
    },
    registerWorkflowPreset(preset: unknown) {
      registeredPreset = preset;
    },
  } as unknown as PluginServerContext;

  beforeEach(() => {
    handlers.clear();
    registeredPreset = null;
    testStorePath = join(
      tmpdir(),
      `test-vc-store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`,
    );
    store = new TaskStore(testStorePath, 3);
  });

  it("registers workflow preset and all required RPC handlers", () => {
    contribute(mockServerContext, { store });
    expect(registeredPreset).toMatchObject({
      workflowId: "visual-crawler-fix",
      sourcePreset: "visual-crawler",
    });
    expect(handlers.has(startCrawlRpc.name)).toBe(true);
    expect(handlers.has(stopCrawlRpc.name)).toBe(true);
    expect(handlers.has(getCrawlStatusRpc.name)).toBe(true);
    expect(handlers.has(listDirectivesRpc.name)).toBe(true);
    expect(handlers.has(approveDirectiveRpc.name)).toBe(true);
    expect(handlers.has(batchApproveRpc.name)).toBe(true);
    expect(handlers.has(getWorkerPoolStatusRpc.name)).toBe(true);
  });

  it("maps approved directive to a scope-bound workflow run without legacy double dispatch", async () => {
    let runsCreated = 0;
    const cleanup = contribute(mockServerContext, {
      store,
      workflowRunner: {
        createRun: async ({ directiveId }) => {
          runsCreated++;
          return { runId: `run_test_${directiveId}`, status: "waiting_approval" };
        },
      },
    });

    // Create a mock pending directive in store
    const directive: FixDirective = {
      id: "dir-1",
      clusterKey: "cluster-1",
      title: "Header overlap bug",
      severity: "P0",
      category: "visual_defect",
      affectedPages: ["/dashboard"],
      occurrenceCount: 1,
      errorDetails: { message: "Header overlap" },
      evidence: {},
      suggestedFix: "Fix CSS flex",
      status: "pending_review",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.upsertDirective(directive);

    const approveHandler = handlers.get(approveDirectiveRpc.name)!;
    const res = (await approveHandler({
      directiveId: "dir-1",
      projectId: "p1",
      workspaceId: "ws1",
    })) as {
      ok: boolean;
      workflowRunId: string;
    };

    expect(res.ok).toBe(true);
    expect(res.workflowRunId).toBe("run_test_dir-1");
    expect(runsCreated).toBe(1);

    // Verify directive is updated in store with workflowRunId and no fake PR
    const updated = store.getDirective("dir-1");
    expect(updated?.workflowRunId).toBe("run_test_dir-1");
    expect(updated?.status).toBe("in_progress");
    expect(updated?.prUrl).toBeUndefined(); // Does not fake PR before approval

    // Second approve call does NOT dispatch a duplicate run
    const secondRes = (await approveHandler({
      directiveId: "dir-1",
      projectId: "p1",
      workspaceId: "ws1",
    })) as {
      ok: boolean;
      workflowRunId: string;
    };
    expect(secondRes.workflowRunId).toBe("run_test_dir-1");
    expect(runsCreated).toBe(1); // No double dispatch!

    // Verify cleanup / reload leaves actionable error on active directives
    cleanup();
    const afterReload = store.getDirective("dir-1");
    expect(afterReload?.errorDetails.message).toContain(
      "Visual Crawler plugin reloaded while workflow run was active",
    );
  });

  it("handles startCrawl and getCrawlStatus", async () => {
    contribute(mockServerContext, { store });
    const startHandler = handlers.get(startCrawlRpc.name)!;
    const statusHandler = handlers.get(getCrawlStatusRpc.name)!;

    const startRes = (await startHandler({
      targetUrl: "http://localhost:3000",
      maxHops: 10,
      seedRoutes: [],
      maxConcurrency: 3,
      autoApproveP0: false,
      allowedOrigins: ["http://localhost:3000"],
    })) as { ok: boolean };

    expect(startRes.ok).toBe(true);

    const statusRes = (await statusHandler({})) as { telemetry: { maxHops: number } };
    expect(statusRes.telemetry.maxHops).toBe(10);
  });
});
