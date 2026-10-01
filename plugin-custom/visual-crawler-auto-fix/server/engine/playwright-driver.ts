import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import type { BrowserDriver } from "./crawler-engine.js";

export interface PlaywrightDriverOptions {
  screenshotDir?: string;
  authHeaders?: Record<string, string>;
  headless?: boolean;
}

export class PlaywrightBrowserDriver implements BrowserDriver {
  private options: PlaywrightDriverOptions;
  private screenshotDir: string;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private consoleLogs: Array<{ level: string; text: string }> = [];
  private networkFailures: Array<{ url: string; status: number; statusText: string }> = [];

  constructor(options?: PlaywrightDriverOptions) {
    this.options = options || {};
    this.screenshotDir =
      this.options.screenshotDir || join(tmpdir(), "paseo-visual-crawler", "screenshots");
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  public async init(): Promise<void> {
    if (this.browser) return;

    try {
      this.browser = await chromium.launch({
        headless: this.options.headless ?? true,
        channel: "chrome",
      });
    } catch {
      try {
        this.browser = await chromium.launch({
          headless: this.options.headless ?? true,
        });
      } catch (err) {
        throw new Error(
          `Could not launch browser. Ensure Google Chrome or Playwright Chromium is installed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.context = await this.browser.newContext({
      extraHTTPHeaders: this.options.authHeaders,
      viewport: { width: 1280, height: 800 },
    });

    this.page = await this.context.newPage();
    this.setupListeners(this.page);
  }

  private setupListeners(page: Page): void {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.consoleLogs.push({ level: "error", text: msg.text() });
      }
    });

    page.on("pageerror", (err) => {
      this.consoleLogs.push({
        level: "error",
        text: err.stack || err.message,
      });
    });

    page.on("response", (res) => {
      if (res.status() >= 400) {
        this.networkFailures.push({
          url: res.url(),
          status: res.status(),
          statusText: res.statusText(),
        });
      }
    });
  }

  public async navigate(
    url: string,
  ): Promise<{ url: string; domFingerprint: string; title: string }> {
    if (!this.page) {
      await this.init();
    }
    const page = this.page!;
    this.consoleLogs = [];
    this.networkFailures = [];

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(150);

    const title = await page.title();
    const domFingerprint = await this.extractFingerprint(page);

    return {
      url: page.url(),
      domFingerprint,
      title: title || `Page at ${url}`,
    };
  }

  public async getConsoleLogs(): Promise<Array<{ level: string; text: string }>> {
    const logs = [...this.consoleLogs];
    this.consoleLogs = [];
    return logs;
  }

  public async getNetworkFailures(): Promise<
    Array<{ url: string; status: number; statusText: string }>
  > {
    const failures = [...this.networkFailures];
    this.networkFailures = [];
    return failures;
  }

  public async getInteractiveElements(): Promise<
    Array<{ selector: string; tag: string; text: string; href?: string }>
  > {
    if (!this.page) return [];

    return this.page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('a[href], button, [role="button"], [role="tab"]'),
      );

      return candidates.slice(0, 50).map((el, i) => {
        let selector = "";
        if (el.id) {
          selector = `#${el.id}`;
        } else if (el.className && typeof el.className === "string") {
          const classes = el.className.split(" ").filter(Boolean).slice(0, 2).join(".");
          selector = classes
            ? `${el.tagName.toLowerCase()}.${classes}`
            : `${el.tagName.toLowerCase()}:nth-of-type(${i + 1})`;
        } else {
          selector = `${el.tagName.toLowerCase()}:nth-of-type(${i + 1})`;
        }

        return {
          selector,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 50),
          href: el.getAttribute("href") || undefined,
        };
      });
    });
  }

  public async click(selector: string): Promise<{ domFingerprint: string; url: string }> {
    if (!this.page) {
      await this.init();
    }
    const page = this.page!;
    this.consoleLogs = [];
    this.networkFailures = [];

    try {
      await page.click(selector, { timeout: 4000 });
    } catch {
      // Fallback for tricky selectors
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        el?.click();
      }, selector);
    }

    await page.waitForTimeout(300);
    const domFingerprint = await this.extractFingerprint(page);

    return {
      domFingerprint,
      url: page.url(),
    };
  }

  public async checkVisualAnomalies(): Promise<
    Array<{
      selector: string;
      reason: "overlap" | "overflow" | "clipped";
      boundingBox: { x: number; y: number; width: number; height: number };
      sourceHint?: { filePath: string; componentName?: string; line?: number };
    }>
  > {
    if (!this.page) return [];

    return this.page.evaluate(() => {
      const anomalies: Array<{
        selector: string;
        reason: "overlap" | "overflow" | "clipped";
        boundingBox: { x: number; y: number; width: number; height: number };
      }> = [];

      // Check for blank page / crash
      const bodyChildren = document.body ? Array.from(document.body.children) : [];
      if (bodyChildren.length === 0) {
        anomalies.push({
          selector: "body",
          reason: "clipped",
          boundingBox: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        });
        return anomalies;
      }

      // Check text clipping
      const textElements = Array.from(
        document.querySelectorAll("h1, h2, h3, p, button, span"),
      ).slice(0, 100);
      for (const el of textElements) {
        if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const selector = el.id ? `#${el.id}` : el.tagName.toLowerCase();
            anomalies.push({
              selector,
              reason: "clipped",
              boundingBox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
            if (anomalies.length >= 3) break;
          }
        }
      }

      return anomalies;
    });
  }

  public async captureScreenshot(targetPath?: string): Promise<string> {
    if (!this.page) {
      await this.init();
    }
    const page = this.page!;
    const dest =
      targetPath ||
      join(
        this.screenshotDir,
        `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`,
      );

    await page.screenshot({ path: dest, fullPage: true });
    return dest;
  }

  public async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  private async extractFingerprint(page: Page): Promise<string> {
    try {
      const summary = await page.evaluate(() => {
        const tags = Array.from(
          document.querySelectorAll("header, nav, main, footer, h1, button, a"),
        )
          .slice(0, 30)
          .map((el) => `${el.tagName}:${el.className}`);
        return tags.join("|");
      });
      return createHash("sha256")
        .update(summary || page.url())
        .digest("hex")
        .slice(0, 16);
    } catch {
      return createHash("sha256").update(page.url()).digest("hex").slice(0, 16);
    }
  }
}
