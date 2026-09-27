import { describe, expect, it, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  WorkspaceEvolutionService,
  type WorkspaceEvolutionServiceDeps,
} from "./workspace-evolution-service.js";
import type { WorkspaceEvolutionDigest } from "@getpaseo/protocol/evolution";
import type { StoredAgentLike } from "./agent-milestone-summarizer.js";

describe("WorkspaceEvolutionService", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-evo-test-"));
  });

  it("reads existing cached digest if present", async () => {
    const mockAgentStorage: WorkspaceEvolutionServiceDeps["agentStorage"] = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
    };
    const mockWorkspaceRegistry: WorkspaceEvolutionServiceDeps["workspaceRegistry"] = {
      get: vi.fn().mockResolvedValue({
        workspaceId: "wks_1",
        displayName: "glorious-eagle",
        branch: "feat/cluster",
      }),
    };

    const service = new WorkspaceEvolutionService({
      cacheRoot: tmpDir,
      agentStorage: mockAgentStorage,
      workspaceRegistry: mockWorkspaceRegistry,
    });

    const cachedData: WorkspaceEvolutionDigest = {
      workspaceId: "wks_1",
      workspaceTitle: "glorious-eagle",
      branch: "feat/cluster",
      executiveSummary: "已完成架构调研",
      currentStage: "已完成",
      overallStatus: "completed",
      updatedAt: new Date().toISOString(),
      milestones: [],
    };

    const wksDir = path.join(tmpDir, "wks_1");
    await fs.mkdir(wksDir, { recursive: true });
    await fs.writeFile(path.join(wksDir, "digest.json"), JSON.stringify(cachedData));

    const digest = await service.getDigest("wks_1");
    expect(digest?.executiveSummary).toBe("已完成架构调研");
    expect(digest?.workspaceTitle).toBe("glorious-eagle");
  });

  it("builds new digest from agents in storage if cache is missing", async () => {
    const mockAgents: StoredAgentLike[] = [
      {
        id: "agent-1",
        provider: "codex",
        cwd: "/path/to/wks_1",
        workspaceId: "wks_1",
        title: "调研 DocDB 集群部署方式",
        createdAt: "2026-09-27T01:00:00.000Z",
        updatedAt: "2026-09-27T01:30:00.000Z",
        lastStatus: "idle",
        config: { model: "gemini-flash" },
      },
    ];

    const findAgent = (id: string) => mockAgents.find((a) => a.id === id) ?? null;
    const mockAgentStorage: WorkspaceEvolutionServiceDeps["agentStorage"] = {
      list: vi.fn().mockResolvedValue(mockAgents),
      get: vi.fn().mockImplementation(findAgent),
    };
    const mockWorkspaceRegistry: WorkspaceEvolutionServiceDeps["workspaceRegistry"] = {
      get: vi.fn().mockResolvedValue({
        workspaceId: "wks_1",
        displayName: "glorious-eagle",
        branch: "feat/cluster",
      }),
    };

    const service = new WorkspaceEvolutionService({
      cacheRoot: tmpDir,
      agentStorage: mockAgentStorage,
      workspaceRegistry: mockWorkspaceRegistry,
    });

    const digest = await service.getDigest("wks_1");
    expect(digest).not.toBeNull();
    expect(digest?.workspaceId).toBe("wks_1");
    expect(digest?.milestones.length).toBe(1);
    expect(digest?.milestones[0].agentId).toBe("agent-1");
    expect(digest?.milestones[0].intentPrompt).toBe("调研 DocDB 集群部署方式");

    // Check that cache file was written
    const cacheExists = await fs
      .access(path.join(tmpDir, "wks_1", "digest.json"))
      .then(() => true)
      .catch(() => false);
    expect(cacheExists).toBe(true);
  });
});
