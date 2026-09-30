import { describe, it, expect } from "vitest";
import {
  buildGiteaWorkflowDefinition,
  buildAutoWorkflowDefinition,
  buildPlanWorkflowDefinition,
} from "../server/presets/issue-to-pr.js";

describe("buildGiteaWorkflowDefinition (legacy)", () => {
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

describe("Gitea Workflow Presets (Auto & Plan)", () => {
  it("builds auto workflow without intermediate approval gates but with auto-design", () => {
    const def = buildAutoWorkflowDefinition();
    const ids = def.steps.map((s) => s.id);

    expect(ids).toContain("claim-issue");
    expect(ids).toContain("worktree-create");
    expect(ids).toContain("auto-design");
    expect(ids).toContain("implement-agent");
    expect(ids).toContain("verify-command");
    expect(ids).toContain("independent-review");
    expect(ids).toContain("resolve-delivery");
    expect(ids).toContain("git-push");
    expect(ids).toContain("git-create-pr");

    // No approval gates in auto mode
    expect(ids).not.toContain("gate-brainstorm");
    expect(ids).not.toContain("gate-spec");
    expect(ids).not.toContain("gate-plan");
    expect(ids).not.toContain("gate-delivery");
  });

  it("builds plan workflow with dual approval gates at each stage", () => {
    const def = buildPlanWorkflowDefinition();
    const ids = def.steps.map((s) => s.id);

    expect(ids).toContain("brainstorm-agent");
    expect(ids).toContain("gate-brainstorm");
    expect(ids).toContain("spec-agent");
    expect(ids).toContain("gate-spec");
    expect(ids).toContain("plan-agent");
    expect(ids).toContain("gate-plan");
    expect(ids).toContain("implement-agent");
    expect(ids).toContain("gate-delivery");
    expect(ids).toContain("git-create-pr");
  });
});
