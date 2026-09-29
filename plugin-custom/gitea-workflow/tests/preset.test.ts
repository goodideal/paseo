import { describe, it, expect } from "vitest";
import { buildGiteaWorkflowDefinition } from "../server/presets/issue-to-pr.js";

describe("buildGiteaWorkflowDefinition", () => {
  it("builds strict full_superpowers DAG with design and plan gates", () => {
    const def = buildGiteaWorkflowDefinition("full_superpowers");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).toContain("fetch-issue");
    expect(stepIds).toContain("claim-issue");
    expect(stepIds).toContain("worktree-create");
    expect(stepIds).toContain("brainstorm-agent");
    expect(stepIds).toContain("design-approval");
    expect(stepIds).toContain("spec-agent");
    expect(stepIds).toContain("spec-approval");
    expect(stepIds).toContain("plan-agent");
    expect(stepIds).toContain("plan-approval");
    expect(stepIds).toContain("implement-agent");
    expect(stepIds).toContain("verify-command");
    expect(stepIds).toContain("independent-review");
    expect(stepIds).toContain("resolve-delivery");
    expect(stepIds).toContain("delivery-approval");
    expect(stepIds).toContain("git-push");
    expect(stepIds).toContain("git-create-pr");
  });

  it("skips design gates in issue_preapproved strategy", () => {
    const def = buildGiteaWorkflowDefinition("issue_preapproved");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).not.toContain("brainstorm-agent");
    expect(stepIds).not.toContain("design-approval");
    expect(stepIds).toContain("plan-agent");
    expect(stepIds).toContain("delivery-approval");
  });

  it("skips intermediate design and plan human approval in unattended strategy", () => {
    const def = buildGiteaWorkflowDefinition("unattended");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).not.toContain("design-approval");
    expect(stepIds).not.toContain("spec-approval");
    expect(stepIds).not.toContain("plan-approval");
    // Delivery approval MUST still be present (cannot be bypassed)
    expect(stepIds).toContain("delivery-approval");
  });
});
