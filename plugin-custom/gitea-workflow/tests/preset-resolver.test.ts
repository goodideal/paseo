import { describe, it, expect } from "vitest";
import { resolveIssueWorkflowPreset } from "../server/preset-resolver.js";

describe("resolveIssueWorkflowPreset", () => {
  it("resolves agent-auto to auto preset", () => {
    const res = resolveIssueWorkflowPreset([{ name: "bug" }, { name: "agent-auto" }]);
    expect(res).toEqual({
      presetId: "gitea.issue-to-pr.auto",
      mode: "auto",
      conflictWarning: false,
      matchedTriggerLabel: "agent-auto",
    });
  });

  it("resolves agent:plan to plan preset with case insensitivity", () => {
    const res = resolveIssueWorkflowPreset([{ name: "AGENT:PLAN" }]);
    expect(res).toEqual({
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: false,
      matchedTriggerLabel: "AGENT:PLAN",
    });
  });

  it("safely demotes to plan preset when both auto and plan tags coexist", () => {
    const res = resolveIssueWorkflowPreset([{ name: "agent-auto" }, { name: "agent-plan" }]);
    expect(res).toEqual({
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: true,
      matchedTriggerLabel: "agent-plan",
    });
  });

  it("returns null when no trigger tags are present", () => {
    const res = resolveIssueWorkflowPreset([{ name: "agent-ready" }, { name: "feature" }]);
    expect(res).toBeNull();
  });
});
