import { describe, it, expect } from "vitest";
import {
  TrackedTaskSchema,
  AuditRecordSchema,
  DesktopPetSettingsSchema,
  PetDashboardSnapshotSchema,
} from "../shared/types.js";

describe("Shared Schemas & Contracts", () => {
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
