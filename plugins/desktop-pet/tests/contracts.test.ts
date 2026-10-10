import { describe, it, expect } from "vitest";
import {
  TrackedTaskSchema,
  AuditRecordSchema,
  DesktopPetSettingsSchema,
  PetDashboardSnapshotSchema,
  PetPrioritySchema,
  computeTaskPriority,
  CompanionActionSchema,
} from "../shared/types.js";

describe("Shared Schemas & Contracts", () => {
  it("computes task priority correctly and validates companion actions", () => {
    const p0Task = {
      agentId: "agent-1",
      taskTitle: "Refactor",
      state: "WAITING_DECISION",
      startedAt: Date.now(),
      activeDurationMs: 1000,
      pendingDecision: {
        requestId: "req-1",
        requestedAt: Date.now(),
        riskHint: "high",
      },
    };
    expect(computeTaskPriority(p0Task as any)).toBe("P0");

    const p1Task = {
      agentId: "agent-2",
      taskTitle: "Running build",
      state: "RUNNING",
      startedAt: Date.now(),
      activeDurationMs: 2000,
    };
    expect(computeTaskPriority(p1Task as any)).toBe("P1");

    const p2Task = {
      agentId: "agent-3",
      taskTitle: "Idle task",
      state: "IDLE",
      startedAt: null,
      activeDurationMs: null,
    };
    expect(computeTaskPriority(p2Task as any)).toBe("P2");

    const validAction = {
      type: "decision.respond",
      agentId: "agent-1",
      requestId: "req-1",
      behavior: "ALLOW",
    };
    expect(CompanionActionSchema.parse(validAction)).toEqual(validAction);
  });
  it("validates a valid TrackedTask payload", () => {
    const task = {
      agentId: "agent-123",
      taskTitle: "Fix Auth Bug",
      state: "RUNNING",
      startedAt: 1700000000000,
      activeDurationMs: 45000,
    };
    const parsed = TrackedTaskSchema.safeParse(task);
    expect(parsed.success).toBe(true);
  });

  it("validates a task waiting for decision with multiple timer fields", () => {
    const task = {
      agentId: "agent-456",
      taskTitle: "Build Report",
      state: "WAITING_DECISION",
      startedAt: 1700000000000,
      activeDurationMs: 120000,
      pendingDecision: {
        requestId: "req-999",
        actionRequested: "npm test -- --coverage",
        riskHint: "low",
        requestedAt: 1700000100000,
        timeoutSeconds: 180,
        expiresAt: 1700000280000,
      },
    };
    const parsed = TrackedTaskSchema.safeParse(task);
    expect(parsed.success).toBe(true);
  });

  it("validates AuditRecordSchema structure", () => {
    const record = {
      id: "uuid-1",
      timestamp: "2026-09-29T12:00:00.000Z",
      agentId: "agent-123",
      taskTitle: "Fix Auth Bug",
      triggerType: "TIMEOUT_AUTO_DECISION",
      requestedAction: "rm -rf /tmp/staging",
      decision: "DENY",
      riskLevel: "high",
      aiReason: "Destructive recursive removal intercepted.",
      reviewedByHuman: false,
    };
    const parsed = AuditRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
  });

  it("validates default DesktopPetSettings", () => {
    const settings = DesktopPetSettingsSchema.parse({});
    expect(settings.autoDecisionEnabled).toBe(true);
    expect(settings.defaultTimeoutSeconds).toBe(180);
    expect(settings.soundEnabled).toBe(true);
    expect(settings.soundVolume).toBe(0.7);
  });
});
