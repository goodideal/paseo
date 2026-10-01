import { describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { VisualCrawlerEngine } from "../server/engine/crawler-engine.js";
import { PlaywrightBrowserDriver } from "../server/engine/playwright-driver.js";
import { TaskStore } from "../server/store/task-store.js";
import { TaskCompiler } from "../server/triage/task-compiler.js";
import { writeMarkdownReport, createReportPath } from "../server/report/report-generator.js";

describe("Live Crawler Verification against https://llm.ezcloud.cc", () => {
  it("runs 10 hops with tester credentials and generates report & tasks", async () => {
    const evidenceDir = path.join(process.cwd(), ".evidence", "visual-crawler");
    const storePath = path.join(evidenceDir, "state.json");
    const screenshotDir = path.join(evidenceDir, "screenshots");

    const store = new TaskStore(storePath, 1);
    const driver = new PlaywrightBrowserDriver({ screenshotDir });
    const crawler = new VisualCrawlerEngine(store, driver);
    const compiler = new TaskCompiler();

    try {
      await crawler.start({
        targetUrl: "https://llm.ezcloud.cc",
        maxHops: 10,
        maxDepth: 10,
        allowedOrigins: ["https://llm.ezcloud.cc"],
        credentials: {
          username: "tester",
          password: "4ZZONM1Ht5IU",
        },
      });

      const hops = store.getHops();
      expect(hops.length).toBeGreaterThanOrEqual(1);

      // Compile tasks from recorded anomalies
      const tasks = compiler.compile(hops, store.getTasks());
      for (const t of tasks) store.upsertTask(t);

      // Generate report
      const reportPath = createReportPath(evidenceDir);
      writeMarkdownReport(reportPath, {
        targetUrl: "https://llm.ezcloud.cc",
        telemetry: store.getTelemetry(),
        tasks: store.getTasks(),
      });

      expect(existsSync(reportPath)).toBe(true);
      const content = readFileSync(reportPath, "utf-8");
      expect(content).toContain("Visual Crawler Report");
      expect(content).toContain("https://llm.ezcloud.cc");
    } finally {
      await driver.close();
    }
  }, 60_000);
});
