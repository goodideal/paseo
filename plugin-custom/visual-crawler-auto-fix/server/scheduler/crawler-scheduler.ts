import type { CrawlScheduleConfig, TimeWindowConfig } from "../../shared/types.js";

export function isWithinTimeWindow(date: Date, window?: TimeWindowConfig): boolean {
  if (!window || !window.enabled) {
    return true;
  }

  const [startH, startM] = window.startTime.split(":").map(Number);
  const [endH, endM] = window.endTime.split(":").map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  // Overnight window: e.g. 23:00 to 06:00
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export type TriggerHandler = () => Promise<void>;

export class CrawlerScheduler {
  private config: CrawlScheduleConfig = {
    enabled: false,
    targetUrl: "",
    maxHops: 50,
    maxDepth: 10,
  };
  private onTrigger?: TriggerHandler;
  private intervalTimer?: ReturnType<typeof setInterval>;
  private isExecuting = false;
  private lastTriggeredMinute = -1;

  public updateConfig(config: CrawlScheduleConfig, onTrigger?: TriggerHandler): void {
    this.config = { ...config };
    if (onTrigger) {
      this.onTrigger = onTrigger;
    }

    this.restartTimer();
  }

  public getConfig(): CrawlScheduleConfig {
    return { ...this.config };
  }

  public async triggerNow(): Promise<void> {
    if (this.isExecuting || !this.onTrigger) return;
    try {
      this.isExecuting = true;
      await this.onTrigger();
    } finally {
      this.isExecuting = false;
    }
  }

  public stop(): void {
    this.config.enabled = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  private restartTimer(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }

    if (!this.config.enabled) return;

    // Check every 30 seconds
    this.intervalTimer = setInterval(() => {
      void this.checkSchedule();
    }, 30_000);
  }

  private async checkSchedule(): Promise<void> {
    if (!this.config.enabled || this.isExecuting || !this.onTrigger) return;

    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Check time window first
    if (!isWithinTimeWindow(now, this.config.timeWindow)) {
      return;
    }

    // If a time window is configured and enabled, trigger once per start of window
    if (this.config.timeWindow?.enabled) {
      const [startH, startM] = this.config.timeWindow.startTime.split(":").map(Number);
      const windowStartMinute = startH * 60 + startM;

      if (currentMinute === windowStartMinute && this.lastTriggeredMinute !== currentMinute) {
        this.lastTriggeredMinute = currentMinute;
        await this.triggerNow();
      }
    }
  }
}
