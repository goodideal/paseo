import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store/task-store.js";
import { VisualCrawlerEngine, type BrowserDriver } from "../server/engine/crawler-engine.js";

describe("VisualCrawlerEngine", () => {
  let store: TaskStore;
  let driver: BrowserDriver;
  let crawler: VisualCrawlerEngine;
  let testFile: string;

  beforeEach(() => {
    testFile = join(
      tmpdir(),
      `test-crawler-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`,
    );
    store = new TaskStore(testFile, 3);

    let step = 0;
    let currentNavUrl = "http://localhost:3000";
    driver = {
      async navigate(url: string) {
        currentNavUrl = url;
        step++;
        return {
          url,
          domFingerprint: `fp-${url}-${step}`,
          title: `Title ${url}`,
        };
      },
      async getConsoleLogs() {
        if (step === 2) {
          return [{ level: "error", text: "Uncaught TypeError: items.map is not a function" }];
        }
        return [];
      },
      async getNetworkFailures() {
        if (step === 3) {
          return [{ url: "/api/user", status: 500, statusText: "Internal Error" }];
        }
        return [];
      },
      async getInteractiveElements() {
        return [
          { selector: "button.next", tag: "button", text: "Next" },
          {
            selector: "a.link",
            tag: "a",
            text: "Settings",
            href: "http://localhost:3000/settings",
          },
        ];
      },
      async click(selector: string) {
        step++;
        return {
          domFingerprint: `fp-click-${selector}-${step}`,
          url: `${currentNavUrl}/clicked`,
        };
      },
      async checkVisualAnomalies() {
        if (step === 4) {
          return [
            {
              selector: "nav.header",
              reason: "overlap",
              boundingBox: { x: 0, y: 0, width: 800, height: 50 },
            },
          ];
        }
        return [];
      },
      async captureScreenshot() {
        return "/tmp/screenshot.png";
      },
    };

    crawler = new VisualCrawlerEngine(store, driver);
  });

  it("crawls up to maxHops and records telemetry", async () => {
    await crawler.start({
      targetUrl: "http://localhost:3000",
      maxHops: 5,
      seedRoutes: ["http://localhost:3000/about"],
      maxConcurrency: 3,
      autoApproveP0: false,
      allowedOrigins: ["http://localhost:3000"],
    });

    const telemetry = store.getTelemetry();
    expect(telemetry.state).toBe("completed");
    expect(telemetry.currentHop).toBe(5);
    expect(telemetry.totalAnomalies).toBeGreaterThan(0);
  });

  it("classifies console error severity correctly", async () => {
    await crawler.start({
      targetUrl: "http://localhost:3000",
      maxHops: 3,
      maxConcurrency: 3,
      autoApproveP0: false,
      allowedOrigins: ["http://localhost:3000"],
    });

    const telemetry = store.getTelemetry();
    // Step 2 generated an uncaught typeerror (classified as P0)
    expect(telemetry.anomaliesBySeverity.P0).toBeGreaterThanOrEqual(1);
  });

  it("can be stopped midway", async () => {
    const promise = crawler.start({
      targetUrl: "http://localhost:3000",
      maxHops: 50,
      maxConcurrency: 3,
      autoApproveP0: false,
      allowedOrigins: ["http://localhost:3000"],
    });

    crawler.stop();
    await promise;

    const telemetry = store.getTelemetry();
    expect(telemetry.state).toBe("idle");
    expect(telemetry.currentHop).toBeLessThan(50);
  });

  it("rejects arbitrary external URLs and unlisted intranet IPs (Task 4.4)", async () => {
    // Arbitrary external URL
    await expect(
      crawler.start({
        targetUrl: "https://google.com",
        maxHops: 5,
        allowedOrigins: ["http://localhost:3000"],
      }),
    ).rejects.toThrow("not in the workspace allowlist");

    // Unlisted intranet IP
    await expect(
      crawler.start({
        targetUrl: "http://192.168.1.100:8080",
        maxHops: 5,
        allowedOrigins: ["http://localhost:3000"],
      }),
    ).rejects.toThrow("not in the workspace allowlist");
  });

  it("permits declared staging/local allowlist targets and restricts path scope (Task 4.4)", async () => {
    await expect(
      crawler.start({
        targetUrl: "http://staging.internal:8080/app",
        maxHops: 2,
        allowedOrigins: ["http://staging.internal:8080/app"],
      }),
    ).resolves.not.toThrow();

    // Out of path scope on same origin rejected
    await expect(
      crawler.start({
        targetUrl: "http://staging.internal:8080/admin/secret",
        maxHops: 2,
        allowedOrigins: ["http://staging.internal:8080/app"],
      }),
    ).rejects.toThrow("not in the workspace allowlist");
  });
});
