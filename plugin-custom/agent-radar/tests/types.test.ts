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
        agentAutoContinueEnabled: true,
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
        agentAutoContinueEnabled: false,
      },
    };

    const parsed = RadarSnapshotSchema.parse(raw);
    expect(parsed.mode).toBe("generic");
    expect(parsed.watchdog.activeBlocker?.errorCode).toBe("THREAD_LIMIT");
  });

  it("exports valid radar RPC descriptors including toggle auto-continue", async () => {
    const { radarToggleAutoContinueRpc } = await import("../shared/rpc.js");
    expect(radarGetSnapshotRpc.name).toBe("radar.get_snapshot");
    expect(radarResolveDecisionRpc.name).toBe("radar.resolve_decision");
    expect(radarToggleAutoContinueRpc.name).toBe("radar.toggle_auto_continue");
  });

  it("validates watchdogSettings schema defaults and custom values", async () => {
    const { watchdogSettings } = await import("../shared/settings.js");
    expect(watchdogSettings.id).toBe("watchdog-settings");
    expect(watchdogSettings.scope).toBe("host");

    const defaultValues = watchdogSettings.schema.parse({});
    expect(defaultValues.autoContinue).toBe(false);
    expect(defaultValues.autoApprovePermissions).toBe(true);
    expect(defaultValues.maxAutoTurns).toBe(5);
    expect(defaultValues.heartbeatThresholdSeconds).toBe(15);
    expect(defaultValues.autoContinuePrompt).toBe("请继续执行下一步任务，直到交付并验证完成。");
    expect(defaultValues.safeCommandWhitelist).toContain("git status");
    expect(defaultValues.safeCommandWhitelist).toContain("npm test");
    expect(defaultValues.consecutiveErrorTolerance).toBe(2);

    const customValues = watchdogSettings.schema.parse({
      autoContinue: false,
      autoApprovePermissions: false,
      maxAutoTurns: 10,
      heartbeatThresholdSeconds: 30,
      autoContinuePrompt: "Custom prompt",
      safeCommandWhitelist: ["cargo test", "pnpm test"],
      consecutiveErrorTolerance: 3,
    });
    expect(customValues.autoContinue).toBe(false);
    expect(customValues.autoApprovePermissions).toBe(false);
    expect(customValues.maxAutoTurns).toBe(10);
    expect(customValues.heartbeatThresholdSeconds).toBe(30);
    expect(customValues.autoContinuePrompt).toBe("Custom prompt");
    expect(customValues.safeCommandWhitelist).toEqual(["cargo test", "pnpm test"]);
    expect(customValues.consecutiveErrorTolerance).toBe(3);
  });
});
