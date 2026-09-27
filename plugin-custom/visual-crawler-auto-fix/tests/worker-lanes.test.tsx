/* eslint-disable react-perf/jsx-no-new-array-as-prop */
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { WorkerLanes, type WorkflowRunLaneSummary } from "../client/components/worker-lanes.js";

describe("WorkerLanes Component (Task 5.4)", () => {
  it("renders workflow run summaries with visible controls and jumps to detail without hover dependency", () => {
    const onSelectRun = vi.fn();
    const runs: WorkflowRunLaneSummary[] = [
      {
        runId: "run-1",
        name: "Fix Header Overlap",
        status: "waiting_approval",
        currentStepId: "ship",
        branchName: "fix/header-overlap",
      },
      {
        runId: "run-2",
        name: "Fix Network Error",
        status: "running",
        currentStepId: "repair",
        branchName: "fix/network-error",
      },
    ];

    render(<WorkerLanes workflowRuns={runs} onSelectRun={onSelectRun} />);

    // Check visible text and badge labels (no hover needed)
    expect(screen.getByText("Fix Header Overlap")).toBeDefined();
    expect(screen.getByText("Fix Network Error")).toBeDefined();
    expect(screen.getByText("WAITING_APPROVAL")).toBeDefined();
    expect(screen.getByText("Current Step: ship")).toBeDefined();
    expect(screen.getByText("🌿 fix/header-overlap")).toBeDefined();
    expect(screen.getByText(/Awaiting Approval/)).toBeDefined();

    // Verify touch/click navigation to detail works via accessible button
    const firstRunButton = screen.getByLabelText(
      "Workflow run Fix Header Overlap, status waiting_approval",
    );
    fireEvent.click(firstRunButton);
    expect(onSelectRun).toHaveBeenCalledWith("run-1");
  });
});
afterEach(cleanup);
