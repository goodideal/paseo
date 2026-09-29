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

  describe("Per-Agent Switch and Configurable Rules", () => {
    it("should manage per-agent auto-continue override", () => {
      const governor = new ManagedGovernor();
      // Default behavior follows global flag (false by default)
      expect(governor.isAgentAutoContinueEnabled("agent-1")).toBe(false);
      expect(governor.isAgentAutoContinueEnabled("agent-1", true)).toBe(true);
      expect(governor.isAgentAutoContinueEnabled("agent-1", false)).toBe(false);

      // Disable agent-1 specifically
      governor.setAgentAutoContinue("agent-1", false);
      expect(governor.isAgentAutoContinueEnabled("agent-1", true)).toBe(false);
      // Other agents still follow global
      expect(governor.isAgentAutoContinueEnabled("agent-2", true)).toBe(true);

      // Enable agent-1 when global is false
      governor.setAgentAutoContinue("agent-1", true);
      expect(governor.isAgentAutoContinueEnabled("agent-1", false)).toBe(true);
    });

    it("should support dynamic custom safe command whitelist", () => {
      const governor = new ManagedGovernor();
      governor.setSafeCommandWhitelist(["cargo test", "pytest", "pnpm test"]);

      expect(governor.isSafeCommand("cargo test --lib")).toBe(true);
      expect(governor.isSafeCommand("pytest -q")).toBe(true);
      expect(governor.isSafeCommand("pnpm test")).toBe(true);
      expect(governor.isSafeCommand("cat file.txt")).toBe(false); // cat not in custom whitelist
    });

    it("should respect configurable consecutive error tolerance", () => {
      const governor = new ManagedGovernor(5);
      governor.setConsecutiveErrorTolerance(3);

      const errText = "Build failed:\nError: TS2304 Undefined symbol";
      // Turn 1
      expect(governor.evaluateOutput("agent-1", `Attempt 1:\n${errText}`, ["npm test"])).not.toBe(
        "BLOCKER_ESCALATE",
      );
      // Turn 2 (repeat once, total 2 consecutive identical errors, tolerance is 3)
      expect(governor.evaluateOutput("agent-1", `Attempt 2:\n${errText}`, ["npm test"])).not.toBe(
        "BLOCKER_ESCALATE",
      );
      // Turn 3 (repeat twice, total 3 consecutive identical errors -> hit tolerance)
      expect(governor.evaluateOutput("agent-1", `Attempt 3:\n${errText}`, ["npm test"])).toBe(
        "BLOCKER_ESCALATE",
      );
      expect(governor.getLastBlockerReason("agent-1")).toContain("Repeated error detected");
    });

    it("should NOT escalate on fatal text discussion or normal human questions", () => {
      const governor = new ManagedGovernor();
      expect(
        governor.evaluateOutput("agent-1", "如果遇到 fatal: remote not found，请检查网络设置", []),
      ).toBe("NEUTRAL");
      expect(
        governor.evaluateOutput("agent-1", "我们有两种方案，请选择方案 1 还是方案 2？", []),
      ).toBe("NEUTRAL");
    });
  });

  describe("PR Merge Protection", () => {
    it("should reject PR merge commands in isSafeCommand", () => {
      const governor = new ManagedGovernor();
      expect(governor.isSafeCommand("gh pr merge 123 --auto")).toBe(false);
      expect(governor.isSafeCommand("git merge origin/feature")).toBe(false);
      expect(governor.isSafeCommand("glab mr merge 9")).toBe(false);
      expect(governor.isSafeCommand("gitea merge pr 5")).toBe(false);
    });

    it("should escalate when PR merge intent is detected in text or tool calls", () => {
      const governor = new ManagedGovernor();
      const intentText = governor.evaluateOutput(
        "agent-1",
        "所有检查已通过，准备合并 PR #42 到主分支，请确认",
        [],
      );
      expect(intentText).toBe("BLOCKER_ESCALATE");
      expect(governor.getLastBlockerReason("agent-1")).toContain("PR merge");

      const intentTool = governor.evaluateOutput("agent-2", "Merging the pull request now", [
        "gh pr merge 42",
      ]);
      expect(intentTool).toBe("BLOCKER_ESCALATE");
      expect(governor.getLastBlockerReason("agent-2")).toContain("PR merge");
    });
  });

  describe("Content-Aware Stopping", () => {
    it("should escalate early when consecutive turns have identical error fingerprints", () => {
      const governor = new ManagedGovernor(5);
      // Turn 1 fails with a specific error
      const intent1 = governor.evaluateOutput(
        "agent-1",
        "Build failed:\nError: TS2304 Cannot find name 'UndefinedSymbol' at line 42",
        ["npm test"],
      );
      // First error turn might continue
      expect(intent1).not.toBe("BLOCKER_ESCALATE");

      // Turn 2 fails with the exact same error fingerprint (non-convergent fix)
      const intent2 = governor.evaluateOutput(
        "agent-1",
        "Retrying after editing...\nBuild failed:\nError: TS2304 Cannot find name 'UndefinedSymbol' at line 42",
        ["npm test"],
      );
      // Should stop early at turn 2 without waiting for turn 5
      expect(intent2).toBe("BLOCKER_ESCALATE");
      expect(governor.getLastBlockerReason("agent-1")).toContain("error");
    });

    it("should escalate on fuzzy semantic flapping even if text is not 100% identical", () => {
      const governor = new ManagedGovernor(5);
      governor.evaluateOutput(
        "agent-1",
        "正在尝试运行修复方案，等待重新编译并运行测试，请稍候...",
        [],
      );
      const intent = governor.evaluateOutput(
        "agent-1",
        "正在尝试运行修复方案，等待重新编译并且运行测试，请稍候...",
        [],
      );
      expect(intent).toBe("BLOCKER_ESCALATE");
      expect(governor.getLastBlockerReason("agent-1")).toContain("flapping");
    });

    it("should NOT escalate when human decision or clarification is needed, allowing normal dialogue", () => {
      const governor = new ManagedGovernor(5);
      const intent = governor.evaluateOutput(
        "agent-1",
        "我们有两种实现方案，请确认选择方案 A 还是方案 B？\n- [ ] 等待用户确认方案",
        [],
      );
      expect(intent).toBe("NEUTRAL");
    });
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

describe("RadarEngine", () => {
  it("should generate a dual-mode snapshot with topology and watchdog status", async () => {
    const { RadarEngine } = await import("../server/radar-engine.js");
    const streamWatcher = new StreamWatcher(15000);
    const governor = new ManagedGovernor(5);
    const activeBlockers = new Map();

    const engine = new RadarEngine({
      workspaceCwd: "/non-existent-dir",
      streamWatcher,
      governor,
      activeBlockers,
    });

    const snapshot = await engine.getSnapshot("agent-root", [
      { id: "agent-root", title: "Root", lastStatus: "running" },
      {
        id: "agent-sub",
        title: "Sub",
        lastStatus: "running",
        labels: { "paseo.parent-agent-id": "agent-root" },
      },
    ]);

    expect(snapshot.mode).toBe("generic");
    expect(snapshot.topology.rootAgentId).toBe("agent-root");
    expect(snapshot.topology.nodes["agent-sub"].parentAgentId).toBe("agent-root");
    expect(snapshot.watchdog.autoTurnCount).toBe(0);
    expect(snapshot.watchdog.maxAutoTurns).toBe(5);
    expect(snapshot.watchdog.agentAutoContinueEnabled).toBe(false);
  });
});
