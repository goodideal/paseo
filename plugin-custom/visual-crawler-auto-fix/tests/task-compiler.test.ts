import { describe, expect, it } from "vitest";
import type { AnomalyRecord, HopRecord } from "../shared/types.js";
import { TaskCompiler } from "../server/triage/task-compiler.js";

describe("TaskCompiler", () => {
  it("clusters duplicate console errors into a single task item across hops", () => {
    const compiler = new TaskCompiler();
    const hops: HopRecord[] = [
      {
        hopNumber: 1,
        url: "https://example.com/page-a",
        action: "navigate",
        timestamp: 1000,
        domFingerprint: "fp-1",
        anomalies: [
          {
            id: "ano-1",
            type: "runtime_error",
            severity: "P1",
            message: "Uncaught TypeError: Cannot read property 'map' of undefined",
            stack:
              "TypeError: Cannot read property 'map' of undefined\n    at ListView.render (list.js:42)",
            url: "https://example.com/page-a",
            timestamp: 1000,
            screenshotPath: ".evidence/screenshots/hop-1.png",
          },
        ],
      },
      {
        hopNumber: 2,
        url: "https://example.com/page-b",
        action: "click:a.next",
        timestamp: 2000,
        domFingerprint: "fp-2",
        anomalies: [
          {
            id: "ano-2",
            type: "runtime_error",
            severity: "P1",
            message: "Uncaught TypeError: Cannot read property 'map' of undefined",
            stack:
              "TypeError: Cannot read property 'map' of undefined\n    at ListView.render (list.js:42)",
            url: "https://example.com/page-b",
            timestamp: 2000,
            screenshotPath: ".evidence/screenshots/hop-2.png",
          },
        ],
      },
    ];

    const tasks = compiler.compile(hops);
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.occurrenceCount).toBe(2);
    expect(task.affectedUrls).toEqual(["https://example.com/page-a", "https://example.com/page-b"]);
    expect(task.severity).toBe("P1");
    expect(task.status).toBe("todo");
    expect(task.evidence.consoleMessage).toContain("Cannot read property 'map'");
    expect(task.reproductionBreadcrumbs).toHaveLength(2);
  });

  it("assigns P0 to crash / uncaught exception and P2 to visual overlap", () => {
    const compiler = new TaskCompiler();
    const hops: HopRecord[] = [
      {
        hopNumber: 1,
        url: "https://example.com/crash",
        action: "navigate",
        timestamp: 1000,
        domFingerprint: "fp-1",
        anomalies: [
          {
            id: "ano-crash",
            type: "runtime_error",
            severity: "P0",
            message: "Application Crash: ChunkLoadError",
            url: "https://example.com/crash",
            timestamp: 1000,
          },
        ],
      },
      {
        hopNumber: 2,
        url: "https://example.com/overlap",
        action: "click:#tab",
        timestamp: 2000,
        domFingerprint: "fp-2",
        anomalies: [
          {
            id: "ano-overlap",
            type: "visual_defect",
            severity: "P2",
            message: "Visual defect detected on div.header: overlap",
            domSelector: "div.header",
            url: "https://example.com/overlap",
            timestamp: 2000,
          },
        ],
      },
    ];

    const tasks = compiler.compile(hops);
    expect(tasks).toHaveLength(2);
    const p0Task = tasks.find((t) => t.severity === "P0");
    const p2Task = tasks.find((t) => t.severity === "P2");
    expect(p0Task?.category).toBe("runtime_error");
    expect(p2Task?.category).toBe("visual_defect");
  });

  it("merges into existing tasks without creating duplicates", () => {
    const compiler = new TaskCompiler();
    const initialHops: HopRecord[] = [
      {
        hopNumber: 1,
        url: "https://example.com/items",
        action: "navigate",
        timestamp: 1000,
        domFingerprint: "fp-1",
        anomalies: [
          {
            id: "ano-500",
            type: "network_failure",
            severity: "P0",
            message: "HTTP 500 on /api/items",
            httpStatus: 500,
            url: "https://example.com/items",
            timestamp: 1000,
          },
        ],
      },
    ];

    const existingTasks = compiler.compile(initialHops);
    expect(existingTasks[0].occurrenceCount).toBe(1);

    const secondHops: HopRecord[] = [
      {
        hopNumber: 2,
        url: "https://example.com/items/refresh",
        action: "click:button.refresh",
        timestamp: 3000,
        domFingerprint: "fp-3",
        anomalies: [
          {
            id: "ano-500-again",
            type: "network_failure",
            severity: "P0",
            message: "HTTP 500 on /api/items",
            httpStatus: 500,
            url: "https://example.com/items/refresh",
            timestamp: 3000,
          },
        ],
      },
    ];

    const updatedTasks = compiler.compile(secondHops, existingTasks);
    expect(updatedTasks).toHaveLength(1);
    expect(updatedTasks[0].occurrenceCount).toBe(2);
    expect(updatedTasks[0].affectedUrls).toContain("https://example.com/items/refresh");
    expect(updatedTasks[0].lastSeenAt).toBe(3000);
  });
});
