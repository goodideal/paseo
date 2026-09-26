import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamWatcher } from "../server/stream-watcher.js";
import { ManagedGovernor } from "../server/managed-governor.js";
import { Synthesizer } from "../server/synthesizer.js";

describe("StreamWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("should trigger heartbeat after threshold", () => {
    const watcher = new StreamWatcher(15000);
    const cb = vi.fn();

    watcher.onToolCall("agent-1", "long_running_tool", cb);

    vi.advanceTimersByTime(10000);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        currentToolName: "long_running_tool",
        elapsedSeconds: 15,
      }),
    );
  });

  it("should support dynamic threshold update", () => {
    const watcher = new StreamWatcher(15000);
    watcher.setHeartbeatThresholdSeconds(10);
    const cb = vi.fn();

    watcher.onToolCall("agent-1", "long_running_tool", cb);

    vi.advanceTimersByTime(10000);
    expect(cb).toHaveBeenCalled();
  });

  it("should clear watcher on tool result", () => {
    const watcher = new StreamWatcher(15000);
    const cb = vi.fn();

    watcher.onToolCall("agent-1", "long_running_tool", cb);
    watcher.onToolResult("agent-1");

    vi.advanceTimersByTime(16000);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("ManagedGovernor", () => {
  it("should escalate on thread limit error", () => {
    const governor = new ManagedGovernor();
    const intent = governor.evaluateOutput(
      "agent-1",
      "collab spawn failed: agent thread limit reached",
      [],
    );
    expect(intent).toBe("BLOCKER_ESCALATE");
  });

  it("should auto continue on safe commands", () => {
    const governor = new ManagedGovernor();
    const intent = governor.evaluateOutput("agent-1", "Check diff", ["git diff"]);
    expect(intent).toBe("AUTO_CONTINUE");
    expect(governor.getAutoTurnCount("agent-1")).toBe(0);
  });

  it("should properly identify dangerous commands", () => {
    const governor = new ManagedGovernor();
    expect(governor.isSafeCommand("rm -rf /")).toBe(false);
    expect(governor.isSafeCommand("git push origin main")).toBe(false);
    expect(governor.isSafeCommand("chmod +x script.sh")).toBe(false);
    expect(governor.isSafeCommand("sudo apt install")).toBe(false);
    expect(governor.isSafeCommand("echo hello > out.txt")).toBe(false);
    expect(governor.isSafeCommand("git status")).toBe(true);
    expect(governor.isSafeCommand("ls -la")).toBe(true);
  });

  it("should identify English completed text", () => {
    const governor = new ManagedGovernor();
    const intent1 = governor.evaluateOutput("agent-1", "All tasks completed successfully", []);
    expect(intent1).toBe("COMPLETED");

    const intent2 = governor.evaluateOutput("agent-1", "Delivery COMPLETE", []);
    expect(intent2).toBe("COMPLETED");
  });

  it("should escalate on flapping", () => {
    const governor = new ManagedGovernor();
    governor.evaluateOutput("agent-1", "Same output", []);
    const intent = governor.evaluateOutput("agent-1", "Same output", []);
    expect(intent).toBe("BLOCKER_ESCALATE");
  });

  it("should be neutral on unresolved todos", () => {
    const governor = new ManagedGovernor();
    const intent = governor.evaluateOutput("agent-1", "I need to do this:\n- [ ] Task A", []);
    expect(intent).toBe("AUTO_CONTINUE");
  });

  it("should escalate after max auto turns and support dynamic update", () => {
    const governor = new ManagedGovernor(2);
    governor.incrementTurn("agent-1");
    governor.incrementTurn("agent-1");

    let intent = governor.evaluateOutput("agent-1", "Check status", ["git status"]);
    expect(intent).toBe("BLOCKER_ESCALATE");

    // Dynamic update
    governor.setMaxAutoTurns(4);
    intent = governor.evaluateOutput("agent-1", "Check status again", ["git status"]);
    expect(intent).toBe("AUTO_CONTINUE");
  });
});

describe("Synthesizer", () => {
  it("should create blocker report", () => {
    const synthesizer = new Synthesizer();
    const report = synthesizer.createBlockerReport(
      "agent-1",
      "Blocked on error",
      "File not found",
      [{ id: "opt1", label: "Option 1", description: "Desc 1", actionType: "pause" }],
    );

    expect(report.agentId).toBe("agent-1");
    expect(report.summary).toBe("Blocked on error");
    expect(report.options.length).toBe(1);
  });

  it("should render decision card", () => {
    const synthesizer = new Synthesizer();
    const report = synthesizer.createBlockerReport(
      "agent-1",
      "Blocked on error",
      "File not found",
      [{ id: "opt1", label: "Option 1", description: "Desc 1", actionType: "pause" }],
    );

    const card = synthesizer.renderDecisionCard(report);
    expect(card).toContain("Watchdog: Escalation Required");
    expect(card).toContain("**Agent**: agent-1");
    expect(card).toContain("Option 1**: Desc 1");
  });
});
