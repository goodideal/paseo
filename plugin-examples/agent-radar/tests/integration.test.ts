import { describe, it, expect, vi } from "vitest";
import contribute from "../index.server.js";
import { resolveDecisionRpc, interruptAgentRpc, getWatchdogStatusRpc } from "../shared/rpc.js";
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
          values: { maxAutoTurns: 5, heartbeatThresholdSeconds: 15 },
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

    cleanup();
  });
});
