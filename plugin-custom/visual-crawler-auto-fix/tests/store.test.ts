import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store/task-store.js";
import type { AnomalyRecord, HopRecord } from "../shared/types.js";

describe("TaskStore", () => {
  let store: TaskStore;
  let testFile: string;

  beforeEach(() => {
    testFile = join(
      tmpdir(),
      `test-store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`,
    );
    store = new TaskStore(testFile, 3);
  });

  it("initializes with default telemetry and slots", () => {
    const telemetry = store.getTelemetry();
    expect(telemetry.state).toBe("idle");
    expect(telemetry.currentHop).toBe(0);
    expect(telemetry.maxHops).toBe(50);

    const slots = store.getSlots();
    expect(slots.length).toBe(3);
    expect(slots.every((s) => s.status === "idle")).toBe(true);
  });

  it("records hops and updates active URL and current hop", () => {
    const hop: HopRecord = {
      hopNumber: 1,
      url: "http://localhost:3000/dashboard",
      action: "navigate",
      timestamp: Date.now(),
      domFingerprint: "fp-1",
      anomalies: [],
    };

    store.recordHop(hop);
    const telemetry = store.getTelemetry();
    expect(telemetry.currentHop).toBe(1);
    expect(telemetry.activeUrl).toBe("http://localhost:3000/dashboard");
  });

  it("records anomalies and counts severity correctly", () => {
    const anomaly: AnomalyRecord = {
      id: "a-1",
      type: "runtime_error",
      severity: "P0",
      message: "Uncaught crash",
      url: "http://localhost:3000",
      timestamp: Date.now(),
    };

    store.recordAnomaly(anomaly);
    const telemetry = store.getTelemetry();
    expect(telemetry.totalAnomalies).toBe(1);
    expect(telemetry.anomaliesBySeverity.P0).toBe(1);
  });

  it("handles directive upsert and filtering", () => {
    store.upsertDirective({
      id: "d-1",
      clusterKey: "k-1",
      title: "Fix Navbar Crash",
      severity: "P0",
      category: "runtime_error",
      affectedPages: ["/"],
      occurrenceCount: 1,
      errorDetails: { message: "Crash" },
      evidence: {},
      suggestedFix: "Fix it",
      status: "pending_review",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    store.upsertDirective({
      id: "d-2",
      clusterKey: "k-2",
      title: "Fix Button Overflow",
      severity: "P2",
      category: "visual_defect",
      affectedPages: ["/settings"],
      occurrenceCount: 1,
      errorDetails: { message: "Overflow" },
      evidence: {},
      suggestedFix: "Fix style",
      status: "resolved",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(store.getDirectives().length).toBe(2);
    expect(store.getDirectives({ severity: "P0" }).length).toBe(1);
    expect(store.getDirectives({ status: "resolved" }).length).toBe(1);
  });

  it("supports dynamic concurrency resizing", () => {
    store.setConcurrency(5);
    expect(store.getSlots().length).toBe(5);

    store.setConcurrency(2);
    expect(store.getSlots().length).toBe(2);
  });

  it("persists crawler tasks and their status transitions", () => {
    store.upsertTask({
      id: "task-1",
      clusterKey: "cluster-1",
      title: "Checkout crash",
      severity: "P0",
      category: "runtime_error",
      status: "todo",
      occurrenceCount: 1,
      affectedUrls: ["http://localhost:3000/checkout"],
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      reproductionBreadcrumbs: [{ hopNumber: 1, url: "http://localhost:3000", action: "navigate" }],
      evidence: { consoleMessage: "Uncaught TypeError" },
    });

    expect(store.getTasks()).toHaveLength(1);
    expect(store.updateTaskStatus("task-1", "ignored")).toBe(true);
    expect(store.getTasks({ status: "ignored" })).toHaveLength(1);

    const restored = new TaskStore(testFile, 3);
    expect(restored.getTasks({ status: "ignored" })).toHaveLength(1);
  });

  it("isolates hops per run so compile only processes the current run's hops", () => {
    const run1Id = store.startRun();
    store.recordHop({
      hopNumber: 1,
      url: "https://example.com/1",
      action: "navigate",
      timestamp: 1000,
      domFingerprint: "fp-1",
      anomalies: [],
    });
    expect(store.getCurrentRunHops()).toHaveLength(1);

    const run2Id = store.startRun();
    expect(store.getCurrentRunHops()).toHaveLength(0);
    store.recordHop({
      hopNumber: 1,
      url: "https://example.com/2",
      action: "navigate",
      timestamp: 2000,
      domFingerprint: "fp-2",
      anomalies: [],
    });
    expect(store.getCurrentRunHops()).toHaveLength(1);
    expect(store.getHops()).toHaveLength(2);
  });
});
