import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import contributeServer from "../index.server.js";
import contributeClient from "../index.client.js";
import { WorkspaceEvolutionService } from "../server/evolution-service.js";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PluginClientContext } from "@getpaseo/plugin/client";

describe("Workspace Reader Plugin", () => {
  it("builds digest and caches completed milestones without touching host internals", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-reader-test-"));
    try {
      const updates: Array<{ workspaceId: string }> = [];
      const service = new WorkspaceEvolutionService({
        cacheRoot: tmpDir,
        onUpdated: (workspaceId) => updates.push({ workspaceId }),
      });

      const digest = await service.refreshAndNotify("wks_1", {
        async getWorkspace() {
          return {
            id: "wks_1",
            title: "De-intrusion Refactor",
            branch: "custom-features",
            cwd: "/repo",
          };
        },
        async listAgents() {
          return [
            {
              id: "agt_1",
              provider: "claude",
              cwd: "/repo",
              workspaceId: "wks_1",
              createdAt: "2026-11-12T00:00:00.000Z",
              updatedAt: "2026-11-12T00:05:00.000Z",
              title: "Code review and architecture audit",
              status: "idle",
              model: "claude-sonnet-4",
            },
          ];
        },
      });

      expect(digest).not.toBeNull();
      expect(digest?.overallStatus).toBe("ready_for_review");
      expect(digest?.milestones).toHaveLength(1);
      expect(digest?.milestones[0]?.agentId).toBe("agt_1");
      expect(updates).toEqual([{ workspaceId: "wks_1" }]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("registers server RPC, subscription, and lifecycle hooks cleanly", () => {
    const handlers = new Map<string, unknown>();
    const hooks = new Map<string, unknown>();

    const server: Partial<PluginServerContext> = {
      handle: vi.fn((contract: { name: string }, handler: unknown) => {
        handlers.set(contract.name, handler);
      }) as PluginServerContext["handle"],
      addHook: vi.fn((name: string, handler: unknown) => {
        hooks.set(name, handler);
        return () => hooks.delete(name);
      }) as PluginServerContext["addHook"],
      registerUsageSource: vi.fn(),
    };

    const cleanup = contributeServer(server as PluginServerContext);
    expect(handlers.has("workspace_reader.digest.get.request")).toBe(true);
    expect(handlers.has("workspace_reader.digest.subscribe")).toBe(true);
    expect(hooks.has("agent.create.after")).toBe(true);
    expect(hooks.has("agent.turn.after")).toBe(true);
    expect(hooks.has("agent.archive.after")).toBe(true);

    void cleanup();
    expect(hooks.size).toBe(0);
  });

  it("registers client workspace panel and command center item cleanly", () => {
    const panels: string[] = [];
    const commands: string[] = [];

    const client: Partial<PluginClientContext> = {
      addWorkspacePanel: vi.fn(
        (_c) => () => {},
      ) as unknown as PluginClientContext["addWorkspacePanel"],
      addCommandCenterItem: vi.fn(
        (_c) => () => {},
      ) as unknown as PluginClientContext["addCommandCenterItem"],
      addHeaderButton: vi.fn(() => ({ update: vi.fn(), remove: vi.fn() })),
    };

    const cleanup = contributeClient(client as PluginClientContext);
    expect(cleanup).toBeDefined();
    expect(client.addWorkspacePanel).toHaveBeenCalled();
    expect(client.addCommandCenterItem).toHaveBeenCalled();
  });
});
