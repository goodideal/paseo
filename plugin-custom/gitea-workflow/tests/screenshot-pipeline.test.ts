import { describe, expect, it } from "vitest";
import { ScreenshotPipeline } from "../server/screenshot-pipeline.js";

describe("ScreenshotPipeline", () => {
  it("generates deterministic service proxy URL according to Paseo conventions", () => {
    const url = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: "agent/issue-42-ui",
      projectName: "web-app",
    });

    expect(url).toBe("http://dev--agent-issue-42-ui--web-app.localhost");
  });

  it("handles main/master branch by omitting branch segment", () => {
    const url = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: "main",
      projectName: "web-app",
    });

    expect(url).toBe("http://dev--web-app.localhost");
  });

  it("captures viewports and returns metadata with base64 dataUri", async () => {
    const executedCommands: string[] = [];
    const mockBroker = {
      execute: async (cmd: { command: string; args?: Record<string, unknown> }) => {
        executedCommands.push(cmd.command);
        if (cmd.command === "new_tab") {
          return { ok: true, result: { browserId: "b-1" } };
        }
        if (cmd.command === "screenshot") {
          return { ok: true, result: { base64: "aGVsbG8=" } };
        }
        return { ok: true, result: {} };
      },
    };

    const results = await ScreenshotPipeline.captureViewports({
      broker: mockBroker,
      url: "http://localhost:3000",
      outputDir: "/tmp/screenshots-test",
    });

    expect(results).toHaveLength(2);
    expect(results[0].dataUri).toBe("data:image/png;base64,aGVsbG8=");
    expect(results[1].dataUri).toBe("data:image/png;base64,aGVsbG8=");
    expect(executedCommands).toContain("new_tab");
    expect(executedCommands).toContain("resize");
    expect(executedCommands).toContain("screenshot");
    expect(executedCommands).toContain("close_tab");
  });
});
