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
});
