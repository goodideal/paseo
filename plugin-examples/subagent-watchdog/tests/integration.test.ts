import { describe, it, expect, vi } from "vitest";
import contribute from "../index.server.js";
import { resolveDecisionRpc, interruptAgentRpc, getWatchdogStatusRpc } from "../shared/rpc.js";
import type { PluginServerContext, PluginHookContext } from "@getpaseo/plugin/server";

describe("Subagent Watchdog Integration Test", () => {
  it("orchestrates turn monitoring, auto-continuation, blocker escalation, and decision RPC", async () => {
    const listeners: Record<string, Function[]> = {};
    const rpcHandlers = new Map<unknown, Function>();

    const fakeServer = {
      on(name: string, handler: Function) {
        if (!listeners[name]) listeners[name] = [];
        listeners[name]!.push(handler);
        return () => {};
      },
      before: vi.fn(),
      registerSettings: vi.fn(),
      handle(contract: unknown, handler: Function) {
        rpcHandlers.set(contract, handler);
      },
      registerProvider: vi.fn(),
    } as unknown as PluginServerContext;

    // Initialize plugin
    const cleanup = contribute(fakeServer);

    const mockSend = vi.fn().mockResolvedValue(undefined);
    const mockRespondToPermission = vi.fn().mockResolvedValue(undefined);

    const fakePaseoApi = {
      agents: {
        ref: (id: string) => ({
          send: mockSend,
          respondToPermission: mockRespondToPermission,
        }),
      },
    };

    const hookContext = {
      paseo: fakePaseoApi,
      signal: new AbortController().signal,
    } as unknown as PluginHookContext;

    // 1. Simulate a turn with incomplete tasks (- [ ])
    const turnEndedListeners = listeners["agent.turn_ended"] || [];
    expect(turnEndedListeners.length).toBeGreaterThan(0);

    const agentA = {
      id: "agent-task-1",
      workspaceId: "wks-1",
      parentAgentId: "parent-1",
      provider: "codex",
      cwd: "/repo",
      title: "Task 1",
    };

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
    await permListeners[0]!(
      {
        agent: agentA,
        request: {
          id: "req-1",
          kind: "command",
          title: "Run git status",
        },
      },
      hookContext,
    );

    expect(mockRespondToPermission).toHaveBeenCalledWith({
      requestId: "req-1",
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
