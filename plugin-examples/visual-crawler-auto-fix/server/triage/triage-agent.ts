import { createHash } from "node:crypto";
import type { AnomalyRecord, FixDirective, Severity } from "../../shared/types.js";
import type { TaskStore } from "../store/task-store.js";

export class ReviewTriageAgent {
  private store: TaskStore;

  constructor(store: TaskStore) {
    this.store = store;
  }

  public triageAnomalies(
    anomalies: AnomalyRecord[],
    options?: { autoApproveP0?: boolean },
  ): FixDirective[] {
    const clusters = new Map<string, AnomalyRecord[]>();

    // 1. Group anomalies by cluster key
    for (const a of anomalies) {
      const clusterKey = this.computeClusterKey(a);
      const list = clusters.get(clusterKey) || [];
      list.push(a);
      clusters.set(clusterKey, list);
    }

    const directives: FixDirective[] = [];

    // 2. Synthesize each cluster into one Fix Directive
    for (const [clusterKey, records] of clusters.entries()) {
      const primary = records[0];
      const highestSeverity = this.pickHighestSeverity(records.map((r) => r.severity));
      const affectedPages = Array.from(new Set(records.map((r) => r.url)));
      const id = `directive-${createHash("sha1").update(clusterKey).digest("hex").slice(0, 10)}`;

      const title = this.generateTitle(primary, highestSeverity, affectedPages.length);
      const suggestedFix = this.synthesizeSuggestedFix(primary);

      const directive: FixDirective = {
        id,
        clusterKey,
        title,
        severity: highestSeverity,
        category: primary.type,
        affectedPages,
        occurrenceCount: records.length,
        sourceHint: primary.sourceHint,
        errorDetails: {
          message: primary.message,
          stack: primary.stack,
          httpStatus: primary.httpStatus,
        },
        evidence: {
          screenshotPath: primary.screenshotPath,
          domSnippet: primary.domSelector,
        },
        suggestedFix,
        status: options?.autoApproveP0 && highestSeverity === "P0" ? "approved" : "pending_review",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.store.upsertDirective(directive);
      directives.push(directive);
    }

    return directives;
  }

  public computeClusterKey(anomaly: AnomalyRecord): string {
    const sourceTarget = anomaly.sourceHint?.filePath || anomaly.domSelector || "global";
    const normalizedMessage = this.normalizeErrorMessage(anomaly.message);
    return `${anomaly.type}::${sourceTarget}::${normalizedMessage}`;
  }

  private normalizeErrorMessage(raw: string): string {
    return raw
      .replace(/http:\/\/[^\s]+/g, "<URL>")
      .replace(/https:\/\/[^\s]+/g, "<URL>")
      .replace(/\b\d{1,5}\b/g, "<NUM>") // replace port or line numbers
      .replace(/[a-f0-9]{8,}/gi, "<HASH>") // replace hashes
      .trim();
  }

  private pickHighestSeverity(severities: Severity[]): Severity {
    const rank: Record<Severity, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };
    let highest: Severity = "P3";
    for (const s of severities) {
      if (rank[s] > rank[highest]) {
        highest = s;
      }
    }
    return highest;
  }

  private generateTitle(primary: AnomalyRecord, severity: Severity, pageCount: number): string {
    const prefix = `[${severity}]`;
    const target = primary.sourceHint?.componentName || primary.domSelector || primary.type;
    const scope = pageCount > 1 ? `across ${pageCount} pages` : "on single page";
    return `${prefix} Fix ${primary.type} in ${target} (${scope})`;
  }

  private synthesizeSuggestedFix(primary: AnomalyRecord): string {
    if (primary.type === "runtime_error") {
      return `Inspect ${primary.sourceHint?.filePath || "component"} and handle null/undefined check or catch unhandled promise rejection: ${primary.message}`;
    }
    if (primary.type === "network_failure") {
      return `Check API endpoint responding with ${primary.httpStatus}. Ensure proper error boundary or fallback state in UI.`;
    }
    return `Resolve visual layout anomaly on ${primary.domSelector}. Ensure flex/grid constraints, fix overlapping z-index, or prevent horizontal clipping.`;
  }
}
