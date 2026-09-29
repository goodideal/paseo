import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AuditLogger } from "../server/audit-logger.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AuditLogger", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pet-audit-test-"));
    filePath = join(tempDir, "audit-log.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends records atomically and queries with pagination", async () => {
    const logger = new AuditLogger(filePath);
    await logger.append({
      id: "rec-1",
      timestamp: "2026-09-29T10:00:00.000Z",
      agentId: "agent-1",
      taskTitle: "Task 1",
      triggerType: "TIMEOUT_AUTO_DECISION",
      requestedAction: "npm test",
      decision: "ALLOW",
      riskLevel: "low",
      aiReason: "Safe",
      reviewedByHuman: false,
    });

    await logger.append({
      id: "rec-2",
      timestamp: "2026-09-29T10:05:00.000Z",
      agentId: "agent-2",
      taskTitle: "Task 2",
      triggerType: "TIMEOUT_AUTO_DECISION",
      requestedAction: "rm -rf /tmp",
      decision: "DENY",
      riskLevel: "high",
      aiReason: "Dangerous",
      reviewedByHuman: true,
    });

    const all = await logger.list({ limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    expect(all.records[0].id).toBe("rec-2"); // Newest first

    const unread = await logger.list({ unreadOnly: true });
    expect(unread.total).toBe(1);
    expect(unread.records[0].id).toBe("rec-1");
  });

  it("marks a record as reviewed", async () => {
    const logger = new AuditLogger(filePath);
    await logger.append({
      id: "rec-3",
      timestamp: "2026-09-29T10:00:00.000Z",
      agentId: "agent-1",
      taskTitle: "Task 1",
      triggerType: "TIMEOUT_AUTO_DECISION",
      requestedAction: "npm test",
      decision: "ALLOW",
      riskLevel: "low",
      aiReason: "Safe",
      reviewedByHuman: false,
    });

    const success = await logger.markReviewed("rec-3");
    expect(success).toBe(true);

    const query = await logger.list({ unreadOnly: true });
    expect(query.total).toBe(0);
  });
});
