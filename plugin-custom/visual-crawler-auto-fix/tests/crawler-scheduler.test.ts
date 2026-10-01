import { describe, expect, it, vi } from "vitest";
import { CrawlerScheduler, isWithinTimeWindow } from "../server/scheduler/crawler-scheduler.js";
import type { TimeWindowConfig } from "../shared/types.js";

describe("CrawlerScheduler & TimeWindow", () => {
  describe("isWithinTimeWindow", () => {
    it("handles daytime window (e.g., 09:00 - 18:00)", () => {
      const window: TimeWindowConfig = {
        enabled: true,
        startTime: "09:00",
        endTime: "18:00",
      };

      const morning = new Date("2026-10-01T08:59:00");
      const noon = new Date("2026-10-01T12:00:00");
      const evening = new Date("2026-10-01T18:01:00");

      expect(isWithinTimeWindow(morning, window)).toBe(false);
      expect(isWithinTimeWindow(noon, window)).toBe(true);
      expect(isWithinTimeWindow(evening, window)).toBe(false);
    });

    it("handles overnight window crossing midnight (e.g., 23:00 - 06:00)", () => {
      const window: TimeWindowConfig = {
        enabled: true,
        startTime: "23:00",
        endTime: "06:00",
      };

      const lateNight = new Date("2026-10-01T23:30:00");
      const earlyMorning = new Date("2026-10-02T02:15:00");
      const afterWindow = new Date("2026-10-02T06:01:00");
      const afternoon = new Date("2026-10-02T15:00:00");

      expect(isWithinTimeWindow(lateNight, window)).toBe(true);
      expect(isWithinTimeWindow(earlyMorning, window)).toBe(true);
      expect(isWithinTimeWindow(afterWindow, window)).toBe(false);
      expect(isWithinTimeWindow(afternoon, window)).toBe(false);
    });

    it("always returns true when window is disabled", () => {
      const window: TimeWindowConfig = {
        enabled: false,
        startTime: "23:00",
        endTime: "06:00",
      };
      const afternoon = new Date("2026-10-02T15:00:00");
      expect(isWithinTimeWindow(afternoon, window)).toBe(true);
    });
  });

  describe("CrawlerScheduler lifecycle", () => {
    it("schedules and updates configuration", () => {
      const scheduler = new CrawlerScheduler();
      expect(scheduler.getConfig().enabled).toBe(false);

      const onTrigger = vi.fn().mockResolvedValue(undefined);
      scheduler.updateConfig(
        {
          enabled: true,
          targetUrl: "https://example.com",
          maxHops: 50,
          maxDepth: 10,
          timeWindow: {
            enabled: true,
            startTime: "01:00",
            endTime: "05:00",
          },
        },
        onTrigger,
      );

      expect(scheduler.getConfig().enabled).toBe(true);
      expect(scheduler.getConfig().targetUrl).toBe("https://example.com");

      scheduler.stop();
      expect(scheduler.getConfig().enabled).toBe(false);
    });

    it("triggers immediately when triggered manually", async () => {
      const scheduler = new CrawlerScheduler();
      const onTrigger = vi.fn().mockResolvedValue(undefined);

      scheduler.updateConfig(
        {
          enabled: false,
          targetUrl: "https://example.com",
          maxHops: 50,
          maxDepth: 10,
        },
        onTrigger,
      );

      await scheduler.triggerNow();
      expect(onTrigger).toHaveBeenCalledTimes(1);
    });
  });
});
