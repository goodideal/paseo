import { describe, expect, it, vi } from "vitest";
import contributeClient from "../index.client.js";
import { buildProjectedWorkflowRuns, sortWorkflowRuns } from "../client/projected-runs.js";
import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";

describe("Workflow Runs Plugin", () => {
  it("projects root and subagent snapshots into virtual DAG runs and sorts by urgency", () => {
    const agents = [
      {
        id: "agt_lead",
        workspaceId: "ws_1",
        parentAgentId: null,
        provider: "claude",
        status: "idle",
        title: "Implement feature X",
        createdAt: "2026-11-12T01:00:00.000Z",
      },
      {
        id: "agt_sub",
        workspaceId: "ws_1",
        parentAgentId: "agt_lead",
        provider: "codex",
        status: "running",
        title: "Run unit tests",
        createdAt: "2026-11-12T01:02:00.000Z",
      },
    ] as unknown as PluginAgentSnapshot[];

    const projected = buildProjectedWorkflowRuns(agents);
    expect(projected.summaries).toHaveLength(1);
    expect(projected.summaries[0]?.status).toBe("running");
    expect(projected.details.get("virtual:session:agt_lead")?.stepAttempts).toHaveLength(2);

    const sorted = sortWorkflowRuns([
      {
        runId: "r_done",
        name: "Done",
        status: "succeeded",
        createdAt: "2026-11-12T02:00:00.000Z",
      },
      ...projected.summaries,
      {
        runId: "r_gate",
        name: "Gate",
        status: "waiting_approval",
        createdAt: "2026-11-12T00:00:00.000Z",
      },
    ]);
    expect(sorted.map((r) => r.runId)).toEqual(["r_gate", "virtual:session:agt_lead", "r_done"]);
  });

  it("registers workspace panel and command center item cleanly", () => {
    const client: Partial<PluginClientContext> = {
      addWorkspacePanel: vi.fn(
        (_c) => () => {},
      ) as unknown as PluginClientContext["addWorkspacePanel"],
      addCommandCenterItem: vi.fn(
        (_c) => () => {},
      ) as unknown as PluginClientContext["addCommandCenterItem"],
      addHeaderButton: vi.fn(() => ({ update: vi.fn(), remove: vi.fn() })),
    };

    const cleanup = contributeClient(client as PluginClientContext);
    expect(cleanup).toBeDefined();
    expect(client.addWorkspacePanel).toHaveBeenCalled();
    expect(client.addCommandCenterItem).toHaveBeenCalled();
  });
});
