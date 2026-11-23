import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";
import { applyAgentModeOption, applyAgentThinkingOption } from "../server/agent-controls.js";
import {
  detectLocalFederatedTargets,
  hasLocalAntigravityTeamPlugin,
  loadWorkspaceAgentTeam,
} from "../server/agent-team-loader.js";
import { createInitialHarnessMetadata, HARNESS_LEAF_META_KEY } from "../shared/lifecycle-state.js";
import { agentHarnessSettings, DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";
import { HARNESS_METADATA_KEY, type HarnessAgentMetadata } from "../shared/types.js";
import {
  harnessInspectEnvironmentRpc,
  harnessTeamCleanRpc,
  harnessTeamDetectRpc,
  harnessTeamDoctorRpc,
  harnessTeamInspectRpc,
  harnessTeamSaveRpc,
} from "../shared/contracts.js";
import { registerHarnessRpcHandlers } from "../server/rpc-handlers.js";
import { getActiveCheckoutLockCount, withCheckoutLock } from "../server/team-editor-service.js";

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
          autoApproveReadOnlyShellInPlan: true,
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
    expect(transformed.config.model).toBe("custom/pro");
    expect(transformed.config.thinkingOptionId).toBe("high");
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
    expect(created.config.model).toBe("pro");
    expect(created.config.thinkingOptionId).toBe("high");

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

  it("arbitrates full-stack composite tasks (UI + backend/storage) to orchestrator Thin Dispatcher role and fast tier", async () => {
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
    expect(createTransformed.config.model).toBe("lite");
    expect(createTransformed.config.thinkingOptionId).toBe("low");
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

  it("skips harness injection across full lifecycle when antigravity uses gemini-pro-orchestrator", async () => {
    const { hooks } = createTestServer();

    const created = await hooks["agent.create.before"]({
      request: {
        config: {
          provider: "antigravity",
          cwd: "/Users/jerry/projects/ai/paseo",
          model: "gemini-pro-orchestrator",
          title: "重构 UI 组件样式",
        },
      },
    });
    expect(created.config.model).toBe("gemini-pro-orchestrator");
    expect(created.config.systemPrompt).toBeUndefined();
    expect(created.metadata?.agentHarnessBypassed).toBe(true);
    expect(created.metadata?.[HARNESS_METADATA_KEY]).toBeUndefined();

    const openRequest = {
      agentId: "agt_agy_orch_1",
      workspaceId: "wks_1",
      provider: "antigravity",
      cwd: "/Users/jerry/projects/ai/paseo",
      reason: "create",
      purpose: "interactive",
      title: "重构 UI 组件样式",
      labels: {},
      metadata: created.metadata,
      tools: [],
      env: { EXISTING_VAR: "1" },
      mcpServers: {},
    };

    const transformed = await hooks["agent.open.before"]({ request: openRequest });
    expect(transformed.env.PASEO_HARNESS_ROLE).toBeUndefined();
    expect(transformed.env.LAZY_TOOL_CONFIG).toBeUndefined();
    expect(transformed.tools).toEqual([]);

    const { context, handle } = createMockContext({
      timelineItems: [{ type: "user_message", text: "yes, continue" }],
    });
    await hooks["agent.turn.before"](
      {
        agent: {
          id: "agt_agy_orch_1",
          provider: "antigravity",
          metadata: created.metadata,
        },
      },
      context,
    );
    expect(handle.setModel).not.toHaveBeenCalled();
  });

  it("enables capability harness and Gemini 4 routing for non-orchestrator antigravity models", async () => {
    const { hooks } = createTestServer();

    const created = await hooks["agent.create.before"]({
      request: {
        config: {
          provider: "antigravity",
          cwd: "/Users/jerry/projects/ai/paseo/agy-ui-leaf",
          model: "gemini-4-hydrogen",
          title: "设计一个多视口响应式 UI 布局方案",
          labels: { role: "ui" },
        },
      },
    });

    // role=ui has preferredTier=standard -> gemini-4-argon (thinking: high); prompt banner uses read_file
    expect(created.config.model).toBe("gemini-4-argon");
    expect(created.config.thinkingOptionId).toBe("high");
    expect(created.config.systemPrompt).toContain("read_file");
    expect(created.config.systemPrompt).not.toContain("invoke the `Skill` tool");
    expect(created.metadata?.[HARNESS_METADATA_KEY]?.role).toBe("ui");

    const opened = await hooks["agent.open.before"]({
      request: {
        agentId: "agt_agy_ui_1",
        workspaceId: "wks_1",
        provider: "antigravity",
        cwd: "/Users/jerry/projects/ai/paseo/agy-ui-leaf",
        reason: "create",
        purpose: "interactive",
        title: "设计一个多视口响应式 UI 布局方案",
        labels: {},
        metadata: created.metadata,
        tools: [],
        env: {},
        mcpServers: {},
      },
    });

    expect(opened.env.PASEO_HARNESS_ROLE).toBe("ui");
    expect(opened.env.LAZY_TOOL_CONFIG).toContain("profiles/ui.yaml");
    expect(opened.tools.some((t: any) => t.name === "harness_handoff")).toBe(true);
  });

  describe("Step 1: System Prompt decoupled by phase and tier", () => {
    it("injects Design & Planning contract for tier=deep, phase=design (and role !== orchestrator)", async () => {
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
      expect(prompt).toContain("- Matrix Tier: deep (model: pro, thinking: high)");
      expect(prompt).toContain(
        "- [Phase: Design & Planning] Rule: You are running in read-only planning phase (phase=design, typically on `deep` tier).",
      );
      expect(prompt).toContain(
        "Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session!",
      );
      expect(prompt).toContain("harness_handoff");
      expect(prompt).not.toContain(
        "Once the user selects a design or says to implement it, actually edit the target project files on disk.",
      );
    });

    it("injects Execution contract for tier=standard, phase=exec (and role !== orchestrator)", async () => {
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
      expect(prompt).toContain("- Matrix Tier: standard (model: flash, thinking: medium)");
      expect(prompt).toContain(
        "- [Phase: Execution] Rule: You are running in read-write execution phase (phase=exec).",
      );
      expect(prompt).toContain(
        "Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic)",
      );
    });

    it("injects Review Gate contract for role=review (tier=deep, phase=review)", async () => {
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
      expect(prompt).toContain("- Matrix Tier: deep (model: pro, thinking: high)");
      expect(prompt).toContain(
        "- [Phase: Review Gate] Rule: You are running in read-only review phase (phase=review, typically on `deep` tier).",
      );
      expect(prompt).toContain(
        "Perform read-only dual-axis audit (Standards + Spec) and agy + ocr delegate gate verification",
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
      expect(prompt).not.toContain("[Phase: Execution]");
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
      expect(harnessMeta.currentTier).toBe("deep");
      expect(harnessMeta.currentThinking).toBe("high");
      expect(harnessMeta.phase).toBe("design");
      expect(harnessMeta.turnCount).toBe(0);
      expect(harnessMeta.planTurnCount).toBe(0);
    });

    it("initializes metadata even when nextConfig === config (default standard execution)", async () => {
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
      expect(harnessMeta.currentTier).toBe("standard");
      expect(harnessMeta.currentThinking).toBe("medium");
      expect(harnessMeta.phase).toBe("exec");
    });

    it("skips harness metadata for antigravity orchestrator models, and initializes for single-tier antigravity models", async () => {
      const { hooks } = createTestServer();
      const bypassedRes = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/dummy-orch",
            model: "gemini-pro-orchestrator-neon",
            title: "分析架构设计",
          },
        },
      });

      expect(bypassedRes.metadata?.[HARNESS_METADATA_KEY]).toBeUndefined();
      expect(bypassedRes.metadata?.agentHarnessBypassed).toBe(true);

      const singleTierRes = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/dummy-single",
            model: "gemini-4-hydrogen",
            title: "分析系统架构与设计方案",
          },
        },
      });

      expect(singleTierRes.config.model).toBe("gemini-4-carbon");
      expect(singleTierRes.config.thinkingOptionId).toBe("high");
      expect(singleTierRes.metadata?.[HARNESS_METADATA_KEY]).toBeDefined();
      expect(singleTierRes.metadata?.[HARNESS_METADATA_KEY]?.currentTier).toBe("deep");
    });
  });

  describe("Step 2: Hook 4 (agent.turn.before)", () => {
    it("upgrades model and thinking for empty-title agent and synchronizes metadata", async () => {
      const { hooks } = createTestServer();
      const initialMeta = createInitialHarnessMetadata({
        role: "general",
        tier: "standard",
        model: "flash",
        thinkingOptionId: "medium",
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

      expect(handle.setModel).toHaveBeenCalledWith("pro");
      expect(handle.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          currentTier: "deep",
          currentModel: "pro",
          currentThinking: "high",
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
          currentTier: "standard",
          currentModel: "flash",
          currentThinking: "medium",
          phase: "exec",
          autoDowngradedAtTurn: 2,
          downgradeReason: "explicit_exec_intent",
          lastProcessedTurnId: "turn_2",
        }),
      });
      // Zero calls to handle.send()
      expect(handle.send).not.toHaveBeenCalled();
    });

    it("auto-downgrades from plan/deep to standard when code write tool (.tsx) is used in design phase", async () => {
      const { hooks } = createTestServer();
      const meta = createInitialHarnessMetadata({
        role: "ui",
        tier: "deep",
        phase: "design",
        model: "pro",
        thinkingOptionId: "high",
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
          currentTier: "standard",
          currentModel: "flash",
          currentThinking: "medium",
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
    it("forces nextConfig.modeId = 'plan' and records resumeModeId for human root agent in design phase", async () => {
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
      expect(meta.currentTier).toBe("deep");
      expect(meta.phase).toBe("design");
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
      await hooks["agent.permission.before"](
        {
          agent,
          request: {
            id: "perm_req_123",
            provider: "claude",
            name: "ExitPlanMode",
            kind: "plan",
          },
        },
        context,
      );

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
          currentTier: "standard",
          currentThinking: "medium",
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
            toTier: "standard",
          }),
        }),
      );
    });

    it("auto-approves read-only shell commands in plan mode via permission.before", async () => {
      const { hooks } = createTestServer();
      const respondToPermissionMock = vi.fn().mockResolvedValue(undefined);
      const handle = {
        respondToPermission: respondToPermissionMock,
      };
      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(handle),
          },
        },
      };

      const agent = {
        id: "agt_plan_readonly_cmd",
        provider: "claude",
        metadata: {
          [HARNESS_METADATA_KEY]: {
            ...createInitialHarnessMetadata({
              role: "orchestrator",
              tier: "plan",
              model: "plan",
              roleMatchedRule: "default",
              tierMatchedRule: "plan",
            }),
            phase: "design",
          },
        },
      };

      // 1. Read-only command (e.g. git status) should be auto-approved
      await hooks["agent.permission.before"](
        {
          agent,
          request: {
            id: "perm_req_readonly_1",
            provider: "claude",
            name: "Bash",
            input: { command: "git status" },
          },
        },
        context,
      );

      expect(handle.respondToPermission).toHaveBeenCalledWith({
        requestId: "perm_req_readonly_1",
        response: { behavior: "allow" },
      });

      // 2. Destructive or write command (e.g. rm -rf) should NOT be auto-approved
      respondToPermissionMock.mockClear();
      await hooks["agent.permission.before"](
        {
          agent,
          request: {
            id: "perm_req_write_1",
            provider: "claude",
            name: "Bash",
            input: { command: "rm -rf dist" },
          },
        },
        context,
      );

      expect(handle.respondToPermission).not.toHaveBeenCalled();

      // 3. Write redirection (e.g. git status > out.txt) should NOT be auto-approved
      respondToPermissionMock.mockClear();
      await hooks["agent.permission.before"](
        {
          agent,
          request: {
            id: "perm_req_redirect_1",
            provider: "claude",
            name: "Bash",
            input: { command: "git status > out.txt" },
          },
        },
        context,
      );

      expect(handle.respondToPermission).not.toHaveBeenCalled();
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
          currentTier: "standard",
          currentThinking: "medium",
          phase: "exec",
          lastBilledTier: "plan",
        }),
      });
      expect(appendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            transitionKind: "auto_downgrade",
            toTier: "standard",
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

    it("handles harnessSwitchTierRpc request via real PaseoApi contract and returns recommendedModeId + recommendedThinkingOptionId", async () => {
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
        current: () => ({ provider: "claude", options: { model: "pro" } }),
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

      // Standard PaseoAgentHandle has no setMode/setThinkingOption; agent-controls gracefully returns false
      await expect(
        applyAgentModeOption(context.paseo as any, "agt_rpc_switch", "acceptEdits"),
      ).resolves.toBe(false);
      await expect(
        applyAgentThinkingOption(context.paseo as any, "agt_rpc_switch", "medium"),
      ).resolves.toBe(false);

      const result = await switchHandler(
        {
          agentId: "agt_rpc_switch",
          targetTier: "standard",
          currentModeId: "plan",
          reason: "User clicked Standard in UI",
        },
        context,
      );

      expect(setModelMock).toHaveBeenCalledWith("flash");
      expect(result.currentTier).toBe("standard");
      expect(result.currentThinking).toBe("medium");
      expect(result.recommendedThinkingOptionId).toBe("medium");
      expect(result.recommendedModeId).toBe("acceptEdits");
      expect(result.metadata.currentTier).toBe("standard");
      expect(handle.timeline.append).toHaveBeenCalledTimes(1);

      // Manual switch to deep or max unlocks plan mode into writable exec phase for non-readonly roles
      const deepResult = await switchHandler(
        {
          agentId: "agt_rpc_switch",
          targetTier: "deep",
          currentModeId: "plan",
          reason: "Manual switch to Deep coding",
        },
        context,
      );
      expect(deepResult.currentTier).toBe("deep");
      expect(deepResult.phase).toBe("exec");
      expect(deepResult.recommendedModeId).toBe("acceptEdits");
      expect(deepResult.recommendedThinkingOptionId).toBe("high");
      expect(setModelMock).toHaveBeenCalledWith("pro");

      const maxResult = await switchHandler(
        {
          agentId: "agt_rpc_switch",
          targetTier: "max",
          currentModeId: "plan",
          reason: "Manual switch to Max coding",
        },
        context,
      );
      expect(maxResult.currentTier).toBe("max");
      expect(maxResult.phase).toBe("exec");
      expect(maxResult.recommendedModeId).toBe("acceptEdits");
      expect(maxResult.recommendedThinkingOptionId).toBe("high");
      expect(setModelMock).toHaveBeenCalledWith("plan");
    });

    it("applies mode/thinking on handles supporting optional control methods without fake daemonClient", async () => {
      const setMode = vi.fn().mockResolvedValue(undefined);
      const setThinkingOption = vi.fn().mockResolvedValue(undefined);
      const paseoWithOptionalControls = {
        agents: {
          ref: () => ({
            setMode,
            setThinkingOption,
          }),
        },
      };

      await expect(
        applyAgentModeOption(paseoWithOptionalControls as any, "agt_1", "plan"),
      ).resolves.toBe(true);
      await expect(
        applyAgentThinkingOption(paseoWithOptionalControls as any, "agt_1", "xhigh"),
      ).resolves.toBe(true);
      expect(setMode).toHaveBeenCalledWith("plan");
      expect(setThinkingOption).toHaveBeenCalledWith("xhigh");
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
        initialTier: "deep",
        currentTier: "deep",
        currentModel: "pro",
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
        lastBilledTier: "deep",
        lastBilledModel: "pro",
      };

      const handle = {
        current: () => ({
          provider: "claude",
          options: { model: "pro" },
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
          targetTier: "standard",
          currentModeId: "plan",
        },
        context,
      );

      expect(setModelMock).toHaveBeenCalledWith("flash");
      expect(result.currentTier).toBe("standard");
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
      expect(result.targetTier).toBe("standard");
      expect(createAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            provider: "claude/flash",
            thinkingOptionId: "medium",
          }),
        }),
      );
      expect(parentHandle.timeline.append).toHaveBeenCalledTimes(1);

      const timelinePayload = parentHandle.timeline.append.mock.calls[0][0];
      expect(timelinePayload.data.transitionKind).toBe("specialist_handoff");
      expect(timelinePayload.data.fromTier).toBe("plan");
      expect(timelinePayload.data.toTier).toBe("standard");
      expect(timelinePayload.data.phase).toBe("exec");
      expect(timelinePayload.data.turnNumber).toBe(4);
      expect(timelinePayload.data.reason).toBe("specialist_handoff");

      // Handing off to readonly review specialist records phase="review" in timeline event
      await handoffHandler(
        {
          agentId: "agt_parent_1",
          workspaceId: "ws_parent",
          targetRole: "review",
          summaryOverride: "Audit implementation against spec",
        },
        context,
      );
      expect(parentHandle.timeline.append).toHaveBeenCalledTimes(2);
      expect(parentHandle.timeline.append.mock.calls[1][0].data.phase).toBe("review");
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
      expect(timelinePayload.data.toTier).toBe("standard");
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

    it("applies L2 LLM role classification when endpoint is configured and avoids duplicate fetch on open", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"role":"architect","tier":"plan"}' } }],
          }),
          { status: 200 },
        ),
      );

      try {
        const { hooks } = createTestServer({
          llmFallbackEnabled: true,
          llmFallbackEndpoint: "https://llm.example.com/v1/chat/completions",
          llmFallbackApiKey: "test-key",
          llmFallbackApplyRole: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const created = await hooks["agent.create.before"]({
          request: {
            config: {
              provider: "antigravity",
              cwd: "/tmp/llm-apply-role-cwd",
              model: "gemini-4-hydrogen",
              title: "梳理跨租户状态流向",
            },
          },
        });

        expect(created.config.model).toBe("gemini-4-carbon");
        expect(created.config.thinkingOptionId).toBe("high");
        expect(created.metadata?.[HARNESS_METADATA_KEY]?.role).toBe("architect");
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        const opened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_llm_1",
            workspaceId: "wks_1",
            provider: "antigravity",
            cwd: "/tmp/llm-apply-role-cwd",
            reason: "create",
            purpose: "interactive",
            title: "梳理跨租户状态流向",
            labels: {},
            tools: [],
            env: {},
            mcpServers: {},
          },
        });

        expect(opened.env.PASEO_HARNESS_ROLE).toBe("architect");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("auto-syncs daemon agentProfiles on subscription update when paseo API has been captured", async () => {
      let subscriber = null as ((state: any) => void) | null;
      const patchMock = vi.fn().mockResolvedValue({ requestId: "req-sync", config: {} });
      const registeredRpcHandlers: Record<string, any> = {};

      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({
            status: "ready",
            values: { enabled: true, autoSyncDaemonAgentProfiles: true },
          }),
          subscribe: vi.fn().mockImplementation((cb) => {
            subscriber = cb;
            return () => {};
          }),
        }),
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        }),
        addHook: vi.fn().mockReturnValue(() => {}),
      };

      contribute(mockServer);

      const inspectHandler = registeredRpcHandlers["agent_harness.environment.inspect.request"];
      expect(inspectHandler).toBeDefined();

      const mockPaseo = {
        providers: {
          snapshot: vi.fn().mockResolvedValue({
            entries: [
              {
                provider: "antigravity",
                enabled: true,
                models: [{ id: "gemini-4-hydrogen-high" }, { id: "gemini-4-carbon-high" }],
              },
            ],
          }),
        },
        config: {
          get: vi.fn().mockResolvedValue({ requestId: "req-g", config: { agentProfiles: [] } }),
          patch: patchMock,
        },
      };

      const inspectRes = await inspectHandler({}, { paseo: mockPaseo });
      expect(inspectRes.availableProviders).toEqual([
        {
          provider: "antigravity",
          enabled: true,
          models: ["gemini-4-hydrogen-high", "gemini-4-carbon-high"],
        },
      ]);
      expect(patchMock).toHaveBeenCalledTimes(1);

      const { DEFAULT_AGENT_HARNESS_SETTINGS } = await import("../shared/settings.js");
      subscriber?.({
        status: "ready",
        values: {
          ...DEFAULT_AGENT_HARNESS_SETTINGS,
          autoSyncDaemonAgentProfiles: true,
          specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
            s.id === "ui" ? { ...s, preferredProvider: "antigravity" } : s,
          ),
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(patchMock).toHaveBeenCalledTimes(2);
      const patchedProfiles = patchMock.mock.calls[1][0].agentProfiles;
      const uiProfile = patchedProfiles.find((p: any) => p.id === "harness-ui");
      expect(uiProfile?.provider).toBe("antigravity");
      expect(uiProfile?.model).toBe("gemini-4-argon");
      expect(uiProfile?.thinkingOptionId).toBe("high");
    });

    it("bypasses resumed untracked gemini-pro-orchestrator via snapshot and rejects harnessSwitchTierRpc", async () => {
      const registeredRpcHandlers: Record<string, any> = {};
      const { mockServer, hooks } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer);

      const switchHandler = registeredRpcHandlers["agent_harness.tier.switch.request"];
      const setModelMock = vi.fn();
      const setMetadataMock = vi.fn().mockResolvedValue(undefined);
      const handle = {
        current: () => ({
          id: "agt_resumed_orch",
          provider: "antigravity",
          runtimeInfo: { provider: "antigravity", model: "gemini-pro-orchestrator" },
          metadata: {},
        }),
        setModel: setModelMock,
        setMetadata: setMetadataMock,
      };
      const context: any = {
        paseo: {
          agents: {
            ref: () => handle,
          },
        },
      };

      // Turn without prior agent.create.before metadata must probe snapshot and bypass + persist flag
      await hooks["agent.turn.before"](
        {
          agent: {
            id: "agt_resumed_orch",
            provider: "antigravity",
            title: "你作为CTO，分析整体系统架构",
            metadata: {},
          },
        },
        context,
      );
      expect(setModelMock).not.toHaveBeenCalled();
      expect(setMetadataMock).toHaveBeenCalledWith({ agentHarnessBypassed: true });

      // Subsequent agent.open.before for a resumed untracked antigravity session without labels.role must conservatively bypass
      const openedResumed = await hooks["agent.open.before"](
        {
          request: {
            agentId: "agt_resumed_unknown_ag",
            provider: "antigravity",
            cwd: "/workspace/resumed",
            reason: "resume",
            purpose: "interactive",
            title: "设计系统架构",
            labels: {},
            tools: [],
            env: {},
            mcpServers: {},
          },
        },
        {
          paseo: {
            agents: {
              ref: () => ({
                current: () => ({
                  id: "agt_resumed_unknown_ag",
                  provider: "antigravity",
                  metadata: {},
                }),
              }),
            },
          },
        },
      );
      expect(openedResumed.env.PASEO_HARNESS_ROLE).toBeUndefined();
      expect(openedResumed.tools).toEqual([]);

      // harnessSwitchTierRpc must reject bypassed orchestrator sessions
      await expect(
        switchHandler(
          { agentId: "agt_resumed_orch", targetTier: "plan", currentModeId: null },
          context,
        ),
      ).rejects.toThrow(/Orchestrator/i);
      expect(setModelMock).not.toHaveBeenCalled();
    });

    it("retries syncDaemonProfilesIfNeeded after patch error and prevents bypassed bleeding across shared cwd", async () => {
      let subscriber = null as ((state: any) => void) | null;
      const patchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("transient daemon write error"))
        .mockResolvedValueOnce({ requestId: "req-ok", config: {} });
      const hooks: Record<string, any> = {};
      const registeredRpcHandlers: Record<string, any> = {};

      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({
            status: "ready",
            values: { enabled: true, autoSyncDaemonAgentProfiles: true },
          }),
          subscribe: vi.fn().mockImplementation((cb) => {
            subscriber = cb;
            return () => {};
          }),
        }),
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        }),
        addHook: vi.fn().mockImplementation((name, handler) => {
          hooks[name] = handler;
          return () => {};
        }),
      };

      contribute(mockServer);

      const mockPaseo = {
        providers: { snapshot: vi.fn().mockResolvedValue({ entries: [] }) },
        config: {
          get: vi.fn().mockResolvedValue({ requestId: "req-g", config: { agentProfiles: [] } }),
          patch: patchMock,
        },
      };

      // First capture triggers sync which fails on patch
      await registeredRpcHandlers["agent_harness.environment.inspect.request"](
        {},
        { paseo: mockPaseo },
      );
      expect(patchMock).toHaveBeenCalledTimes(1);

      // Same settings emitted again must retry because signature was not committed on error
      const { DEFAULT_AGENT_HARNESS_SETTINGS } = await import("../shared/settings.js");
      subscriber?.({
        status: "ready",
        values: { ...DEFAULT_AGENT_HARNESS_SETTINGS, autoSyncDaemonAgentProfiles: true },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(patchMock).toHaveBeenCalledTimes(2);

      // Bypassed orchestrator created in /shared-cwd must NOT bleed bypassed=true to next empty-prompt session
      const bypassedRes = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/shared-cwd",
            model: "gemini-pro-orchestrator",
            title: "Orchestrate task",
          },
        },
      });
      expect(bypassedRes.metadata?.agentHarnessBypassed).toBe(true);

      const nextLeafRes = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/shared-cwd",
            model: "gemini-4-hydrogen-high",
            title: "",
          },
        },
      });
      expect(nextLeafRes.metadata?.agentHarnessBypassed).toBeUndefined();
      expect(nextLeafRes.metadata?.[HARNESS_METADATA_KEY]).toBeDefined();
    });

    it("skips specialist modelOverride in handoff-tool when honorSpecialistPreferredProvider is false", async () => {
      const { DEFAULT_AGENT_HARNESS_SETTINGS } = await import("../shared/settings.js");
      const { hooks } = createTestServer({
        honorSpecialistPreferredProvider: false,
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
          s.id === "ui"
            ? {
                ...s,
                preferredProvider: "antigravity",
                modelOverride: "gemini-4-neon-high",
              }
            : s,
        ),
      });

      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_parent_mismatch",
          provider: "claude",
          cwd: "/workspace/mismatch",
          reason: "create",
          purpose: "interactive",
          title: "Architecture planning",
          labels: {},
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      const handoffTool = opened.tools.find((t: any) => t.name === "harness_handoff");
      expect(handoffTool).toBeDefined();

      const childHandle = {
        id: "agt_child_claude",
        agentId: "agt_child_claude",
        status: "running",
      };
      const createAgentMock = vi.fn().mockResolvedValue(childHandle);
      const parentHandle = {
        current: () => ({
          provider: "claude",
          cwd: "/workspace/mismatch",
          workspaceId: "ws_mismatch",
          metadata: {},
        }),
        timeline: { append: vi.fn().mockResolvedValue({}) },
      };
      const handoffRes = await handoffTool.execute(
        {
          targetRole: "ui",
          title: "[UI] Styling update",
          specPrompt: "Update button styles cleanly.",
        },
        {
          agent: {
            id: "agt_parent_mismatch",
            provider: "claude",
            cwd: "/workspace/mismatch",
            workspaceId: "ws_mismatch",
          },
          paseo: {
            agents: {
              ref: () => parentHandle,
              create: createAgentMock,
            },
            workspaces: {
              ref: () => ({
                agents: {
                  create: createAgentMock,
                },
              }),
            },
          },
        },
      );

      expect(handoffRes.isError).toBeUndefined();
      const createArg = createAgentMock.mock.calls[0][0];
      expect(createArg.config.provider).toBe("claude/flash");
      expect(createArg.config.provider).not.toContain("gemini-4-neon-high");
    });

    it("loads N dynamic roles from .agents/agent-team.json with worktree fallback, enforces antigravity LAZY_TOOL_CONFIG avoidance, injects role markdown & leaf guard", async () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-federation-"));
      try {
        const mainRepo = path.join(tmpBase, "main-repo");
        const worktreeDir = path.join(tmpBase, "wt-1");
        const wtGitDir = path.join(mainRepo, ".git", "worktrees", "wt-1");
        const teamAgentsDir = path.join(mainRepo, ".agents", "plugins", "team-demo", "agents");
        fs.mkdirSync(wtGitDir, { recursive: true });
        fs.mkdirSync(teamAgentsDir, { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });

        fs.writeFileSync(path.join(wtGitDir, "commondir"), "../..\n", "utf8");
        fs.writeFileSync(path.join(worktreeDir, ".git"), `gitdir: ${wtGitDir}\n`, "utf8");

        fs.writeFileSync(
          path.join(mainRepo, ".agents", "agent-team.json"),
          JSON.stringify(
            {
              schema_version: "1.0.0",
              project_slug: "demo",
              preset: "custom",
              roles: ["fe-uiux", "fe-architect", "fe-developer", "be-developer", "be-reviewer"],
              capabilities: ["matt-sdd"],
              mcp_sources: ["serena"],
              guards: ["guard-serena-nomem"],
              tracker: "local",
              flow: { openspec: false, contracts: false, workflows: false, scaffold_docs: false },
              git_mode: "exclude",
              bindings: {
                "be-developer": { provider: "codex", tier: "flash" },
                "be-reviewer": { provider: "claude", tier: "review" },
              },
            },
            null,
            2,
          ),
          "utf8",
        );

        fs.writeFileSync(
          path.join(mainRepo, ".agents", "plugins", "team-demo", "mcp_config.json"),
          JSON.stringify({ mcpServers: {} }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(teamAgentsDir, "be-developer.md"),
          "---\nname: be-developer\n---\n\nBe Developer Custom Soul Body",
          "utf8",
        );
        fs.writeFileSync(
          path.join(teamAgentsDir, "be-reviewer.md"),
          "---\nname: be-reviewer\ntools: [read_file]\n---\n\nStrict Read-Only Reviewer Soul",
          "utf8",
        );

        const registeredRpcHandlers: Record<string, any> = {};
        const { mockServer, hooks } = createTestServer();
        mockServer.handle.mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        });
        contribute(mockServer);

        const inspectHandler = registeredRpcHandlers["agent_harness.environment.inspect.request"];
        const effectiveHandler = registeredRpcHandlers["agent_harness.config.effective.request"];
        const mockPaseo = {
          providers: { snapshot: vi.fn().mockResolvedValue({ entries: [] }) },
        };

        // Main repo: inspect returns 5 roles + hasLocalAntigravityPlugin=true
        const inspectMain = await inspectHandler({ cwd: mainRepo }, { paseo: mockPaseo });
        expect(inspectMain.agentTeam).toEqual(
          expect.objectContaining({
            projectSlug: "demo",
            rolesCount: 5,
            hasLocalAntigravityPlugin: true,
          }),
        );

        // Worktree without local .agents/plugins falls back to mainRepo's 5 roles, hasLocalAntigravityPlugin=false
        const effectiveWt = await effectiveHandler({ cwd: worktreeDir }, { paseo: mockPaseo });
        expect(effectiveWt.config.specialists).toHaveLength(5);
        expect(effectiveWt.config.agentTeam?.hasLocalAntigravityPlugin).toBe(false);

        // Main repo antigravity root session receives 3-line Federation Bridge and no LAZY_TOOL_CONFIG
        const agCreated = await hooks["agent.create.before"]({
          request: {
            config: {
              provider: "antigravity",
              cwd: mainRepo,
              model: "gemini-4-hydrogen-high",
              title: "Orchestrate feature task",
            },
          },
        });
        expect(agCreated.config.systemPrompt).toContain("[Agent Harness — Federation Bridge]");
        expect(agCreated.config.systemPrompt).not.toContain("[Capability Harness Active Profile]");

        const agOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_main_ag",
            provider: "antigravity",
            cwd: mainRepo,
            reason: "create",
            purpose: "interactive",
            title: "Orchestrate feature task",
            labels: {},
            metadata: agCreated.metadata,
            tools: [],
            env: {},
            mcpServers: { serena: { command: "serena" } },
          },
        });
        expect(agOpened.env.LAZY_TOOL_CONFIG).toBeUndefined();
        expect(agOpened.mcpServers).toEqual({ serena: { command: "serena" } });

        // Worktree antigravity lacks local plugin -> still injects LAZY_TOOL_CONFIG
        const wtOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_wt_ag",
            provider: "antigravity",
            cwd: worktreeDir,
            reason: "create",
            purpose: "interactive",
            title: "Implement feature",
            labels: { role: "fe-developer" },
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(wtOpened.env.LAZY_TOOL_CONFIG).toContain("ui.yaml");

        // Codex session in mainRepo still injects LAZY_TOOL_CONFIG
        const codexOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_main_codex",
            provider: "codex",
            cwd: mainRepo,
            reason: "create",
            purpose: "interactive",
            title: "Build backend API",
            labels: { role: "be-developer" },
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(codexOpened.env.LAZY_TOOL_CONFIG).toContain("backend.yaml");

        // Root interactive handoff spawns be-developer onto codex/flash with leaf label + hides harness_handoff in child
        const handoffTool = agOpened.tools.find((t: any) => t.name === "harness_handoff");
        expect(handoffTool).toBeDefined();

        const createdPayloads: any[] = [];
        const createChildMock = vi.fn().mockImplementation(async (req: any) => {
          createdPayloads.push(req);
          return { id: `child_${createdPayloads.length}`, status: "running" };
        });

        await handoffTool.execute(
          {
            targetRole: "be-developer",
            title: "Implement endpoint",
            specPrompt: "Build the HTTP route cleanly.",
          },
          {
            agent: {
              id: "agt_main_ag",
              provider: "antigravity",
              cwd: mainRepo,
              workspaceId: "ws_demo",
            },
            paseo: {
              agents: {
                ref: () => ({
                  current: () => ({
                    provider: "antigravity",
                    cwd: mainRepo,
                    workspaceId: "ws_demo",
                    metadata: agCreated.metadata,
                  }),
                  timeline: { append: vi.fn().mockResolvedValue({}) },
                }),
                create: createChildMock,
              },
              workspaces: {
                ref: () => ({ agents: { create: createChildMock } }),
              },
            },
          },
        );

        const devSpawnReq = createdPayloads[0];
        expect(devSpawnReq.config.provider).toBe("codex/flash");
        expect(devSpawnReq.labels).toEqual({
          role: "be-developer",
          "paseo.harness-leaf": "1",
        });

        // Passing spawned child into agent.create.before + agent.open.before injects soul markdown & hides harness_handoff
        const leafCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: devSpawnReq.prompt,
            labels: devSpawnReq.labels,
            config: {
              provider: "codex",
              model: "flash",
              cwd: mainRepo,
              title: devSpawnReq.title,
            },
          },
        });
        expect(leafCreated.config.systemPrompt).toContain("Be Developer Custom Soul Body");
        expect(leafCreated.config.systemPrompt).toContain("Leaf Specialist Boundary");
        expect(leafCreated.metadata?.agentHarnessLeaf).toBe(true);

        const leafOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "child_1",
            provider: "codex",
            cwd: mainRepo,
            reason: "create",
            purpose: "interactive",
            title: devSpawnReq.title,
            labels: devSpawnReq.labels,
            metadata: leafCreated.metadata,
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(leafOpened.env.PASEO_HARNESS_LEAF).toBe("1");
        expect(leafOpened.tools.some((t: any) => t.name === "harness_handoff")).toBe(false);

        // Readonly be-reviewer spawns onto claude/review with modeId="plan" and Read-Only Enforcement
        await handoffTool.execute(
          {
            targetRole: "be-reviewer",
            title: "Audit code",
            specPrompt: "Review backend changes.",
          },
          {
            agent: {
              id: "agt_main_ag",
              provider: "antigravity",
              cwd: mainRepo,
              workspaceId: "ws_demo",
            },
            paseo: {
              agents: {
                ref: () => ({
                  current: () => ({
                    provider: "antigravity",
                    cwd: mainRepo,
                    workspaceId: "ws_demo",
                    metadata: agCreated.metadata,
                  }),
                  timeline: { append: vi.fn().mockResolvedValue({}) },
                }),
                create: createChildMock,
              },
              workspaces: {
                ref: () => ({ agents: { create: createChildMock } }),
              },
            },
          },
        );

        const reviewerSpawnReq = createdPayloads[1];
        expect(reviewerSpawnReq.config.provider).toBe("claude/pro");
        expect(reviewerSpawnReq.config.thinkingOptionId).toBe("high");
        expect(reviewerSpawnReq.config.modeId).toBe("plan");

        const reviewerCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: reviewerSpawnReq.prompt,
            labels: reviewerSpawnReq.labels,
            config: {
              provider: "claude",
              model: "review",
              cwd: mainRepo,
              title: reviewerSpawnReq.title,
            },
          },
        });
        expect(reviewerCreated.config.modeId).toBe("plan");
        expect(reviewerCreated.config.systemPrompt).toContain("Strict Read-Only Reviewer Soul");
        expect(reviewerCreated.config.systemPrompt).toContain("Read-Only Specialist Enforcement");
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });

    it("keeps active specialist banner on fullstack prompt when manifest omits orchestrator", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-fullstack-no-orch-"));
      try {
        fs.mkdirSync(path.join(tmpRepo, ".agents", "plugins", "team-demo"), { recursive: true });
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: 2,
            preset: "go-api",
            roles: ["be-impl", "be-reviewer"],
          }),
        );
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "plugins", "team-demo", "mcp_config.json"),
          JSON.stringify({ mcpServers: {} }),
        );

        const { hooks } = createTestServer({ enforceSessionMcpFiltering: true });
        const prompt = "全栈实现一个带 React UI 前端和 Go 后端存储的看板应用";

        const created = await hooks["agent.create.before"]({
          request: {
            initialPrompt: prompt,
            config: {
              provider: "antigravity",
              cwd: tmpRepo,
              title: "Fullstack Board",
            },
          },
        });

        expect(created.config.systemPrompt).toContain("[Agent Harness — Federation Bridge]");
        const meta = created.metadata[HARNESS_METADATA_KEY];
        expect(["be-impl", "be-reviewer"]).toContain(meta.role);
        expect(meta.role).not.toBe("orchestrator");

        const opened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_no_orch_ag",
            reason: "create",
            purpose: "interactive",
            provider: "antigravity",
            cwd: tmpRepo,
            title: "Fullstack Board",
            metadata: created.metadata,
            env: { LAZY_TOOL_CONFIG: "/keep/existing.yaml" },
          },
        });
        expect(opened.env.LAZY_TOOL_CONFIG).toBe("/keep/existing.yaml");
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("locks readonly specialist modeId=plan across create, switch_tier RPC, and turn.after", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-readonly-lock-"));
      try {
        fs.mkdirSync(path.join(tmpRepo, ".agents", "plugins", "team-demo", "agents"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: 2,
            preset: "go-api",
            roles: ["be-impl", "be-reviewer"],
            bindings: {
              "be-reviewer": {
                provider: "claude",
                tier: "review",
                modeId: "acceptEdits",
              },
            },
          }),
        );
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "plugins", "team-demo", "agents", "be-reviewer.md"),
          "---\nname: be-reviewer\nreadonly: true\n---\nReview strictly read-only.\n",
        );

        const registeredRpcHandlers: Record<string, any> = {};
        const { mockServer, hooks, cleanup } = createTestServer({
          autoDowngradePlanOnExec: true,
          phaseLifecycleEnabled: true,
        });
        cleanup();
        mockServer.handle.mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        });
        contribute(mockServer);

        const created = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "Review backend changes",
            labels: { role: "be-reviewer" },
            config: {
              provider: "claude",
              cwd: tmpRepo,
              modeId: "bypassPermissions",
            },
          },
        });
        expect(created.config.modeId).toBe("plan");

        const switchHandler = registeredRpcHandlers["agent_harness.tier.switch.request"];
        expect(switchHandler).toBeDefined();

        const setModelMock = vi.fn().mockResolvedValue(undefined);
        const setMetadataMock = vi.fn().mockResolvedValue(undefined);
        const roMeta = createInitialHarnessMetadata({
          role: "be-reviewer",
          tier: "plan",
          model: "plan",
          roleMatchedRule: "keyword:review",
          tierMatchedRule: "review:kw",
          userModelLocked: false,
          roleLockedByLabel: false,
        });

        const rpcResult = await switchHandler(
          {
            agentId: "agt_ro_switch",
            targetTier: "flash",
            currentModeId: "bypassPermissions",
            reason: "Attempt switch",
          },
          {
            paseo: {
              agents: {
                ref: () => ({
                  current: () => ({
                    provider: "claude",
                    cwd: tmpRepo,
                    options: { model: "plan" },
                    metadata: { [HARNESS_METADATA_KEY]: roMeta },
                  }),
                  setModel: setModelMock,
                  setMetadata: setMetadataMock,
                  timeline: { append: vi.fn().mockResolvedValue({}) },
                }),
              },
            },
          },
        );
        expect(rpcResult.recommendedModeId).toBe("plan");

        const turnSetModel = vi.fn().mockResolvedValue(undefined);
        const turnSetMetadata = vi.fn().mockResolvedValue(undefined);
        const turnAfterHook =
          mockServer.addHook.mock.calls.find((c: any) => c[0] === "agent.turn.after")?.[1] ??
          hooks["agent.turn.after"];
        expect(turnAfterHook).toBeDefined();

        const metaWithTurn1 = { ...roMeta, turnCount: 1, planTurnCount: 1 };
        await turnAfterHook(
          {
            agent: {
              id: "agt_ro_turn",
              provider: "claude",
              cwd: tmpRepo,
              metadata: { [HARNESS_METADATA_KEY]: metaWithTurn1 },
            },
          },
          {
            paseo: {
              agents: {
                ref: () => ({
                  current: () => ({
                    provider: "claude",
                    cwd: tmpRepo,
                    metadata: { [HARNESS_METADATA_KEY]: metaWithTurn1 },
                  }),
                  setModel: turnSetModel,
                  setMetadata: turnSetMetadata,
                  timeline: {
                    refetch: vi.fn().mockResolvedValue({
                      items: [
                        { type: "user_message", text: "Execute now" },
                        { type: "tool_call", name: "edit_file", status: "completed" },
                      ],
                    }),
                    append: vi.fn().mockResolvedValue({}),
                  },
                }),
              },
            },
          },
        );
        expect(turnSetModel).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("isolates concurrent same-cwd leaf/root creates and strips harness_handoff on leaf open & reopen", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sibling-queue-"));
      try {
        fs.mkdirSync(path.join(tmpRepo, ".agents", "plugins", "team-demo"), { recursive: true });
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: 2,
            preset: "react-ts",
            roles: ["fe-developer", "be-developer"],
          }),
        );

        const { hooks } = createTestServer();

        const leafCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "Implement backend API endpoint",
            labels: {
              "paseo.harness-leaf": "1",
              role: "be-developer",
            },
            config: {
              provider: "codex",
              cwd: tmpRepo,
              title: "Leaf Worker",
            },
          },
        });
        expect(leafCreated.metadata[HARNESS_LEAF_META_KEY]).toBe(true);
        expect(leafCreated.metadata[HARNESS_METADATA_KEY].role).toBe("be-developer");

        const rootCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "Coordinate feature work",
            config: {
              provider: "claude",
              cwd: tmpRepo,
              title: "Root Planner",
            },
          },
        });
        expect(rootCreated.metadata[HARNESS_LEAF_META_KEY]).toBeUndefined();
        expect(rootCreated.metadata[HARNESS_METADATA_KEY].role).toBe("fe-developer");

        const rootOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_root_sibling",
            reason: "create",
            purpose: "interactive",
            provider: "claude",
            cwd: tmpRepo,
            title: "Root Planner",
            metadata: rootCreated.metadata,
            tools: [],
          },
        });
        expect(rootOpened.env.PASEO_HARNESS_LEAF).toBeUndefined();
        expect(rootOpened.tools.some((t: any) => t.name === "harness_handoff")).toBe(true);

        const leafOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_leaf_sibling",
            reason: "create",
            purpose: "interactive",
            provider: "codex",
            cwd: tmpRepo,
            title: "Leaf Worker",
            metadata: leafCreated.metadata,
            tools: [{ name: "harness_handoff" }, { name: "read_file" }],
          },
        });
        expect(leafOpened.env.PASEO_HARNESS_LEAF).toBe("1");
        expect(leafOpened.tools.map((t: any) => t.name)).toEqual(["read_file"]);

        const leafReopened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_leaf_sibling",
            reason: "resume",
            purpose: "interactive",
            provider: "codex",
            cwd: tmpRepo,
            title: "Leaf Worker",
            metadata: leafCreated.metadata,
            tools: [{ name: "harness_handoff" }, { name: "read_file" }],
          },
        });
        expect(leafReopened.tools.map((t: any) => t.name)).toEqual(["read_file"]);
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("loads agent-team fallback from ~/.gemini/team-kits, expands placeholders, blocks traversal, and invalidates mtime cache", () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "harness-loader-direct-"));
      try {
        const mockHome = path.join(tmpBase, "home");
        const repoDir = path.join(tmpBase, "repo");
        fs.mkdirSync(path.join(mockHome, ".gemini", "team-kits", "plugins", "team-ops", "agents"), {
          recursive: true,
        });
        fs.mkdirSync(path.join(mockHome, ".local", "bin"), { recursive: true });
        fs.mkdirSync(path.join(mockHome, ".volta", "bin"), { recursive: true });
        fs.writeFileSync(path.join(mockHome, ".local", "bin", "ocr"), "#!/bin/sh\n");
        fs.writeFileSync(path.join(mockHome, ".volta", "bin", "playwright-cli"), "#!/bin/sh\n");

        fs.mkdirSync(path.join(repoDir, ".agents"), { recursive: true });
        const manifestPath = path.join(repoDir, ".agents", "agent-team.json");
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({
            schema_version: 2,
            preset: "custom",
            roles: ["ops-auditor", "../../outside"],
            bindings: {
              "ops-auditor": { provider: "codex", tier: "review" },
            },
          }),
        );
        fs.writeFileSync(
          path.join(
            mockHome,
            ".gemini",
            "team-kits",
            "plugins",
            "team-ops",
            "agents",
            "ops-auditor.md",
          ),
          "---\nname: ops-auditor\nreadonly: true\n---\nHome={{HOME}} OCR={{OCR_BIN}} PW={{PLAYWRIGHT_CLI_BIN}}\n",
        );
        fs.writeFileSync(path.join(tmpBase, "outside.md"), "SHOULD_NOT_LOAD");

        const first = loadWorkspaceAgentTeam(repoDir, mockHome);
        expect(first).not.toBeNull();
        expect(first?.summary.hasLocalAntigravityPlugin).toBe(false);
        expect(first?.summary.roles).toEqual(["ops-auditor"]);
        expect(first?.specialists[0]?.readonly).toBe(true);
        expect(first?.specialists[0]?.matchPatterns.length).toBeGreaterThan(0);
        expect(first?.specialists[0]?.rolePromptTemplate).toBe(
          `Home=${mockHome} OCR=${path.join(mockHome, ".local", "bin", "ocr")} PW=${path.join(mockHome, ".volta", "bin", "playwright-cli")}`,
        );
        expect(first?.specialists[0]?.preferredProvider).toBe("codex");

        // Ensure hasLocalAntigravityTeamPlugin rejects traversal slugs even with fake outer mcp_config.json
        fs.mkdirSync(path.join(repoDir, ".agents", "plugins"), { recursive: true });
        fs.mkdirSync(path.join(repoDir, ".agents", "team-outside"), { recursive: true });
        fs.writeFileSync(
          path.join(repoDir, ".agents", "team-outside", "mcp_config.json"),
          JSON.stringify({ mcpServers: {} }),
        );
        expect(hasLocalAntigravityTeamPlugin(repoDir, "../team-outside")).toBe(false);
        expect(hasLocalAntigravityTeamPlugin(repoDir, "../../outside")).toBe(false);

        // Update manifest with bumped mtime to confirm cache invalidation
        const prevStat = fs.statSync(manifestPath);
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({
            schema_version: 2,
            preset: "custom",
            roles: ["ops-auditor"],
            bindings: {
              "ops-auditor": { provider: "claude", tier: "plan" },
            },
          }),
        );
        const bumpedTime = new Date(prevStat.mtimeMs + 2000);
        fs.utimesSync(manifestPath, bumpedTime, bumpedTime);

        const second = loadWorkspaceAgentTeam(repoDir, mockHome);
        expect(second).not.toBeNull();
        expect(second?.specialists[0]?.preferredProvider).toBe("claude");
        expect(second?.specialists[0]?.preferredTier).toBe("deep");
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });

    it("routes unlabelled natural-language prompts via inferred matchPatterns for workspace roles", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dynamic-matchpatterns-"));
      try {
        fs.mkdirSync(path.join(tmpRepo, ".agents", "plugins", "team-demo"), { recursive: true });
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: 2,
            preset: "fullstack",
            roles: ["fe-developer", "be-developer", "be-reviewer"],
          }),
        );

        const { hooks } = createTestServer();

        const reviewCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "请对变更执行双轴审查与质量门禁检查",
            config: {
              provider: "claude",
              cwd: tmpRepo,
            },
          },
        });
        expect(reviewCreated.metadata[HARNESS_METADATA_KEY].role).toBe("be-reviewer");

        const backendCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "优化后端数据库与 RPC 服务端接口",
            config: {
              provider: "codex",
              cwd: tmpRepo,
            },
          },
        });
        expect(backendCreated.metadata[HARNESS_METADATA_KEY].role).toBe("be-developer");
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("detects per-checkout localFederatedTargets for claude/codex and isolates worktrees without local artifacts", async () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "harness-multi-target-wt-"));
      try {
        const mainRepo = path.join(tmpBase, "main-repo");
        const worktreeDir = path.join(tmpBase, "wt-clean");
        fs.mkdirSync(path.join(mainRepo, ".git", "worktrees", "wt-clean"), { recursive: true });
        fs.mkdirSync(path.join(mainRepo, ".agents"), { recursive: true });
        fs.mkdirSync(path.join(mainRepo, ".claude", "agents"), { recursive: true });
        fs.mkdirSync(path.join(mainRepo, ".codex", "agents"), { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        fs.writeFileSync(
          path.join(worktreeDir, ".git"),
          `gitdir: ${path.join(mainRepo, ".git", "worktrees", "wt-clean")}\n`,
        );
        fs.writeFileSync(
          path.join(mainRepo, ".git", "worktrees", "wt-clean", "commondir"),
          "../..\n",
        );

        fs.writeFileSync(
          path.join(mainRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            project_slug: "fed-demo",
            preset: "go-api",
            targets: ["claude", "codex"],
            roles: ["be-developer", "be-reviewer"],
            bindings: {
              "be-reviewer": { provider: "claude-code", tier: "review" },
            },
          }),
        );
        fs.writeFileSync(
          path.join(mainRepo, ".claude", "agents", "be-developer.md"),
          "---\nname: be-developer\nmodel: flash\n---\n<!-- generated_by: agent-team:fed-demo -->\nDev.\n",
        );
        fs.writeFileSync(
          path.join(mainRepo, ".codex", "agents", "be-developer.toml"),
          '# generated_by: agent-team:fed-demo\nmodel = "flash"\nsandbox_mode = "workspace-write"\ndeveloper_instructions = "Dev."\n',
        );
        // Foreign slug artifact must NOT mark opencode as federated for fed-demo
        fs.mkdirSync(path.join(mainRepo, ".opencode", "agents"), { recursive: true });
        fs.writeFileSync(
          path.join(mainRepo, ".opencode", "agents", "legacy.md"),
          "---\nmode: subagent\n---\n<!-- generated_by: agent-team:other-team -->\nForeign.\n",
        );

        expect(detectLocalFederatedTargets(mainRepo, "fed-demo")).toEqual(["claude", "codex"]);
        expect(detectLocalFederatedTargets(worktreeDir, "fed-demo")).toEqual([]);

        const loadedMain = loadWorkspaceAgentTeam(mainRepo);
        expect(loadedMain?.summary.localFederatedTargets).toEqual(["claude", "codex"]);
        expect(loadedMain?.summary.hasLocalAntigravityPlugin).toBe(false);
        expect(loadedMain?.specialists.find((s) => s.id === "be-reviewer")?.preferredProvider).toBe(
          "claude",
        );

        const loadedWt = loadWorkspaceAgentTeam(worktreeDir);
        expect(loadedWt?.summary.localFederatedTargets).toEqual([]);

        const { hooks } = createTestServer({ enforceSessionMcpFiltering: true });

        // Main repo claude root skips LAZY_TOOL_CONFIG & mcpServers filtering, and gets Federation Bridge
        const claudeCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "Implement Go endpoint",
            config: { provider: "claude", cwd: mainRepo, title: "Main Claude" },
          },
        });
        expect(claudeCreated.config.systemPrompt).toContain("[Agent Harness — Federation Bridge]");
        expect(claudeCreated.config.systemPrompt).not.toContain(
          "[Capability Harness Active Profile]",
        );

        const claudeOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_fed_claude_main",
            reason: "create",
            purpose: "interactive",
            provider: "claude",
            cwd: mainRepo,
            title: "Main Claude",
            metadata: claudeCreated.metadata,
            env: { LAZY_TOOL_CONFIG: "/existing/user.yaml" },
            mcpServers: { user_only: { command: "echo" }, dbx: { command: "dbx" } },
          },
        });
        expect(claudeOpened.env.LAZY_TOOL_CONFIG).toBe("/existing/user.yaml");
        expect(claudeOpened.mcpServers).toEqual({
          user_only: { command: "echo" },
          dbx: { command: "dbx" },
        });

        // Worktree without synthesized .claude/agents keeps Paseo LAZY_TOOL_CONFIG fallback
        const wtCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "Implement Go endpoint",
            config: { provider: "claude", cwd: worktreeDir, title: "WT Claude" },
          },
        });
        expect(wtCreated.config.systemPrompt).toContain("[Capability Harness Active Profile]");

        const wtOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_fed_claude_wt",
            reason: "create",
            purpose: "interactive",
            provider: "claude",
            cwd: worktreeDir,
            title: "WT Claude",
            metadata: wtCreated.metadata,
            env: {},
          },
        });
        expect(wtOpened.env.LAZY_TOOL_CONFIG).toContain("backend.yaml");
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });
  });

  describe("Agent Harness Phase 3 - Workspace Agent Team Editor RPCs", () => {
    function setupTeamRpcHarness(options: {
      workspaces: Record<string, { directory: string; name?: string }>;
      resolveCompiler?: () => {
        available: boolean;
        pythonBin: string | null;
        scriptsDir: string | null;
        agentTeamPy: string | null;
        message: string | null;
      };
      runTeamCompiler?: (
        cmd: string,
        args: string[],
        opts: { cwd: string; timeoutMs: number },
      ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
    }) {
      const handlers: Record<string, any> = {};
      const onTeamUpdated = vi.fn();
      const mockServer: any = {
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          handlers[contract.name] = handler;
        }),
      };

      registerHarnessRpcHandlers(mockServer, {
        readLatestMetadata: async () => null,
        setLatestMetadata: async () => {},
        onTeamUpdated,
        resolveWorkspaceDir: async (wsId) => options.workspaces[wsId] ?? null,
        resolveCompiler: options.resolveCompiler,
        runTeamCompiler: options.runTeamCompiler,
        getConfig: (_wsId, cwd) =>
          ({
            agentTeam: cwd ? loadWorkspaceAgentTeam(cwd)?.summary : null,
          }) as any,
      });

      const mockContext: any = {
        paseo: {
          providers: {
            snapshot: vi.fn().mockResolvedValue({
              entries: [
                {
                  provider: "antigravity",
                  enabled: true,
                  models: [{ id: "gemini-4-hydrogen-high" }],
                },
                {
                  provider: "claude",
                  enabled: true,
                  models: [{ id: "claude-sonnet-4" }],
                },
              ],
            }),
          },
          workspaces: {
            list: vi.fn().mockResolvedValue({
              entries: Object.entries(options.workspaces).map(([id, w]) => ({
                id,
                name: w.name ?? id,
                title: w.name ?? null,
                workspaceDirectory: w.directory,
                projectRootPath: w.directory,
              })),
            }),
            ref: vi.fn((id: string) => ({
              directory: options.workspaces[id]?.directory ?? null,
              name: options.workspaces[id]?.name ?? id,
              current: () =>
                options.workspaces[id]
                  ? {
                      workspaceDirectory: options.workspaces[id].directory,
                      name: options.workspaces[id].name ?? id,
                    }
                  : null,
            })),
          },
        },
      };

      return { handlers, mockContext, onTeamUpdated };
    }

    it("rejects unregistered workspaceId across all 5 agent_harness.team RPCs", async () => {
      const { handlers, mockContext } = setupTeamRpcHarness({ workspaces: {} });

      await expect(
        handlers[harnessTeamInspectRpc.name]({ workspaceId: "missing-ws" }, mockContext),
      ).rejects.toThrow(/Unknown or unavailable registered workspace/);
      await expect(
        handlers[harnessTeamDetectRpc.name]({ workspaceId: "missing-ws" }, mockContext),
      ).rejects.toThrow(/Unknown or unavailable registered workspace/);
      await expect(
        handlers[harnessTeamSaveRpc.name](
          {
            workspaceId: "missing-ws",
            manifest: {
              schema_version: "1.0.0",
              project_slug: "demo",
              preset: "lean-solo",
              targets: ["antigravity"],
              roles: ["be-developer"],
              capabilities: [],
              mcp_sources: [],
              guards: [],
              tracker: "local",
              git_mode: "tracked-manifest",
              flow: {
                openspec: false,
                contracts: false,
                workflows: false,
                scaffold_docs: false,
              },
              bindings: {},
            },
          },
          mockContext,
        ),
      ).rejects.toThrow(/Unknown or unavailable registered workspace/);
      await expect(
        handlers[harnessTeamDoctorRpc.name]({ workspaceId: "missing-ws" }, mockContext),
      ).rejects.toThrow(/Unknown or unavailable registered workspace/);
      await expect(
        handlers[harnessTeamCleanRpc.name]({ workspaceId: "missing-ws" }, mockContext),
      ).rejects.toThrow(/Unknown or unavailable registered workspace/);
    });

    it("reports inherited_from_main in linked worktree and materializes only in worktree without touching mainRepo", async () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "harness-phase3-wt-"));
      try {
        const mainRepo = path.join(tmpBase, "main-repo");
        const worktreeDir = path.join(tmpBase, "wt-feature");
        fs.mkdirSync(path.join(mainRepo, ".git", "worktrees", "wt-feature"), { recursive: true });
        fs.mkdirSync(path.join(mainRepo, ".agents"), { recursive: true });
        fs.mkdirSync(worktreeDir, { recursive: true });
        fs.writeFileSync(
          path.join(worktreeDir, ".git"),
          `gitdir: ${path.join(mainRepo, ".git", "worktrees", "wt-feature")}\n`,
        );
        fs.writeFileSync(
          path.join(mainRepo, ".git", "worktrees", "wt-feature", "commondir"),
          "../..\n",
        );

        const originalMainManifest = JSON.stringify(
          {
            schema_version: "1.0.0",
            project_slug: "main-proj",
            preset: "lean-solo",
            targets: ["antigravity"],
            roles: ["be-developer", "be-reviewer"],
            capabilities: [],
            mcp_sources: ["serena"],
            guards: ["guard-serena-nomem"],
            tracker: "local",
            git_mode: "tracked-manifest",
            flow: { openspec: false, contracts: false, workflows: false, scaffold_docs: false },
            bindings: {},
          },
          null,
          2,
        );
        fs.writeFileSync(path.join(mainRepo, ".agents", "agent-team.json"), originalMainManifest);

        const { handlers, mockContext, onTeamUpdated } = setupTeamRpcHarness({
          workspaces: {
            "ws-main": { directory: mainRepo, name: "Main Repo" },
            "ws-wt": { directory: worktreeDir, name: "Feature WT" },
          },
          resolveCompiler: () => ({
            available: false,
            pythonBin: null,
            scriptsDir: null,
            agentTeamPy: null,
            message: "No Python compiler in test",
          }),
        });

        // Worktree sees inherited_from_main pointing to mainRepo manifest
        const inspectedWt = await handlers[harnessTeamInspectRpc.name](
          { workspaceId: "ws-wt" },
          mockContext,
        );
        expect(inspectedWt.isWorktree).toBe(true);
        expect(inspectedWt.manifestState).toBe("inherited_from_main");
        expect(inspectedWt.checkoutRoot).toBe(path.resolve(worktreeDir));
        expect(inspectedWt.mainRepoRoot).toBe(path.resolve(mainRepo));
        expect(inspectedWt.compilerAvailable).toBe(false);

        // Save materializes worktree manifest with fallback atomic JSON write
        const savedWt = await handlers[harnessTeamSaveRpc.name](
          {
            workspaceId: "ws-wt",
            manifest: {
              ...inspectedWt.manifest!,
              targets: ["antigravity", "codex"],
              guards: [], // verify manual guard uncheck is persisted without re-forcing
              bindings: {
                "be-reviewer": {
                  provider: "claude-code",
                  tier: "review",
                  model: "claude-sonnet-4",
                },
              },
            },
          },
          mockContext,
        );

        expect(savedWt.success).toBe(true);
        expect(savedWt.compiled).toBe(false);
        expect(savedWt.warnings.length).toBeGreaterThan(0);
        expect(savedWt.manifestPath).toBe(
          path.join(path.resolve(worktreeDir), ".agents", "agent-team.json"),
        );
        expect(onTeamUpdated).toHaveBeenCalledTimes(1);

        // Main repo manifest stayed completely untouched
        expect(fs.readFileSync(path.join(mainRepo, ".agents", "agent-team.json"), "utf8")).toBe(
          originalMainManifest,
        );
        const writtenWt = JSON.parse(
          fs.readFileSync(path.join(worktreeDir, ".agents", "agent-team.json"), "utf8"),
        );
        expect(writtenWt.guards).toEqual([]);
        expect(writtenWt.bindings["be-reviewer"].provider).toBe("claude");

        // Re-inspecting worktree now shows present
        const reinspectedWt = await handlers[harnessTeamInspectRpc.name](
          { workspaceId: "ws-wt" },
          mockContext,
        );
        expect(reinspectedWt.manifestState).toBe("present");

        // harnessInspectEnvironmentRpc discovers workspaces and resolves agentTeam by workspaceId
        const envInspect = await handlers[harnessInspectEnvironmentRpc.name](
          { workspaceId: "ws-wt" },
          mockContext,
        );
        expect(envInspect.workspaces?.map((w: any) => w.id)).toEqual(["ws-main", "ws-wt"]);
        expect(envInspect.agentTeam?.projectSlug).toBe("main-proj");
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });

    it("invokes synthesizer detect/save/doctor/clean and preserves failure draft state", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-phase3-compiler-"));
      try {
        fs.mkdirSync(path.join(tmpRepo, ".git"), { recursive: true });
        fs.writeFileSync(
          path.join(tmpRepo, "package.json"),
          JSON.stringify({ dependencies: { react: "^19.0.0" } }),
        );

        const compilerCalls: Array<{ cmd: string; args: string[] }> = [];
        let failSave = false;

        const { handlers, mockContext, onTeamUpdated } = setupTeamRpcHarness({
          workspaces: { "ws-comp": { directory: tmpRepo, name: "React App" } },
          resolveCompiler: () => ({
            available: true,
            pythonBin: "/usr/bin/python3",
            scriptsDir: "/mock/scripts",
            agentTeamPy: "/mock/scripts/agent_team.py",
            message: null,
          }),
          runTeamCompiler: async (cmd, args) => {
            compilerCalls.push({ cmd, args });
            // detect <checkoutRoot> --json
            if (args[0] === "/mock/scripts/agent_team.py" && args[1] === "detect") {
              return {
                exitCode: 0,
                stderr: "",
                stdout: JSON.stringify({
                  recommended_preset: "web-react",
                  resolution_notes: ["Detected React dependency"],
                  recommended_manifest: {
                    schema_version: "1.0.0",
                    project_slug: "react-app",
                    preset: "web-react",
                    targets: ["antigravity", "claude"],
                    roles: ["fe-uiux", "fe-developer"],
                    capabilities: ["ui-unslop"],
                    mcp_sources: ["serena"],
                    guards: ["guard-serena-nomem"],
                    tracker: "local",
                    git_mode: "tracked-manifest",
                    flow: {
                      openspec: false,
                      contracts: false,
                      workflows: false,
                      scaffold_docs: true,
                    },
                  },
                }),
              };
            }
            // doctor <checkoutRoot>
            if (args[0] === "/mock/scripts/agent_team.py" && args[1] === "doctor") {
              return {
                exitCode: 0,
                stderr: "",
                stdout:
                  "\x1b[32m[PASS]\x1b[0m manifest valid\n\x1b[33m[WARN]\x1b[0m codex disabled\n[PASS] antigravity plugin synced\n",
              };
            }
            // synthesize_project or clean_project inline -c script
            if (args[0] === "-c") {
              const targetDir = args[3];
              if (failSave) {
                return { exitCode: 2, stdout: "", stderr: "Synthesizer syntax failure" };
              }
              if (args.length >= 6) {
                const parsed = JSON.parse(args[4]);
                const agDir = path.join(
                  targetDir,
                  ".agents",
                  "plugins",
                  `team-${parsed.project_slug}`,
                );
                fs.mkdirSync(agDir, { recursive: true });
                fs.writeFileSync(path.join(agDir, "mcp_config.json"), "{}");
                fs.writeFileSync(
                  path.join(targetDir, ".agents", "agent-team.json"),
                  JSON.stringify(parsed, null, 2),
                );
                if (parsed.targets.includes("claude")) {
                  const claudeDir = path.join(targetDir, ".claude", "agents");
                  fs.mkdirSync(claudeDir, { recursive: true });
                  fs.writeFileSync(
                    path.join(claudeDir, "fe-developer.md"),
                    `---\ngenerated_by: agent-team:${parsed.project_slug}\n---\n`,
                  );
                }
                return { exitCode: 0, stdout: JSON.stringify({ warnings: [] }), stderr: "" };
              }
              // clean script (args[4] is remove_all_flag)
              const removeAll = args[4] === "1";
              const removed: string[] = [];
              const pluginDir = path.join(targetDir, ".agents", "plugins");
              if (fs.existsSync(pluginDir)) {
                fs.rmSync(pluginDir, { recursive: true, force: true });
                removed.push(".agents/plugins");
              }
              if (removeAll) {
                const mPath = path.join(targetDir, ".agents", "agent-team.json");
                if (fs.existsSync(mPath)) {
                  fs.unlinkSync(mPath);
                  removed.push(".agents/agent-team.json");
                }
              }
              return { exitCode: 0, stdout: JSON.stringify({ removed }), stderr: "" };
            }
            return { exitCode: 1, stdout: "", stderr: "Unexpected compiler args" };
          },
        });

        const detected = await handlers[harnessTeamDetectRpc.name](
          { workspaceId: "ws-comp" },
          mockContext,
        );
        expect(detected.usedCompiler).toBe(true);
        expect(detected.recommendedPreset).toBe("web-react");

        // Verify failure response when compiler exits non-zero
        failSave = true;
        const failedSave = await handlers[harnessTeamSaveRpc.name](
          { workspaceId: "ws-comp", manifest: detected.manifest },
          mockContext,
        );
        expect(failedSave.success).toBe(false);
        expect(failedSave.error).toContain("Synthesizer syntax failure");
        expect(onTeamUpdated).not.toHaveBeenCalled();

        // Successful save & compilation
        failSave = false;
        const saved = await handlers[harnessTeamSaveRpc.name](
          { workspaceId: "ws-comp", manifest: detected.manifest },
          mockContext,
        );
        expect(saved.success).toBe(true);
        expect(saved.compiled).toBe(true);
        expect(saved.localFederatedTargets).toEqual(["antigravity", "claude"]);
        expect(onTeamUpdated).toHaveBeenCalledTimes(1);

        // Doctor ANSI parsing
        const doctorRes = await handlers[harnessTeamDoctorRpc.name](
          { workspaceId: "ws-comp" },
          mockContext,
        );
        expect(doctorRes.passed).toBe(true);
        expect(doctorRes.passCount).toBe(2);
        expect(doctorRes.warnCount).toBe(1);
        expect(doctorRes.failCount).toBe(0);
        expect(doctorRes.output).not.toContain("\x1b[");

        // Clean artifacts while keeping manifest
        const cleanKeep = await handlers[harnessTeamCleanRpc.name](
          { workspaceId: "ws-comp", deleteManifest: false },
          mockContext,
        );
        expect(cleanKeep.success).toBe(true);
        expect(cleanKeep.removed).toContain(".agents/plugins");
        expect(fs.existsSync(path.join(tmpRepo, ".agents", "agent-team.json"))).toBe(true);

        // Clean artifacts AND delete manifest
        const cleanAll = await handlers[harnessTeamCleanRpc.name](
          { workspaceId: "ws-comp", deleteManifest: true },
          mockContext,
        );
        expect(cleanAll.success).toBe(true);
        expect(fs.existsSync(path.join(tmpRepo, ".agents", "agent-team.json"))).toBe(false);
        expect(onTeamUpdated).toHaveBeenCalledTimes(3);
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("serializes concurrent operations on the same checkoutRoot via withCheckoutLock in FIFO order", async () => {
      const order: string[] = [];
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const p1 = withCheckoutLock("/tmp/fifo-lock-repo", async () => {
        order.push("1-start");
        await firstGate;
        order.push("1-end");
        return 1;
      });
      const p2 = withCheckoutLock("/tmp/fifo-lock-repo", async () => {
        order.push("2-start");
        order.push("2-end");
        return 2;
      });
      const p3 = withCheckoutLock("/tmp/fifo-lock-repo", async () => {
        order.push("3-start");
        order.push("3-end");
        return 3;
      });

      await Promise.resolve();
      expect(order).toEqual(["1-start"]);
      releaseFirst();
      await Promise.all([p1, p2, p3]);
      expect(order).toEqual(["1-start", "1-end", "2-start", "2-end", "3-start", "3-end"]);
      expect(getActiveCheckoutLockCount()).toBe(0);
    });

    it("surfaces manifestError on malformed JSON and refuses silent clean when compiler is missing with live artifacts", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-phase3-safety-"));
      try {
        fs.mkdirSync(path.join(tmpRepo, ".git"), { recursive: true });
        fs.mkdirSync(path.join(tmpRepo, ".agents"), { recursive: true });
        fs.writeFileSync(path.join(tmpRepo, ".agents", "agent-team.json"), "{ invalid json");
        fs.mkdirSync(path.join(tmpRepo, ".claude", "agents"), { recursive: true });
        fs.writeFileSync(
          path.join(tmpRepo, ".claude", "agents", "fe-developer.md"),
          "---\ngenerated_by: agent-team:demo\n---\n",
        );

        const { handlers, mockContext } = setupTeamRpcHarness({
          workspaces: { "ws-err": { directory: tmpRepo, name: "Broken JSON" } },
          resolveCompiler: () => ({
            available: false,
            pythonBin: null,
            scriptsDir: null,
            agentTeamPy: null,
            message: "No Python compiler",
          }),
        });

        const inspected = await handlers[harnessTeamInspectRpc.name](
          { workspaceId: "ws-err" },
          mockContext,
        );
        expect(inspected.manifestState).toBe("present");
        expect(inspected.manifest).toBeNull();
        expect(inspected.manifestError).toContain("Invalid JSON");

        // Compiler unavailable while compiled target artifacts still exist -> refuse clean even with deleteManifest
        const refusedClean = await handlers[harnessTeamCleanRpc.name](
          { workspaceId: "ws-err", deleteManifest: true },
          mockContext,
        );
        expect(refusedClean.success).toBe(false);
        expect(refusedClean.error).toContain("compiled artifacts remain");
        expect(fs.existsSync(path.join(tmpRepo, ".agents", "agent-team.json"))).toBe(true);
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("routes doctor to mainRepoRoot for inherited_from_main worktrees and appends save hint when manifest is absent", async () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "harness-phase3-doctor-wt-"));
      try {
        const mainRepo = path.join(tmpBase, "main-repo");
        const worktreeDir = path.join(tmpBase, "wt-doc");
        const emptyRepo = path.join(tmpBase, "empty-repo");
        fs.mkdirSync(path.join(mainRepo, ".git", "worktrees", "wt-doc"), { recursive: true });
        fs.mkdirSync(path.join(mainRepo, ".agents"), { recursive: true });
        fs.writeFileSync(
          path.join(mainRepo, ".agents", "agent-team.json"),
          JSON.stringify({ project_slug: "main-proj" }),
        );
        fs.mkdirSync(worktreeDir, { recursive: true });
        fs.writeFileSync(
          path.join(worktreeDir, ".git"),
          `gitdir: ${path.join(mainRepo, ".git", "worktrees", "wt-doc")}\n`,
        );
        fs.writeFileSync(
          path.join(mainRepo, ".git", "worktrees", "wt-doc", "commondir"),
          "../..\n",
        );
        fs.mkdirSync(path.join(emptyRepo, ".git"), { recursive: true });

        const doctorInvocations: Array<{ target: string; cwd?: string }> = [];
        const { handlers, mockContext } = setupTeamRpcHarness({
          workspaces: {
            "ws-wt": { directory: worktreeDir, name: "Inherited WT" },
            "ws-empty": { directory: emptyRepo, name: "Empty Repo" },
          },
          resolveCompiler: () => ({
            available: true,
            pythonBin: "/usr/bin/python3",
            scriptsDir: "/mock/scripts",
            agentTeamPy: "/mock/scripts/agent_team.py",
            message: null,
          }),
          runTeamCompiler: async (_cmd, args, opts) => {
            if (args[1] === "doctor") {
              const target = args[2] ?? "";
              doctorInvocations.push({ target, cwd: opts?.cwd });
              if (target === path.resolve(mainRepo)) {
                return {
                  exitCode: 0,
                  stdout: `[PASS] Project directory exists: ${target}\n[PASS] Manifest exists\n`,
                  stderr: "",
                };
              }
              return {
                exitCode: 1,
                stdout: `[PASS] Project directory exists: ${target}\n[FAIL] Missing manifest: ${target}/.agents/agent-team.json\n`,
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: "unexpected" };
          },
        });

        const wtDoctor = await handlers[harnessTeamDoctorRpc.name](
          { workspaceId: "ws-wt" },
          mockContext,
        );
        expect(wtDoctor.passed).toBe(true);
        expect(wtDoctor.output).toContain("Inherited from main project");
        expect(doctorInvocations[0]).toEqual({
          target: path.resolve(mainRepo),
          cwd: path.resolve(mainRepo),
        });

        const emptyDoctor = await handlers[harnessTeamDoctorRpc.name](
          { workspaceId: "ws-empty" },
          mockContext,
        );
        expect(emptyDoctor.passed).toBe(false);
        expect(emptyDoctor.failCount).toBe(1);
        expect(emptyDoctor.output).toContain('click "Save & compile" first');
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });
  });

  describe("agy + ocr delegate review mechanism & v4/v5 migration", () => {
    it("defaults review specialist to antigravity with open-code-review-delegate skill and routes harness_handoff to gemini-4-carbon (deep)", async () => {
      const reviewSpec = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "review");
      expect(reviewSpec?.preferredProvider).toBe("antigravity");
      expect(reviewSpec?.preferredTier).toBe("deep");
      expect(reviewSpec?.primarySkills).toEqual([
        "mattpocock-skills:code-review",
        "open-code-review-delegate",
        "gitea",
      ]);
      expect(reviewSpec?.qualityGates).toEqual([
        "dual-axis-semantic-review",
        "open-code-review-delegate-gate",
      ]);

      const { hooks } = createTestServer();
      const created = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/workspace/demo",
            title: "双轴审查与门禁",
            labels: { role: "review" },
          },
        },
      });
      expect(created.config.model).toBe("gemini-4-carbon");
      expect(created.config.thinkingOptionId).toBe("high");
      expect(created.config.systemPrompt).toContain(
        "Primary Skills: code-review, open-code-review-delegate, gitea",
      );

      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_parent_exec",
          provider: "claude",
          cwd: "/workspace/demo",
          reason: "create",
          purpose: "interactive",
          title: "执行阶段",
          labels: {},
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      const handoffTool = opened.tools.find((t: any) => t.name === "harness_handoff");
      expect(handoffTool).toBeDefined();

      const createChildMock = vi.fn().mockResolvedValue({ id: "agt_child_review" });
      const handoffRes = await handoffTool.execute(
        {
          targetRole: "review",
          title: "Review PR changes",
          specPrompt: "Run dual-axis review and ocr delegate checks.",
        },
        {
          agent: {
            id: "agt_parent_exec",
            provider: "claude",
            cwd: "/workspace/demo",
            workspaceId: "ws_demo",
          },
          paseo: {
            agents: {
              ref: () => ({
                current: () => ({
                  provider: "claude",
                  cwd: "/workspace/demo",
                  workspaceId: "ws_demo",
                  metadata: {},
                }),
                timeline: { append: vi.fn().mockResolvedValue({}) },
              }),
              create: createChildMock,
            },
            workspaces: {
              ref: () => ({
                agents: { create: createChildMock },
              }),
            },
          },
        },
      );

      expect(createChildMock).toHaveBeenCalledTimes(1);
      const spawnReq = createChildMock.mock.calls[0]?.[0];
      expect(spawnReq.config.provider).toBe("antigravity/gemini-4-carbon");
      expect(spawnReq.config.thinkingOptionId).toBe("high");
      expect(handoffRes.structuredContent.targetTier).toBe("deep");
      expect(handoffRes.structuredContent.targetModel).toBe("gemini-4-carbon");
    });

    it("migrates v3 settings cleanly to v4 for review specialist and phaseRules", () => {
      const v3Values = {
        ...DEFAULT_AGENT_HARNESS_SETTINGS,
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
          s.id === "review"
            ? {
                ...s,
                description:
                  "双轴代码审查与安全合规审计官（Standards 规范轴 + Spec 契约轴 + OCR 硬门禁）",
                preferredProvider: "claude",
                handoffDefaultPrompt:
                  "Perform dual-axis code review (Standards + Spec) and OCR gate scan.",
                primarySkills: ["mattpocock-skills:code-review", "security-review", "gitea"],
                qualityGates: ["dual-axis-semantic-review", "open-code-review-cli-gate"],
                matchPatterns: [
                  "\\b(?:ocr|code-review|security-review)\\b",
                  "代码审查|安全审计|双轴审查|质量门禁",
                ],
              }
            : s,
        ),
        phaseRules: {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.phaseRules,
          exec: "- [Phase: Fast Execution] Rule: You are running on the fast flash model (phase=exec). Implement minimal, targeted code changes per spec and verify with targeted tests (npx vitest run <file> --bail=1, NEVER full suite), npm run typecheck, and npm run lint. Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic), once green, spawn or hand off via paseo-handoff to Reviewer (Gate) (--label role=review) for dual-axis review (Standards + Spec) and local ocr scan.",
          review:
            "- [Phase: Review Gate] Rule: You are running on the review model (phase=review). Perform read-only dual-axis audit (Standards + Spec) and ocr gate verification; do not author large feature implementations directly.",
        },
      };

      const migrated = agentHarnessSettings.migrate!(
        v3Values,
        3,
      ) as typeof DEFAULT_AGENT_HARNESS_SETTINGS;
      const review = migrated.specialists.find((s) => s.id === "review")!;
      expect(review.preferredProvider).toBe("antigravity");
      expect(review.primarySkills).toEqual([
        "mattpocock-skills:code-review",
        "open-code-review-delegate",
        "gitea",
      ]);
      expect(review.qualityGates).toEqual([
        "dual-axis-semantic-review",
        "open-code-review-delegate-gate",
      ]);
      expect(review.matchPatterns[0]).toContain("open-code-review-delegate");
      expect(migrated.phaseRules.review).toContain("agy + ocr delegate gate verification");
      expect(migrated.phaseRules.exec).toContain("agy + ocr delegate gate verification");
    });

    it("syncs metadata phase=design when implicit architect role starts from exec-classified text, and marks manual max model as currentTier=max", async () => {
      const { hooks } = createTestServer();
      const architectCreate = await hooks["agent.create.before"]({
        request: {
          config: { provider: "claude", model: "flash" },
          initialPrompt: "fix: update adr module boundary check",
          metadata: {},
        },
      });
      const architectMeta = architectCreate.metadata?.[
        HARNESS_METADATA_KEY
      ] as HarnessAgentMetadata;
      expect(architectMeta.role).toBe("architect");
      expect(architectMeta.phase).toBe("design");
      expect(architectCreate.config.modeId).toBe("plan");
      expect(architectCreate.config.systemPrompt).toContain("phase=design");

      const maxCreate = await hooks["agent.create.before"]({
        request: {
          config: { provider: "antigravity", model: "gemini-4-neon" },
          initialPrompt: "fix: deep race condition in lock manager",
          metadata: {},
        },
      });
      const maxMeta = maxCreate.metadata?.[HARNESS_METADATA_KEY] as HarnessAgentMetadata;
      expect(maxMeta.currentTier).toBe("max");
      expect(maxMeta.currentModel).toBe("gemini-4-neon");
      expect(maxMeta.currentThinking).toBe("xhigh");
      expect(maxMeta.userModelLocked).toBe(true);
      expect(maxCreate.config.thinkingOptionId).toBe("xhigh");
    });
  });
});
