/* eslint-disable react-perf/jsx-no-new-object-as-prop */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowApproval,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "@getpaseo/protocol/workflow/rpc-schemas";
import { useWorkflowRuns, type WorkflowEngineClient } from "./workflow-runs-panel";

const scope = { projectId: "p1", workspaceId: "ws-1" };

function TestComponent({ client }: { client: WorkflowEngineClient | null }) {
  const model = useWorkflowRuns(client, scope);
  const select = useCallback(() => model.setSelectedRunId("2"), [model]);
  const cancel = useCallback(() => void model.cancelRun("2"), [model]);
  const approve = useCallback(() => void model.approveRun("2", "appr-1"), [model]);
  const retry = useCallback(() => void model.retryRun("2", "verify"), [model]);
  return (
    <div>
      <div data-testid="runs-count">{model.runs?.length ?? "null"}</div>
      <div data-testid="first-run-id">{model.runs?.[0]?.runId ?? "none"}</div>
      <div data-testid="first-run-status">{model.runs?.[0]?.status ?? "none"}</div>
      <div data-testid="detail-status">{model.detail?.status ?? "null"}</div>
      <div data-testid="detail-steps-count">{model.detail?.stepAttempts.length ?? 0}</div>
      <div data-testid="action-success">{model.actionSuccess ?? "none"}</div>
      <div data-testid="action-error">{model.actionError ?? "none"}</div>
      <button type="button" data-testid="select" onClick={select}>
        Select
      </button>
      <button type="button" data-testid="cancel" onClick={cancel}>
        Cancel
      </button>
      <button type="button" data-testid="approve" onClick={approve}>
        Approve
      </button>
      <button type="button" data-testid="retry" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

const runRunning: WorkflowRunSummary = {
  projectId: "p1",
  workspaceId: "ws-1",
  runId: "run-running",
  workflowId: "wf-1",
  name: "Running",
  sourcePreset: "default",
  definitionRevision: "1",
  definitionHash: "hash-1",
  status: "running",
  currentStepId: "step-1",
  executionRisk: "observe",
  createdAt: "2026-09-25T01:00:00Z",
  updatedAt: "2026-09-25T01:00:00Z",
  completedAt: null,
};
const runAwaiting: WorkflowRunSummary = {
  ...runRunning,
  runId: "run-awaiting",
  name: "Awaiting",
  status: "waiting_approval",
  executionRisk: "external_side_effect",
  createdAt: "2026-09-25T00:00:00Z",
};
const runFailed: WorkflowRunSummary = {
  ...runRunning,
  runId: "run-failed",
  name: "Failed",
  status: "failed",
  executionRisk: "workspace_write",
  createdAt: "2026-09-25T00:30:00Z",
};
const mockRuns = [runRunning, runAwaiting, runFailed];
const mockDetail: WorkflowRunDetail = {
  ...runAwaiting,
  stepAttempts: [
    {
      stepId: "worktree",
      attempt: 1,
      status: "succeeded",
      startedAt: null,
      completedAt: null,
      skipReason: null,
      failureReason: null,
    },
    {
      stepId: "verify",
      attempt: 1,
      status: "failed",
      startedAt: null,
      completedAt: null,
      skipReason: null,
      failureReason: "failed",
    },
    {
      stepId: "ship",
      attempt: 1,
      status: "waiting_approval",
      startedAt: null,
      completedAt: null,
      skipReason: null,
      failureReason: null,
    },
  ],
};
const approval: WorkflowApproval = {
  projectId: "p1",
  workspaceId: "ws-1",
  approvalId: "appr-1",
  runId: "2",
  stepId: "ship",
  status: "pending",
  action: "git.create_pr",
  target: "origin/main",
  policyReason: "External write",
  createdAt: "2026-09-25T00:00:00Z",
  decidedAt: null,
  reason: null,
};

function createClient(overrides: Partial<WorkflowEngineClient> = {}): WorkflowEngineClient {
  return {
    workflowRunList: vi
      .fn()
      .mockResolvedValue({ ...scope, requestId: "list", runId: null, runs: mockRuns, error: null }),
    workflowRunInspect: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "inspect",
      runId: "2",
      run: mockDetail,
      error: null,
    }),
    workflowRunCancel: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "cancel",
      runId: "2",
      run: mockDetail,
      error: null,
    }),
    workflowApprovalList: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "approvals",
      runId: "2",
      approvals: [approval],
      error: null,
    }),
    workflowApprovalApprove: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "approve",
      runId: "2",
      approval,
      run: mockDetail,
      error: null,
    }),
    workflowApprovalDeny: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "deny",
      runId: "2",
      approval,
      run: mockDetail,
      error: null,
    }),
    workflowRunRetry: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "retry",
      runId: "2",
      run: mockDetail,
      error: null,
    }),
    workflowRunResume: vi.fn().mockResolvedValue({
      ...scope,
      requestId: "resume",
      runId: "2",
      run: mockDetail,
      error: null,
    }),
    ...overrides,
  };
}

describe("useWorkflowRuns", () => {
  it("uses the real scoped client contract and pins actionable runs", async () => {
    const client = createClient();
    render(<TestComponent client={client} />);
    await screen.findByText("3", { selector: '[data-testid="runs-count"]' });
    expect(client.workflowRunList).toHaveBeenCalledWith(scope);
    expect(screen.getByTestId("first-run-id").textContent).toBe("run-awaiting");
  });

  it("loads detail and real approval ids", async () => {
    const client = createClient();
    render(<TestComponent client={client} />);
    await screen.findByText("3", { selector: '[data-testid="runs-count"]' });
    fireEvent.click(screen.getByTestId("select"));
    await screen.findByText("waiting_approval", { selector: '[data-testid="detail-status"]' });
    expect(client.workflowRunInspect).toHaveBeenCalledWith({ ...scope, runId: "2" });
    expect(client.workflowApprovalList).toHaveBeenCalledWith({ ...scope, runId: "2" });
    await act(async () => fireEvent.click(screen.getByTestId("approve")));
    expect(client.workflowApprovalApprove).toHaveBeenCalledWith({
      ...scope,
      runId: "2",
      approvalId: "appr-1",
    });
  });

  it("surfaces resolved RPC business errors instead of reporting success", async () => {
    const client = createClient({
      workflowRunCancel: vi.fn().mockResolvedValue({
        ...scope,
        requestId: "cancel",
        runId: "2",
        run: null,
        error: "Run is already terminal",
      }),
    });
    render(<TestComponent client={client} />);
    await screen.findByText("3", { selector: '[data-testid="runs-count"]' });
    await act(async () => fireEvent.click(screen.getByTestId("cancel")));
    expect(screen.getByTestId("action-error").textContent).toBe("Run is already terminal");
    expect(screen.getByTestId("action-success").textContent).toBe("none");
  });
});

afterEach(cleanup);
