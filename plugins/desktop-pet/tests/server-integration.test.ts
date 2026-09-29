import { describe, it, expect, vi } from "vitest";
import contribute from "../index.server.js";
import { getDashboardRpc } from "../shared/contracts.js";

describe("Server Entry Integration", () => {
  it("registers lifecycle hooks and handles RPCs correctly", async () => {
    const registeredHooks: Record<string, Function> = {};
    const registeredRpcs: Record<string, Function> = {};

    const mockServer = {
      on: vi.fn((event: string, handler: Function) => {
        registeredHooks[event] = handler;
      }),
      handle: vi.fn((contract: any, handler: Function) => {
        registeredRpcs[contract.name] = handler;
      }),
      registerSettings: vi.fn().mockReturnValue({ read: vi.fn() }),
      paseo: {
        agents: {
          ref: vi.fn().mockReturnValue({
            respondToPermission: vi.fn(),
          }),
        },
      },
    };

    const cleanup = contribute(mockServer as any);
    expect(mockServer.on).toHaveBeenCalledWith("agent.turn_started", expect.any(Function));
    expect(mockServer.on).toHaveBeenCalledWith("agent.turn_ended", expect.any(Function));
    expect(mockServer.on).toHaveBeenCalledWith("agent.permission_requested", expect.any(Function));
    expect(mockServer.on).toHaveBeenCalledWith("agent.permission_resolved", expect.any(Function));
    expect(registeredRpcs["pet.get_dashboard"]).toBeDefined();

    // Call dashboard RPC
    const dashboard = await registeredRpcs["pet.get_dashboard"]({});
    expect(dashboard.runningCount).toBe(0);

    cleanup();
  });
});
