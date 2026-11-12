import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  getWorkspaceDigestRpc,
  subscribeWorkspaceDigest,
  type WorkspaceEvolutionDigest,
} from "./shared/contracts.js";
import {
  WorkspaceEvolutionService,
  type EvolutionServiceDataSource,
} from "./server/evolution-service.js";

function getCacheRoot(): string {
  const paseoHome = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
  return path.join(paseoHome, "cache", "workspace-evolution");
}

function createPaseoDataSource(paseo: any): EvolutionServiceDataSource {
  return {
    async listAgents(workspaceId: string) {
      if (typeof paseo?.agents?.list !== "function") return [];
      try {
        const res = await paseo.agents.list({
          includeArchived: true,
          includeSubagents: true,
        });
        const entries = res?.entries ?? [];
        return entries
          .map((e: any) => e.agent ?? e)
          .filter((a: any) => !workspaceId || a.workspaceId === workspaceId)
          .map((agent: any) => ({
            id: agent.id,
            provider: agent.provider,
            cwd: agent.cwd,
            workspaceId: agent.workspaceId,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
            lastActivityAt: agent.lastActivityAt,
            title: agent.title,
            status: agent.status,
            labels: agent.labels,
            parentAgentId: agent.parentAgentId,
            model: agent.model,
            runtimeInfo: agent.runtimeInfo,
            archivedAt: agent.archivedAt,
          }));
      } catch {
        return [];
      }
    },
    async getWorkspace(workspaceId: string) {
      if (typeof paseo?.workspaces?.list !== "function") return null;
      try {
        const res = await paseo.workspaces.list({ includeArchived: true });
        const entries = res?.entries ?? [];
        const found = entries.find((w: any) => (w.id ?? w.workspaceId) === workspaceId);
        if (!found) return null;
        return {
          id: found.id ?? found.workspaceId,
          title: found.title ?? found.name,
          name: found.name,
          branch: found.currentBranch ?? null,
          cwd: found.workspaceDirectory ?? null,
        };
      } catch {
        return null;
      }
    },
  };
}

export default function contribute(server: PluginServerContext) {
  const cleanups: Array<() => void> = [];
  const subscribers = new Map<string, Set<(digest: WorkspaceEvolutionDigest) => void>>();

  const service = new WorkspaceEvolutionService({
    cacheRoot: getCacheRoot(),
    onUpdated(workspaceId, digest) {
      const workspaceListeners = subscribers.get(workspaceId);
      if (!workspaceListeners) return;
      for (const listener of workspaceListeners) {
        listener(digest);
      }
    },
  });

  server.handle(getWorkspaceDigestRpc, async (input, context) => {
    try {
      const source = createPaseoDataSource(context.paseo);
      const digest = await service.getDigest(input.workspaceId, source, {
        forceRefresh: input.forceRefresh,
      });
      return {
        workspaceId: input.workspaceId,
        digest,
        isAnalyzing: false,
      };
    } catch (error) {
      return {
        workspaceId: input.workspaceId,
        digest: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  server.handle(subscribeWorkspaceDigest, (input, context) => {
    let set = subscribers.get(input.workspaceId);
    if (!set) {
      set = new Set();
      subscribers.set(input.workspaceId, set);
    }
    const listener = (digest: WorkspaceEvolutionDigest) => {
      void context.push({ workspaceId: input.workspaceId, digest });
    };
    set.add(listener);
    context.signal.addEventListener(
      "abort",
      () => {
        set?.delete(listener);
        if (set && set.size === 0) {
          subscribers.delete(input.workspaceId);
        }
      },
      { once: true },
    );
  });

  cleanups.push(
    server.addHook("agent.create.after", async ({ agent }, context) => {
      if (!agent.workspaceId) return;
      await service
        .refreshAndNotify(agent.workspaceId, createPaseoDataSource(context.paseo))
        .catch(() => undefined);
    }),
  );

  cleanups.push(
    server.addHook("agent.turn.after", async ({ agent }, context) => {
      if (!agent.workspaceId) return;
      await service
        .refreshAndNotify(agent.workspaceId, createPaseoDataSource(context.paseo))
        .catch(() => undefined);
    }),
  );

  cleanups.push(
    server.addHook("agent.archive.after", async ({ agent }, context) => {
      if (!agent.workspaceId) return;
      await service
        .refreshAndNotify(agent.workspaceId, createPaseoDataSource(context.paseo))
        .catch(() => undefined);
    }),
  );

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    subscribers.clear();
  };
}
