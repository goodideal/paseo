import { describe, it, expect, vi } from "vitest";
import {
  createAgentExecuteAdapter,
  normalizeAgentChangeMode,
} from "../server/adapters/agent-execute.js";

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

    const mockWsRef = {
      current: vi.fn().mockReturnValue({ id: "ws-wt-run-99", title: null }),
      setTitle: vi.fn().mockResolvedValue(undefined),
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
        ref: vi.fn().mockReturnValue(mockWsRef),
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
      expect.stringContaining("superpowers:brainstorming"),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );

    // 3. Verifies proposal summary is returned in result
    expect(result.summary).toContain("### 方案选型");
    expect(result.status).toBe("succeeded");

    // 4. Verifies workspace title is set semantically
    expect(mockWsRef.setTitle).toHaveBeenCalledWith("✨ #42 [Feature] Implement vector caching");
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
      run: { runId: "run-mode-55", projectId: "proj-codex", workspaceRoot: "/projects/test-proj" },
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

  it("locates worktree by issue number when multiple worktrees exist without runId", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("codex"),
      getAgentModel: vi.fn().mockReturnValue("flash"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 201,
        issueTitle: "Error on openai gateway",
      }),
    };

    const mockAgentHandle = {
      id: "agent-issue-201",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            {
              id: "ws-wt-199",
              workspaceDirectory: "/tmp/worktrees/joyous-deer",
              name: "agent/issue-199-some-fix",
              workspaceKind: "worktree",
              projectRootPath: "/projects/repo",
            },
            {
              id: "ws-wt-201",
              workspaceDirectory: "/tmp/worktrees/agent-issue-201-auto-incident",
              name: "agent/issue-201-auto-incident",
              title: "✨ #201 [Feature] Error on openai",
              workspaceKind: "worktree",
              projectRootPath: "/projects/repo",
            },
            {
              id: "ws-main",
              workspaceDirectory: "/projects/repo",
              name: "main-checkout",
              workspaceKind: "local_checkout",
              projectRootPath: "/projects/repo",
            },
          ],
        }),
        ref: vi.fn().mockReturnValue({
          current: vi
            .fn()
            .mockReturnValue({ id: "ws-wt-201", title: "✨ #201 [Feature] Error on openai" }),
          setTitle: vi.fn().mockResolvedValue(undefined),
        }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);

    await adapter.execute({ phase: "auto_design" }, {
      paseo: mockPaseo as any,
      run: { runId: "run_e7ffe63d", projectId: "prj_test" },
      step: { stepId: "auto-design" },
    } as any);

    expect(mockPaseo.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/worktrees/agent-issue-201-auto-incident",
        workspaceId: "ws-wt-201",
        title: expect.stringContaining("[#201]"),
      }),
    );
  });

  it("never falls back to process.cwd() and safely uses project checkout root", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("codex"),
      getAgentModel: vi.fn().mockReturnValue("flash"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 999,
        issueTitle: "Unmatched issue",
      }),
    };

    const mockAgentHandle = {
      id: "agent-safe-fallback",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            {
              id: "ws-main",
              workspaceDirectory: "/projects/my-safe-repo",
              name: "main-checkout",
              workspaceKind: "local_checkout",
              projectRootPath: "/projects/my-safe-repo",
            },
          ],
        }),
        ref: vi.fn().mockReturnValue({
          current: vi.fn().mockReturnValue({ id: "ws-main" }),
          setTitle: vi.fn().mockResolvedValue(undefined),
        }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);

    await adapter.execute({ phase: "implement" }, {
      paseo: mockPaseo as any,
      run: { runId: "run_nomatch", projectId: "prj_test" },
      step: { stepId: "implement-agent" },
    } as any);

    expect(mockPaseo.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/projects/my-safe-repo",
        workspaceId: "ws-main",
      }),
    );
  });

  it("locates worktree using stepOutputs from worktree-create when available", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("codex"),
      getAgentModel: vi.fn().mockReturnValue("flash"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 300,
        issueTitle: "Use step output",
      }),
    };

    const mockAgentHandle = {
      id: "agent-step-output",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            {
              id: "ws-wt-custom",
              workspaceDirectory: "/tmp/worktrees/custom-slug",
              name: "custom-slug",
              workspaceKind: "worktree",
              projectRootPath: "/projects/repo",
            },
          ],
        }),
        ref: vi.fn().mockReturnValue({
          current: vi.fn().mockReturnValue({ id: "ws-wt-custom" }),
          setTitle: vi.fn().mockResolvedValue(undefined),
        }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);

    await adapter.execute({ phase: "implement" }, {
      paseo: mockPaseo as any,
      run: { runId: "run_step_out", projectId: "prj_test" },
      stepOutputs: {
        "worktree-create": {
          workspaceId: "ws-wt-custom",
          worktreePath: "/tmp/worktrees/custom-slug",
        },
      },
      step: { stepId: "implement-agent" },
    } as any);

    expect(mockPaseo.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/worktrees/custom-slug",
        workspaceId: "ws-wt-custom",
      }),
    );
  });

  it("interpolates and passes custom agentAutoPrompt for auto_design phase", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("sonnet"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
      getAgentAutoPrompt: vi
        .fn()
        .mockReturnValue(
          "Custom Auto for #{{issueNumber}} in {{repoOwner}}/{{repoName}}: {{issueTitle}}. Description: {{issueBody}}",
        ),
      getAgentPlanPrompt: vi.fn().mockReturnValue("Custom Plan"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 88,
        issueTitle: "Auto fix memory leak",
        issueBody: "Memory increases monotonically under load.",
        repoOwner: "infra-team",
        repoName: "cluster-agent",
      }),
    };
    const mockAgentHandle = {
      id: "agent-custom-prompt-auto",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            { id: "ws-1", workspaceDirectory: "/projects/repo", workspaceKind: "local_checkout" },
          ],
        }),
        ref: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue({ id: "ws-1" }) }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
    await adapter.execute({ phase: "auto_design" }, {
      paseo: mockPaseo as any,
      run: { runId: "run-auto-88", projectId: "prj-infra" },
      step: { stepId: "auto-design" },
    } as any);

    expect(mockSettings.getAgentAutoPrompt).toHaveBeenCalledWith("prj-infra");
    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      "Custom Auto for #88 in infra-team/cluster-agent: Auto fix memory leak. Description: Memory increases monotonically under load.",
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("interpolates and passes custom agentPlanPrompt for brainstorm phase", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("sonnet"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
      getAgentAutoPrompt: vi.fn().mockReturnValue("Custom Auto"),
      getAgentPlanPrompt: vi
        .fn()
        .mockReturnValue("Custom Plan for #{{issueNumber}}: {{issueTitle}} (repo: {{repoName}})"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 77,
        issueTitle: "Plan architectural migration",
        repoOwner: "core-team",
        repoName: "web-gateway",
      }),
    };
    const mockAgentHandle = {
      id: "agent-custom-prompt-plan",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            { id: "ws-1", workspaceDirectory: "/projects/repo", workspaceKind: "local_checkout" },
          ],
        }),
        ref: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue({ id: "ws-1" }) }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
    await adapter.execute({ phase: "brainstorm" }, {
      paseo: mockPaseo as any,
      run: { runId: "run-plan-77", projectId: "prj-core" },
      step: { stepId: "brainstorm-agent" },
    } as any);

    expect(mockSettings.getAgentPlanPrompt).toHaveBeenCalledWith("prj-core");
    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      "Custom Plan for #77: Plan architectural migration (repo: web-gateway)",
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("interpolates default DEFAULT_AGENT_AUTO_PROMPT with issue body, repo, and branch", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("sonnet"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
      getAgentAutoPrompt: vi.fn().mockReturnValue(""),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 393,
        issueTitle: "Warning: Setting NODE_TLS_REJECT_UNAUTHORIZED",
        issueBody: "Stack trace: error in node fetch with self-signed certificate",
        repoOwner: "infra-team",
        repoName: "cluster-agent",
      }),
    };
    const mockAgentHandle = {
      id: "agent-default-auto",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            { id: "ws-1", workspaceDirectory: "/projects/repo", workspaceKind: "local_checkout" },
          ],
        }),
        ref: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue({ id: "ws-1" }) }),
      },
      agents: {
        create: vi.fn().mockResolvedValue(mockAgentHandle),
      },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
    await adapter.execute({ phase: "auto_design" }, {
      paseo: mockPaseo as any,
      run: {
        runId: "run-393",
        projectId: "prj-infra",
        runInput: { branch: "agent/issue-393-tls-warning" },
      },
      step: { stepId: "auto-design" },
    } as any);

    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      expect.stringContaining("Gitea Issue #393: Warning: Setting NODE_TLS_REJECT_UNAUTHORIZED"),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      expect.stringContaining(
        "Repository: infra-team/cluster-agent | Branch: agent/issue-393-tls-warning",
      ),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      expect.stringContaining("Stack trace: error in node fetch with self-signed certificate"),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  describe("normalizeAgentChangeMode", () => {
    it("maps full-access to bypassPermissions for claude provider", () => {
      expect(normalizeAgentChangeMode("claude", "full-access")).toBe("bypassPermissions");
      expect(normalizeAgentChangeMode("claude", "auto")).toBe("auto");
      expect(normalizeAgentChangeMode("claude", "plan")).toBe("plan");
      expect(normalizeAgentChangeMode("claude", "default")).toBe("default");
      expect(normalizeAgentChangeMode("claude", "acceptEdits")).toBe("acceptEdits");
      expect(normalizeAgentChangeMode("claude", "bypassPermissions")).toBe("bypassPermissions");
      expect(normalizeAgentChangeMode("claude", "invalid-mode")).toBe("auto");
      expect(normalizeAgentChangeMode("claude", undefined)).toBe("auto");
    });

    it("maps bypassPermissions to full-access for codex provider", () => {
      expect(normalizeAgentChangeMode("codex", "bypassPermissions")).toBe("full-access");
      expect(normalizeAgentChangeMode("codex", "acceptEdits")).toBe("full-access");
      expect(normalizeAgentChangeMode("codex", "auto")).toBe("auto");
      expect(normalizeAgentChangeMode("codex", "auto-review")).toBe("auto-review");
      expect(normalizeAgentChangeMode("codex", "full-access")).toBe("full-access");
      expect(normalizeAgentChangeMode("codex", "invalid-mode")).toBe("auto");
      expect(normalizeAgentChangeMode("codex", undefined)).toBe("auto");
    });

    it("safely passes through or falls back for other providers", () => {
      expect(normalizeAgentChangeMode("opencode", "full-access")).toBe("auto");
      expect(normalizeAgentChangeMode("opencode", "bypassPermissions")).toBe("auto");
      expect(normalizeAgentChangeMode("opencode", "build")).toBe("build");
      expect(normalizeAgentChangeMode("antigravity", "full-access")).toBe("full-access");
    });

    it("passes normalized bypassPermissions when agentProvider is claude and settings has full-access", async () => {
      const mockSettings = {
        getAgentProvider: vi.fn().mockReturnValue("claude"),
        getAgentModel: vi.fn().mockReturnValue("gemini-flash[1M]"),
        getAgentChangeMode: vi.fn().mockReturnValue("full-access"),
      };
      const mockIndexStore = {
        getEntryByRunId: vi.fn().mockResolvedValue({
          issueNumber: 174,
          issueTitle: "Auto incident error on openai",
        }),
      };
      const mockAgentHandle = {
        id: "agent-mode-norm",
        run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
        send: vi.fn().mockResolvedValue(undefined),
      };
      const mockPaseo = {
        workspaces: {
          list: vi.fn().mockResolvedValue({
            entries: [
              {
                id: "ws-wt-174",
                workspaceDirectory: "/tmp/worktrees/issue-174",
                workspaceKind: "worktree",
                name: "issue-174",
              },
            ],
          }),
          ref: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue({ id: "ws-wt-174" }) }),
        },
        agents: {
          create: vi.fn().mockResolvedValue(mockAgentHandle),
        },
      };

      const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
      await adapter.execute({ phase: "implement" }, {
        paseo: mockPaseo as any,
        run: { runId: "run-174", projectId: "prj-norm" },
        step: { stepId: "implement-agent" },
      } as any);

      expect(mockPaseo.agents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            provider: "claude/gemini-flash[1M]",
            modeId: "bypassPermissions",
          }),
        }),
      );
    });
  });
  it("passes custom timeoutMs from input to agentHandle.run", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("flash"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 123,
        issueTitle: "Test timeout",
      }),
    };
    const mockAgentHandle = {
      id: "agent-timeout-test",
      run: vi.fn().mockResolvedValue({ status: "idle", lastMessage: "Done" }),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            { id: "ws-1", workspaceDirectory: "/projects/repo", workspaceKind: "local_checkout" },
          ],
        }),
        ref: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue({ id: "ws-1" }) }),
      },
      agents: { create: vi.fn().mockResolvedValue(mockAgentHandle) },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
    await adapter.execute({ phase: "auto_design", timeoutMs: 15 * 60 * 1000 }, {
      paseo: mockPaseo as any,
      run: { runId: "run-123", projectId: "prj-1" },
      step: { stepId: "auto-design" },
    } as any);

    expect(mockAgentHandle.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeoutMs: 15 * 60 * 1000 }),
    );
  });

  it("throws error and detaches agent when agentHandle.run times out", async () => {
    const mockSettings = {
      getAgentProvider: vi.fn().mockReturnValue("claude"),
      getAgentModel: vi.fn().mockReturnValue("flash"),
      getAgentChangeMode: vi.fn().mockReturnValue("auto"),
    };
    const mockIndexStore = {
      getEntryByRunId: vi.fn().mockResolvedValue({
        issueNumber: 123,
        issueTitle: "Test timeout failure",
      }),
    };
    const mockAgentHandle = {
      id: "agent-timeout-fail",
      run: vi.fn().mockResolvedValue({ status: "timeout", error: "Execution timed out" }),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const mockPaseo = {
      workspaces: {
        list: vi.fn().mockResolvedValue({
          entries: [
            { id: "ws-1", workspaceDirectory: "/projects/repo", workspaceKind: "local_checkout" },
          ],
        }),
        ref: vi.fn().mockReturnValue({ current: vi.fn().mockReturnValue({ id: "ws-1" }) }),
      },
      agents: { create: vi.fn().mockResolvedValue(mockAgentHandle) },
    };

    const adapter = createAgentExecuteAdapter(mockSettings as any, mockIndexStore as any);
    await expect(
      adapter.execute({ phase: "auto_design", timeoutMs: 10 * 60 * 1000 }, {
        paseo: mockPaseo as any,
        run: { runId: "run-123", projectId: "prj-1" },
        step: { stepId: "auto-design" },
      } as any),
    ).rejects.toThrow('Agent run failed with status "timeout"');

    expect(mockAgentHandle.detach).toHaveBeenCalled();
  });
});
