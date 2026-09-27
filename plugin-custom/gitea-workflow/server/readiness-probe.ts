export interface ReadinessProbeOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export interface ReadinessProbeResult {
  ready: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

export const ReadinessProbe = {
  async waitForServiceReady(
    url: string,
    options: ReadinessProbeOptions = {},
  ): Promise<ReadinessProbeResult> {
    const timeoutMs = options.timeoutMs ?? 30000;
    const intervalMs = options.intervalMs ?? 600;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const pingStart = Date.now();
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/json,*/*",
          },
          signal: controller.signal,
        });

        const latencyMs = Date.now() - pingStart;

        if (res.status >= 200 && res.status < 400) {
          const text = await res.text().catch(() => "");
          if (
            text.includes("<html") ||
            text.includes("<body") ||
            text.includes("<div") ||
            text.includes("<main") ||
            text.trim().startsWith("{") ||
            text.trim().length > 20
          ) {
            return {
              ready: true,
              latencyMs,
              statusCode: res.status,
            };
          }
        }
      } catch {
        // Connection refused, connection reset, or proxy still spinning up
      } finally {
        clearTimeout(timer);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return {
      ready: false,
      latencyMs: Date.now() - startTime,
      error: `Service at ${url} was not ready within ${timeoutMs}ms`,
    };
  },
};
