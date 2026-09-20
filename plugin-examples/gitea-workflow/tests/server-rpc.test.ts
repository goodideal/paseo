import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";
import type { PluginServerContext } from "@getpaseo/plugin/server";

describe("Server RPC Handlers", () => {
  it("registers and responds to RPCs with project filtering", async () => {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    const mockServer: Partial<PluginServerContext> = {
      handle: vi.fn().mockImplementation((contract, handler) => {
        handlers.set(contract.name, handler);
      }),
    };

    const cleanup = contribute(mockServer as PluginServerContext);

    expect(handlers.has("gitea.tasks.list")).toBe(true);
    expect(handlers.has("gitea.tasks.get")).toBe(true);
    expect(handlers.has("gitea.tasks.approve")).toBe(true);
    expect(handlers.has("gitea.tasks.reject")).toBe(true);

    const mockCtx = {
      paseo: {
        projects: { list: vi.fn().mockResolvedValue({ projects: [] }) },
        workspaces: {
          ref: vi.fn().mockReturnValue({
            current: () => ({ projectId: "proj-my-app" }),
          }),
        },
      },
    };

    const listHandler = handlers.get("gitea.tasks.list")!;
    const listRes = (await listHandler({ workspaceId: "ws-123" }, mockCtx)) as { tasks: unknown[] };
    expect(listRes.tasks).toEqual([]);

    cleanup();
  });
});
