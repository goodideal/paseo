import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";
import type { PluginServerContext } from "@getpaseo/plugin/server";

describe("Plugin Server Entrypoint", () => {
  it("registers required RPC handlers", () => {
    const handlers = new Map<string, unknown>();
    const mockServer = {
      handle: vi.fn((contract: { name: string }, handler: unknown) => {
        handlers.set(contract.name, handler);
      }),
      registerSettings: vi.fn(),
      on: vi.fn(),
    } as unknown as PluginServerContext;

    const cleanup = contribute(mockServer);
    expect(handlers.has("gitea.tasks.list")).toBe(true);
    expect(handlers.has("gitea.tasks.approve")).toBe(true);
    expect(handlers.has("gitea.tasks.reject")).toBe(true);
    expect(typeof cleanup).toBe("function");
  });
});
