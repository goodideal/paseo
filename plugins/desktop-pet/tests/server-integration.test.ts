import { describe, it, expect, vi } from "vitest";
import contribute from "../index.server.js";
import { getDashboardRpc } from "../shared/contracts.js";

describe("Server Entry Integration", () => {
  it("registers observeAgents, handles RPCs and updates projection", async () => {
    let observerCallbacks: any = null;
    const registeredRpcs: Record<string, Function> = {};
    const mockDispose = vi.fn();

    const mockServer = {
      observeAgents: vi.fn((observer) => {
        observerCallbacks = observer;
        return { dispose: mockDispose };
      }),
      on: vi.fn(),
      handle: vi.fn((contract: any, handler: Function) => {
        registeredRpcs[contract.name] = handler;
      }),
      registerSettings: vi.fn().mockReturnValue({ read: vi.fn() }),
    };

    const cleanup = contribute(mockServer as any);
    expect(mockServer.observeAgents).toHaveBeenCalled();
    expect(registeredRpcs["pet.get_dashboard"]).toBeDefined();

    // Deliver snapshot via observer
    const initialAgent: any = {
      id: "agent-initial-1",
      title: "Initial Task",
      status: "running",
      activeTurn: { turnId: "turn-1", startedAt: "2026-09-29T10:00:00.000Z" },
      pendingPermissions: [],
      cwd: "/repo",
      createdAt: "2026-09-29T09:00:00.000Z",
      updatedAt: "2026-09-29T10:00:00.000Z",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    };
    observerCallbacks.onSnapshot([initialAgent]);

    const dashboard = await registeredRpcs["pet.get_dashboard"]({});
    expect(dashboard.runningCount).toBe(1);
    expect(dashboard.tasks[0].taskTitle).toBe("Initial Task");
    expect(dashboard.tasks[0].state).toBe("RUNNING");

    // Call respond permission RPC with context.paseo
    const mockRespond = vi.fn().mockResolvedValue(undefined);
    const mockPaseo = {
      agents: {
        ref: vi.fn().mockReturnValue({
          respondToPermission: mockRespond,
        }),
      },
    };
    const respondResult = await registeredRpcs["pet.respond_permission"](
      { agentId: "agent-123", requestId: "req-1", behavior: "allow" },
      { paseo: mockPaseo },
    );
    expect(respondResult.success).toBe(true);
    expect(mockPaseo.agents.ref).toHaveBeenCalledWith("agent-123");
    expect(mockRespond).toHaveBeenCalledWith({
      requestId: "req-1",
      response: { behavior: "allow" },
    });

    cleanup();
    expect(mockDispose).toHaveBeenCalled();
  });

  it("sorts mixed multi-agent states by P0 > P1 > P2 and updates petMood", async () => {
    let observerCallbacks: any = null;
    const registeredRpcs: Record<string, Function> = {};

    const mockServer = {
      observeAgents: vi.fn((observer) => {
        observerCallbacks = observer;
        return { dispose: vi.fn() };
      }),
      on: vi.fn(),
      handle: vi.fn((contract: any, handler: Function) => {
        registeredRpcs[contract.name] = handler;
      }),
      registerSettings: vi.fn().mockReturnValue({ read: vi.fn() }),
    };

    const cleanup = contribute(mockServer as any);

    const idleAgent: any = {
      id: "agent-idle",
      title: "Idle Worker",
      status: "idle",
      pendingPermissions: [],
      activeTurn: null,
      createdAt: "",
      updatedAt: "",
      cwd: "",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    };

    const runningAgent: any = {
      id: "agent-running",
      title: "Running Worker",
      status: "running",
      activeTurn: { turnId: "turn-1", startedAt: new Date(Date.now() - 3000).toISOString() },
      pendingPermissions: [],
      createdAt: "",
      updatedAt: "",
      cwd: "",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    };

    const urgentAgent: any = {
      id: "agent-urgent",
      title: "High Risk Permission Worker",
      status: "running",
      activeTurn: { turnId: "turn-2", startedAt: new Date(Date.now() - 10000).toISOString() },
      pendingPermissions: [
        {
          id: "req-danger",
          kind: "shell",
          command: "rm -rf /dist",
          riskHint: "high",
          requestedAt: new Date().toISOString(),
        },
      ],
      createdAt: "",
      updatedAt: "",
      cwd: "",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    };

    // Deliver multi-agent snapshot in mixed order: idle, urgent, running
    observerCallbacks.onSnapshot([idleAgent, urgentAgent, runningAgent]);

    const dashboard = await registeredRpcs["pet.get_dashboard"]({});
    expect(dashboard.tasks.length).toBe(3);
    // P0 must be first
    expect(dashboard.tasks[0].agentId).toBe("agent-urgent");
    expect(dashboard.tasks[0].priority).toBe("P0");
    expect(dashboard.tasks[0].pendingDecision?.requestId).toBe("req-danger");

    // P1 must be second
    expect(dashboard.tasks[1].agentId).toBe("agent-running");
    expect(dashboard.tasks[1].priority).toBe("P1");

    // P2 must be third
    expect(dashboard.tasks[2].agentId).toBe("agent-idle");
    expect(dashboard.tasks[2].priority).toBe("P2");

    // petMood must be urgent due to high risk
    expect(dashboard.petMood).toBe("urgent");

    // Also verify respond_permission updates XP and projection
    const mockRespond = vi.fn().mockResolvedValue(undefined);
    const mockPaseo = {
      agents: {
        ref: vi.fn().mockReturnValue({
          respondToPermission: mockRespond,
        }),
      },
    };
    await registeredRpcs["pet.respond_permission"](
      { agentId: "agent-urgent", requestId: "req-danger", behavior: "allow" },
      { paseo: mockPaseo },
    );

    const updatedDashboard = await registeredRpcs["pet.get_dashboard"]({});
    expect(updatedDashboard.petXp).toBe(15);

    cleanup();
  });
});
