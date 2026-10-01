import { createHash } from "node:crypto";
import type {
  ActionBreadcrumb,
  AnomalyRecord,
  CrawlerTaskItem,
  HopRecord,
  Severity,
} from "../../shared/types.js";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  P0: 4,
  P1: 3,
  P2: 2,
  P3: 1,
};

export class TaskCompiler {
  public computeClusterKey(anomaly: AnomalyRecord): string {
    const normalizedMessage = anomaly.message
      .replace(/https?:\/\/[^\s]+/g, "<URL>")
      .replace(/0x[a-f0-9]+/gi, "<HEX>")
      .replace(/\b\d{4,}\b/g, "<NUM>")
      .trim();

    const identity = [
      anomaly.type,
      normalizedMessage,
      anomaly.domSelector ?? "",
      anomaly.httpStatus ? String(anomaly.httpStatus) : "",
    ].join("::");

    return createHash("sha256").update(identity).digest("hex");
  }

  public compile(hops: HopRecord[], existingTasks: CrawlerTaskItem[] = []): CrawlerTaskItem[] {
    const taskMap = new Map<string, CrawlerTaskItem>();

    for (const task of existingTasks) {
      taskMap.set(task.clusterKey, {
        ...task,
        affectedUrls: [...task.affectedUrls],
        reproductionBreadcrumbs: [...task.reproductionBreadcrumbs],
        evidence: { ...task.evidence },
      });
    }

    const runningBreadcrumbs: ActionBreadcrumb[] = [];

    for (const hop of hops) {
      runningBreadcrumbs.push({
        hopNumber: hop.hopNumber,
        url: hop.url,
        action: hop.action,
      });

      for (const anomaly of hop.anomalies) {
        const clusterKey = this.computeClusterKey(anomaly);
        const existing = taskMap.get(clusterKey);

        if (existing) {
          existing.occurrenceCount += 1;
          if (!existing.affectedUrls.includes(hop.url)) {
            existing.affectedUrls.push(hop.url);
          }
          existing.lastSeenAt = Math.max(existing.lastSeenAt, anomaly.timestamp);

          // Escalate severity if new anomaly has higher severity
          if (SEVERITY_WEIGHT[anomaly.severity] > SEVERITY_WEIGHT[existing.severity]) {
            existing.severity = anomaly.severity;
          }

          // Update evidence if new anomaly has screenshot
          if (anomaly.screenshotPath && !existing.evidence.screenshotPath) {
            existing.evidence.screenshotPath = anomaly.screenshotPath;
          }
          if (anomaly.stack && !existing.evidence.stackTrace) {
            existing.evidence.stackTrace = anomaly.stack;
          }

          // Append breadcrumb if not present
          const hasBreadcrumb = existing.reproductionBreadcrumbs.some(
            (b) => b.hopNumber === hop.hopNumber && b.action === hop.action,
          );
          if (!hasBreadcrumb) {
            existing.reproductionBreadcrumbs.push({
              hopNumber: hop.hopNumber,
              url: hop.url,
              action: hop.action,
            });
          }
        } else {
          const title = this.formatTaskTitle(anomaly);
          const newTask: CrawlerTaskItem = {
            id: `task-${clusterKey.slice(0, 12)}`,
            clusterKey,
            title,
            severity: anomaly.severity,
            category: anomaly.type,
            status: "todo",
            occurrenceCount: 1,
            affectedUrls: [hop.url],
            firstSeenAt: anomaly.timestamp,
            lastSeenAt: anomaly.timestamp,
            reproductionBreadcrumbs: [...runningBreadcrumbs],
            evidence: {
              screenshotPath: anomaly.screenshotPath,
              consoleMessage: anomaly.type === "runtime_error" ? anomaly.message : undefined,
              stackTrace: anomaly.stack,
              httpStatus: anomaly.httpStatus,
              domSelector: anomaly.domSelector,
            },
          };
          taskMap.set(clusterKey, newTask);
        }
      }
    }

    return Array.from(taskMap.values());
  }

  private formatTaskTitle(anomaly: AnomalyRecord): string {
    if (anomaly.type === "network_failure") {
      return `Network failure: HTTP ${anomaly.httpStatus ?? "error"}`;
    }
    if (anomaly.type === "visual_defect") {
      return `Visual defect on ${anomaly.domSelector || "page element"}`;
    }
    const firstLine = anomaly.message.split("\n")[0] || "Runtime error";
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }
}
