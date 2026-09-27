import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store/task-store.js";
import { WorktreeFixPool, type WorktreeAdapter } from "../server/orchestrator/worktree-pool.js";
import type { FixDirective } from "../shared/types.js";

describe("WorktreeFixPool", () => {
  let store: TaskStore;
  let adapter: WorktreeAdapter;
  let pool: WorktreeFixPool;

  beforeEach(() => {
    const testFile = join(
      tmpdir(),
      `test-pool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`,
    );
    store = new TaskStore(testFile, 3);

    adapter = {
      createWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/mock-worktree" }),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      dispatchCodingAgent: vi.fn().mockResolvedValue({ success: true }),
      runVerification: vi.fn().mockResolvedValue({ passed: true, output: "Tests passed" }),
      pushAndCreatePr: vi.fn().mockResolvedValue({ prUrl: "https://gitea.local/pr/101" }),
    };

    pool = new WorktreeFixPool(store, adapter, 3);
  });

  function createDirective(id: string): FixDirective {
    const d: FixDirective = {
      id,
      clusterKey: `k-${id}`,
      title: `Fix Issue ${id}`,
      severity: "P1",
      category: "runtime_error",
      affectedPages: ["/"],
      occurrenceCount: 1,
      errorDetails: { message: "Error" },
      evidence: {},
      suggestedFix: "Fix code",
      status: "pending_review",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.upsertDirective(d);
    return d;
  }

  it("processes up to 3 parallel tasks and creates PRs", async () => {
    createDirective("d1");
    createDirective("d2");
    createDirective("d3");

    pool.enqueueDirective("d1");
    pool.enqueueDirective("d2");
    pool.enqueueDirective("d3");

    // Wait for the synchronous lifecycle ticks
    await new Promise((r) => setTimeout(r, 100));

    expect(adapter.createWorktree).toHaveBeenCalledTimes(3);
    expect(adapter.dispatchCodingAgent).toHaveBeenCalledTimes(3);
    expect(adapter.runVerification).toHaveBeenCalledTimes(3);
    expect(adapter.pushAndCreatePr).toHaveBeenCalledTimes(3);

    const d1 = store.getDirective("d1");
    expect(d1?.status).toBe("resolved");
    expect(d1?.prUrl).toBe("https://gitea.local/pr/101");
  });

  it("queues the 4th task when maxConcurrency is 3", async () => {
    const delayedCreate = () =>
      new Promise<{ worktreePath: string }>((resolve) => {
        setTimeout(() => resolve({ worktreePath: "/tmp/wt" }), 200);
      });

    (adapter.createWorktree as Mock).mockImplementation(delayedCreate);

    createDirective("d1");
    createDirective("d2");
    createDirective("d3");
    createDirective("d4");

    pool.enqueueDirective("d1");
    pool.enqueueDirective("d2");
    pool.enqueueDirective("d3");
    pool.enqueueDirective("d4");

    // Immediately check: 3 slots occupied, 1 remaining in queue
    expect(pool.getQueueLength()).toBe(1);
  });

  it("handles verification failure gracefully and marks slot failed", async () => {
    (adapter.runVerification as Mock).mockResolvedValue({
      passed: false,
      output: "Type error: TS2322",
    });

    createDirective("d-fail");
    pool.enqueueDirective("d-fail");

    await new Promise((r) => setTimeout(r, 100));

    const slots = store.getSlots();
    const failedSlot = slots.find((s) => s.status === "failed");
    expect(failedSlot).toBeDefined();
    expect(failedSlot?.logMessage).toContain("Verification failed");
  });
});
