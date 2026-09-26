import { describe, expect, it } from "vitest";
import {
  RadarSnapshotSchema,
  SuperpowerTaskStepSchema,
  AgentTopologyNodeSchema,
  type RadarSnapshot,
} from "../shared/types.js";
import { radarGetSnapshotRpc, radarResolveDecisionRpc } from "../shared/rpc.js";

describe("agent-radar shared types and contracts", () => {
  it("validates a valid Superpower mode RadarSnapshot", () => {
    const raw: RadarSnapshot = {
      mode: "superpower",
      superpower: {
        planSlug: "feature-radar",
        planPath: "docs/superpowers/plans/feature-radar.md",
        tasks: [
          {
            id: "task-1",
            title: "Scaffold radar plugin",
            status: "completed",
            currentRound: 1,
            maxRounds: 5,
            commits: ["abc1234"],
            rulings: ["Ruling: adopt dual-engine"],
            durationMs: 45000,
          },
          {
            id: "task-2",
            title: "Build client panel",
            status: "running",
            currentRound: 2,
            maxRounds: 5,
            durationMs: 12000,
          },
        ],
        currentTaskId: "task-2",
      },
      topology: {
        rootAgentId: "agent-root",
        nodes: {
          "agent-root": {
            agentId: "agent-root",
            title: "Root Agent",
            status: "running",
            childAgentIds: ["agent-child-1"],
          },
          "agent-child-1": {
            agentId: "agent-child-1",
            parentAgentId: "agent-root",
            title: "Subagent 1",
            status: "running",
            runningTool: "npm test",
            durationMs: 15000,
            childAgentIds: [],
          },
        },
      },
      watchdog: {
        activeHeartbeat: {
          agentId: "agent-child-1",
          subagentNickname: "Subagent 1",
          currentToolName: "npm test",
          elapsedSeconds: 15,
          statusDescription: "Running tests",
        },
        activeBlocker: null,
        autoTurnCount: 1,
        maxAutoTurns: 5,
      },
    };

    const parsed = RadarSnapshotSchema.parse(raw);
    expect(parsed.mode).toBe("superpower");
    expect(parsed.superpower?.tasks).toHaveLength(2);
    expect(parsed.topology.nodes["agent-child-1"].runningTool).toBe("npm test");
  });

  it("validates a Generic mode RadarSnapshot with blocker report", () => {
    const raw = {
      mode: "generic",
      topology: {
        rootAgentId: "agent-root",
        nodes: {
          "agent-root": {
            agentId: "agent-root",
            title: "Root Agent",
            status: "error",
            childAgentIds: [],
          },
        },
      },
      watchdog: {
        activeHeartbeat: null,
        activeBlocker: {
          agentId: "agent-root",
          summary: "Thread limit reached",
          rootCause: "Concurrency limit hit",
          errorCode: "THREAD_LIMIT",
          options: [
            {
              id: "retry",
              label: "Retry",
              description: "Retry with delay",
              actionType: "retry_with_tip" as const,
            },
          ],
          timestamp: new Date().toISOString(),
        },
        autoTurnCount: 0,
        maxAutoTurns: 5,
      },
    };

    const parsed = RadarSnapshotSchema.parse(raw);
    expect(parsed.mode).toBe("generic");
    expect(parsed.watchdog.activeBlocker?.errorCode).toBe("THREAD_LIMIT");
  });

  it("exports valid radar RPC descriptors", () => {
    expect(radarGetSnapshotRpc.name).toBe("radar.get_snapshot");
    expect(radarResolveDecisionRpc.name).toBe("radar.resolve_decision");
  });
});
