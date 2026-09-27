import type { AnomalyRecord, CrawlConfig, HopRecord, Severity } from "../../shared/types.js";
import type { TaskStore } from "../store/task-store.js";

export interface BrowserDriver {
  navigate(url: string): Promise<{ url: string; domFingerprint: string; title: string }>;
  getConsoleLogs(): Promise<Array<{ level: string; text: string }>>;
  getNetworkFailures(): Promise<Array<{ url: string; status: number; statusText: string }>>;
  getInteractiveElements(): Promise<
    Array<{ selector: string; tag: string; text: string; href?: string }>
  >;
  click(selector: string): Promise<{ domFingerprint: string; url: string }>;
  checkVisualAnomalies(): Promise<
    Array<{
      selector: string;
      reason: "overlap" | "overflow" | "clipped";
      boundingBox: { x: number; y: number; width: number; height: number };
      sourceHint?: { filePath: string; componentName?: string; line?: number };
    }>
  >;
  captureScreenshot(): Promise<string>;
}

export function isUrlInAllowlist(targetUrlStr: string, allowedOrigins: string[]): boolean {
  try {
    const target = new URL(targetUrlStr);
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    return allowedOrigins.some((allowed) => {
      try {
        const allowedUrl = new URL(allowed);
        if (allowedUrl.protocol !== target.protocol || allowedUrl.port !== target.port)
          return false;
        const hostnameMatches = allowedUrl.hostname.startsWith("*.")
          ? target.hostname.endsWith(`.${allowedUrl.hostname.slice(2)}`)
          : allowedUrl.hostname === target.hostname;
        if (!hostnameMatches) return false;
        const allowedPath = allowedUrl.pathname.replace(/\/$/, "");
        return (
          allowedPath === "" ||
          target.pathname === allowedPath ||
          target.pathname.startsWith(`${allowedPath}/`)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export class VisualCrawlerEngine {
  private store: TaskStore;
  private driver: BrowserDriver;
  private isRunning = false;
  private visitedUrls = new Set<string>();
  private actionHistory = new Map<string, number>(); // actionKey -> visitCount
  private routeActionCount = new Map<string, number>(); // url -> actionCount

  constructor(store: TaskStore, driver: BrowserDriver) {
    this.store = store;
    this.driver = driver;
  }

  public async start(config: CrawlConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error("Crawler is already running");
    }

    const allowlist = config.allowedOrigins ?? [];
    if (allowlist.length === 0) {
      throw new Error("Crawler requires an explicit workspace URL allowlist");
    }
    if (!isUrlInAllowlist(config.targetUrl, allowlist)) {
      throw new Error(`Target URL is not in the workspace allowlist: ${config.targetUrl}`);
    }

    this.isRunning = true;
    this.visitedUrls.clear();
    this.actionHistory.clear();
    this.routeActionCount.clear();

    this.store.updateTelemetry({
      state: "running",
      currentHop: 0,
      maxHops: config.maxHops,
      activeUrl: config.targetUrl,
      startedAt: Date.now(),
      endedAt: undefined,
    });

    try {
      await this.runLoop(config);
      if (this.isRunning) {
        this.store.updateTelemetry({
          state: "completed",
          endedAt: Date.now(),
        });
      }
    } catch (err: unknown) {
      this.store.updateTelemetry({
        state: "error",
        endedAt: Date.now(),
      });
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      this.isRunning = false;
    }
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.store.updateTelemetry({
      state: "idle",
      endedAt: Date.now(),
    });
  }

  private chooseNextAction(
    elements: Array<{ selector: string; tag: string; text: string; href?: string }>,
    queue: string[],
    currentUrl: string,
    config: CrawlConfig,
    allowlist: string[],
  ): { selector: string; type: "click" | "navigate"; targetUrl?: string } | null {
    for (const el of elements) {
      if (el.href) {
        const resolvedHref = new URL(el.href, currentUrl).href;
        if (!isUrlInAllowlist(resolvedHref, allowlist)) continue;
        if (!this.visitedUrls.has(resolvedHref)) {
          return { selector: el.selector, type: "navigate", targetUrl: resolvedHref };
        }
      }

      const actionKey = `${currentUrl}::${el.selector}`;
      const count = this.actionHistory.get(actionKey) || 0;
      const routeCount = this.routeActionCount.get(currentUrl) || 0;

      if (count < 2 && routeCount < 5) {
        this.actionHistory.set(actionKey, count + 1);
        this.routeActionCount.set(currentUrl, routeCount + 1);
        return { selector: el.selector, type: "click" };
      }
    }

    while (queue.length > 0) {
      const nextRoute = queue.shift();
      if (nextRoute) {
        const resolvedRoute = new URL(nextRoute, config.targetUrl).href;
        if (!isUrlInAllowlist(resolvedRoute, allowlist)) continue;
        if (!this.visitedUrls.has(resolvedRoute)) {
          return { selector: "body", type: "navigate", targetUrl: resolvedRoute };
        }
      }
    }

    return null;
  }

  private async runLoop(config: CrawlConfig): Promise<void> {
    const allowlist = config.allowedOrigins ?? [];
    const queue: string[] = [config.targetUrl, ...(config.seedRoutes || [])];
    let hopCount = 0;
    let currentUrl = config.targetUrl;

    // Initial navigation
    const initial = await this.driver.navigate(currentUrl);
    if (!isUrlInAllowlist(initial.url, allowlist)) {
      throw new Error(`Browser redirected outside the workspace allowlist: ${initial.url}`);
    }
    this.visitedUrls.add(initial.url);
    hopCount++;

    await this.inspectAndRecordHop(hopCount, initial.url, "navigate", initial.domFingerprint);

    while (this.isRunning && hopCount < config.maxHops) {
      const elements = await this.driver.getInteractiveElements();
      const nextAction = this.chooseNextAction(elements, queue, currentUrl, config, allowlist);
      if (!nextAction) {
        break;
      }

      hopCount++;

      // 4. Execute action
      let actionLabel = "";
      let newFingerprint = "";

      if (nextAction.type === "navigate" && nextAction.targetUrl) {
        actionLabel = `navigate:${nextAction.targetUrl}`;
        const res = await this.driver.navigate(nextAction.targetUrl);
        if (!isUrlInAllowlist(res.url, allowlist)) {
          throw new Error(`Browser redirected outside the workspace allowlist: ${res.url}`);
        }
        currentUrl = res.url;
        this.visitedUrls.add(currentUrl);
        newFingerprint = res.domFingerprint;
      } else {
        actionLabel = `click:${nextAction.selector}`;
        const res = await this.driver.click(nextAction.selector);
        if (!isUrlInAllowlist(res.url, allowlist)) {
          throw new Error(`Browser click navigated outside the workspace allowlist: ${res.url}`);
        }
        currentUrl = res.url;
        newFingerprint = res.domFingerprint;
      }

      // 5. Inspect and record anomalies for this hop
      await this.inspectAndRecordHop(hopCount, currentUrl, actionLabel, newFingerprint);
    }
  }

  private async inspectAndRecordHop(
    hopNumber: number,
    url: string,
    action: string,
    fingerprint: string,
  ): Promise<void> {
    const anomalies: AnomalyRecord[] = [];

    // Check runtime console errors
    const logs = await this.driver.getConsoleLogs();
    for (const log of logs) {
      if (log.level === "error") {
        anomalies.push({
          id: `anomaly-console-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: "runtime_error",
          severity: this.classifyConsoleSeverity(log.text),
          message: log.text,
          url,
          timestamp: Date.now(),
        });
      }
    }

    // Check network failures
    const failures = await this.driver.getNetworkFailures();
    for (const fail of failures) {
      anomalies.push({
        id: `anomaly-net-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "network_failure",
        severity: fail.status >= 500 ? "P0" : "P1",
        message: `HTTP ${fail.status} on ${fail.url} (${fail.statusText})`,
        httpStatus: fail.status,
        url,
        timestamp: Date.now(),
      });
    }

    // Check visual defects
    const visualIssues = await this.driver.checkVisualAnomalies();
    for (const vis of visualIssues) {
      anomalies.push({
        id: `anomaly-vis-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "visual_defect",
        severity: vis.reason === "overlap" ? "P1" : "P2",
        message: `Visual defect detected on ${vis.selector}: ${vis.reason}`,
        domSelector: vis.selector,
        boundingBox: vis.boundingBox,
        sourceHint: vis.sourceHint,
        url,
        timestamp: Date.now(),
      });
    }

    // Capture screenshot if anomaly exists
    if (anomalies.length > 0) {
      const screenshot = await this.driver.captureScreenshot();
      for (const a of anomalies) {
        a.screenshotPath = screenshot;
        this.store.recordAnomaly(a);
      }
    }

    const hop: HopRecord = {
      hopNumber,
      url,
      action,
      timestamp: Date.now(),
      domFingerprint: fingerprint,
      anomalies,
    };

    this.store.recordHop(hop);
  }

  private classifyConsoleSeverity(message: string): Severity {
    const lower = message.toLowerCase();
    if (lower.includes("uncaught") || lower.includes("crash") || lower.includes("chunkloaderror")) {
      return "P0";
    }
    if (
      lower.includes("typeerror") ||
      lower.includes("referenceerror") ||
      lower.includes("invariant")
    ) {
      return "P1";
    }
    return "P2";
  }

  private isInternalUrl(target: string, base: string, allowlist: string[]): boolean {
    try {
      const u = new URL(target, base);
      return isUrlInAllowlist(u.href, allowlist);
    } catch {
      return false;
    }
  }
}
