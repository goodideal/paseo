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
});
