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
}

/**
 * Sort workflow runs by operational urgency (waiting approval, failed, running, then terminal/other)
 * and newest creation timestamp first within the same priority bucket.
 */
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
