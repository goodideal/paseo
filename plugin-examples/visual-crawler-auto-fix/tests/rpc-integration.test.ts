import { describe, it, expect, beforeEach } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.js";
import {
  approveDirectiveRpc,
  batchApproveRpc,
  getCrawlStatusRpc,
  getWorkerPoolStatusRpc,
  listDirectivesRpc,
  startCrawlRpc,
  stopCrawlRpc,
} from "../shared/contracts.js";

type RpcHandler = (input: unknown) => Promise<unknown>;

describe("VisualCrawlerAutoFix Plugin Server Integration", () => {
  const handlers = new Map<string, RpcHandler>();

  const mockServerContext = {
    handle(rpcContract: { name: string }, handler: RpcHandler) {
      handlers.set(rpcContract.name, handler);
    },
  } as unknown as PluginServerContext;

  beforeEach(() => {
    handlers.clear();
    contribute(mockServerContext);
  });

  it("registers all required RPC handlers", () => {
    expect(handlers.has(startCrawlRpc.name)).toBe(true);
    expect(handlers.has(stopCrawlRpc.name)).toBe(true);
    expect(handlers.has(getCrawlStatusRpc.name)).toBe(true);
    expect(handlers.has(listDirectivesRpc.name)).toBe(true);
    expect(handlers.has(approveDirectiveRpc.name)).toBe(true);
    expect(handlers.has(batchApproveRpc.name)).toBe(true);
    expect(handlers.has(getWorkerPoolStatusRpc.name)).toBe(true);
  });

  it("handles startCrawl and getCrawlStatus", async () => {
    const startHandler = handlers.get(startCrawlRpc.name)!;
    const statusHandler = handlers.get(getCrawlStatusRpc.name)!;

    const startRes = (await startHandler({
      targetUrl: "http://localhost:3000",
      maxHops: 10,
      seedRoutes: [],
      maxConcurrency: 3,
      autoApproveP0: false,
    })) as { ok: boolean };

    expect(startRes.ok).toBe(true);

    const statusRes = (await statusHandler({})) as { telemetry: { maxHops: number } };
    expect(statusRes.telemetry.maxHops).toBe(10);
  });

  it("returns worker pool status with 3 concurrency slots", async () => {
    const poolHandler = handlers.get(getWorkerPoolStatusRpc.name)!;
    const poolRes = (await poolHandler({})) as { maxConcurrency: number; slots: unknown[] };

    expect(poolRes.maxConcurrency).toBe(3);
    expect(poolRes.slots.length).toBe(3);
  });
});
