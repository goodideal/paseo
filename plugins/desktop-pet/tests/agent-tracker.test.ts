import { describe, it, expect } from "vitest";
import { AgentTracker } from "../server/agent-tracker.js";

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
});
