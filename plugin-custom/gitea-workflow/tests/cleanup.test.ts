import { describe, it, expect, vi } from "vitest";
import { EvidencePruner } from "../server/cleanup.js";

describe("EvidencePruner", () => {
  it("prunes evidence for terminal runs older than retention period but protects active runs", async () => {
    const now = 100_000_000_000;
    const ninetyOneDaysAgo = now - 91 * 24 * 3600 * 1000;

    const mockEvidenceManager = {
      listRecordedEvidence: vi.fn().mockResolvedValue([
        {
          runId: "old-terminal-run",
          path: "/tmp/ev1.png",
          createdAt: ninetyOneDaysAgo,
          sizeBytes: 1024,
        },
        {
          runId: "old-active-run",
          path: "/tmp/ev2.png",
          createdAt: ninetyOneDaysAgo,
          sizeBytes: 2048,
        },
      ]),
      deleteEvidenceFile: vi.fn().mockResolvedValue(true),
    };
    const mockWorkflows = {
      runInspect: vi.fn().mockImplementation(async ({ runId }) => {
        if (runId === "old-terminal-run") return { run: { status: "succeeded" } };
        return { run: { status: "waiting_approval" } }; // 保护活跃或待审批任务
      }),
    };
    const mockSettings = { current: { evidenceRetentionDays: 90 } };

    const pruner = new EvidencePruner(
      mockEvidenceManager as any,
      mockWorkflows as any,
      mockSettings as any,
    );
    const result = await pruner.pruneExpiredEvidence(now);

    expect(result.prunedCount).toBe(1);
    expect(result.freedBytes).toBe(1024);
    expect(mockEvidenceManager.deleteEvidenceFile).toHaveBeenCalledWith("/tmp/ev1.png");
    expect(mockEvidenceManager.deleteEvidenceFile).not.toHaveBeenCalledWith("/tmp/ev2.png");
  });
});
