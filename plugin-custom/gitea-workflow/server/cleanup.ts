import type { EvidenceManager } from "./evidence-manager.js";
import type { PaseoWorkflowActions } from "@getpaseo/client";
import type { SettingsManager } from "./settings-manager.js";

export interface PruneResult {
  prunedCount: number;
  freedBytes: number;
}

export class EvidencePruner {
  constructor(
    private readonly evidenceManager: typeof EvidenceManager,
    private readonly workflows: PaseoWorkflowActions,
    private readonly settings: SettingsManager,
  ) {}

  async pruneExpiredEvidence(nowMs = Date.now()): Promise<PruneResult> {
    const retentionDays = this.settings.current.evidenceRetentionDays ?? 90;
    const cutoffMs = nowMs - retentionDays * 24 * 3600 * 1000;
    const records = await this.evidenceManager.listRecordedEvidence();

    let prunedCount = 0;
    let freedBytes = 0;

    for (const record of records) {
      if (record.createdAt > cutoffMs) continue;

      try {
        const inspectRes = await this.workflows.runInspect({
          projectId: "default",
          workspaceId: "default",
          runId: record.runId,
        });
        const status = inspectRes.run?.status;
        const isTerminal = status && ["succeeded", "failed", "cancelled"].includes(status);
        if (!isTerminal) {
          // Never prune active or awaiting runs
          continue;
        }

        const success = await this.evidenceManager.deleteEvidenceFile(record.path);
        if (success) {
          prunedCount++;
          freedBytes += record.sizeBytes;
        }
      } catch {
        // ignore individual inspection error
      }
    }

    return { prunedCount, freedBytes };
  }
}
