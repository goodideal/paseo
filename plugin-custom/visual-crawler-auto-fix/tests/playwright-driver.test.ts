import { describe, expect, it, afterEach } from "vitest";
import { PlaywrightBrowserDriver } from "../server/engine/playwright-driver.js";

describe("PlaywrightBrowserDriver", () => {
  let driver: PlaywrightBrowserDriver | null = null;

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = null;
    }
  });

  it("extracts DOM fingerprint and title from page", async () => {
    driver = new PlaywrightBrowserDriver();
    await driver.init();

    // Use a lightweight inline data URL
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <header class="navbar"><h1>Site Title</h1></header>
          <main>
            <a href="https://example.com/about" class="nav-link">About</a>
            <button class="submit-btn">Click me</button>
          </main>
        </body>
      </html>
    `;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    const res = await driver.navigate(dataUrl);

    expect(res.title).toBe("Test Page");
    expect(res.domFingerprint).toBeTruthy();

    const elements = await driver.getInteractiveElements();
    expect(elements.some((el) => el.tag === "button" && el.text === "Click me")).toBe(true);
    expect(elements.some((el) => el.tag === "a" && el.href === "https://example.com/about")).toBe(
      true,
    );
  });

  it("captures runtime console errors and page errors", async () => {
    driver = new PlaywrightBrowserDriver();
    await driver.init();

    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Error Page</title></head>
        <body>
          <script>
            console.error("Custom test console error");
            setTimeout(() => { throw new Error("Unhandled test exception"); }, 10);
          </script>
        </body>
      </html>
    `;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await driver.navigate(dataUrl);

    // Give page script a brief moment to throw
    await new Promise((r) => setTimeout(r, 100));

    const logs = await driver.getConsoleLogs();
    expect(logs.some((l) => l.text.includes("Custom test console error"))).toBe(true);
    expect(logs.some((l) => l.text.includes("Unhandled test exception"))).toBe(true);
  });

  it("captures real screenshot file on disk", async () => {
    driver = new PlaywrightBrowserDriver({ screenshotDir: "/tmp/crawler-test-screenshots" });
    await driver.init();

    const html = `<html><body><h1 style="color: red;">Screenshot Test</h1></body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await driver.navigate(dataUrl);

    const screenshotPath = await driver.captureScreenshot();
    expect(screenshotPath).toContain("/tmp/crawler-test-screenshots");
    expect(screenshotPath.endsWith(".png")).toBe(true);
  });

  it("does not report intentional ellipsis or icon spans as clipped defects", async () => {
    driver = new PlaywrightBrowserDriver();
    await driver.init();

    const html = `
      <html><body>
        <span style="display:block;width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="Long visible label">This intentionally long label is safely truncated</span>
        <span aria-hidden="true" style="display:block;width:10px;overflow:hidden">••••</span>
      </body></html>
    `;
    await driver.navigate(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    expect(await driver.checkVisualAnomalies()).toEqual([]);
  });

  it("reports visible, materially clipped user-facing text without an accessible fallback", async () => {
    driver = new PlaywrightBrowserDriver();
    await driver.init();

    const html = `
      <html><body>
        <p style="display:block;width:80px;white-space:nowrap;overflow:hidden">This is a long, user facing critical status message</p>
      </body></html>
    `;
    await driver.navigate(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const anomalies = await driver.checkVisualAnomalies();
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({ selector: "p", reason: "clipped" });
  });
});
