import { describe, it, expect } from "vitest";
import {
  buildDirectPrWorkflowDefinition,
  buildGiteaWorkflowDefinition,
  buildAutoWorkflowDefinition,
  buildPlanWorkflowDefinition,
  giteaWorkflowPresets,
} from "../server/presets/issue-to-pr.js";

describe("Gitea 2-Track Matt Pocock Workflow Presets", () => {
  it("builds 0-gate direct_pr workflow definition as default", () => {
    const def = buildGiteaWorkflowDefinition("direct_pr");
    expect(def.id).toBe("gitea.issue-to-pr");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).toEqual([
      "fetch-issue",
      "claim-issue",
      "worktree-create",
      "implement-agent",
      "independent-review",
      "deliver-pr",
    ]);

    const approvalSteps = def.steps.filter((s) => s.type === "approval.wait");
    expect(approvalSteps).toHaveLength(0);

    const implementStep = def.steps.find((s) => s.id === "implement-agent");
    expect(implementStep?.type).toBe("gitea.agent_execute");
    expect(implementStep?.input).toEqual({
      phase: "auto_design",
      timeoutMs: 45 * 60 * 1000,
    });

    const reviewStep = def.steps.find((s) => s.id === "independent-review");
    expect(reviewStep?.type).toBe("gitea.quality_gate");
    expect(reviewStep?.timeoutMs).toBe(45 * 60 * 1000);

    const deliverStep = def.steps.find((s) => s.id === "deliver-pr");
    expect(deliverStep?.type).toBe("gitea.deliver_pr");
    expect(deliverStep?.timeoutMs).toBe(120_000);
  });

  it("builds auto workflow definition matching direct_pr track", () => {
    const def = buildAutoWorkflowDefinition();
    expect(def.id).toBe("gitea.issue-to-pr.auto");
    expect(def.steps.map((s) => s.id)).toEqual(
      buildDirectPrWorkflowDefinition("gitea.issue-to-pr.auto").steps.map((s) => s.id),
    );
    expect(def.steps.filter((s) => s.type === "approval.wait")).toHaveLength(0);
  });

  it("builds 1-gate grill_plan workflow definition with single gate-plan confirmation", () => {
    const def = buildPlanWorkflowDefinition();
    expect(def.id).toBe("gitea.issue-to-pr.plan");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).toEqual([
      "fetch-issue",
      "claim-issue",
      "worktree-create",
      "plan-agent",
      "gate-plan",
      "implement-agent",
      "independent-review",
      "deliver-pr",
    ]);

    // Exactly 1 approval.wait step (gate-plan)
    const approvalSteps = def.steps.filter((s) => s.type === "approval.wait");
    expect(approvalSteps).toHaveLength(1);
    expect(approvalSteps[0]?.id).toBe("gate-plan");
    expect(approvalSteps[0]?.approval).toBe("required");
    expect(approvalSteps[0]?.timeoutMs).toBe(60 * 60 * 1000);
    expect(approvalSteps[0]?.input).toEqual({
      phase: "plan",
      reason: "Grilling design & implementation plan requires confirmation",
    });

    expect(stepIds).not.toContain("brainstorm-agent");
    expect(stepIds).not.toContain("spec-agent");
    expect(stepIds).not.toContain("gate-delivery");
    expect(stepIds).not.toContain("delivery-approval");
  });

  it("maps legacy strategies cleanly to 0-gate direct_pr or 1-gate grill_plan tracks", () => {
    const unattended = buildGiteaWorkflowDefinition("unattended");
    expect(unattended.id).toBe("gitea.issue-to-pr.unattended");
    expect(unattended.steps.filter((s) => s.type === "approval.wait")).toHaveLength(0);

    const preapproved = buildGiteaWorkflowDefinition("issue_preapproved");
    expect(preapproved.id).toBe("gitea.issue-to-pr.preapproved");
    expect(preapproved.steps.filter((s) => s.type === "approval.wait")).toHaveLength(1);
    expect(preapproved.steps.find((s) => s.type === "approval.wait")?.id).toBe("gate-plan");

    const legacySuperpowers = buildGiteaWorkflowDefinition("full_superpowers");
    expect(legacySuperpowers.id).toBe("gitea.issue-to-pr.legacy-superpowers");
    expect(legacySuperpowers.steps.filter((s) => s.type === "approval.wait")).toHaveLength(1);
    expect(legacySuperpowers.steps.find((s) => s.type === "approval.wait")?.id).toBe("gate-plan");
  });

  it("exports preset catalog without Superpowers branding", () => {
    for (const preset of giteaWorkflowPresets) {
      expect(preset.name).not.toContain("Superpowers");
    }
    const presetIds = giteaWorkflowPresets.map((p) => p.workflowId);
    expect(presetIds).toContain("gitea.issue-to-pr");
    expect(presetIds).toContain("gitea.issue-to-pr.auto");
    expect(presetIds).toContain("gitea.issue-to-pr.plan");
    expect(presetIds).toContain("gitea.issue-to-pr.preapproved");
    expect(presetIds).toContain("gitea.issue-to-pr.unattended");
    expect(presetIds).toContain("gitea.issue-to-pr.legacy-superpowers");
  });
});
