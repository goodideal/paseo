import type { PluginWorkflowPreset } from "@getpaseo/plugin/server";
import type { GiteaWorkflowPolicy } from "../../shared/types.js";

interface StepDefinition {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  timeoutMs: number;
  retries: number;
  concurrency: number;
  approval: "required" | "automatic";
}

export function buildGiteaWorkflowDefinition(strategy: GiteaWorkflowPolicy = "full_superpowers") {
  const steps: StepDefinition[] = [
    {
      id: "fetch-issue",
      type: "gitea.fetch_issue",
      timeoutMs: 30_000,
      retries: 2,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "claim-issue",
      type: "gitea.claim_issue",
      dependsOn: ["fetch-issue"],
      timeoutMs: 30_000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "worktree-create",
      type: "worktree.create",
      dependsOn: ["claim-issue"],
      timeoutMs: 60_000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
  ];

  if (strategy === "full_superpowers") {
    steps.push(
      {
        id: "brainstorm-agent",
        type: "agent.run_until_complete",
        dependsOn: ["worktree-create"],
        timeoutMs: 30 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "design-approval",
        type: "approval.wait",
        dependsOn: ["brainstorm-agent"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "required",
      },
      {
        id: "spec-agent",
        type: "agent.continue_until_complete",
        dependsOn: ["design-approval"],
        timeoutMs: 30 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "spec-approval",
        type: "approval.wait",
        dependsOn: ["spec-agent"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "required",
      },
      {
        id: "plan-agent",
        type: "agent.continue_until_complete",
        dependsOn: ["spec-approval"],
        timeoutMs: 30 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "plan-approval",
        type: "approval.wait",
        dependsOn: ["plan-agent"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "required",
      },
      {
        id: "implement-agent",
        type: "agent.continue_until_complete",
        dependsOn: ["plan-approval"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
    );
  } else if (strategy === "issue_preapproved") {
    steps.push(
      {
        id: "plan-agent",
        type: "agent.run_until_complete",
        dependsOn: ["worktree-create"],
        timeoutMs: 30 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "plan-approval",
        type: "approval.wait",
        dependsOn: ["plan-agent"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "required",
      },
      {
        id: "implement-agent",
        type: "agent.continue_until_complete",
        dependsOn: ["plan-approval"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
    );
  } else {
    // unattended strategy: proceed without intermediate approval pauses
    steps.push(
      {
        id: "plan-agent",
        type: "agent.run_until_complete",
        dependsOn: ["worktree-create"],
        timeoutMs: 30 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
      {
        id: "implement-agent",
        type: "agent.continue_until_complete",
        dependsOn: ["plan-agent"],
        timeoutMs: 60 * 60 * 1000,
        retries: 0,
        concurrency: 1,
        approval: "automatic",
      },
    );
  }

  // Final verification, independent review, manifest gate and delivery
  steps.push(
    {
      id: "verify-command",
      type: "verify.command",
      dependsOn: ["implement-agent"],
      timeoutMs: 15 * 60 * 1000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "independent-review",
      type: "agent.run_until_complete",
      dependsOn: ["verify-command"],
      timeoutMs: 30 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "resolve-delivery",
      type: "gitea.resolve_delivery",
      dependsOn: ["independent-review"],
      timeoutMs: 30_000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "delivery-approval",
      type: "approval.wait",
      dependsOn: ["resolve-delivery"],
      timeoutMs: 60 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "required",
    },
    {
      id: "git-push",
      type: "git.push",
      dependsOn: ["delivery-approval"],
      timeoutMs: 60_000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "git-create-pr",
      type: "git.create_pr",
      dependsOn: ["git-push"],
      timeoutMs: 60_000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
  );

  return {
    id: "gitea.issue-to-pr",
    revision: "1",
    maxConcurrency: 1,
    maxArtifactBytes: 10 * 1024 * 1024,
    steps,
  };
}

export const issueToPrPreset: PluginWorkflowPreset = {
  workflowId: "gitea.issue-to-pr",
  name: "Gitea Superpowers Issue-to-PR Pipeline",
  sourcePreset: "gitea-workflow",
  definition: buildGiteaWorkflowDefinition("full_superpowers"),
};
