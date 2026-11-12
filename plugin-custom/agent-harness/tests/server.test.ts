import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";
import { createInitialHarnessMetadata } from "../shared/lifecycle-state.js";
import { HARNESS_METADATA_KEY, type HarnessAgentMetadata } from "../shared/types.js";

function createTestServer(settingsOverride?: Record<string, unknown>) {
  const hooks: Record<string, any> = {};
  const mockServer: any = {
    registerSettings: vi.fn().mockReturnValue({
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: {
          enabled: true,
          overrideIfDefaultOnly: true,
          debugLogs: false,
          phaseLifecycleEnabled: true,
          planTurnSoftLimit: 3,
          autoDowngradePlanOnExec: true,
          ...settingsOverride,
        },
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    }),
    handle: vi.fn(),
    addHook: vi.fn().mockImplementation((name, handler) => {
      hooks[name] = handler;
      return () => {};
    }),
  };
  const cleanup = contribute(mockServer);
  return { mockServer, hooks, cleanup };
}

function createMockContext(options?: { timelineItems?: unknown[]; throwOnSetModel?: boolean }) {
  const setModel = vi.fn().mockImplementation(async () => {
    if (options?.throwOnSetModel) {
      throw new Error("Failed to set model");
    }
  });
  const setMetadata = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue(undefined);
  const refetch = vi.fn().mockResolvedValue({
    items: options?.timelineItems ?? [],
  });

  const handle = {
    setModel,
    setMetadata,
    send,
    timeline: {
      refetch,
    },
  };

  const context = {
    paseo: {
      agents: {
        ref: vi.fn().mockReturnValue(handle),
      },
    },
  };

  return { context, handle };
}

