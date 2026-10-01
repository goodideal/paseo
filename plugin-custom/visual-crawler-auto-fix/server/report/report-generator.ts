import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CrawlerTaskItem, CrawlTelemetry } from "../../shared/types.js";

export interface MarkdownReportInput {
  targetUrl: string;
  telemetry: CrawlTelemetry;
  tasks: CrawlerTaskItem[];
  generatedAt?: Date;
}

export function generateMarkdownReport({
  targetUrl,
  telemetry,
  tasks,
  generatedAt = new Date(),
}: MarkdownReportInput): string {
  const durationMs = Math.max(
    0,
    (telemetry.endedAt || generatedAt.getTime()) - (telemetry.startedAt || generatedAt.getTime()),
  );
  const durationSeconds = Math.round(durationMs / 1000);
  const severityRows = (["P0", "P1", "P2", "P3"] as const)
    .map((severity) => `| ${severity} | ${telemetry.anomaliesBySeverity[severity] || 0} |`)
    .join("\n");
  const checklist = tasks.length
    ? tasks
        .map((task) => {
          const breadcrumbs = task.reproductionBreadcrumbs
            .map((crumb) => `  1. #${crumb.hopNumber} ${crumb.action} — ${crumb.url}`)
            .join("\n");
          const evidence = [
            task.evidence.consoleMessage
              ? `  - Console: \`${task.evidence.consoleMessage}\``
              : undefined,
            task.evidence.httpStatus ? `  - HTTP status: ${task.evidence.httpStatus}` : undefined,
            task.evidence.domSelector
              ? `  - Selector: \`${task.evidence.domSelector}\``
              : undefined,
            task.evidence.screenshotPath
              ? `  - Screenshot: ${task.evidence.screenshotPath}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n");
          return [
            `- [ ] **${task.severity}** ${task.title} (${task.occurrenceCount} occurrence${task.occurrenceCount === 1 ? "" : "s"})`,
            `  - Status: ${task.status}`,
            `  - Affected URLs: ${task.affectedUrls.join(", ")}`,
            "  - Reproduction:",
            breadcrumbs || "  1. No action trace available",
            evidence,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n")
    : "No issues detected.";

  return `# Visual Crawler Report

- Generated: ${generatedAt.toISOString()}
- Target URL: ${targetUrl}
- State: ${telemetry.state}
- Hops: ${telemetry.currentHop} / ${telemetry.maxHops}
- Duration: ${durationSeconds}s

## Severity Summary

| Severity | Count |
| --- | ---: |
${severityRows}

## Issue Task List

${checklist}
`;
}

export function writeMarkdownReport(filePath: string, input: MarkdownReportInput): string {
  const directory = dirname(filePath);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const report = generateMarkdownReport(input);
  writeFileSync(filePath, report, "utf-8");
  return filePath;
}

export function createReportPath(evidenceDir: string, date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return join(evidenceDir, "reports", `crawl-report-${timestamp}.md`);
}
