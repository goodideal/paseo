import type { PluginAgentSnapshot } from "@getpaseo/plugin";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export interface WorkflowRunItemSummary {
  runId: string;
  name: string;
  status: WorkflowRunStatus;
  createdAt: string;
  isProjected?: boolean;
}

export interface WorkflowStepItem {
  stepId: string;
  attempt: number;
  status: string;
  failureReason: string | null;
  skipReason: string | null;
  description?: string | null;
  agentId?: string;
  isSubagent?: boolean;
  isProjected?: boolean;
}

export interface WorkflowRunItemDetail {
  runId: string;
  name: string;
  status: WorkflowRunStatus;
  pendingInteraction?: {
    id: string;
    status?: string;
    question?: string | null;
  } | null;
  stepAttempts: WorkflowStepItem[];
  isProjected?: boolean;
}

export function isProjectedRunId(runId: string): boolean {
  return runId.startsWith("virtual:session:");
}

export function sortWorkflowRuns(
  runs: readonly WorkflowRunItemSummary[],
): WorkflowRunItemSummary[] {
  const priority = (status: string) => {
    if (status === "waiting_approval") return 0;
    if (status === "failed") return 1;
    if (status === "running") return 2;
    return 3;
  };
  return [...runs].sort((a, b) => {
    const diff = priority(a.status) - priority(b.status);
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function mapAgentStatusToStep(status: PluginAgentSnapshot["status"]): string {
  if (status === "running" || status === "initializing") return "running";
  if (status === "error") return "failed";
  return "succeeded";
}

export function buildProjectedWorkflowRuns(agents: readonly PluginAgentSnapshot[]): {
  summaries: WorkflowRunItemSummary[];
  details: Map<string, WorkflowRunItemDetail>;
} {
  const rootAgents = agents.filter((a) => !a.parentAgentId);
  const subsByParent = new Map<string, PluginAgentSnapshot[]>();
  for (const agent of agents) {
    if (!agent.parentAgentId) continue;
    let list = subsByParent.get(agent.parentAgentId);
    if (!list) {
      list = [];
      subsByParent.set(agent.parentAgentId, list);
    }
    list.push(agent);
  }

  const summaries: WorkflowRunItemSummary[] = [];
  const details = new Map<string, WorkflowRunItemDetail>();

  for (const lead of rootAgents) {
    const subs = subsByParent.get(lead.id) ?? [];
    const anyRunning =
      lead.status === "running" ||
      lead.status === "initializing" ||
      subs.some((s) => s.status === "running" || s.status === "initializing");
    const anyFailed = lead.status === "error" || subs.some((s) => s.status === "error");

    const status: WorkflowRunStatus = anyRunning ? "running" : anyFailed ? "failed" : "succeeded";

    const runId = `virtual:session:${lead.id}`;
    const name = lead.title?.trim() || `${lead.provider} session`;

    summaries.push({
      runId,
      name,
      status,
      createdAt: lead.createdAt,
      isProjected: true,
    });

    const stepAttempts: WorkflowStepItem[] = [
      {
        stepId: `Session: ${name}`,
        attempt: 1,
        status: mapAgentStatusToStep(lead.status),
        failureReason: lead.status === "error" ? "Lead agent reported an error" : null,
        skipReason: null,
        description: lead.title,
        agentId: lead.id,
        isProjected: true,
      },
      ...subs.map((sub) => ({
        stepId: sub.title?.trim() || `Sub-agent ${sub.id.slice(0, 8)}`,
        attempt: 1,
        status: mapAgentStatusToStep(sub.status),
        failureReason: sub.status === "error" ? "Sub-agent failed" : null,
        skipReason: null,
        description: sub.title,
        agentId: sub.id,
        isSubagent: true,
        isProjected: true,
      })),
    ];

    details.set(runId, {
      runId,
      name,
      status,
      stepAttempts,
      isProjected: true,
    });
  }

  return { summaries, details };
}