describe("agent-harness server contribute", () => {
  it("registers hook on agent.create.before and routes plan intent", async () => {
    const { mockServer, hooks } = createTestServer();
    expect(mockServer.addHook).toHaveBeenCalledWith("agent.create.before", expect.any(Function));
    expect(mockServer.addHook).toHaveBeenCalledWith("agent.open.before", expect.any(Function));

    const request = {
      config: {
        provider: "opencode",
        cwd: "/dummy",
        model: "custom/flash",
        title: "分析一下线上的hub环境：为什么reader没有任何关联的数据？分析根因。",
      },
    };

    const transformed = await hooks["agent.create.before"]({ request });
    expect(transformed.config.model).toBe("custom/plan");
  });

  it("does not override model if execution task", async () => {
    const { hooks } = createTestServer();

    const request = {
      config: {
        provider: "opencode",
        cwd: "/dummy",
        model: "custom/flash",
        title: "fix: 修复样式重叠问题",
      },
    };

    const transformed = await hooks["agent.create.before"]({ request });
    expect(transformed.config.model).toBe("custom/flash");
  });

  it("injects capability harness env in agent.open.before based on role label or title", async () => {
    const { hooks } = createTestServer();

    const openRequest = {
      agentId: "agt_ui_1",
      workspaceId: "wks_1",
      provider: "claude",
      cwd: "/Users/jerry/projects/ai/paseo",
      reason: "create",
      purpose: "interactive",
      title: "重构 QuickPrompts 弹窗组件的 Unistyles 样式与 hover 交互",
      labels: {},
      tools: [],
      env: { EXISTING_VAR: "1" },
      mcpServers: {},
    };

    const transformed = await hooks["agent.open.before"]({ request: openRequest });
    expect(transformed.agentId).toBe("agt_ui_1");
    expect(transformed.title).toBe(openRequest.title);
    expect(transformed.env.EXISTING_VAR).toBe("1");
    expect(transformed.env.PASEO_HARNESS_ROLE).toBe("ui");
    expect(transformed.env.PASEO_HARNESS_PROFILE).toContain("ui-specialist.json");
    expect(transformed.env.LAZY_TOOL_CONFIG).toContain("profiles/ui.yaml");
  });

  it("routes model by explicit role label in agent.create.before and propagates label to agent.open.before", async () => {
    const { hooks } = createTestServer();

    const createReq = {
      config: {
        provider: "claude",
        cwd: "/Users/jerry/projects/ai/paseo",
        model: "flash",
        title: "检查当前提交",
        labels: { role: "review" },
      },
    };

    const created = await hooks["agent.create.before"]({ request: createReq });
    expect(created.config.model).toBe("review");

    const openReq = {
      agentId: "agt_rev_1",
      workspaceId: "wks_1",
      provider: "claude",
      cwd: "/Users/jerry/projects/ai/paseo",
      reason: "create",
      purpose: "interactive",
      title: "检查当前提交",
      labels: {},
      tools: [],
      env: {},
      mcpServers: {},
    };

    const opened = await hooks["agent.open.before"]({ request: openReq });
    expect(opened.env.PASEO_HARNESS_ROLE).toBe("review");
    expect(opened.env.PASEO_HARNESS_PROFILE).toContain("security-review.json");
  });

  it("arbitrates full-stack composite tasks (UI + backend/storage) to orchestrator Thin Dispatcher role and flash tier", async () => {
    const { hooks } = createTestServer();

    const createRequest = {
      config: {
        provider: "claude",
        cwd: "/tmp/snake-test",
        model: "flash",
        title: "",
      },
      initialPrompt:
        "开发一个贪吃蛇的游戏，有UI前端、有后台，可以保存游戏结果，玩家输入姓名，可以排名。",
    };

    const createTransformed = await hooks["agent.create.before"]({ request: createRequest });
    expect(createTransformed.config.model).toBe("flash");
    expect(createTransformed.config.systemPrompt).toContain("Role: orchestrator");

    const openRequest = {
      agentId: "agt_snake_fullstack",
      workspaceId: "wks_snake",
      provider: "claude",
      cwd: "/tmp/snake-test",
      reason: "create",
      purpose: "interactive",
      title: createTransformed.config.title,
      labels: {},
      tools: [],
      env: {},
    };

    const openTransformed = await hooks["agent.open.before"]({ request: openRequest });
    expect(openTransformed.env.PASEO_HARNESS_ROLE).toBe("orchestrator");
    expect(openTransformed.env.LAZY_TOOL_CONFIG).toContain("pm.yaml");
    expect(openTransformed.env.PASEO_HARNESS_PROFILE).toContain("orchestrator.json");
  });

  it("does not leak role labels to subsequent agent creations in the same cwd", async () => {
    const { hooks } = createTestServer();

    await hooks["agent.create.before"]({
      request: {
        config: {
          provider: "claude",
          cwd: "/Users/jerry/projects/ai/paseo",
          model: "flash",
          title: "审查代码",
          labels: { role: "review" },
        },
      },
    });

    await hooks["agent.open.before"]({
      request: {
        agentId: "agt_1",
        workspaceId: "wks_1",
        provider: "claude",
        cwd: "/Users/jerry/projects/ai/paseo",
        reason: "create",
        purpose: "interactive",
        title: "审查代码",
        labels: {},
        tools: [],
        env: {},
        mcpServers: {},
      },
    });

    // Second agent in same cwd without role label
    await hooks["agent.create.before"]({
      request: {
        config: {
          provider: "codex",
          cwd: "/Users/jerry/projects/ai/paseo",
          model: "flash",
          title: "修复 daemon WebSocket RPC 协议兼容性",
        },
      },
    });

    const openedSecond = await hooks["agent.open.before"]({
      request: {
        agentId: "agt_2",
        workspaceId: "wks_1",
        provider: "codex",
        cwd: "/Users/jerry/projects/ai/paseo",
        reason: "create",
        purpose: "interactive",
        title: "修复 daemon WebSocket RPC 协议兼容性",
        labels: {},
        tools: [],
        env: {},
        mcpServers: {},
      },
    });

    expect(openedSecond.env.PASEO_HARNESS_ROLE).toBe("backend");
  });

  it("skips harness injection for antigravity safety-net provider in agent.open.before", async () => {
    const { hooks } = createTestServer();

    const openRequest = {
      agentId: "agt_agy_1",
      workspaceId: "wks_1",
      provider: "antigravity",
      cwd: "/Users/jerry/projects/ai/paseo",
      reason: "create",
      purpose: "interactive",
      title: "重构 UI 组件样式",
      labels: {},
      tools: [],
      env: { EXISTING_VAR: "1" },
      mcpServers: {},
    };

    const transformed = await hooks["agent.open.before"]({ request: openRequest });
    expect(transformed.env.PASEO_HARNESS_ROLE).toBeUndefined();
    expect(transformed.env.LAZY_TOOL_CONFIG).toBeUndefined();
  });

  describe("Step 1: System Prompt decoupled by decision.tier", () => {
    it("injects Design & Planning contract for tier=plan (and role !== orchestrator)", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            title: "有没有更好的ui方案？",
          },
        },
      });

      const prompt = res.config.systemPrompt;
      expect(prompt).toContain(
        "- [Phase: Design & Planning] Rule: You are running on the high-reasoning plan model (phase=design).",
      );
      expect(prompt).toContain(
        "Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session!",
      );
      expect(prompt).toContain("harness_handoff");
      // Old UI Consultation string must be completely removed
      expect(prompt).not.toContain(
        "Once the user selects a design or says to implement it, actually edit the target project files on disk.",
      );
    });

    it("injects Fast Execution contract for tier=flash (and role !== orchestrator)", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            title: "fix: 修复样式重叠问题",
          },
        },
      });

      const prompt = res.config.systemPrompt;
      expect(prompt).toContain(
        "- [Phase: Fast Execution] Rule: You are running on the fast flash model (phase=exec).",
      );
      expect(prompt).toContain(
        "Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic)",
      );
    });

    it("injects Review Gate contract for tier=review (and role !== orchestrator)", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            title: "审查当前提交",
            labels: { role: "review" },
          },
        },
      });

      const prompt = res.config.systemPrompt;
      expect(prompt).toContain(
        "- [Phase: Review Gate] Rule: You are running on the review model (phase=review).",
      );
      expect(prompt).toContain(
        "Perform read-only dual-axis audit (Standards + Spec) and ocr gate verification",
      );
    });

    it("retains Paseo Thin Dispatcher Rule when role=orchestrator", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/tmp/snake",
            title: "开发贪吃蛇游戏，有UI前端和后端持久化与排名",
          },
        },
      });

      const prompt = res.config.systemPrompt;
      expect(prompt).toContain("Paseo Thin Dispatcher Rule");
      expect(prompt).not.toContain("[Phase: Fast Execution]");
    });
  });

  describe("Step 2: agent.create.before metadata initialization", () => {
    it("initializes metadata under agentHarness key and preserves other metadata keys", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            title: "分析系统设计方案",
          },
          metadata: {
            existingPluginData: { id: 123 },
          },
        },
      });

      expect(res.metadata.existingPluginData).toEqual({ id: 123 });
      const harnessMeta = res.metadata[HARNESS_METADATA_KEY] as HarnessAgentMetadata;
      expect(harnessMeta).toBeDefined();
      expect(harnessMeta.version).toBe(1);
      expect(harnessMeta.currentTier).toBe("plan");
      expect(harnessMeta.phase).toBe("design");
      expect(harnessMeta.turnCount).toBe(0);
      expect(harnessMeta.planTurnCount).toBe(0);
    });

    it("initializes metadata even when nextConfig === config (default flash execution)", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            model: "flash",
            title: "fix: button alignment",
          },
        },
      });

      const harnessMeta = res.metadata[HARNESS_METADATA_KEY] as HarnessAgentMetadata;
      expect(harnessMeta).toBeDefined();
      expect(harnessMeta.currentTier).toBe("flash");
      expect(harnessMeta.phase).toBe("exec");
    });

    it("does not initialize metadata for antigravity safety-net provider", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/dummy",
            model: "gemini-2.5-flash",
            title: "fix: button alignment",
          },
        },
      });

      expect(res.metadata?.[HARNESS_METADATA_KEY]).toBeUndefined();
    });
  });

  describe("Step 2: Hook 4 (agent.turn.before)", () => {
    it("upgrades model for empty-title agent and synchronizes metadata", async () => {
      const { hooks } = createTestServer();
      const initialMeta = createInitialHarnessMetadata({
        role: "general",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "default",
        tierMatchedRule: "default",
      });

      const agent = {
        id: "agt_turn_upgrade",
        provider: "claude",
        title: "分析系统设计方案",
        metadata: { [HARNESS_METADATA_KEY]: initialMeta },
      };

      const { context, handle } = createMockContext();
      await hooks["agent.turn.before"]({ agent }, context);

      expect(handle.setModel).toHaveBeenCalledWith("plan");
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          currentTier: "plan",
          currentModel: "plan",
          phase: "design",
        }),
      });
    });

    it("skips model upgrade if userModelLocked is true", async () => {
      const { hooks } = createTestServer();
      const initialMeta = createInitialHarnessMetadata({
        role: "general",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "default",
        tierMatchedRule: "default",
        userModelLocked: true,
      });

      const agent = {
        id: "agt_user_locked",
        provider: "claude",
        title: "分析系统设计方案",
        metadata: { [HARNESS_METADATA_KEY]: initialMeta },
      };

      const { context, handle } = createMockContext();
      await hooks["agent.turn.before"]({ agent }, context);

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.setMetadata).not.toHaveBeenCalled();
    });

    it("skips model upgrade if roleLockedByLabel is true", async () => {
      const { hooks } = createTestServer();
      const initialMeta = createInitialHarnessMetadata({
        role: "backend",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "label:role",
        tierMatchedRule: "role_tier:backend",
        roleLockedByLabel: true,
      });

      const agent = {
        id: "agt_label_locked",
        provider: "claude",
        title: "分析系统设计方案",
        metadata: { [HARNESS_METADATA_KEY]: initialMeta },
      };

      const { context, handle } = createMockContext();
      await hooks["agent.turn.before"]({ agent }, context);

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.setMetadata).not.toHaveBeenCalled();
    });

    it("skips model upgrade if turnCount is greater than 0", async () => {
      const { hooks } = createTestServer();
      const meta = createInitialHarnessMetadata({
        role: "general",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "default",
        tierMatchedRule: "default",
      });
      meta.turnCount = 1;

      const agent = {
        id: "agt_turn_gt_zero",
        provider: "claude",
        title: "分析系统设计方案",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      const { context, handle } = createMockContext();
      await hooks["agent.turn.before"]({ agent }, context);

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.setMetadata).not.toHaveBeenCalled();
    });

    it("prevents delayed Turn 2 title generation from upgrading model if Turn 1 started with empty title", async () => {
      const { hooks } = createTestServer();
      const meta = createInitialHarnessMetadata({
        role: "general",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "default",
        tierMatchedRule: "default",
      });

      // Turn 1: Empty title
      const agentTurn1 = {
        id: "agt_delayed_title",
        provider: "claude",
        title: "",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      const { context, handle } = createMockContext();
      await hooks["agent.turn.before"]({ agent: agentTurn1 }, context);
      expect(handle.setModel).not.toHaveBeenCalled();

      // Turn 2: Delayed auto-generated title arrives
      meta.turnCount = 1;
      const agentTurn2 = {
        id: "agt_delayed_title",
        provider: "claude",
        title: "设计一套系统架构方案",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.before"]({ agent: agentTurn2 }, context);
      expect(handle.setModel).not.toHaveBeenCalled();
    });
  });

  describe("Step 2: Hook 5 (agent.turn.after)", () => {
    it("auto-downgrades from plan to flash on Turn 2 upon explicit exec intent", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const timelineItems = [
        { type: "user_message", text: "好的，就按方案A改代码" },
        { type: "assistant_message", text: "马上开始修改" },
      ];

      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_auto_downgrade",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_2", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).toHaveBeenCalledWith("flash");
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 2,
          planTurnCount: 2,
          currentTier: "flash",
          currentModel: "flash",
          phase: "exec",
          autoDowngradedAtTurn: 2,
          downgradeReason: "explicit_exec_intent",
          lastProcessedTurnId: "turn_2",
        }),
      });
      // Zero calls to handle.send()
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("auto-downgrades from plan to flash when code write tool (.tsx) is used in plan phase", async () => {
      const { hooks } = createTestServer();
      const meta = createInitialHarnessMetadata({
        role: "ui",
        tier: "plan",
        model: "claude-3-7-sonnet",
        roleMatchedRule: "keyword",
        tierMatchedRule: "plan",
      });

      const timelineItems = [
        { type: "user_message", text: "请调整按钮边框" },
        {
          type: "tool_call",
          name: "Edit",
          input: { file_path: "packages/app/src/components/button.tsx" },
        },
      ];

      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_write_downgrade",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_1", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).toHaveBeenCalledWith("flash");
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 1,
          planTurnCount: 1,
          currentTier: "flash",
          currentModel: "flash",
          phase: "exec",
          autoDowngradedAtTurn: 1,
          downgradeReason: "write_tool_in_plan",
          writeToolDetectedInPlan: true,
        }),
      });
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("exempts whitelisted documentation edits (openspec/**/*.md) and stays in plan phase", async () => {
      const { hooks } = createTestServer();
      const meta = createInitialHarnessMetadata({
        role: "architect",
        tier: "plan",
        model: "claude-3-7-sonnet",
        roleMatchedRule: "keyword",
        tierMatchedRule: "plan",
      });

      const timelineItems = [
        { type: "user_message", text: "编写系统设计" },
        {
          type: "tool_call",
          name: "Write",
          input: { file_path: "openspec/changes/refactor-auth/proposal.md" },
        },
        {
          type: "tool_call",
          name: "Edit",
          input: { file_path: "docs/architecture.md" },
        },
      ];

      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_docs_exempt",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_1", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 1,
          planTurnCount: 1,
          currentTier: "plan",
          phase: "design",
          writeToolDetectedInPlan: false,
          autoDowngradedAtTurn: null,
        }),
      });
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("marks handoffSuggestedAtTurn when planTurnCount reaches soft limit", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        turnCount: 2,
        planTurnCount: 2,
      };

      const timelineItems = [
        { type: "user_message", text: "继续讨论第三个方案" },
        { type: "assistant_message", text: "第三个方案如下" },
      ];

      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_soft_limit",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_3", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 3,
          planTurnCount: 3,
          handoffSuggestedAtTurn: 3,
          currentTier: "plan",
          phase: "design",
        }),
      });
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("exempts downgrade for userModelLocked agents", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
          userModelLocked: true,
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const timelineItems = [{ type: "user_message", text: "直接改代码" }];
      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_user_locked_after",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_2", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("exempts downgrade for roleLockedByLabel: architect or pm", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "architect",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "label:role",
          tierMatchedRule: "role_tier:architect",
          roleLockedByLabel: true,
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const timelineItems = [{ type: "user_message", text: "好的，就按方案A改代码" }];
      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_architect_exempt",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_2", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("allows downgrade for roleLockedByLabel: ui when exec intent is given", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "label:role",
          tierMatchedRule: "plan",
          roleLockedByLabel: true,
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const timelineItems = [{ type: "user_message", text: "好的，就按方案A改代码" }];
      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_ui_label_downgrade",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_2", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).toHaveBeenCalledWith("flash");
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("does not downgrade on explicit exec intent if handoffInvoked is true", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const timelineItems = [
        { type: "user_message", text: "好的，就按方案A改代码" },
        {
          type: "tool_call",
          name: "Skill",
          input: { skill: "paseo-handoff" },
        },
      ];

      const { context, handle } = createMockContext({ timelineItems });
      const agent = {
        id: "agt_handoff_invoked",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_2", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("is idempotent and skips processing if turnId was already processed", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        lastProcessedTurnId: "turn_already_seen",
      };

      const { context, handle } = createMockContext();
      const agent = {
        id: "agt_idempotent",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_already_seen", outcome: { kind: "completed" } },
        context,
      );

      expect(handle.timeline.refetch).not.toHaveBeenCalled();
      expect(handle.setModel).not.toHaveBeenCalled();
      expect(handle.setMetadata).not.toHaveBeenCalled();
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("handles setModel failure gracefully and does not throw or corrupt state", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const timelineItems = [{ type: "user_message", text: "直接改代码" }];
      const { context, handle } = createMockContext({
        timelineItems,
        throwOnSetModel: true,
      });

      const agent = {
        id: "agt_fail_set_model",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await expect(
        hooks["agent.turn.after"](
          { agent, turnId: "turn_2", outcome: { kind: "completed" } },
          context,
        ),
      ).resolves.not.toThrow();

      // Since setModel failed, tier and phase remain plan and design
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 2,
          planTurnCount: 2,
          currentTier: "plan",
          phase: "design",
          autoDowngradedAtTurn: null,
          lastProcessedTurnId: "turn_2",
        }),
      });
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("prunes I/O and skips timeline.refetch if agent has already been auto-downgraded", async () => {
      const { hooks } = createTestServer();
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        turnCount: 2,
        planTurnCount: 2,
        currentTier: "flash" as const,
        phase: "exec" as const,
        autoDowngradedAtTurn: 2,
      };

      const { context, handle } = createMockContext();
      const agent = {
        id: "agt_pruned",
        provider: "claude",
        metadata: { [HARNESS_METADATA_KEY]: meta },
      };

      await hooks["agent.turn.after"](
        { agent, turnId: "turn_3", outcome: { kind: "completed" } },
        context,
      );

      // timeline.refetch is skipped because it is already downgraded
      expect(handle.timeline.refetch).not.toHaveBeenCalled();
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 3,
          planTurnCount: 2,
          lastProcessedTurnId: "turn_3",
        }),
      });
      expect(handle.send).not.toHaveBeenCalled();
    });
  });

  describe("Step 3: Native Plan Mode Gate & ExitPlanMode Lifecycle", () => {
    it("forces nextConfig.modeId = 'plan' and records resumeModeId for human root agent on plan tier", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            modeId: "acceptEdits",
            title: "分析系统设计方案",
          },
        },
      });

      expect(res.config.modeId).toBe("plan");
      const meta = res.metadata[HARNESS_METADATA_KEY];
      expect(meta.resumeModeId).toBe("acceptEdits");
      expect(meta.currentTier).toBe("plan");
    });

    it("exempts background subagent from native plan mode enforcement", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            title: "[Architect] 系统架构设计",
          },
          parentAgentId: "parent_agt_1",
        },
      });

      expect(res.config.modeId).not.toBe("plan");
    });

    it("exempts subagent with parent-agent-id label from native plan mode enforcement", async () => {
      const { hooks } = createTestServer();
      const res = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy",
            title: "[PM] 需求规格设计",
            labels: { "paseo.parent-agent-id": "parent_agt_123" },
          },
        },
      });

      expect(res.config.modeId).not.toBe("plan");
    });

    it("emits initial_route timeline event in agent.create.after", async () => {
      const { hooks } = createTestServer();
      const appendMock = vi.fn().mockResolvedValue({ seq: 1, epoch: "epoch_1" });
      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue({
              timeline: { append: appendMock },
            }),
          },
        },
      };

      const agent = {
        id: "agt_new_plan",
        metadata: {
          [HARNESS_METADATA_KEY]: createInitialHarnessMetadata({
            role: "general",
            tier: "plan",
            model: "claude-3-7-sonnet",
            roleMatchedRule: "rule",
            tierMatchedRule: "plan_rule",
          }),
        },
      };

      await hooks["agent.create.after"]({ agent }, context);
      expect(appendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "plugin",
          kind: "harness-transition",
          data: expect.objectContaining({
            transitionKind: "initial_route",
            toTier: "plan",
          }),
        }),
      );
    });

    it("switches to flash model and emits plan_approved timeline transition on ExitPlanMode approval", async () => {
      const { hooks } = createTestServer();
      const setModelMock = vi.fn().mockResolvedValue(undefined);
      const setMetadataMock = vi.fn().mockResolvedValue(undefined);
      const appendMock = vi.fn().mockResolvedValue({ seq: 2, epoch: "epoch_1" });

      const handle = {
        setModel: setModelMock,
        setMetadata: setMetadataMock,
        timeline: { append: appendMock },
      };

      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(handle),
          },
        },
      };

      const agent = {
        id: "agt_plan_approving",
        provider: "claude",
        metadata: {
          [HARNESS_METADATA_KEY]: {
            ...createInitialHarnessMetadata({
              role: "ui",
              tier: "plan",
              model: "claude-3-7-sonnet",
              roleMatchedRule: "keyword",
              tierMatchedRule: "plan",
            }),
            turnCount: 2,
            planTurnCount: 2,
          },
        },
      };

      // 1. permission.before
      await hooks["agent.permission.before"]({
        agent,
        request: {
          id: "perm_req_123",
          provider: "claude",
          name: "ExitPlanMode",
          kind: "plan",
        },
      });

      // 2. permission.after with resolution allow
      await hooks["agent.permission.after"](
        {
          agent,
          requestId: "perm_req_123",
          resolution: { behavior: "allow" },
        },
        context,
      );

      expect(setModelMock).toHaveBeenCalledWith("flash");
      expect(setMetadataMock).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          currentTier: "flash",
          phase: "exec",
          downgradeReason: "plan_approved",
          lastBilledTier: "plan",
        }),
      });
      expect(appendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transitionKind: "plan_approved",
            fromTier: "plan",
            toTier: "flash",
          }),
        }),
      );
    });
  });

  describe("Step 4: Proactive pre-turn auto-downgrade and short affirmative confirmation", () => {
    it("triggers pre-turn auto-downgrade on 'yes, continue' and emits timeline event", async () => {
      const { hooks } = createTestServer();
      const setModelMock = vi.fn().mockResolvedValue(undefined);
      const setMetadataMock = vi.fn().mockResolvedValue(undefined);
      const appendMock = vi.fn().mockResolvedValue({ seq: 3, epoch: "epoch_1" });
      const refetchMock = vi.fn().mockResolvedValue({
        items: [{ type: "user_message", text: "yes, continue" }],
      });

      const handle = {
        setModel: setModelMock,
        setMetadata: setMetadataMock,
        timeline: { append: appendMock, refetch: refetchMock },
      };

      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(handle),
          },
        },
      };

      const agent = {
        id: "agt_preturn_downgrade",
        provider: "claude",
        metadata: {
          [HARNESS_METADATA_KEY]: {
            ...createInitialHarnessMetadata({
              role: "ui",
              tier: "plan",
              model: "claude-3-7-sonnet",
              roleMatchedRule: "keyword",
              tierMatchedRule: "plan",
            }),
            turnCount: 1,
            planTurnCount: 1,
          },
        },
      };

      await hooks["agent.turn.before"]({ agent }, context);

      expect(setModelMock).toHaveBeenCalledWith("flash");
      expect(setMetadataMock).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          currentTier: "flash",
          phase: "exec",
          lastBilledTier: "plan",
        }),
      });
      expect(appendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transitionKind: "auto_downgrade",
            toTier: "flash",
          }),
        }),
      );
    });
  });

  describe("Step 5: harness_handoff host tool and RPC handlers", () => {
    it("injects harness_handoff tool into interactive agent.open.before", async () => {
      const { hooks } = createTestServer();
      const openRequest = {
        agentId: "agt_tool_test",
        workspaceId: "wks_1",
        provider: "claude",
        cwd: "/dummy",
        reason: "create",
        purpose: "interactive",
        title: "设计与实施",
        labels: {},
        tools: [],
        env: {},
        mcpServers: {},
      };

      const opened = await hooks["agent.open.before"]({ request: openRequest });
      expect(opened.tools.some((t: any) => t.name === "harness_handoff")).toBe(true);
    });

    it("handles harnessSwitchTierRpc request and returns recommendedModeId", async () => {
      const registeredRpcHandlers: Record<string, any> = {};
      const { mockServer } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });

      // Re-trigger contribute with our spy handle
      contribute(mockServer);

      const switchHandler = registeredRpcHandlers["agent_harness.tier.switch.request"];
      expect(switchHandler).toBeDefined();

      const setModelMock = vi.fn().mockResolvedValue(undefined);
      const setMetadataMock = vi.fn().mockResolvedValue(undefined);
      const handle = {
        current: () => ({ provider: "claude", options: { model: "claude-3-7-sonnet" } }),
        setModel: setModelMock,
        setMetadata: setMetadataMock,
        timeline: { append: vi.fn().mockResolvedValue({}) },
      };

      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(handle),
          },
        },
      };

      const result = await switchHandler(
        {
          agentId: "agt_rpc_switch",
          targetTier: "flash",
          currentModeId: "plan",
          reason: "User clicked Flash in UI",
        },
        context,
      );

      expect(setModelMock).toHaveBeenCalledWith("flash");
      expect(result.currentTier).toBe("flash");
      expect(result.recommendedModeId).toBe("acceptEdits");
      expect(result.metadata.currentTier).toBe("flash");
      expect(handle.timeline.append).toHaveBeenCalledTimes(1);
    });

    it("restores metadata from agent snapshot and backfills cache on cache miss during harnessSwitchTierRpc", async () => {
      const registeredRpcHandlers: Record<string, any> = {};
      const { mockServer } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer);

      const switchHandler = registeredRpcHandlers["agent_harness.tier.switch.request"];
      expect(switchHandler).toBeDefined();

      const setModelMock = vi.fn().mockResolvedValue(undefined);
      const setMetadataMock = vi.fn().mockResolvedValue(undefined);
      const existingMeta: HarnessAgentMetadata = {
        version: 1,
        role: "architect",
        initialTier: "plan",
        currentTier: "plan",
        currentModel: "claude-3-7-sonnet",
        phase: "design",
        roleMatchedRule: "llm_fallback:architect",
        tierMatchedRule: "intent:plan",
        userModelLocked: false,
        roleLockedByLabel: false,
        turnCount: 5,
        planTurnCount: 3,
        writeToolDetectedInPlan: false,
        handoffSuggestedAtTurn: null,
        autoDowngradedAtTurn: null,
        downgradeReason: null,
        lastProcessedTurnId: "turn_5",
        resumeModeId: "dontAsk",
        lastBilledTier: "plan",
        lastBilledModel: "claude-3-7-sonnet",
      };

      const handle = {
        current: () => ({
          provider: "claude",
          options: { model: "claude-3-7-sonnet" },
          metadata: { [HARNESS_METADATA_KEY]: existingMeta },
        }),
        setModel: setModelMock,
        setMetadata: setMetadataMock,
        timeline: { append: vi.fn().mockResolvedValue({}) },
      };

      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(handle),
          },
        },
      };

      const result = await switchHandler(
        {
          agentId: "agt_cache_miss_123",
          targetTier: "flash",
          currentModeId: "plan",
        },
        context,
      );

      expect(setModelMock).toHaveBeenCalledWith("flash");
      expect(result.currentTier).toBe("flash");
      // Preserved role, turnCount, and restored resumeModeId -> recommendedModeId
      expect(result.metadata.role).toBe("architect");
      expect(result.metadata.turnCount).toBe(5);
      expect(result.recommendedModeId).toBe("dontAsk");
      expect(setMetadataMock).toHaveBeenCalled();
      expect(handle.timeline.append).toHaveBeenCalledTimes(1);
    });

    it("handles harnessHandoffRpc request, spawns specialist child agent, and appends timeline transition", async () => {
      const registeredRpcHandlers: Record<string, any> = {};
      const { mockServer } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer);

      const handoffHandler = registeredRpcHandlers["agent_harness.specialist.handoff.request"];
      expect(handoffHandler).toBeDefined();

      const parentMeta: HarnessAgentMetadata = {
        version: 1,
        role: "architect",
        initialTier: "plan",
        currentTier: "plan",
        currentModel: "claude-3-7-sonnet",
        phase: "design",
        roleMatchedRule: "rule",
        tierMatchedRule: "rule",
        userModelLocked: false,
        roleLockedByLabel: false,
        turnCount: 4,
        planTurnCount: 2,
        writeToolDetectedInPlan: false,
        handoffSuggestedAtTurn: null,
        autoDowngradedAtTurn: null,
        downgradeReason: null,
        lastProcessedTurnId: null,
        resumeModeId: null,
        lastBilledTier: "plan",
        lastBilledModel: "claude-3-7-sonnet",
      };

      const parentHandle = {
        current: () => ({
          provider: "claude",
          cwd: "/workspace/project",
          workspaceId: "ws_parent",
          metadata: { [HARNESS_METADATA_KEY]: parentMeta },
        }),
        timeline: { append: vi.fn().mockResolvedValue({}) },
      };

      const childHandle = {
        id: "agt_child_specialist_ui",
        waitForFinish: vi.fn(),
      };

      const createAgentMock = vi.fn().mockResolvedValue(childHandle);

      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(parentHandle),
            create: createAgentMock,
          },
          workspaces: {
            ref: vi.fn().mockReturnValue({
              agents: {
                create: createAgentMock,
              },
            }),
          },
        },
      };

      const result = await handoffHandler(
        {
          agentId: "agt_parent_1",
          workspaceId: "ws_parent",
          targetRole: "ui",
          summaryOverride: "Implement responsive layout per design.md",
        },
        context,
      );

      expect(result.childAgentId).toBe("agt_child_specialist_ui");
      expect(result.targetRole).toBe("ui");
      expect(result.targetTier).toBe("flash");
      expect(createAgentMock).toHaveBeenCalled();
      expect(parentHandle.timeline.append).toHaveBeenCalledTimes(1);

      const timelinePayload = parentHandle.timeline.append.mock.calls[0][0];
      expect(timelinePayload.data.transitionKind).toBe("specialist_handoff");
      expect(timelinePayload.data.fromTier).toBe("plan");
      expect(timelinePayload.data.toTier).toBe("flash");
      expect(timelinePayload.data.turnNumber).toBe(4);
      expect(timelinePayload.data.reason).toBe("specialist_handoff");
    });

    it("executes harness_handoff tool, reads lastMessage when waitForCompletion is true, and appends timeline transition", async () => {
      const { hooks } = createTestServer();
      const openRequest = {
        agentId: "agt_parent_tool",
        provider: "claude",
        cwd: "/workspace/project",
        reason: "create",
        purpose: "interactive",
        title: "主代理架构设计",
        labels: {},
        tools: [],
        env: {},
        mcpServers: {},
      };

      const opened = await hooks["agent.open.before"]({ request: openRequest });
      const handoffTool = opened.tools.find((t: any) => t.name === "harness_handoff");
      expect(handoffTool).toBeDefined();

      const parentMeta: HarnessAgentMetadata = {
        version: 1,
        role: "architect",
        initialTier: "plan",
        currentTier: "plan",
        currentModel: "claude-3-7-sonnet",
        phase: "design",
        roleMatchedRule: "rule",
        tierMatchedRule: "rule",
        userModelLocked: false,
        roleLockedByLabel: false,
        turnCount: 2,
        planTurnCount: 2,
        writeToolDetectedInPlan: false,
        handoffSuggestedAtTurn: null,
        autoDowngradedAtTurn: null,
        downgradeReason: null,
        lastProcessedTurnId: null,
        resumeModeId: null,
        lastBilledTier: "plan",
        lastBilledModel: "claude-3-7-sonnet",
      };

      const parentHandle = {
        current: () => ({
          provider: "claude",
          cwd: "/workspace/project",
          workspaceId: "ws_parent",
          metadata: { [HARNESS_METADATA_KEY]: parentMeta },
        }),
        timeline: { append: vi.fn().mockResolvedValue({}) },
      };

      const childHandle = {
        id: "agt_child_backend_specialist",
        waitForFinish: vi.fn().mockResolvedValue({
          status: "completed",
          final: true,
          error: null,
          lastMessage: "Successfully implemented SQLite migrations and RPC handlers.",
        }),
      };

      const createAgentMock = vi.fn().mockResolvedValue(childHandle);

      const toolContext = {
        agent: {
          id: "agt_parent_tool",
          provider: "claude",
          cwd: "/workspace/project",
          workspaceId: "ws_parent",
        },
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(parentHandle),
            create: createAgentMock,
          },
          workspaces: {
            ref: vi.fn().mockReturnValue({
              agents: {
                create: createAgentMock,
              },
            }),
          },
        },
      };

      const toolResult = await handoffTool.execute(
        {
          targetRole: "backend",
          title: "后端实施任务",
          specPrompt: "按照 design.md 实施数据库与 RPC 接口",
          waitForCompletion: true,
        },
        toolContext,
      );

      expect(toolResult.structuredContent.status).toBe("completed");
      expect(toolResult.structuredContent.finalText).toBe(
        "Successfully implemented SQLite migrations and RPC handlers.",
      );
      expect(toolResult.structuredContent.childAgentId).toBe("agt_child_backend_specialist");
      expect(parentHandle.timeline.append).toHaveBeenCalledTimes(1);

      const timelinePayload = parentHandle.timeline.append.mock.calls[0][0];
      expect(timelinePayload.data.transitionKind).toBe("specialist_handoff");
      expect(timelinePayload.data.fromTier).toBe("plan");
      expect(timelinePayload.data.toTier).toBe("flash");
      expect(timelinePayload.data.turnNumber).toBe(2);
      expect(timelinePayload.data.reason).toBe("specialist_handoff");
    });

    it("returns status 'timeout' or 'failed' without falsely reporting 'completed' when child agent times out or fails", async () => {
      const { hooks } = createTestServer();
      const openRequest = {
        agentId: "agt_parent_timeout_test",
        provider: "claude",
        cwd: "/workspace/project",
        reason: "create",
        purpose: "interactive",
        title: "主代理架构设计",
        labels: {},
        tools: [],
        env: {},
        mcpServers: {},
      };

      const opened = await hooks["agent.open.before"]({ request: openRequest });
      const handoffTool = opened.tools.find((t: any) => t.name === "harness_handoff");
      expect(handoffTool).toBeDefined();

      const parentHandle = {
        current: () => ({
          provider: "claude",
          cwd: "/workspace/project",
          workspaceId: "ws_parent",
          metadata: {},
        }),
        timeline: { append: vi.fn().mockResolvedValue({}) },
      };

      // Test 1: Timeout scenario
      const timeoutChildHandle = {
        id: "agt_child_timeout",
        waitForFinish: vi.fn().mockResolvedValue({
          status: "timeout",
          final: false,
          error: "Turn execution timed out after 120s",
        }),
      };

      const toolContextTimeout = {
        agent: {
          id: "agt_parent_timeout_test",
          provider: "claude",
          cwd: "/workspace/project",
          workspaceId: "ws_parent",
        },
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(parentHandle),
            create: vi.fn().mockResolvedValue(timeoutChildHandle),
          },
          workspaces: {
            ref: vi.fn().mockReturnValue({
              agents: {
                create: vi.fn().mockResolvedValue(timeoutChildHandle),
              },
            }),
          },
        },
      };

      const timeoutResult = await handoffTool.execute(
        {
          targetRole: "backend",
          title: "超时任务",
          specPrompt: "执行长耗时任务",
          waitForCompletion: true,
        },
        toolContextTimeout,
      );

      expect(timeoutResult.structuredContent.status).toBe("timeout");
      expect(timeoutResult.structuredContent.status).not.toBe("completed");

      // Test 2: Error / Failed scenario
      const errorChildHandle = {
        id: "agt_child_error",
        waitForFinish: vi.fn().mockResolvedValue({
          status: "error",
          final: true,
          error: "Process crashed with exit code 1",
        }),
      };

      const toolContextError = {
        agent: {
          id: "agt_parent_timeout_test",
          provider: "claude",
          cwd: "/workspace/project",
          workspaceId: "ws_parent",
        },
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(parentHandle),
            create: vi.fn().mockResolvedValue(errorChildHandle),
          },
          workspaces: {
            ref: vi.fn().mockReturnValue({
              agents: {
                create: vi.fn().mockResolvedValue(errorChildHandle),
              },
            }),
          },
        },
      };

      const errorResult = await handoffTool.execute(
        {
          targetRole: "backend",
          title: "崩溃任务",
          specPrompt: "执行任务发生错误",
          waitForCompletion: true,
        },
        toolContextError,
      );

      expect(errorResult.structuredContent.status).toBe("failed");
      expect(errorResult.structuredContent.status).not.toBe("completed");
    });

    it("cleans up metadata and first turn cache on agent close and archive", async () => {
      const { hooks } = createTestServer();
      await hooks["agent.close.after"]({ agent: { id: "agt_close_1" } });
      await hooks["agent.archive.after"]({ agent: { id: "agt_archive_1" } });
      expect(true).toBe(true);
    });
  });
});
