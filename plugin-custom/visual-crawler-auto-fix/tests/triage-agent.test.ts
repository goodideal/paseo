import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store/task-store.js";
import { ReviewTriageAgent } from "../server/triage/triage-agent.js";
import type { AnomalyRecord } from "../shared/types.js";

describe("ReviewTriageAgent", () => {
  let store: TaskStore;
  let triageAgent: ReviewTriageAgent;

  beforeEach(() => {
    const testFile = join(
      tmpdir(),
      `test-triage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`,
    );
    store = new TaskStore(testFile, 3);
    triageAgent = new ReviewTriageAgent(store);
  });

  it("clusters 20 occurrences of the same component error across different pages into 1 directive", () => {
    const anomalies: AnomalyRecord[] = [];

    // Generate 20 errors across 10 different pages
    for (let i = 0; i < 20; i++) {
      anomalies.push({
        id: `anomaly-${i}`,
        type: "runtime_error",
        severity: i === 0 ? "P0" : "P1", // one is P0, others P1
        message: `TypeError: Cannot read property of undefined at http://localhost:3000/chunk-${i % 5}.js:142`,
        url: `http://localhost:3000/page-${i % 10}`,
        sourceHint: {
          filePath: "src/components/Navbar.tsx",
          componentName: "Navbar",
          line: 42,
        },
        timestamp: Date.now() + i,
      });
    }

    const directives = triageAgent.triageAnomalies(anomalies);

    // All 20 errors should cluster into exactly 1 directive because they share the same source component & normalized error!
    expect(directives.length).toBe(1);
    const directive = directives[0];
    expect(directive.occurrenceCount).toBe(20);
    expect(directive.affectedPages.length).toBe(10);
    expect(directive.severity).toBe("P0"); // picked highest
    expect(directive.sourceHint?.filePath).toBe("src/components/Navbar.tsx");
  });

  it("differentiates errors from different components or error types", () => {
    const anomalies: AnomalyRecord[] = [
      {
        id: "a-1",
        type: "runtime_error",
        severity: "P1",
        message: "Failed to render user avatar",
        url: "http://localhost:3000/profile",
        sourceHint: { filePath: "src/components/Avatar.tsx" },
        timestamp: Date.now(),
      },
      {
        id: "a-2",
        type: "visual_defect",
        severity: "P2",
        message: "Text overflow in footer",
        url: "http://localhost:3000/home",
        domSelector: "footer.bottom-bar",
        timestamp: Date.now(),
      },
    ];

    const directives = triageAgent.triageAnomalies(anomalies);
    expect(directives.length).toBe(2);
  });

  it("auto-approves P0 directives when autoApproveP0 is enabled", () => {
    const anomalies: AnomalyRecord[] = [
      {
        id: "a-p0",
        type: "runtime_error",
        severity: "P0",
        message: "Uncaught fatal crash",
        url: "http://localhost:3000",
        timestamp: Date.now(),
      },
      {
        id: "a-p2",
        type: "visual_defect",
        severity: "P2",
        message: "Minor style misalignment",
        url: "http://localhost:3000",
        timestamp: Date.now(),
      },
    ];

    const directives = triageAgent.triageAnomalies(anomalies, { autoApproveP0: true });
    expect(directives.length).toBe(2);

    const p0 = directives.find((d) => d.severity === "P0");
    const p2 = directives.find((d) => d.severity === "P2");

    expect(p0?.status).toBe("approved");
    expect(p2?.status).toBe("pending_review");
  });
});
