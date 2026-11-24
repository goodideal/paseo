import type { PluginWorkflowPreset } from "../../shared/workflow-types.js";
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

export function buildDirectPrWorkflowDefinition(workflowId = "gitea.issue-to-pr") {
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
    {
      id: "implement-agent",
      type: "gitea.agent_execute",
      dependsOn: ["worktree-create"],
      input: { phase: "auto_design", timeoutMs: 45 * 60 * 1000 },
      timeoutMs: 45 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "independent-review",
      type: "gitea.quality_gate",
      dependsOn: ["implement-agent"],
      timeoutMs: 45 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "deliver-pr",
      type: "gitea.deliver_pr",
      dependsOn: ["independent-review"],
      timeoutMs: 120_000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
  ];

  return {
    id: workflowId,
    revision: "2",
    maxConcurrency: 1,
    maxArtifactBytes: 10 * 1024 * 1024,
    steps,
  };
}

export function buildAutoWorkflowDefinition() {
  return buildDirectPrWorkflowDefinition("gitea.issue-to-pr.auto");
}

export function buildPlanWorkflowDefinition(workflowId = "gitea.issue-to-pr.plan") {
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
    {
      id: "plan-agent",
      type: "gitea.agent_execute",
      dependsOn: ["worktree-create"],
      input: { phase: "plan", timeoutMs: 30 * 60 * 1000 },
      timeoutMs: 30 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "gate-plan",
      type: "approval.wait",
      dependsOn: ["plan-agent"],
      input: {
        phase: "plan",
        reason: "Grilling design & implementation plan requires confirmation",
      },
      timeoutMs: 60 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "required",
    },
    {
      id: "implement-agent",
      type: "gitea.agent_execute",
      dependsOn: ["gate-plan"],
      input: { phase: "implement", timeoutMs: 60 * 60 * 1000 },
      timeoutMs: 60 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "independent-review",
      type: "gitea.quality_gate",
      dependsOn: ["implement-agent"],
      timeoutMs: 45 * 60 * 1000,
      retries: 0,
      concurrency: 1,
      approval: "automatic",
    },
    {
      id: "deliver-pr",
      type: "gitea.deliver_pr",
      dependsOn: ["independent-review"],
      timeoutMs: 120_000,
      retries: 1,
      concurrency: 1,
      approval: "automatic",
    },
  ];

  return {
    id: workflowId,
    revision: "2",
    maxConcurrency: 1,
    maxArtifactBytes: 10 * 1024 * 1024,
    steps,
  };
}

export function buildGiteaWorkflowDefinition(strategy: GiteaWorkflowPolicy = "direct_pr") {
  switch (strategy) {
    case "direct_pr":
      return buildDirectPrWorkflowDefinition("gitea.issue-to-pr");
    case "unattended":
      return buildDirectPrWorkflowDefinition("gitea.issue-to-pr.unattended");
    case "grill_plan":
      return buildPlanWorkflowDefinition("gitea.issue-to-pr.plan");
    case "issue_preapproved":
      return buildPlanWorkflowDefinition("gitea.issue-to-pr.preapproved");
    case "full_superpowers":
      return buildPlanWorkflowDefinition("gitea.issue-to-pr.legacy-superpowers");
    default:
      return buildDirectPrWorkflowDefinition("gitea.issue-to-pr");
  }
}

export const giteaWorkflowPresets: PluginWorkflowPreset[] = [
  {
    workflowId: "gitea.issue-to-pr",
    name: "Gitea Issue-to-PR Pipeline (Direct PR)",
    sourcePreset: "gitea-workflow",
    definition: buildGiteaWorkflowDefinition("direct_pr"),
  },
  {
    workflowId: "gitea.issue-to-pr.auto",
    name: "Gitea Issue-to-PR Pipeline (Auto)",
    sourcePreset: "gitea-workflow",
    definition: buildAutoWorkflowDefinition(),
  },
  {
    workflowId: "gitea.issue-to-pr.plan",
    name: "Gitea Issue-to-PR Pipeline (Grill & Plan)",
    sourcePreset: "gitea-workflow",
    definition: buildGiteaWorkflowDefinition("grill_plan"),
  },
  {
    workflowId: "gitea.issue-to-pr.preapproved",
    name: "Gitea Issue-to-PR Pipeline (Preapproved)",
    sourcePreset: "gitea-workflow",
    definition: buildGiteaWorkflowDefinition("issue_preapproved"),
  },
  {
    workflowId: "gitea.issue-to-pr.unattended",
    name: "Gitea Issue-to-PR Pipeline (Unattended)",
    sourcePreset: "gitea-workflow",
    definition: buildGiteaWorkflowDefinition("unattended"),
  },
  {
    workflowId: "gitea.issue-to-pr.legacy-superpowers",
    name: "Gitea Issue-to-PR Pipeline (Legacy Plan)",
    sourcePreset: "gitea-workflow",
    definition: buildGiteaWorkflowDefinition("full_superpowers"),
  },
];

export const issueToPrPreset: PluginWorkflowPreset = giteaWorkflowPresets[0]!;
