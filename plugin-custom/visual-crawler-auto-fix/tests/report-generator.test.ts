import { describe, expect, it } from "vitest";
import { generateMarkdownReport } from "../server/report/report-generator.js";
import type { CrawlerTaskItem, CrawlTelemetry } from "../shared/types.js";

describe("generateMarkdownReport", () => {
  it("writes run overview, severity summary, and reproducible task checklist", () => {
    const telemetry: CrawlTelemetry = {
      state: "completed",
      currentHop: 12,
      maxHops: 50,
      activeUrl: "https://example.com/checkout",
      totalAnomalies: 2,
      anomaliesBySeverity: { P0: 1, P1: 0, P2: 1, P3: 0 },
      startedAt: 1000,
      endedAt: 2000,
    };
    const tasks: CrawlerTaskItem[] = [
      {
        id: "task-crash",
        clusterKey: "crash",
        title: "Checkout runtime crash",
        severity: "P0",
        category: "runtime_error",
        status: "todo",
        occurrenceCount: 2,
        affectedUrls: ["https://example.com/checkout"],
        firstSeenAt: 1000,
        lastSeenAt: 2000,
        reproductionBreadcrumbs: [
          { hopNumber: 1, url: "https://example.com", action: "navigate" },
          { hopNumber: 2, url: "https://example.com/checkout", action: "click:button.buy" },
        ],
        evidence: {
          screenshotPath: ".evidence/visual-crawler/screenshots/crash.png",
          consoleMessage: "Uncaught TypeError",
        },
      },
    ];

    const report = generateMarkdownReport({
      targetUrl: "https://example.com",
      telemetry,
      tasks,
      generatedAt: new Date("2026-10-01T02:00:00Z"),
    });

    expect(report).toContain("# Visual Crawler Report");
    expect(report).toContain("12 / 50");
    expect(report).toContain("| P0 | 1 |");
    expect(report).toContain("- [ ] **P0** Checkout runtime crash");
    expect(report).toContain("click:button.buy");
    expect(report).toContain("crash.png");
  });
});
