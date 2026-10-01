import { describe, expect, it } from "vitest";
import {
  CrawlConfigSchema,
  CrawlerTaskItemSchema,
  CrawlScheduleConfigSchema,
  TimeWindowConfigSchema,
} from "../shared/types.js";
import {
  getScheduleRpc,
  listTasksRpc,
  saveScheduleRpc,
  startCrawlRpc,
  updateTaskStatusRpc,
} from "../shared/contracts.js";

describe("Shared Contracts & Schemas", () => {
  it("validates TimeWindowConfigSchema", () => {
    const valid = TimeWindowConfigSchema.parse({
      enabled: true,
      startTime: "23:00",
      endTime: "06:00",
    });
    expect(valid.startTime).toBe("23:00");
    expect(valid.endTime).toBe("06:00");

    expect(() =>
      TimeWindowConfigSchema.parse({
        enabled: true,
        startTime: "invalid",
        endTime: "06:00",
      }),
    ).toThrow();
  });

  it("validates CrawlScheduleConfigSchema", () => {
    const valid = CrawlScheduleConfigSchema.parse({
      enabled: true,
      cron: "0 2 * * *",
      targetUrl: "https://staging.example.com",
      maxHops: 50,
      maxDepth: 10,
      timeWindow: {
        enabled: true,
        startTime: "23:00",
        endTime: "06:00",
      },
    });
    expect(valid.targetUrl).toBe("https://staging.example.com");
    expect(valid.maxDepth).toBe(10);
  });

  it("validates CrawlerTaskItemSchema", () => {
    const task = CrawlerTaskItemSchema.parse({
      id: "task-123",
      clusterKey: "err-click-submit",
      title: "Uncaught TypeError on button.submit",
      severity: "P0",
      category: "runtime_error",
      status: "todo",
      occurrenceCount: 3,
      affectedUrls: ["https://example.com/checkout", "https://example.com/cart"],
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      reproductionBreadcrumbs: [
        { hopNumber: 1, url: "https://example.com/", action: "navigate" },
        { hopNumber: 2, url: "https://example.com/cart", action: "click:button.checkout" },
      ],
      evidence: {
        screenshotPath: ".evidence/visual-crawler/screenshots/step-2.png",
        consoleMessage: "TypeError: Cannot read properties of undefined",
      },
    });
    expect(task.severity).toBe("P0");
    expect(task.status).toBe("todo");
    expect(task.reproductionBreadcrumbs).toHaveLength(2);
  });

  it("validates CrawlConfigSchema with depth and authHeaders", () => {
    const config = CrawlConfigSchema.parse({
      targetUrl: "https://example.com",
      maxHops: 80,
      maxDepth: 15,
      authHeaders: { Authorization: "Bearer test-token" },
      allowedOrigins: ["https://example.com"],
    });
    expect(config.maxDepth).toBe(15);
    expect(config.authHeaders?.Authorization).toBe("Bearer test-token");
  });

  it("exports new task and schedule RPCs", () => {
    expect(saveScheduleRpc.name).toBe("visual_crawler.schedule.save");
    expect(getScheduleRpc.name).toBe("visual_crawler.schedule.get");
    expect(listTasksRpc.name).toBe("visual_crawler.tasks.list");
    expect(updateTaskStatusRpc.name).toBe("visual_crawler.tasks.update_status");
  });
});
