import { describe, expect, it } from "vitest";
import {
  interpolatePrompt,
  type PromptInterpolationContext,
} from "../server/prompt-interpolator.js";

describe("interpolatePrompt", () => {
  const sampleContext: PromptInterpolationContext = {
    issueNumber: 42,
    issueTitle: "fix(auth): handle token refresh error",
    issueBody: "When token expires, request fails with 401 instead of refreshing.",
    repoOwner: "acme-corp",
    repoName: "payment-gateway",
    branchName: "agent/issue-42-fix-auth",
    projectId: "proj-web",
  };

  it("returns empty string when template is empty or falsy", () => {
    expect(interpolatePrompt("", sampleContext)).toBe("");
    expect(interpolatePrompt(null as any, sampleContext)).toBe("");
  });

  it("replaces all recognized variables accurately", () => {
    const template = [
      "Task for Issue #{{issueNumber}}: {{issueTitle}}",
      "Repo: {{repoOwner}}/{{repoName}}",
      "Branch: {{branchName}}",
      "Project: {{projectId}}",
      "Body: {{issueBody}}",
    ].join("\n");

    const result = interpolatePrompt(template, sampleContext);

    expect(result).toBe(
      [
        "Task for Issue #42: fix(auth): handle token refresh error",
        "Repo: acme-corp/payment-gateway",
        "Branch: agent/issue-42-fix-auth",
        "Project: proj-web",
        "Body: When token expires, request fails with 401 instead of refreshing.",
      ].join("\n"),
    );
  });

  it("supports whitespace inside placeholders like {{ issueNumber }}", () => {
    const template = "Resolves #{{  issueNumber  }} - {{ issueTitle }}";
    const result = interpolatePrompt(template, sampleContext);
    expect(result).toBe("Resolves #42 - fix(auth): handle token refresh error");
  });

  it("preserves unrecognized placeholders safely without throwing", () => {
    const template = "Hello {{unknownPlaceholder}}, Issue #{{issueNumber}}!";
    const result = interpolatePrompt(template, sampleContext);
    expect(result).toBe("Hello {{unknownPlaceholder}}, Issue #42!");
  });

  it("handles missing optional context fields cleanly with empty string", () => {
    const partialContext: PromptInterpolationContext = {
      issueNumber: 99,
      issueTitle: "Simple title",
      issueBody: "",
      repoOwner: "org",
      repoName: "repo",
    };
    const template = "Issue #{{issueNumber}}: Branch {{branchName}}";
    const result = interpolatePrompt(template, partialContext);
    expect(result).toBe("Issue #99: Branch ");
  });
});
