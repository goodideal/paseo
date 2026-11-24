import { describe, expect, it, vi } from "vitest";
import contributeClient from "../../index.client.js";
import { sortWorkflowRuns, type WorkflowStepItem } from "../../client/run-list-model.js";
import type { PluginClientContext } from "@getpaseo/plugin/client";

describe("Gitea Workflow Embedded DAG Runs", () => {
  it("preserves optional agentId, summary, and harness fields on WorkflowStepItem", () => {
    const step: WorkflowStepItem = {
      stepId: "independent-review",
      attempt: 1,
      status: "succeeded",
      failureReason: null,
      skipReason: null,
      agentId: "agent-123",
      summary: "All checks passed",
      harness: {
        enabled: true,
        mode: "auto",
        role: "review",
        tier: "review",
        phase: "review",
        provider: "antigravity",
        model: "gemini-4-carbon",
        lazyToolSlice: "review.yaml",
      },
    };
    expect(step.harness?.role).toBe("review");
    expect(step.harness?.lazyToolSlice).toBe("review.yaml");
    expect(step.summary).toBe("All checks passed");
  });

  it("sorts workflow run summaries by urgency and newest creation time", () => {
    const sorted = sortWorkflowRuns([
      {
        runId: "r_done_old",
        name: "Done Old",
        status: "succeeded",
        createdAt: "2026-11-12T01:00:00.000Z",
      },
      {
        runId: "r_run",
        name: "Running",
        status: "running",
        createdAt: "2026-11-12T01:30:00.000Z",
      },
      {
        runId: "r_done_new",
        name: "Done New",
        status: "succeeded",
        createdAt: "2026-11-12T02:00:00.000Z",
      },
      {
        runId: "r_fail",
        name: "Failed",
        status: "failed",
        createdAt: "2026-11-12T00:30:00.000Z",
      },
      {
        runId: "r_gate",
        name: "Gate",
        status: "waiting_approval",
        createdAt: "2026-11-12T00:00:00.000Z",
      },
    ]);

    expect(sorted.map((r) => r.runId)).toEqual([
      "r_gate",
      "r_fail",
      "r_run",
      "r_done_new",
      "r_done_old",
    ]);
  });

  it("registers unified workspace panel, command center item, and settings screen cleanly", () => {
    const panelRemove = vi.fn();
    const cmdRemove = vi.fn();
    const settingsRemove = vi.fn();

    const client: Partial<PluginClientContext> = {
      addWorkspacePanel: vi.fn(
        () => panelRemove,
      ) as unknown as PluginClientContext["addWorkspacePanel"],
      addCommandCenterItem: vi.fn(
        () => cmdRemove,
      ) as unknown as PluginClientContext["addCommandCenterItem"],
      addSettingsScreen: vi.fn(
        () => settingsRemove,
      ) as unknown as PluginClientContext["addSettingsScreen"],
    };

    const cleanup = contributeClient(client as PluginClientContext);
    expect(cleanup).toBeDefined();
    expect(client.addWorkspacePanel).toHaveBeenCalledTimes(1);
    expect(client.addCommandCenterItem).toHaveBeenCalledTimes(1);
    expect(client.addSettingsScreen).toHaveBeenCalledTimes(1);

    cleanup?.();
    expect(panelRemove).toHaveBeenCalledTimes(1);
    expect(cmdRemove).toHaveBeenCalledTimes(1);
    expect(settingsRemove).toHaveBeenCalledTimes(1);
  });
});
