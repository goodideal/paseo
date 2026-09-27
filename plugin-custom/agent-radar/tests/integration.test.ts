import { describe, it, expect, vi } from "vitest";
import contribute from "../index.server.js";
import {
  resolveDecisionRpc,
  interruptAgentRpc,
  getWatchdogStatusRpc,
  radarGetSnapshotRpc,
  radarResolveDecisionRpc,
  radarToggleAutoContinueRpc,
} from "../shared/rpc.js";
import type { PluginServerContext, PluginHookContext } from "@getpaseo/plugin/server";

describe("Subagent Watchdog Integration Test", () => {
  it("orchestrates turn monitoring, auto-continuation, blocker escalation, timeline append, and decision RPC", async () => {
    const listeners: Record<string, Function[]> = {};
    const rpcHandlers = new Map<any, Function>();

    const fakeServer: PluginServerContext = {
      on(name: any, handler: any) {
        if (!listeners[name]) listeners[name] = [];
        listeners[name]!.push(handler);
        return () => {};
      },
      before: vi.fn(),
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          values: { autoContinue: true, maxAutoTurns: 5, heartbeatThresholdSeconds: 15 },
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      }) as any,
      handle(contract: any, handler: any) {
        rpcHandlers.set(contract, handler);
      },
      registerProvider: vi.fn(),
    };

    // Initialize plugin
    const cleanup = contribute(fakeServer);

    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockRespondToPermission = vi.fn().mockResolvedValue(undefined);
    const mockAppend = vi.fn().mockResolvedValue({ seq: 1, epoch: "epoch-1" });
    const mockSubscribe = vi.fn().mockReturnValue(() => {});

    const fakePaseoApi: any = {
      agents: {
        ref: (id: string) => ({
          send: mockSend,
          respondToPermission: mockRespondToPermission,
          timeline: {
            append: mockAppend,
            subscribe: mockSubscribe,
          },
        }),
      },
    };

    const hookContext: PluginHookContext = {
      paseo: fakePaseoApi,
      signal: new AbortController().signal,
    };

    const agentA = {
      id: "agent-task-1",
      workspaceId: "wks-1",
      parentAgentId: "parent-1",
      provider: "codex",
      cwd: "/repo",
      title: "Task 1",
    };

    // 0. Test turn started subscribes to timeline stream
    const turnStartedListeners = listeners["agent.turn_started"] || [];
    expect(turnStartedListeners.length).toBeGreaterThan(0);
    turnStartedListeners[0]!({ agent: agentA, turnId: "turn-1" }, hookContext);
    expect(mockSubscribe).toHaveBeenCalled();

    // 1. Simulate a turn with incomplete tasks (- [ ])
    await Promise.resolve();
    const turnEndedListeners = listeners["agent.turn_ended"] || [];
    expect(turnEndedListeners.length).toBeGreaterThan(0);

    await turnEndedListeners[0]!(
      {
        agent: agentA,
        turnId: "turn-1",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "I finished step 1.\n- [ ] Step 2: Write tests\n- [ ] Step 3: Implement",
          },
        ],
      },
      hookContext,
    );

    // Verify autoContinue was invoked
    expect(mockSend).toHaveBeenCalledWith("请继续执行下一步任务，直到交付并验证完成。");

    // 2. Simulate permission request while auto-turn is active
    const permListeners = listeners["agent.permission_requested"] || [];

    // Dangerous command - should not be allowed
    await permListeners[0]!(
      {
        agent: agentA,
        request: {
          id: "req-danger",
          kind: "command",
          title: "Run rm -rf /",
          input: { cmd: "rm -rf /" },
        },
      },
      hookContext,
    );
    expect(mockRespondToPermission).not.toHaveBeenCalled();

    // Safe command - should be allowed
    await permListeners[0]!(
      {
        agent: agentA,
        request: {
          id: "req-safe",
          kind: "command",
          title: "Run git status",
          input: { cmd: "git status" },
        },
      },
      hookContext,
    );

    expect(mockRespondToPermission).toHaveBeenCalledWith({
      requestId: "req-safe",
      response: { behavior: "allow" },
    });

    // 3. Simulate hitting thread limit error (collab spawn failed)
    await turnEndedListeners[0]!(
      {
        agent: agentA,
        turnId: "turn-2",
        outcome: { kind: "failed", error: { message: "Thread collision" } },
        timeline: [
          {
            type: "assistant_message",
            text: "collab spawn failed: agent thread limit reached",
          },
        ],
      },
      hookContext,
    );

    // Verify timeline.append was invoked to render DecisionCard on timeline
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "watchdog-blocker",
        version: 1,
        data: expect.objectContaining({
          agentId: "agent-task-1",
          rootCause: expect.stringContaining("Agent thread limit reached"),
        }),
      }),
    );

    // Query status via getWatchdogStatusRpc
    const statusHandler = rpcHandlers.get(getWatchdogStatusRpc);
    expect(statusHandler).toBeDefined();

    const status = await statusHandler!({ agentId: "agent-task-1" }, hookContext);
    expect(status.blocker).toBeDefined();
    expect(status.blocker?.rootCause).toContain("Agent thread limit reached");
    expect(status.blocker?.options.length).toBeGreaterThanOrEqual(2);

    // 4. Resolve decision via resolveDecisionRpc
    const resolveHandler = rpcHandlers.get(resolveDecisionRpc);
    expect(resolveHandler).toBeDefined();

    mockSend.mockClear();
    const resolution = await resolveHandler!(
      {
        agentId: "agent-task-1",
        optionId: "retry",
      },
      hookContext,
    );

    expect(resolution.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining("已由 Watchdog 批准继续执行"));

    // 5. Test interruption RPC
    const interruptHandler = rpcHandlers.get(interruptAgentRpc);
    expect(interruptHandler).toBeDefined();

    const interruptRes = await interruptHandler!({ agentId: "agent-task-1" }, hookContext);
    expect(interruptRes.success).toBe(true);

    // 6. Test Radar Snapshot RPC
    const radarSnapshotHandler = rpcHandlers.get(radarGetSnapshotRpc);
    expect(radarSnapshotHandler).toBeDefined();

    const radarSnapshot = await radarSnapshotHandler!({ agentId: "agent-task-1" }, hookContext);
    expect(radarSnapshot).toBeDefined();
    expect(radarSnapshot.mode).toBe("superpower");
    expect(radarSnapshot.topology.rootAgentId).toBe("agent-task-1");
    expect(radarSnapshot.watchdog.maxAutoTurns).toBe(5);

    // 7. Test Radar Resolve Decision RPC
    const radarResolveHandler = rpcHandlers.get(radarResolveDecisionRpc);
    expect(radarResolveHandler).toBeDefined();

    cleanup();
  });

  it("respects dynamic settings for autoContinue and autoApprovePermissions", async () => {
    const listeners: Record<string, Function[]> = {};
    let settingsSubscriber: ((state: any) => void) | null = null;

    const fakeServer: PluginServerContext = {
      on(name: any, handler: any) {
        if (!listeners[name]) listeners[name] = [];
        listeners[name]!.push(handler);
        return () => {};
      },
      before: vi.fn(),
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          values: {
            autoContinue: false,
            autoApprovePermissions: false,
            maxAutoTurns: 3,
            heartbeatThresholdSeconds: 10,
          },
        }),
        subscribe: vi.fn().mockImplementation((fn) => {
          settingsSubscriber = fn;
          return () => {};
        }),
      }) as any,
      handle: vi.fn(),
      registerProvider: vi.fn(),
    };

    const cleanup = contribute(fakeServer);

    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockRespondToPermission = vi.fn().mockResolvedValue(undefined);

    const hookContext: PluginHookContext = {
      paseo: {
        agents: {
          ref: () => ({
            send: mockSend,
            respondToPermission: mockRespondToPermission,
          }),
        },
      } as any,
      signal: new AbortController().signal,
    };

    const agentB = {
      id: "agent-disabled-settings",
      workspaceId: "wks-1",
      provider: "codex",
      cwd: "/repo",
      title: "Task B",
    };

    // Trigger settings update to disable autoContinue and autoApprovePermissions
    settingsSubscriber!({
      status: "ready",
      values: {
        autoContinue: false,
        autoApprovePermissions: false,
        maxAutoTurns: 3,
        heartbeatThresholdSeconds: 10,
      },
    });

    const turnEndedListeners = listeners["agent.turn_ended"] || [];
    await turnEndedListeners[0]!(
      {
        agent: agentB,
        turnId: "turn-1",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "Unfinished:\n- [ ] Step 2",
          },
        ],
      },
      hookContext,
    );

    // autoContinue is disabled, so mockSend should NOT be called
    expect(mockSend).not.toHaveBeenCalled();

    // Permission requested with safe command, but autoApprovePermissions is false
    const permListeners = listeners["agent.permission_requested"] || [];
    await permListeners[0]!(
      {
        agent: agentB,
        request: {
          id: "req-safe-disabled",
          kind: "command",
          title: "Run git status",
          input: { cmd: "git status" },
        },
      },
      hookContext,
    );

    expect(mockRespondToPermission).not.toHaveBeenCalled();

    cleanup();
  });

  it("blocks PR merge from auto-approval and escalates with PR review card", async () => {
    const listeners: Record<string, Function[]> = {};

    const fakeServer: PluginServerContext = {
      on(name: any, handler: any) {
        if (!listeners[name]) listeners[name] = [];
        listeners[name]!.push(handler);
        return () => {};
      },
      before: vi.fn(),
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          values: {
            autoContinue: true,
            autoApprovePermissions: true,
            maxAutoTurns: 5,
            heartbeatThresholdSeconds: 15,
          },
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      }) as any,
      handle: vi.fn(),
      registerProvider: vi.fn(),
    };

    const cleanup = contribute(fakeServer);

    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockRespondToPermission = vi.fn().mockResolvedValue(undefined);
    const mockAppend = vi.fn().mockResolvedValue({ seq: 1 });

    const hookContext: PluginHookContext = {
      paseo: {
        agents: {
          ref: () => ({
            send: mockSend,
            respondToPermission: mockRespondToPermission,
            timeline: { append: mockAppend },
          }),
        },
      } as any,
      signal: new AbortController().signal,
    };

    const agentPR = {
      id: "agent-pr-merge",
      workspaceId: "wks-1",
      provider: "codex",
      cwd: "/repo",
      title: "PR Merge Task",
    };

    await Promise.resolve();
    const turnEndedListeners = listeners["agent.turn_ended"] || [];
    const permListeners = listeners["agent.permission_requested"] || [];

    // First, start an auto-turn by regular incomplete task
    await turnEndedListeners[0]!(
      {
        agent: agentPR,
        turnId: "turn-1",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "Testing completed:\n- [ ] Step 2: Merge PR",
          },
        ],
      },
      hookContext,
    );

    // Auto-continue sent prompt
    expect(mockSend).toHaveBeenCalledWith(expect.stringContaining("请继续执行下一步任务"));
    mockSend.mockClear();

    // Now permission requested for PR merge: even though autoApprovePermissions is true, PR merge MUST NOT be auto-approved!
    await permListeners[0]!(
      {
        agent: agentPR,
        request: {
          id: "req-pr-merge",
          kind: "command",
          title: "Run gh pr merge 123 --squash",
          input: { cmd: "gh pr merge 123 --squash" },
        },
      },
      hookContext,
    );

    expect(mockRespondToPermission).not.toHaveBeenCalled();

    // Next turn: agent indicates intent to merge PR
    await turnEndedListeners[0]!(
      {
        agent: agentPR,
        turnId: "turn-2",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "All checks passed. 准备合并 PR #123 到 main 分支并发布。",
          },
        ],
      },
      hookContext,
    );

    // Must NOT auto-continue
    expect(mockSend).not.toHaveBeenCalled();

    // Must append PR review card to timeline
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "watchdog-blocker",
        data: expect.objectContaining({
          agentId: "agent-pr-merge",
          rootCause: expect.stringContaining("PR merge"),
          options: expect.arrayContaining([
            expect.objectContaining({ id: "approve_pr", label: "Approve & Merge" }),
          ]),
        }),
      }),
    );

    cleanup();
  });

  it("supports per-agent auto-continue toggle and custom prompt from settings", async () => {
    const listeners: Record<string, Function[]> = {};
    const rpcHandlers = new Map<any, Function>();

    const fakeServer: PluginServerContext = {
      on(name: any, handler: any) {
        if (!listeners[name]) listeners[name] = [];
        listeners[name]!.push(handler);
        return () => {};
      },
      before: vi.fn(),
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          values: {
            autoContinue: true,
            autoApprovePermissions: true,
            maxAutoTurns: 5,
            autoContinuePrompt: "Custom steering prompt: proceed with TDD.",
            safeCommandWhitelist: ["git status", "npm test"],
            consecutiveErrorTolerance: 2,
          },
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      }) as any,
      handle(contract: any, handler: any) {
        rpcHandlers.set(contract, handler);
      },
      registerProvider: vi.fn(),
    };

    const cleanup = contribute(fakeServer);

    const mockSend = vi.fn().mockResolvedValue(undefined);
    const hookContext: PluginHookContext = {
      paseo: {
        agents: {
          ref: () => ({ send: mockSend }),
        },
      } as any,
      signal: new AbortController().signal,
    };

    const agentToggle = {
      id: "agent-toggle-test",
      workspaceId: "wks-1",
      provider: "codex",
      cwd: "/repo",
      title: "Toggle Task",
    };

    // Wait for settings.read() promise to settle
    await Promise.resolve();

    const turnEndedListeners = listeners["agent.turn_ended"] || [];
    const toggleHandler = rpcHandlers.get(radarToggleAutoContinueRpc);
    expect(toggleHandler).toBeDefined();

    // 1. Initially enabled via global default; should send custom prompt
    await turnEndedListeners[0]!(
      {
        agent: agentToggle,
        turnId: "turn-1",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "Done step 1:\n- [ ] Step 2: Next",
          },
        ],
      },
      hookContext,
    );

    expect(mockSend).toHaveBeenCalledWith("Custom steering prompt: proceed with TDD.");
    mockSend.mockClear();

    // 2. Toggle off for this agent specifically via RPC
    const toggleResult = await toggleHandler!(
      { agentId: "agent-toggle-test", enabled: false },
      hookContext,
    );
    expect(toggleResult).toEqual({ agentId: "agent-toggle-test", enabled: false });

    // 3. Next turn: should NOT auto-continue because agent override is false
    await turnEndedListeners[0]!(
      {
        agent: agentToggle,
        turnId: "turn-2",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "Done step 2:\n- [ ] Step 3: Next",
          },
        ],
      },
      hookContext,
    );

    expect(mockSend).not.toHaveBeenCalled();

    // 4. Verify snapshot returns agentAutoContinueEnabled as false
    const snapshotHandler = rpcHandlers.get(radarGetSnapshotRpc);
    const snapshot = await snapshotHandler!({ agentId: "agent-toggle-test" }, hookContext);
    expect(snapshot.watchdog.agentAutoContinueEnabled).toBe(false);

    cleanup();
  });

  it("defaults auto-continue to disabled unless explicitly turned on", async () => {
    const listeners: Record<string, Function[]> = {};

    const fakeServer: PluginServerContext = {
      on(name: any, handler: any) {
        if (!listeners[name]) listeners[name] = [];
        listeners[name]!.push(handler);
        return () => {};
      },
      before: vi.fn(),
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          values: {
            maxAutoTurns: 5,
            heartbeatThresholdSeconds: 15,
          },
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      }) as any,
      handle: vi.fn(),
      registerProvider: vi.fn(),
    };

    const cleanup = contribute(fakeServer);
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const hookContext: PluginHookContext = {
      paseo: {
        agents: {
          ref: () => ({ send: mockSend }),
        },
      } as any,
      signal: new AbortController().signal,
    };

    const agentDefault = {
      id: "agent-default-test",
      workspaceId: "wks-1",
      provider: "codex",
      cwd: "/repo",
      title: "Default Task",
    };

    await Promise.resolve();
    const turnEndedListeners = listeners["agent.turn_ended"] || [];
    await turnEndedListeners[0]!(
      {
        agent: agentDefault,
        turnId: "turn-1",
        outcome: { kind: "completed" },
        timeline: [
          {
            type: "assistant_message",
            text: "Unfinished:\n- [ ] Step 2",
          },
        ],
      },
      hookContext,
    );

    // Because autoContinue defaults to false, mockSend MUST NOT be called!
    expect(mockSend).not.toHaveBeenCalled();

    cleanup();
  });
});
