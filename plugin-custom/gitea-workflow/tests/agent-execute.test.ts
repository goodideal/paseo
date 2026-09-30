import { describe, it, expect, vi } from "vitest";
import { createAgentExecuteAdapter } from "../server/adapters/agent-execute.js";

describe("Agent Execute Adapter", () => {
  it("locates worktree by runId and awaits agent.run to extract proposal summary", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("claude-3-7-sonnet"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 42,
        issueTitle: "Implement vector caching",
      }),
    };

    const mockAgentHandle = {
      id: "agent-exec-1",
      run: vi.fn().mockResolvedValue({
        status: "idle",
        lastMessage: "### 方案选型\n- 方案 A: 内存 LRU\n- 方案 B: SQLite FTS5\n推荐方案 A。",
        error: null,
      }),
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            {
              id: "ws-wt-run-99",
              workspaceDirectory: "/tmp/worktrees/run-99",
              name: "worktree-run-99",
              workspaceKind: "worktree",
            },
            {
              id: "ws-wt-other",
              workspaceDirectory: "/tmp/worktrees/other-task",
              name: "worktree-other",
              workspaceKind: "worktree",
            },
          ],
        }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);

    const result = await adapter.execute({ phase: "brainstorm" }, {
      paseo: mockPaseo as any,
      run: { runId: "run-99", projectId: "proj-1" },
      step: { stepId: "brainstorm-agent" },
    } as any);

    // 1. Verifies worktree is specifically matched to runId, NOT ws-wt-other
    expect(mockPaseo.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/worktrees/run-99",
        workspaceId: "ws-wt-run-99",
        title: "💡 [#42] 方案设计 · Implement vector caching",
      }),
    );

    // 2. Verifies agentHandle.run was called to await execution
    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      expect.stringContaining("use the `gitea` skill to fetch Issue #42"),
    );

    // 3. Verifies proposal summary is returned in result
    expect(result.summary).toContain("### 方案选型");
    expect(result.status).toBe("succeeded");
  });
  it("passes configured changeMode (e.g. Codex full-access) to agent create options", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("codex"),
      getAgentModel: vi.fn().mockReturnValue("gpt-5.4"),
      getAgentChangeMode: vi.fn().mockReturnValue("full-access"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 55,
        issueTitle: "Analyze auth performance",
      }),
    };
    const mockAgentHandle = {
      id: "agent-mode-1",
      run: vi.fn().mockResolvedValue({
        status: "idle",
        lastMessage: "Execution complete.",
      }),
    };
    const mockPaseo = {
      workspaces: { list: vi.fn().mockResolvedValue({ entries: [] }) },
      agents: { create: vi.fn().mockResolvedValue(mockAgentHandle) },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
    await adapter.execute({ phase: "implement" }, {
      paseo: mockPaseo as any,
      run: { runId: "run-mode-55", projectId: "proj-codex" },
      step: { stepId: "implement-agent" },
    } as any);

    expect(mockPaseo.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          provider: "codex/gpt-5.4",
          modeId: "full-access",
        }),
      }),
    );
  });
});
