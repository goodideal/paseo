import { describe, expect, it, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceEvolutionService } from "./workspace-evolution-service.js";
import type { StoredAgentLike } from "./agent-milestone-summarizer.js";

describe("glorious-eagle Real Workspace Evolution Verification", () => {
  let tmpDir: string;
  const realAgentsDir = path.join(
    os.homedir(),
    ".paseo/agents/Users-jerry-.paseo-worktrees-01v9kkez-glorious-eagle",
  );

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-eagle-verify-"));
  });

  it("extracts and synthesizes evolution timeline from glorious-eagle agents", async () => {
    let dirExists = false;
    try {
      await fs.access(realAgentsDir);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    if (!dirExists) {
      console.warn("Skipping real workspace verification: agents directory not present");
      return;
    }

    const files = await fs.readdir(realAgentsDir);
    const agentRecords: StoredAgentLike[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(realAgentsDir, file), "utf8");
      const record = JSON.parse(raw) as StoredAgentLike;
      agentRecords.push(record);
    }

    expect(agentRecords.length).toBeGreaterThanOrEqual(4);

    const workspaceId = "wks_7349dafdd357c9fb";
    const service = new WorkspaceEvolutionService({
      cacheRoot: tmpDir,
      agentStorage: {
        list: async () => agentRecords,
        get: async (id) => agentRecords.find((a) => a.id === id) ?? null,
      },
      workspaceRegistry: {
        get: async () => ({
          workspaceId,
          displayName: "glorious-eagle",
          title: "集群化改造",
          branch: "agent/issue-113-req-tr-s-p1-cli-proxy-api-hub",
          cwd: "/Users/jerry/.paseo/worktrees/01v9kkez/glorious-eagle",
        }),
      },
    });

    const digest = await service.getDigest(workspaceId);

    expect(digest).not.toBeNull();
    expect(digest?.workspaceId).toBe(workspaceId);
    expect(digest?.workspaceTitle).toBe("集群化改造");
    expect(digest?.branch).toBe("agent/issue-113-req-tr-s-p1-cli-proxy-api-hub");
    expect(digest?.milestones.length).toBe(agentRecords.length);

    // Verify chronological order
    const timestamps = digest!.milestones.map((m) => new Date(m.startedAt).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }

    // Verify each milestone has executiveSummary and keyDecisions
    for (const milestone of digest!.milestones) {
      expect(milestone.executiveSummary.length).toBeGreaterThan(0);
      expect(milestone.keyDecisions.length).toBeGreaterThan(0);
    }

    // Verify cache file was written
    const cacheRaw = await fs.readFile(path.join(tmpDir, workspaceId, "digest.json"), "utf8");
    const cached = JSON.parse(cacheRaw);
    expect(cached.workspaceTitle).toBe("集群化改造");
  });
});
