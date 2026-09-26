import { describe, expect, it } from "vitest";
import { buildAgentTopology, type RawAgentSummary } from "../server/topology-builder.js";

describe("topology-builder", () => {
  it("builds a single node topology when no children exist", () => {
    const agents: RawAgentSummary[] = [
      {
        id: "root-1",
        title: "Main Agent",
        lastStatus: "running",
      },
    ];

    const topology = buildAgentTopology("root-1", agents);
    expect(topology.rootAgentId).toBe("root-1");
    expect(Object.keys(topology.nodes)).toHaveLength(1);
    expect(topology.nodes["root-1"].title).toBe("Main Agent");
    expect(topology.nodes["root-1"].childAgentIds).toEqual([]);
  });

  it("builds multi-level hierarchy (parent -> child -> grandchild)", () => {
    const agents: RawAgentSummary[] = [
      {
        id: "root-1",
        title: "Coordinator",
        lastStatus: "running",
      },
      {
        id: "sub-1",
        title: "Implementer",
        lastStatus: "running",
        labels: { "paseo.parent-agent-id": "root-1" },
      },
      {
        id: "sub-2",
        title: "Reviewer",
        lastStatus: "idle",
        labels: { "paseo.parent-agent-id": "root-1" },
      },
      {
        id: "grand-1",
        title: "Test Runner",
        lastStatus: "running",
        labels: { "paseo.parent-agent-id": "sub-1" },
      },
      {
        id: "unrelated",
        title: "Other Session",
        lastStatus: "running",
      },
    ];

    const activeTools = {
      "sub-1": { toolName: "git commit", durationMs: 4000 },
      "grand-1": { toolName: "npm test", durationMs: 18000 },
    };

    const topology = buildAgentTopology("root-1", agents, activeTools);
    expect(topology.rootAgentId).toBe("root-1");
    // Only root-1 and its descendants should be in the topology
    expect(Object.keys(topology.nodes).sort()).toEqual(["grand-1", "root-1", "sub-1", "sub-2"]);

    expect(topology.nodes["root-1"].childAgentIds.sort()).toEqual(["sub-1", "sub-2"]);
    expect(topology.nodes["sub-1"].childAgentIds).toEqual(["grand-1"]);
    expect(topology.nodes["sub-1"].runningTool).toBe("git commit");
    expect(topology.nodes["sub-1"].durationMs).toBe(4000);

    expect(topology.nodes["grand-1"].parentAgentId).toBe("sub-1");
    expect(topology.nodes["grand-1"].runningTool).toBe("npm test");
    expect(topology.nodes["grand-1"].durationMs).toBe(18000);
  });
});
