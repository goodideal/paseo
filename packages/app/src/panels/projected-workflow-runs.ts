import { useMemo } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type {
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowStepAttemptStatus,
} from "@getpaseo/protocol/workflow/rpc-schemas";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";

export type ProjectedAgent = Pick<
  Agent,
  | "id"
  | "title"
  | "provider"
  | "status"
  | "workspaceId"
  | "parentAgentId"
  | "createdAt"
  | "updatedAt"
  | "archivedAt"
>;

export interface ProjectedSubagent {
  id: string;
  parentAgentId: string;
  title: string | null;
  description: string | null;
  subtitle?: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  createdAt: string; // 严格 ISO string，在录入边界统一调用 .toISOString() 或直接 string
  updatedAt?: string;
}

export interface BuildProjectedRunsInput {
  projectId: string;
  workspaceId: string;
  agents: ProjectedAgent[];
  subagentsByParentId: Map<string, ProjectedSubagent[]>;
}

export interface ProjectedWorkflowStepAttempt {
  kind: "projected";
  stepId: string;
  attempt: number;
  status: WorkflowStepAttemptStatus;
  startedAt: string | null;
  completedAt: string | null;
  skipReason: string | null;
  failureReason: string | null;
  description?: string | null;
  agentId: string;
  subagentId?: string;
}

export function isProjectedStepAttempt(step: unknown): step is ProjectedWorkflowStepAttempt {
  return (
    typeof step === "object" &&
    step !== null &&
    "kind" in step &&
    (step as { kind: unknown }).kind === "projected"
  );
}

export interface ProjectedWorkflowRunDetail extends Omit<WorkflowRunDetail, "stepAttempts"> {
  kind: "projected";
  stepAttempts: ProjectedWorkflowStepAttempt[];
}

export function isProjectedRunId(runId: string): boolean {
  return runId.startsWith("virtual:session:");
}

export function resolveRunStatus(
  leadStatus: ProjectedAgent["status"],
  subagents: ProjectedSubagent[],
): WorkflowRunSummary["status"] {
  const isAnySubagentRunning = subagents.some((s) => s.status === "running");
  if (leadStatus === "running" || leadStatus === "initializing" || isAnySubagentRunning) {
    return "running";
  }
  const isAnySubagentFailed = subagents.some((s) => s.status === "failed");
  if (leadStatus === "error" || isAnySubagentFailed) {
    return "failed";
  }
  return "succeeded";
}

export function resolveManagedSubagentStatus(
  agentStatus: ProjectedAgent["status"],
): ProjectedSubagent["status"] {
  if (agentStatus === "running" || agentStatus === "initializing") return "running";
  if (agentStatus === "error") return "failed";
  return "completed";
}

function toIsoString(value: Date | string): string {
  if (typeof value === "string") return value;
  return value.toISOString();
}

function toOptionalIsoString(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function resolveStepName(sub: ProjectedSubagent): string {
  const title = sub.title?.trim();
  if (title) return title;
  if (sub.description) {
    return sub.description.length > 50 ? `${sub.description.slice(0, 47)}...` : sub.description;
  }
  return `Sub-agent ${sub.id.slice(0, 8)}`;
}

function resolveSubagentStepStatus(status: ProjectedSubagent["status"]): WorkflowStepAttemptStatus {
  if (status === "completed") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "canceled") return "cancelled";
  return "running";
}

function buildStepAttemptsForAgent(
  agent: ProjectedAgent,
  subagents: ProjectedSubagent[],
): ProjectedWorkflowStepAttempt[] {
  const createdAtIso = toIsoString(agent.createdAt);
  const updatedAtIso = toIsoString(agent.updatedAt ?? agent.createdAt);
  const isInFlight = agent.status === "running" || agent.status === "initializing";
  let leadStepStatus: WorkflowStepAttemptStatus = "succeeded";
  if (isInFlight) {
    leadStepStatus = "running";
  } else if (agent.status === "error") {
    leadStepStatus = "failed";
  }

  const attempts: ProjectedWorkflowStepAttempt[] = [
    {
      kind: "projected",
      stepId: `Session: ${agent.title?.trim() || agent.provider}`,
      attempt: 1,
      status: leadStepStatus,
      startedAt: createdAtIso,
      completedAt: isInFlight ? null : updatedAtIso,
      skipReason: null,
      failureReason: agent.status === "error" ? "Lead agent reported an error" : null,
      description: agent.title,
      agentId: agent.id,
    },
  ];

  for (const sub of subagents) {
    const subCreatedIso = sub.createdAt;
    const subCompletedIso = sub.status !== "running" ? (sub.updatedAt ?? null) : null;
    const subStatus = resolveSubagentStepStatus(sub.status);

    attempts.push({
      kind: "projected",
      stepId: resolveStepName(sub),
      attempt: 1,
      status: subStatus,
      startedAt: subCreatedIso,
      completedAt: subCompletedIso,
      skipReason: null,
      failureReason:
        sub.status === "failed" ? sub.description || "Sub-agent execution failed" : null,
      description: sub.description,
      agentId: agent.id,
      subagentId: sub.id,
    });
  }

  return attempts;
}

