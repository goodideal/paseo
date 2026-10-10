import { describe, it, expect } from "vitest";
import { AgentTracker } from "../server/agent-tracker.js";
import { DesktopPetAgentProjection } from "../server/agent-projection.js";

describe("AgentTracker", () => {
  it("tracks running tasks and calculates duration accurately", () => {
    const tracker = new AgentTracker();
    const t0 = 1000000;
    tracker.startTask("agent-1", "Task 1", t0);

    const snapshot1 = tracker.getSnapshot(t0 + 5000);
    expect(snapshot1.runningCount).toBe(1);
    expect(snapshot1.tasks[0].activeDurationMs).toBe(5000);
    expect(snapshot1.tasks[0].state).toBe("RUNNING");
  });

  it("handles multiple concurrent tasks with independent pending decision timers", () => {
    const tracker = new AgentTracker();
    const t0 = 1000000;
    tracker.startTask("agent-1", "Task 1", t0);
    tracker.startTask("agent-2", "Task 2", t0);

    // Agent 1 asks for permission at t0 + 10s with 60s timeout
    tracker.recordPermissionRequest({
      agentId: "agent-1",
      requestId: "req-1",
      actionRequested: "npm test",
      timeoutSeconds: 60,
      now: t0 + 10000,
    });

    // Agent 2 asks for permission at t0 + 20s with 120s timeout
    tracker.recordPermissionRequest({
      agentId: "agent-2",
      requestId: "req-2",
      actionRequested: "git push",
      timeoutSeconds: 120,
      now: t0 + 20000,
    });

    const snapshot = tracker.getSnapshot(t0 + 25000);
    expect(snapshot.waitingCount).toBe(2);

    const task1 = snapshot.tasks.find((t) => t.agentId === "agent-1");
    const task2 = snapshot.tasks.find((t) => t.agentId === "agent-2");

    expect(task1?.pendingDecision?.expiresAt).toBe(t0 + 10000 + 60000);
    expect(task2?.pendingDecision?.expiresAt).toBe(t0 + 20000 + 120000);

    // At t0 + 75s, agent-1 should be expired, but agent-2 not expired
    const expiredAt75 = tracker.getExpiredPendingDecisions(t0 + 75000);
    expect(expiredAt75).toHaveLength(1);
    expect(expiredAt75[0].agentId).toBe("agent-1");

    // At t0 + 150s, both should be expired
    const expiredAt150 = tracker.getExpiredPendingDecisions(t0 + 150000);
    expect(expiredAt150).toHaveLength(2);
  });

  it("guards against negative duration if system clock shifts backwards", () => {
    const tracker = new AgentTracker();
    const t0 = 1000000;
    tracker.startTask("agent-1", "Task 1", t0);
    const snapshot = tracker.getSnapshot(t0 - 5000);
    expect(snapshot.tasks[0].activeDurationMs).toBe(0);
  });

  it("sorts tasks by priority (P0 > P1 > P2) and computes petMood in DesktopPetAgentProjection", () => {
    const projection = new DesktopPetAgentProjection();
    projection.handleSnapshot([
      {
        id: "agent-idle",
        title: "Idle Agent",
        status: "idle",
        pendingPermissions: [],
        activeTurn: null,
        createdAt: "",
        updatedAt: "",
        cwd: "",
        lastUserMessageAt: null,
        capabilities: {} as any,
        availableModes: [],
        currentModeId: null,
        persistence: null,
      } as any,
      {
        id: "agent-running",
        title: "Running Agent",
        status: "running",
        activeTurn: { turnId: "turn-1", startedAt: new Date(Date.now() - 5000).toISOString() },
        pendingPermissions: [],
        createdAt: "",
        updatedAt: "",
        cwd: "",
        lastUserMessageAt: null,
        capabilities: {} as any,
        availableModes: [],
        currentModeId: null,
        persistence: null,
      } as any,
      {
        id: "agent-waiting",
        title: "Waiting Agent",
        status: "running",
        activeTurn: { turnId: "turn-2", startedAt: new Date(Date.now() - 10000).toISOString() },
        pendingPermissions: [
          {
            id: "req-1",
            kind: "shell",
            command: "rm -rf cache",
            requestedAt: new Date().toISOString(),
          } as any,
        ],
        createdAt: "",
        updatedAt: "",
        cwd: "",
        lastUserMessageAt: null,
        capabilities: {} as any,
        availableModes: [],
        currentModeId: null,
        persistence: null,
      } as any,
    ]);

    const snapshot = projection.getSnapshot();
    expect(snapshot.tasks.length).toBe(3);
    expect(snapshot.tasks[0].agentId).toBe("agent-waiting");
    expect(snapshot.tasks[0].priority).toBe("P0");
    expect(snapshot.tasks[1].agentId).toBe("agent-running");
    expect(snapshot.tasks[1].priority).toBe("P1");
    expect(snapshot.tasks[2].agentId).toBe("agent-idle");
    expect(snapshot.tasks[2].priority).toBe("P2");
    expect((snapshot as any).petMood).toBe("waiting");
  });
});