export function buildProjectedWorkflowRuns(input: BuildProjectedRunsInput): {
  summaries: WorkflowRunSummary[];
  getDetail: (runId: string) => ProjectedWorkflowRunDetail | null;
} {
  const detailsMap = new Map<string, ProjectedWorkflowRunDetail>();
  const summaries: WorkflowRunSummary[] = [];

  for (const agent of input.agents) {
    if (agent.archivedAt || agent.parentAgentId) continue;

    const subagents = input.subagentsByParentId.get(agent.id) ?? [];
    const isInFlight = agent.status === "running" || agent.status === "initializing";
    if (subagents.length === 0 && !isInFlight) continue;

    const runId = `virtual:session:${agent.id}`;
    const name = agent.title?.trim() || `Agent Session (${agent.provider})`;
    const createdAtIso = toIsoString(agent.createdAt);
    const updatedAtIso = toIsoString(agent.updatedAt ?? agent.createdAt);
    const runStatus = resolveRunStatus(agent.status, subagents);
    const stepAttempts = buildStepAttemptsForAgent(agent, subagents);

    const summary: WorkflowRunSummary = {
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      runId,
      workflowId: "agent-session",
      name,
      sourcePreset: "agent-session",
      definitionRevision: "1",
      definitionHash: "virtual-session",
      status: runStatus,
      currentStepId: stepAttempts[stepAttempts.length - 1]?.stepId ?? null,
      executionRisk: "workspace_write",
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      completedAt: runStatus === "running" ? null : updatedAtIso,
      pendingInteraction: null,
    };

    const detail: ProjectedWorkflowRunDetail = {
      ...summary,
      kind: "projected",
      stepAttempts,
      interactions: [],
      deliveryApprovalManifest: null,
    };

    summaries.push(summary);
    detailsMap.set(runId, detail);
  }

  return {
    summaries,
    getDetail: (runId: string) => detailsMap.get(runId) ?? null,
  };
}

export interface UseProjectedWorkflowRunsInput {
  serverId: string;
  workspaceId: string;
  projectId: string | null;
}

const EMPTY_RUNS: WorkflowRunSummary[] = [];
const EMPTY_AGENTS: ProjectedAgent[] = [];
const EMPTY_SUBAGENTS: ProjectedSubagent[] = [];

export function useProjectedWorkflowRuns(input: UseProjectedWorkflowRunsInput): {
  projectedRuns: WorkflowRunSummary[];
  getProjectedDetail: (runId: string) => ProjectedWorkflowRunDetail | null;
} {
  const isValidProjectId = Boolean(
    input.projectId && input.projectId.trim() !== "" && input.projectId !== "default",
  );

  const supported = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.providerSubagents === true,
  );

  const workspaceAgents = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const agents = state.sessions[input.serverId]?.agents;
      if (!agents || agents.size === 0) return EMPTY_AGENTS;
      const list: ProjectedAgent[] = [];
      for (const agent of agents.values()) {
        if (agent.workspaceId === input.workspaceId) {
          list.push({
            id: agent.id,
            title: agent.title,
            provider: agent.provider,
            status: agent.status,
            workspaceId: agent.workspaceId,
            parentAgentId: agent.parentAgentId,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
            archivedAt: agent.archivedAt,
          });
        }
      }
      return list;
    },
    equal,
  );

  const providerSubagents = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => {
      if (!supported || state.descriptors.size === 0) return EMPTY_SUBAGENTS;
      const prefix = `${input.serverId}\0`;
      const list: ProjectedSubagent[] = [];
      for (const [key, desc] of state.descriptors) {
        if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
        list.push({
          id: desc.id,
          parentAgentId: desc.parentAgentId,
          title: desc.title,
          description: desc.description,
          subtitle: desc.subtitle,
          status: desc.status,
          createdAt: toIsoString(desc.createdAt),
          updatedAt: toOptionalIsoString(desc.updatedAt),
        });
      }
      return list;
    },
    equal,
  );

  return useMemo(() => {
    if (!isValidProjectId) {
      return {
        projectedRuns: EMPTY_RUNS,
        getProjectedDetail: () => null,
      };
    }

    const subagentsByParentId = new Map<string, ProjectedSubagent[]>();

    // 1. Collect Provider Subagents
    for (const sub of providerSubagents) {
      const list = subagentsByParentId.get(sub.parentAgentId) ?? [];
      list.push(sub);
      subagentsByParentId.set(sub.parentAgentId, list);
    }

    // 2. Collect Managed Child Agents belonging to this workspace
    for (const agent of workspaceAgents) {
      if (agent.parentAgentId && !agent.archivedAt) {
        const list = subagentsByParentId.get(agent.parentAgentId) ?? [];
        list.push({
          id: agent.id,
          parentAgentId: agent.parentAgentId,
          title: agent.title,
          description: null,
          subtitle: agent.provider,
          status: resolveManagedSubagentStatus(agent.status),
          createdAt: toIsoString(agent.createdAt),
          updatedAt: toOptionalIsoString(agent.updatedAt),
        });
        subagentsByParentId.set(agent.parentAgentId, list);
      }
    }

    // Sort subagents by createdAt
    for (const list of subagentsByParentId.values()) {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    const { summaries, getDetail } = buildProjectedWorkflowRuns({
      projectId: input.projectId as string,
      workspaceId: input.workspaceId,
      agents: workspaceAgents,
      subagentsByParentId,
    });

    return {
      projectedRuns: summaries,
      getProjectedDetail: getDetail,
    };
  }, [isValidProjectId, providerSubagents, workspaceAgents, input.projectId, input.workspaceId]);
}
