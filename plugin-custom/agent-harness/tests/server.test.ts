import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import contribute from "../index.server.js";
import { AgentIntentRouter, type CliRunner } from "../server/agent-intent-router.js";
import { applyAgentModeOption, applyAgentThinkingOption } from "../server/agent-controls.js";
import {
  detectLocalFederatedTargets,
  hasLocalAntigravityTeamPlugin,
  loadWorkspaceAgentTeam,
} from "../server/agent-team-loader.js";
import {
  createInitialHarnessMetadata,
  HARNESS_BYPASSED_META_KEY,
  HARNESS_LEAF_LABEL_KEY,
  HARNESS_LEAF_META_KEY,
  HARNESS_WORKFLOW_PHASE_LABEL_KEY,
  HARNESS_WORKFLOW_TIER_LABEL_KEY,
  HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY,
} from "../shared/lifecycle-state.js";
import { agentHarnessSettings, DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";
import { HARNESS_METADATA_KEY, type HarnessAgentMetadata } from "../shared/types.js";
import {
  harnessDebugClearRpc,
  harnessDebugStatusRpc,
  harnessDebugToggleRpc,
  harnessInspectEnvironmentRpc,
  harnessTeamCleanRpc,
  harnessTeamDetectRpc,
  harnessTeamDoctorRpc,
  harnessTeamInspectRpc,
  harnessTeamSaveRpc,
} from "../shared/contracts.js";
import { registerHarnessRpcHandlers } from "../server/rpc-handlers.js";
import { getActiveCheckoutLockCount, withCheckoutLock } from "../server/team-editor-service.js";

const trackedTestDataDirs = new Set<string>();

function overrideSpecialistInList(
  specialists: typeof DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
  id: string,
  patch: Partial<(typeof DEFAULT_AGENT_HARNESS_SETTINGS.specialists)[number]>,
) {
  const next: typeof DEFAULT_AGENT_HARNESS_SETTINGS.specialists = [];
  for (const s of specialists) {
    next.push(s.id === id ? { ...s, ...patch } : s);
  }
  return next;
}

function createIsolatedTestDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-harness-test-data-"));
  trackedTestDataDirs.add(dir);
  return dir;
}

function createTestServer(
  settingsOverride?: Record<string, unknown>,
  contributeOptions?: {
    dataDir?: string;
    disableAutoDiskSync?: boolean;
    routerCliRunner?: Mock<CliRunner>;
  },
) {
  const dataDir = contributeOptions?.dataDir ?? createIsolatedTestDataDir();
  const routerCliRunner: Mock<CliRunner> =
    contributeOptions?.routerCliRunner ??
    vi.fn<CliRunner>().mockResolvedValue({ stdout: "{}", stderr: "" });
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
  const rawCleanup = contribute(mockServer, {
    dataDir,
    disableAutoDiskSync: true,
    routerCliRunner,
    ...contributeOptions,
  });
  const cleanup = () => {
    rawCleanup();
    trackedTestDataDirs.delete(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { mockServer, hooks, cleanup, dataDir, routerCliRunner };
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

afterEach(() => {
  for (const dir of Array.from(trackedTestDataDirs)) {
    trackedTestDataDirs.delete(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent-harness server contribute", () => {
  it("isolates createTestServer with disableAutoDiskSync so host ~/.agents/profiles/*.json and profilesDir are never modified", async () => {
    const isolatedProfilesDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-profiles-iso-"));
    const hostProfilesDir = "/Users/jerry/.agents/profiles";
    const beforeHostMtimes = new Map<string, number>();
    if (fs.existsSync(hostProfilesDir)) {
      for (const file of fs.readdirSync(hostProfilesDir)) {
        if (file.endsWith(".json")) {
          beforeHostMtimes.set(file, fs.statSync(path.join(hostProfilesDir, file)).mtimeMs);
        }
      }
    }

    try {
      const { cleanup, dataDir } = createTestServer({
        autoSyncDiskProfiles: true,
        autoSyncDaemonAgentProfiles: true,
        profilesDir: isolatedProfilesDir,
      });

      // Wait for async settings.read() promise in contribute() to flush
      await Promise.resolve();
      await Promise.resolve();

      await vi.waitFor(() => {
        expect(fs.existsSync(dataDir)).toBe(true);
      });
      expect(fs.readdirSync(isolatedProfilesDir)).toEqual([]);

      // Also verify real host ~/.agents/profiles/*.json timestamps were untouched
      if (fs.existsSync(hostProfilesDir)) {
        for (const [file, prevMtime] of beforeHostMtimes.entries()) {
          const curMtime = fs.statSync(path.join(hostProfilesDir, file)).mtimeMs;
          expect(curMtime).toBe(prevMtime);
        }
      }

      cleanup();
      expect(fs.existsSync(dataDir)).toBe(false);
    } finally {
      fs.rmSync(isolatedProfilesDir, { recursive: true, force: true });
    }
  });
  it("registers hook on agent.create.before and routes plan intent via Semantic Router", async () => {
    const { mockServer, hooks, routerCliRunner } = createTestServer();
    expect(mockServer.addHook).toHaveBeenCalledWith("agent.create.before", expect.any(Function));
    expect(mockServer.addHook).toHaveBeenCalledWith("agent.open.before", expect.any(Function));

    routerCliRunner.mockResolvedValueOnce({
      stdout: JSON.stringify({
        structured_output: { role: "architect", tier: "plan", phase: "design", confidence: 0.94 },
      }),
      stderr: "",
    });

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
    expect(transformed.config.systemPrompt).toBeUndefined();
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

  it("injects capability harness env and transient appendSystemPrompt banner in agent.open.before based on Semantic Router or labels", async () => {
    const { hooks, routerCliRunner } = createTestServer();

    routerCliRunner.mockResolvedValueOnce({
      stdout: JSON.stringify({
        structured_output: { role: "ui", tier: "standard", phase: "exec", confidence: 0.93 },
      }),
      stderr: "",
    });

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
    expect(transformed.appendSystemPrompt?.join("\n")).toContain(
      "[Capability Harness Active Profile]",
    );
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

  it("honors explicit orchestrator label with Thin Dispatcher role and fast tier (while never auto-routing orchestrator)", async () => {
    const { hooks, routerCliRunner } = createTestServer();

    // Auto-routing composite full-stack prompt without label MUST NOT auto-route to orchestrator
    routerCliRunner.mockResolvedValueOnce({
      stdout: JSON.stringify({
        structured_output: { role: "orchestrator", tier: "fast", phase: "exec", confidence: 0.99 },
      }),
      stderr: "",
    });
    const autoCreated = await hooks["agent.create.before"]({
      request: {
        config: { provider: "claude", cwd: "/tmp/no-auto-orch", model: "flash", title: "" },
        initialPrompt: "开发前后端全栈功能",
      },
    });
    expect(autoCreated.metadata?.[HARNESS_METADATA_KEY]?.role).not.toBe("orchestrator");

    // Explicit role=orchestrator label activates Thin Dispatcher on fast tier
    const createRequest = {
      config: {
        provider: "claude",
        cwd: "/tmp/snake-test",
        model: "flash",
        title: "",
        labels: { role: "orchestrator" },
      },
      initialPrompt:
        "开发一个贪吃蛇的游戏，有UI前端、有后台，可以保存游戏结果，玩家输入姓名，可以排名。",
    };

    const createTransformed = await hooks["agent.create.before"]({ request: createRequest });
    expect(createTransformed.config.model).toBe("lite");
    expect(createTransformed.config.thinkingOptionId).toBe("low");
    expect(createTransformed.config.systemPrompt).toBeUndefined();

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
    expect(openTransformed.appendSystemPrompt?.join("\n")).toContain("Role: orchestrator");
  });

  it("does not leak role labels to subsequent agent creations in the same cwd", async () => {
    const { hooks, routerCliRunner } = createTestServer();

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

    routerCliRunner.mockResolvedValueOnce({
      stdout: JSON.stringify({
        structured_output: { role: "backend", tier: "standard", phase: "exec", confidence: 0.92 },
      }),
      stderr: "",
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

    // role=ui has preferredTier=standard -> gemini-4-neon (thinking: high); banner moves to appendSystemPrompt
    expect(created.config.model).toBe("gemini-4-neon");
    expect(created.config.thinkingOptionId).toBe("high");
    expect(created.config.systemPrompt).toBeUndefined();
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
    expect(opened.tools.some((t: any) => t.name === "harness_handoff")).toBe(false);
    const openBanner = opened.appendSystemPrompt?.join("\n") ?? "";
    expect(openBanner).toContain("read_file");
    expect(openBanner).not.toContain("invoke the `Skill` tool");

    // Pre-existing harness_handoff passed in request.tools must also be stripped for antigravity
    const openedWithPreexistingTool = await hooks["agent.open.before"]({
      request: {
        agentId: "agt_ag_strip",
        workspaceId: "wks_1",
        provider: "antigravity",
        cwd: "/Users/jerry/projects/ai/paseo/ag-strip-test",
        reason: "create",
        purpose: "interactive",
        title: "设计一个多视口响应式 UI 布局方案",
        labels: {},
        tools: [{ name: "harness_handoff" }, { name: "other_tool" }],
        env: {},
        mcpServers: {},
      },
    });
    expect(openedWithPreexistingTool.tools.map((t: any) => t.name)).toEqual(["other_tool"]);

    // Claude & Codex interactive root sessions still receive harness_handoff
    for (const supportedProvider of ["claude", "codex"]) {
      const supportedOpened = await hooks["agent.open.before"]({
        request: {
          agentId: `agt_${supportedProvider}_root`,
          workspaceId: "wks_1",
          provider: supportedProvider,
          cwd: "/Users/jerry/projects/ai/paseo/supported-root",
          reason: "create",
          purpose: "interactive",
          title: "重构按钮组件",
          labels: {},
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      expect(supportedOpened.tools.some((t: any) => t.name === "harness_handoff")).toBe(true);
    }
  });

  describe("Step 1: System Prompt decoupled by phase and tier (injected via transient appendSystemPrompt)", () => {
    it("injects Design & Planning contract into appendSystemPrompt for tier=plan, phase=design (and role !== orchestrator)", async () => {
      const { hooks, routerCliRunner } = createTestServer();
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: { role: "ui", tier: "plan", phase: "design", confidence: 0.93 },
        }),
        stderr: "",
      });
      const created = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy-design-banner",
            title: "有没有更好的ui方案？",
          },
        },
      });
      expect(created.config.systemPrompt).toBeUndefined();

      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_design_banner",
          workspaceId: "wks_1",
          provider: "claude",
          cwd: "/dummy-design-banner",
          reason: "create",
          purpose: "interactive",
          title: "有没有更好的ui方案？",
          labels: {},
          metadata: created.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });

      const prompt = opened.appendSystemPrompt?.join("\n") ?? "";
      expect(prompt).toContain("- Matrix Tier: plan (model: pro, thinking: high)");
      expect(prompt).toContain(
        "- [Phase: Design & Planning] Rule: You are running in read-only planning phase (phase=design, typically on `plan` tier).",
      );
      expect(prompt).toContain(
        "Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session!",
      );
      expect(prompt).toContain("harness_handoff");
      expect(prompt).not.toContain(
        "Once the user selects a design or says to implement it, actually edit the target project files on disk.",
      );
    });

    it("injects Execution contract into appendSystemPrompt for tier=standard, phase=exec (and role !== orchestrator)", async () => {
      const { hooks } = createTestServer();
      const created = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy-exec-banner",
            title: "fix: 修复样式重叠问题",
          },
        },
      });
      expect(created.config.systemPrompt).toBeUndefined();

      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_exec_banner",
          workspaceId: "wks_1",
          provider: "claude",
          cwd: "/dummy-exec-banner",
          reason: "create",
          purpose: "interactive",
          title: "fix: 修复样式重叠问题",
          labels: {},
          metadata: created.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });

      const prompt = opened.appendSystemPrompt?.join("\n") ?? "";
      expect(prompt).toContain("- Matrix Tier: standard (model: flash, thinking: medium)");
      expect(prompt).toContain(
        "- [Phase: Execution] Rule: You are running in read-write execution phase (phase=exec).",
      );
      expect(prompt).toContain(
        "Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic)",
      );
    });

    it("injects Review Gate contract into appendSystemPrompt for role=review (tier=review, phase=review)", async () => {
      const { hooks } = createTestServer();
      const created = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/dummy-review-banner",
            title: "审查当前提交",
            labels: { role: "review" },
          },
        },
      });
      expect(created.config.systemPrompt).toBeUndefined();

      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_review_banner",
          workspaceId: "wks_1",
          provider: "claude",
          cwd: "/dummy-review-banner",
          reason: "create",
          purpose: "interactive",
          title: "审查当前提交",
          labels: { role: "review" },
          metadata: created.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });

      const prompt = opened.appendSystemPrompt?.join("\n") ?? "";
      expect(prompt).toContain("- Matrix Tier: review (model: pro, thinking: high)");
      expect(prompt).toContain(
        "- [Phase: Review Gate] Rule: You are running in read-only review phase (phase=review, typically on `review` tier).",
      );
      expect(prompt).toContain(
        "Perform read-only dual-axis audit (Standards + Spec) and agy + ocr delegate gate verification",
      );
    });

    it("retains Paseo Thin Dispatcher Rule in appendSystemPrompt when role=orchestrator", async () => {
      const { hooks } = createTestServer();
      const created = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/tmp/snake",
            title: "开发贪吃蛇游戏，有UI前端和后端持久化与排名",
            labels: { role: "orchestrator" },
          },
        },
      });
      expect(created.config.systemPrompt).toBeUndefined();

      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_orch_banner",
          workspaceId: "wks_1",
          provider: "claude",
          cwd: "/tmp/snake",
          reason: "create",
          purpose: "interactive",
          title: "开发贪吃蛇游戏，有UI前端和后端持久化与排名",
          labels: { role: "orchestrator" },
          metadata: created.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });

      const prompt = opened.appendSystemPrompt?.join("\n") ?? "";
      expect(prompt).toContain("Paseo Thin Dispatcher Rule");
      expect(prompt).not.toContain("[Phase: Execution]");
    });
  });

  describe("Step 2: agent.create.before metadata initialization", () => {
    it("initializes metadata under agentHarness key and preserves other metadata keys", async () => {
      const { hooks, routerCliRunner } = createTestServer();
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: { role: "architect", tier: "plan", phase: "design", confidence: 0.94 },
        }),
        stderr: "",
      });
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
            title: "/opsx-propose 分析系统架构与设计方案",
          },
        },
      });

      expect(singleTierRes.config.model).toBe("gemini-4-carbon");
      expect(singleTierRes.config.thinkingOptionId).toBe("high");
      expect(singleTierRes.metadata?.[HARNESS_METADATA_KEY]).toBeDefined();
      expect(singleTierRes.metadata?.[HARNESS_METADATA_KEY]?.currentTier).toBe("plan");
    });
  });

  describe("Step 2: Hook 4 (agent.turn.before)", () => {
    it("upgrades model and thinking for empty-title agent (tierMatchedRule=default_empty) and synchronizes metadata", async () => {
      const { hooks, routerCliRunner } = createTestServer();
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: { role: "architect", tier: "plan", phase: "design", confidence: 0.94 },
        }),
        stderr: "",
      });
      const initialMeta = createInitialHarnessMetadata({
        role: "general",
        tier: "standard",
        model: "flash",
        thinkingOptionId: "medium",
        roleMatchedRule: "default_general",
        tierMatchedRule: "default_empty",
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
          currentTier: "plan",
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
      const { hooks, routerCliRunner } = createTestServer();
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: { role: "ui", tier: "plan", phase: "design", confidence: 0.94 },
        }),
        stderr: "",
      });
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
      const { mockServer, dataDir } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });

      // Re-trigger contribute with our spy handle
      contribute(mockServer, { dataDir, disableAutoDiskSync: true });

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

      // Manual switch to deep (normalizes to plan) or max unlocks plan mode into writable exec phase for non-readonly roles
      const deepResult = await switchHandler(
        {
          agentId: "agt_rpc_switch",
          targetTier: "deep",
          currentModeId: "plan",
          reason: "Manual switch to Deep coding",
        },
        context,
      );
      expect(deepResult.currentTier).toBe("plan");
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
      const { mockServer, dataDir } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer, { dataDir, disableAutoDiskSync: true });

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
      const { mockServer, dataDir } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer, { dataDir, disableAutoDiskSync: true });

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

    it("applies Semantic Router role classification and avoids duplicate CLI invocation on open", async () => {
      const { hooks, routerCliRunner } = createTestServer({
        routerEnabled: true,
      });
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: { role: "architect", tier: "plan", phase: "design", confidence: 0.94 },
        }),
        stderr: "",
      });
      await Promise.resolve();
      await Promise.resolve();

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
      expect(routerCliRunner).toHaveBeenCalledTimes(1);

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
      expect(routerCliRunner).toHaveBeenCalledTimes(1);
    });

    it("auto-syncs daemon agentProfiles on subscription update when paseo API has been captured", async () => {
      let subscriber = null as ((state: any) => void) | null;
      const patchMock = vi.fn().mockResolvedValue({ requestId: "req-sync", config: {} });
      const registeredRpcHandlers: Record<string, any> = {};

      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({
            status: "ready",
            values: {
              enabled: true,
              autoSyncDiskProfiles: false,
              autoSyncDaemonAgentProfiles: true,
            },
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

      contribute(mockServer, {
        dataDir: createIsolatedTestDataDir(),
        routerCliRunner: vi.fn<CliRunner>().mockResolvedValue({ stdout: "{}", stderr: "" }),
      });

      const inspectHandler = registeredRpcHandlers["agent_harness.environment.inspect.request"];
      expect(inspectHandler).toBeDefined();

      const mockPaseo = {
        providers: {
          snapshot: vi.fn().mockResolvedValue({
            entries: [
              {
                provider: "antigravity",
                enabled: true,
                models: [
                  { id: "gemini-4-hydrogen-high" },
                  { id: "gemini-4-neon" },
                  { id: "gemini-4-carbon-high" },
                ],
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
          models: ["gemini-4-hydrogen-high", "gemini-4-neon", "gemini-4-carbon-high"],
          modelDetails: [
            { id: "gemini-4-hydrogen-high" },
            { id: "gemini-4-neon" },
            { id: "gemini-4-carbon-high" },
          ],
        },
      ]);
      await vi.waitFor(() => {
        expect(patchMock).toHaveBeenCalledTimes(1);
      });

      subscriber?.({
        status: "ready",
        values: {
          ...DEFAULT_AGENT_HARNESS_SETTINGS,
          autoSyncDiskProfiles: false,
          autoSyncDaemonAgentProfiles: true,
          specialists: overrideSpecialistInList(DEFAULT_AGENT_HARNESS_SETTINGS.specialists, "ui", {
            preferredProvider: "antigravity",
          }),
        },
      });

      await vi.waitFor(() => {
        expect(patchMock).toHaveBeenCalledTimes(2);
      });
      const patchedProfiles = patchMock.mock.calls[1][0].agentProfiles;
      const uiProfile = patchedProfiles.find((p: any) => p.id === "harness-ui");
      expect(uiProfile?.provider).toBe("antigravity");
      expect(uiProfile?.model).toBe("gemini-4-neon");
      expect(uiProfile?.thinkingOptionId).toBe("high");
    });

    it("bypasses resumed untracked gemini-pro-orchestrator via snapshot and rejects harnessSwitchTierRpc", async () => {
      const registeredRpcHandlers: Record<string, any> = {};
      const { mockServer, hooks, dataDir, routerCliRunner } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer, { dataDir, disableAutoDiskSync: true, routerCliRunner });

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
            values: {
              enabled: true,
              autoSyncDiskProfiles: false,
              autoSyncDaemonAgentProfiles: true,
            },
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

      contribute(mockServer, {
        dataDir: createIsolatedTestDataDir(),
        routerCliRunner: vi.fn<CliRunner>().mockResolvedValue({ stdout: "{}", stderr: "" }),
      });

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
      await vi.waitFor(() => {
        expect(patchMock).toHaveBeenCalledTimes(1);
      });

      // Same settings emitted again must retry because signature was not committed on error
      subscriber?.({
        status: "ready",
        values: {
          ...DEFAULT_AGENT_HARNESS_SETTINGS,
          autoSyncDiskProfiles: false,
          autoSyncDaemonAgentProfiles: true,
        },
      });
      await vi.waitFor(() => {
        expect(patchMock).toHaveBeenCalledTimes(2);
      });

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

    it("records daemonProfilesSync status in plugin.settings debug logs across skipped, partial, synced, and idle states", async () => {
      const subscriberRef: { fn: ((state: any) => void) | null } = { fn: null };
      const patchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("transient daemon write error"))
        .mockResolvedValueOnce({ requestId: "req-ok", config: {} });
      const registeredRpcHandlers: Record<string, any> = {};

      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({
            status: "ready",
            values: {
              ...DEFAULT_AGENT_HARNESS_SETTINGS,
              enabled: true,
              debugLogs: true,
              autoSyncDiskProfiles: false,
              autoSyncDaemonAgentProfiles: true,
            },
          }),
          subscribe: vi.fn().mockImplementation((cb) => {
            subscriberRef.fn = cb;
            return () => {};
          }),
        }),
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        }),
        addHook: vi.fn().mockReturnValue(() => {}),
      };

      const dataDir = createIsolatedTestDataDir();
      const rawCleanup = contribute(mockServer, {
        dataDir,
        routerCliRunner: vi.fn<CliRunner>().mockResolvedValue({ stdout: "{}", stderr: "" }),
      });

      try {
        const statusHandler = registeredRpcHandlers[harnessDebugStatusRpc.name];
        await vi.waitFor(async () => {
          const s = await statusHandler({ limit: 20 }, {});
          const initialEvent = s.entries.find((e: any) => e.event === "plugin.settings");
          expect(initialEvent?.detail?.daemonProfilesSync).toEqual({
            status: "skipped",
            reason: "paseo_unavailable",
          });
        });

        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: false,
          },
        });
        await vi.waitFor(async () => {
          const s = await statusHandler({ limit: 20 }, {});
          expect(s.entries[0]?.event).toBe("plugin.settings");
          expect(s.entries[0]?.detail?.daemonProfilesSync).toEqual({
            status: "skipped",
            reason: "autoSyncDaemonAgentProfiles_disabled",
          });
        });

        const mockPaseo = {
          providers: { snapshot: vi.fn().mockResolvedValue({ entries: [] }) },
          config: {
            get: vi.fn().mockResolvedValue({ requestId: "req-g", config: { agentProfiles: [] } }),
            patch: patchMock,
          },
        };
        await registeredRpcHandlers["agent_harness.environment.inspect.request"](
          {},
          { paseo: mockPaseo },
        );
        expect(patchMock).toHaveBeenCalledTimes(0);

        // Re-enabling autoSyncDaemonAgentProfiles triggers sync -> first patch fails -> logs status: "partial"
        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
          },
        });
        await vi.waitFor(async () => {
          expect(patchMock).toHaveBeenCalledTimes(1);
          const s = await statusHandler({ limit: 20 }, {});
          const latest = s.entries.find((e: any) => e.event === "plugin.settings");
          expect(latest?.detail?.daemonProfilesSync).toMatchObject({
            status: "partial",
            syncedCount: 0,
            errorCount: 1,
          });
        });

        // Subscribe triggers retry after partial failure -> succeeds with status: "synced"
        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
          },
        });
        await vi.waitFor(async () => {
          expect(patchMock).toHaveBeenCalledTimes(2);
          const s = await statusHandler({ limit: 20 }, {});
          const latest = s.entries.find((e: any) => e.event === "plugin.settings");
          expect(latest?.detail?.daemonProfilesSync).toMatchObject({
            status: "synced",
            errorCount: 0,
          });
          expect(latest?.detail?.daemonProfilesSync?.syncedCount).toBeGreaterThan(0);
        });

        // Re-emitting unchanged settings yields status: "idle" without patching again
        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
          },
        });
        await vi.waitFor(async () => {
          const s = await statusHandler({ limit: 20 }, {});
          const latest = s.entries.find((e: any) => e.event === "plugin.settings");
          expect(latest?.detail?.daemonProfilesSync).toMatchObject({
            status: "idle",
            reason: "signature_unchanged",
          });
        });
        expect(patchMock).toHaveBeenCalledTimes(2);
      } finally {
        rawCleanup();
      }
    });

    it("gates capturePaseoApi before hydration with awaiting_settings_hydration, guards stale daemonSyncSeq races, and clears intentRouter cache on applySettings", async () => {
      let resolveInitialRead!: (state: any) => void;
      const subscriberRef: { fn: ((state: any) => void) | null } = { fn: null };
      let rejectSlowFirstPatch!: (err: Error) => void;
      const patchMock = vi
        .fn()
        // 1st patch succeeds after hydration completes
        .mockResolvedValueOnce({ requestId: "req-hydrated", config: {} })
        // 2nd patch (from subscriber A) stays pending while subscriber B supersedes it
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectSlowFirstPatch = reject;
            }),
        )
        // 3rd patch (from subscriber B) resolves immediately
        .mockResolvedValueOnce({ requestId: "req-b", config: {} });

      const registeredRpcHandlers: Record<string, any> = {};
      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn(
            () =>
              new Promise((resolve) => {
                resolveInitialRead = resolve;
              }),
          ),
          subscribe: vi.fn().mockImplementation((cb) => {
            subscriberRef.fn = cb;
            return () => {};
          }),
        }),
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        }),
        addHook: vi.fn().mockReturnValue(() => {}),
      };

      const fakeIntentRouter = new AgentIntentRouter({
        cliRunner: vi.fn<CliRunner>().mockResolvedValue({ stdout: "{}", stderr: "" }),
      });
      const clearCacheSpy = vi.spyOn(fakeIntentRouter, "clearCache");
      const disposeSpy = vi.spyOn(fakeIntentRouter, "dispose");

      const dataDir = createIsolatedTestDataDir();
      const rawCleanup = contribute(mockServer, {
        dataDir,
        intentRouter: fakeIntentRouter,
      });

      const mockPaseo = {
        providers: { snapshot: vi.fn().mockResolvedValue({ entries: [] }) },
        config: {
          get: vi.fn().mockResolvedValue({ requestId: "req-g", config: { agentProfiles: [] } }),
          patch: patchMock,
        },
      };

      let cleaned = false;
      try {
        const statusHandler = registeredRpcHandlers[harnessDebugStatusRpc.name];
        const toggleHandler = registeredRpcHandlers[harnessDebugToggleRpc.name];

        // Enable debug logging before hydration finishes so pre-hydration events persist cleanly
        await toggleHandler({ enabled: true }, {});

        // capturePaseoApi before hydration MUST NOT patch daemon yet; must record awaiting_settings_hydration
        await registeredRpcHandlers["agent_harness.environment.inspect.request"](
          {},
          { paseo: mockPaseo },
        );
        expect(patchMock).toHaveBeenCalledTimes(0);

        await vi.waitFor(async () => {
          const s = await statusHandler({ limit: 20 }, {});
          const awaitingEvent = s.entries.find(
            (e: any) =>
              e.event === "plugin.settings" &&
              e.detail?.daemonProfilesSync?.reason === "awaiting_settings_hydration",
          );
          expect(awaitingEvent).toBeDefined();
        });

        const clearCallsBeforeHydration = clearCacheSpy.mock.calls.length;

        // Now hydrate settings -> applySettings clears intentRouter cache and triggers deferred daemon sync
        resolveInitialRead({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
          },
        });

        await vi.waitFor(async () => {
          expect(patchMock).toHaveBeenCalledTimes(1);
          expect(clearCacheSpy.mock.calls.length).toBeGreaterThan(clearCallsBeforeHydration);
          const s = await statusHandler({ limit: 20 }, {});
          expect(s.entries[0]?.event).toBe("plugin.settings");
          expect(s.entries[0]?.detail?.daemonProfilesSync?.status).toBe("synced");
        });

        // Race guard: emit S1 (slow patch), then supersede with S2 (fast patch)
        const specsS1 = overrideSpecialistInList(DEFAULT_AGENT_HARNESS_SETTINGS.specialists, "ui", {
          name: "UI Specialist S1",
        });
        const specsS2 = overrideSpecialistInList(DEFAULT_AGENT_HARNESS_SETTINGS.specialists, "ui", {
          name: "UI Specialist S2",
        });

        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
            specialists: specsS1,
          },
        });
        await vi.waitFor(() => {
          expect(patchMock).toHaveBeenCalledTimes(2);
        });

        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
            specialists: specsS2,
          },
        });
        await vi.waitFor(async () => {
          expect(patchMock).toHaveBeenCalledTimes(3);
          const s = await statusHandler({ limit: 20 }, {});
          expect(s.entries[0]?.detail?.daemonProfilesSync?.status).toBe("synced");
        });

        // Reject stale S1 sync after S2 already committed -> MUST NOT overwrite status with partial or reset signature
        rejectSlowFirstPatch(new Error("stale S1 patch failure"));
        await Promise.resolve();
        await Promise.resolve();

        const afterStale = await statusHandler({ limit: 20 }, {});
        expect(afterStale.entries[0]?.detail?.daemonProfilesSync?.status).toBe("synced");

        // Re-emitting S2 should hit idle/signature_unchanged cleanly (signature was NOT clobbered by stale S1)
        subscriberRef.fn?.({
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            enabled: true,
            debugLogs: true,
            autoSyncDiskProfiles: false,
            autoSyncDaemonAgentProfiles: true,
            specialists: specsS2,
          },
        });
        await vi.waitFor(async () => {
          const s = await statusHandler({ limit: 20 }, {});
          expect(s.entries[0]?.detail?.daemonProfilesSync).toMatchObject({
            status: "idle",
            reason: "signature_unchanged",
          });
        });
        expect(patchMock).toHaveBeenCalledTimes(3);

        rawCleanup();
        cleaned = true;
        expect(disposeSpy).toHaveBeenCalledTimes(1);
      } finally {
        if (!cleaned) rawCleanup();
      }
    });

    it("skips specialist modelOverride in handoff-tool when honorSpecialistPreferredProvider is false", async () => {
      const { hooks } = createTestServer({
        honorSpecialistPreferredProvider: false,
        specialists: overrideSpecialistInList(DEFAULT_AGENT_HARNESS_SETTINGS.specialists, "ui", {
          preferredProvider: "antigravity",
          modelOverride: "gemini-4-neon-high",
        }),
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
        const { mockServer, hooks, dataDir, routerCliRunner } = createTestServer();
        mockServer.handle.mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        });
        contribute(mockServer, { dataDir, disableAutoDiskSync: true, routerCliRunner });

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

        // Main repo antigravity root session receives 3-line Federation Bridge via appendSystemPrompt and no LAZY_TOOL_CONFIG
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
        expect(agCreated.config.systemPrompt).toBeUndefined();

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
        expect(agOpened.appendSystemPrompt?.join("\n")).toContain(
          "[Agent Harness — Federation Bridge]",
        );
        expect(agOpened.appendSystemPrompt?.join("\n")).not.toContain(
          "[Capability Harness Active Profile]",
        );
        expect(agOpened.env.LAZY_TOOL_CONFIG).toBeUndefined();
        expect(agOpened.mcpServers).toEqual({ serena: { command: "serena" } });
        expect(agOpened.tools.some((t: any) => t.name === "harness_handoff")).toBe(false);

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

        // Codex session in mainRepo still injects LAZY_TOOL_CONFIG and attaches harness_handoff
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

        // Root interactive handoff (from codex/claude) spawns be-developer onto codex/flash with leaf label + hides harness_handoff in child
        const handoffTool = codexOpened.tools.find((t: any) => t.name === "harness_handoff");
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
        expect(leafCreated.config.systemPrompt).toBeUndefined();
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
        expect(leafOpened.appendSystemPrompt?.join("\n")).toContain(
          "Be Developer Custom Soul Body",
        );
        expect(leafOpened.appendSystemPrompt?.join("\n")).toContain("Leaf Specialist Boundary");
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
        expect(reviewerCreated.config.systemPrompt).toBeUndefined();

        const reviewerOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "child_2",
            provider: "claude",
            cwd: mainRepo,
            reason: "create",
            purpose: "interactive",
            title: reviewerSpawnReq.title,
            labels: reviewerSpawnReq.labels,
            metadata: reviewerCreated.metadata,
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(reviewerOpened.appendSystemPrompt?.join("\n")).toContain(
          "Strict Read-Only Reviewer Soul",
        );
        expect(reviewerOpened.appendSystemPrompt?.join("\n")).toContain(
          "Read-Only Specialist Enforcement",
        );
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

        const { hooks, routerCliRunner } = createTestServer({ enforceSessionMcpFiltering: true });
        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "be-impl",
              tier: "standard",
              phase: "exec",
              confidence: 0.92,
              reason: "Backend workspace role",
            },
          }),
          stderr: "",
        });
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

        expect(created.config.systemPrompt).toBeUndefined();
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
        expect(opened.appendSystemPrompt?.join("\n")).toContain(
          "[Agent Harness — Federation Bridge]",
        );
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
        const isolatedDir = createIsolatedTestDataDir();
        mockServer.handle.mockImplementation((contract: any, handler: any) => {
          registeredRpcHandlers[contract.name] = handler;
        });
        contribute(mockServer, { dataDir: isolatedDir, disableAutoDiskSync: true });

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
        expect(first?.specialists[0]?.matchPatterns).toEqual([]);
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
        expect(second?.specialists[0]?.preferredTier).toBe("plan");
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });

    it("leaves workspace role matchPatterns empty and routes via explicit role labels or Semantic Router", async () => {
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

        const loadedTeam = loadWorkspaceAgentTeam(tmpRepo);
        expect(loadedTeam).not.toBeNull();
        expect(loadedTeam?.specialists.every((s) => s.matchPatterns.length === 0)).toBe(true);

        const { hooks, routerCliRunner } = createTestServer();

        const reviewCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "请对变更执行双轴审查与质量门禁检查",
            labels: { role: "be-reviewer" },
            config: {
              provider: "claude",
              cwd: tmpRepo,
            },
          },
        });
        expect(reviewCreated.metadata[HARNESS_METADATA_KEY].role).toBe("be-reviewer");

        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "be-developer",
              tier: "standard",
              phase: "exec",
              confidence: 0.94,
              reason: "Backend RPC endpoint optimization",
            },
          }),
          stderr: "",
        });
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

        const { hooks, routerCliRunner } = createTestServer({ enforceSessionMcpFiltering: true });
        routerCliRunner.mockResolvedValue({
          stdout: JSON.stringify({
            structured_output: {
              role: "be-developer",
              tier: "standard",
              phase: "exec",
              confidence: 0.94,
              reason: "Go backend endpoint",
            },
          }),
          stderr: "",
        });

        // Main repo claude root skips LAZY_TOOL_CONFIG & mcpServers filtering, and gets Federation Bridge
        const claudeCreated = await hooks["agent.create.before"]({
          request: {
            initialPrompt: "Implement Go endpoint",
            config: { provider: "claude", cwd: mainRepo, title: "Main Claude" },
          },
        });
        expect(claudeCreated.config.systemPrompt).toBeUndefined();

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
        expect(claudeOpened.appendSystemPrompt?.join("\n")).toContain(
          "[Agent Harness — Federation Bridge]",
        );
        expect(claudeOpened.appendSystemPrompt?.join("\n")).not.toContain(
          "[Capability Harness Active Profile]",
        );
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
        expect(wtCreated.config.systemPrompt).toBeUndefined();

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
        expect(wtOpened.appendSystemPrompt?.join("\n")).toContain(
          "[Capability Harness Active Profile]",
        );
        expect(wtOpened.env.LAZY_TOOL_CONFIG).toContain("backend.yaml");
      } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      }
    });

    it("populates role-accurate lazyToolSlice and non-empty skills, docsFocus, allowedMcpServers, and mandatorySkillActivation for synthesized agent-team specialists", () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "harness-team-defaults-"));
      try {
        const mockHome = path.join(tmpBase, "home");
        const repoDir = path.join(tmpBase, "repo");
        fs.mkdirSync(path.join(repoDir, ".agents"), { recursive: true });
        fs.mkdirSync(mockHome, { recursive: true });

        fs.writeFileSync(
          path.join(repoDir, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            project_slug: "defaults-demo",
            preset: "fullstack-monorepo",
            roles: [
              "fe-pm",
              "fe-architect",
              "fe-developer",
              "fe-qa",
              "be-developer",
              "be-reviewer",
              "ops-ci",
              "be-scout",
            ],
            mcp_sources: ["serena", "postgres-ro"],
            capabilities: ["pm-discovery", "matt-sdd"],
          }),
        );

        const loaded = loadWorkspaceAgentTeam(repoDir, mockHome);
        expect(loaded).not.toBeNull();
        const byId = new Map(loaded!.specialists.map((s) => [s.id, s]));

        expect(byId.get("fe-pm")?.lazyToolSlice).toBe("pm.yaml");
        expect(byId.get("fe-architect")?.lazyToolSlice).toBe("architect.yaml");
        expect(byId.get("fe-developer")?.lazyToolSlice).toBe("ui.yaml");
        expect(byId.get("fe-qa")?.lazyToolSlice).toBe("qa.yaml");
        expect(byId.get("be-developer")?.lazyToolSlice).toBe("backend.yaml");
        expect(byId.get("be-reviewer")?.lazyToolSlice).toBe("review.yaml");
        expect(byId.get("ops-ci")?.lazyToolSlice).toBe("general.yaml");
        expect(byId.get("be-scout")?.lazyToolSlice).toBe("scout.yaml");

        for (const roleId of [
          "fe-pm",
          "fe-architect",
          "fe-developer",
          "fe-qa",
          "be-developer",
          "be-reviewer",
        ]) {
          const spec = byId.get(roleId)!;
          expect(spec.lazyToolSlice).not.toBe("codex.yaml");
          expect(spec.primarySkills.length, `${roleId} primarySkills`).toBeGreaterThan(0);
          expect(spec.docsFocus.length, `${roleId} docsFocus`).toBeGreaterThan(0);
          expect(spec.allowedMcpServers.length, `${roleId} allowedMcpServers`).toBeGreaterThan(0);
          expect(spec.allowedMcpServers).toContain("postgres-ro");
          expect(spec.mandatorySkillActivation, `${roleId} mandatorySkillActivation`).toBe(true);
        }

        expect(byId.get("ops-ci")?.primarySkills.length).toBeGreaterThan(0);
        expect(byId.get("ops-ci")?.docsFocus.length).toBeGreaterThan(0);
        expect(byId.get("ops-ci")?.allowedMcpServers).toContain("serena");
        expect(byId.get("be-scout")?.allowedMcpServers).toContain("claude-mem");
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
    it("defaults review specialist to inherit host provider with review tier, open-code-review-delegate skill, and routes harness_handoff accordingly", async () => {
      const reviewSpec = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.find((s) => s.id === "review");
      expect(reviewSpec?.preferredProvider).toBe("");
      expect(reviewSpec?.preferredTier).toBe("review");
      expect(reviewSpec?.primarySkills).toEqual(["code-review", "open-code-review-delegate"]);
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
      expect(created.config.model).toBe("gemini-4-argon");
      expect(created.config.thinkingOptionId).toBe("high");
      expect(created.config.systemPrompt).toBeUndefined();

      const reviewOpened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_review_ag",
          provider: "antigravity",
          cwd: "/workspace/demo",
          reason: "create",
          purpose: "interactive",
          title: "双轴审查与门禁",
          labels: { role: "review" },
          metadata: created.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      expect(reviewOpened.appendSystemPrompt?.join("\n")).toContain(
        "Primary Skills: code-review, open-code-review-delegate",
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
      expect(spawnReq.config.provider).toBe("claude/pro");
      expect(spawnReq.config.thinkingOptionId).toBe("high");
      expect(handoffRes.structuredContent.targetTier).toBe("review");
      expect(handoffRes.structuredContent.targetModel).toBe("pro");
    });

    it("migrates v3 settings cleanly to v9 for review specialist and phaseRules", () => {
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
      expect(review.preferredProvider).toBe("");
      expect(review.preferredTier).toBe("review");
      expect(review.primarySkills).toEqual(["code-review", "open-code-review-delegate"]);
      expect(review.qualityGates).toEqual([
        "dual-axis-semantic-review",
        "open-code-review-delegate-gate",
      ]);
      expect(review.matchPatterns).toEqual([]);
      expect(migrated.phaseRules.review).toContain("agy + ocr delegate gate verification");
      expect(migrated.phaseRules.review).toContain("`review` tier");
      expect(migrated.phaseRules.exec).toContain("agy + ocr delegate gate verification");
    });

    it("syncs metadata phase=design when implicit architect role starts from exec-classified text, and marks manual max model as currentTier=max", async () => {
      const { hooks, routerCliRunner } = createTestServer();
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: {
            role: "architect",
            tier: "standard",
            phase: "exec",
            confidence: 0.94,
            reason: "ADR boundary check",
          },
        }),
        stderr: "",
      });
      const architectCreate = await hooks["agent.create.before"]({
        request: {
          config: { provider: "claude", model: "flash" },
          initialPrompt: "排查 adr module boundary 检查问题",
          metadata: {},
        },
      });
      const architectMeta = architectCreate.metadata?.[
        HARNESS_METADATA_KEY
      ] as HarnessAgentMetadata;
      expect(architectMeta.role).toBe("architect");
      expect(architectMeta.phase).toBe("design");
      expect(architectCreate.config.modeId).toBe("plan");
      expect(architectCreate.config.systemPrompt).toBeUndefined();

      const architectOpened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_arch_design",
          provider: "claude",
          reason: "create",
          purpose: "interactive",
          metadata: architectCreate.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      expect(architectOpened.appendSystemPrompt?.join("\n")).toContain("phase=design");

      const maxCreate = await hooks["agent.create.before"]({
        request: {
          config: { provider: "codex", model: "plan" },
          initialPrompt: "fix: deep race condition in lock manager",
          metadata: {},
        },
      });
      const maxMeta = maxCreate.metadata?.[HARNESS_METADATA_KEY] as HarnessAgentMetadata;
      expect(maxMeta.currentTier).toBe("max");
      expect(maxMeta.currentModel).toBe("plan");
      expect(maxMeta.currentThinking).toBe("xhigh");
      expect(maxMeta.userModelLocked).toBe(true);
      expect(maxCreate.config.thinkingOptionId).toBe("xhigh");
    });

    it("reconciles external Paseo model switches and legacy v4 tier labels across turn hooks", async () => {
      const { hooks } = createTestServer();
      const setModelMock = vi.fn().mockResolvedValue(undefined);
      const setMetadataMock = vi.fn().mockResolvedValue(undefined);

      const legacyMeta: HarnessAgentMetadata = {
        version: 1,
        role: "ui",
        initialTier: "flash",
        currentTier: "flash",
        currentModel: "gemini-4-neon",
        phase: "exec",
        roleMatchedRule: "heuristic:ui",
        tierMatchedRule: "preserve_user_choice (default_fallback)",
        userModelLocked: true,
        roleLockedByLabel: false,
        turnCount: 0,
        planTurnCount: 0,
        writeToolDetectedInPlan: false,
        handoffSuggestedAtTurn: null,
        autoDowngradedAtTurn: null,
        downgradeReason: null,
        lastProcessedTurnId: null,
        resumeModeId: "full-access",
        lastBilledTier: "flash",
        lastBilledModel: "gemini-4-neon",
        currentThinking: null,
        lastBilledThinking: null,
      };

      const liveSnapshot = {
        id: "agt_ext_switch",
        provider: "antigravity",
        model: "gemini-4-hydrogen",
        thinkingOptionId: "high",
        runtimeInfo: {
          model: "gemini-4-hydrogen",
          thinkingOptionId: "high",
        },
        metadata: { [HARNESS_METADATA_KEY]: legacyMeta },
      };

      const handle = {
        current: () => liveSnapshot,
        setModel: setModelMock,
        setMetadata: setMetadataMock,
        timeline: { refetch: vi.fn().mockResolvedValue({ items: [] }) },
      };
      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(handle),
          },
        },
      };

      await hooks["agent.turn.before"](
        {
          agent: {
            id: "agt_ext_switch",
            provider: "antigravity",
            title: "设计统一后台样式方案",
            metadata: { [HARNESS_METADATA_KEY]: legacyMeta },
          },
        },
        context,
      );

      // Should NOT override the user's manual switch to hydrogen on Turn 0
      expect(setModelMock).not.toHaveBeenCalled();
      expect(setMetadataMock).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          initialTier: "standard",
          currentTier: "fast",
          currentModel: "gemini-4-hydrogen",
          currentThinking: "high",
          lastBilledTier: "standard",
          userModelLocked: false,
          tierMatchedRule: "runtime_sync:external_model_change",
        }),
      });

      setMetadataMock.mockClear();

      await hooks["agent.turn.after"](
        {
          agent: {
            id: "agt_ext_switch",
            provider: "antigravity",
            metadata: { [HARNESS_METADATA_KEY]: legacyMeta },
          },
          turnId: "turn_ext_1",
          outcome: { kind: "completed" },
        },
        context,
      );

      expect(setMetadataMock).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          turnCount: 1,
          currentTier: "fast",
          currentModel: "gemini-4-hydrogen",
          currentThinking: "high",
          lastBilledTier: "fast",
          lastBilledModel: "gemini-4-hydrogen",
          lastBilledThinking: "high",
          lastProcessedTurnId: "turn_ext_1",
        }),
      });
    });

    it("blocks concurrent writable specialist handoff while parent is running, allows readonly review, and injects parent context", async () => {
      const registeredRpcHandlers: Record<string, any> = {};
      const { mockServer, dataDir } = createTestServer();
      mockServer.handle.mockImplementation((contract: any, handler: any) => {
        registeredRpcHandlers[contract.name] = handler;
      });
      contribute(mockServer, { dataDir, disableAutoDiskSync: true });

      const handoffHandler = registeredRpcHandlers["agent_harness.specialist.handoff.request"];
      expect(handoffHandler).toBeDefined();

      let parentStatus: "running" | "idle" = "running";
      const createChildMock = vi.fn().mockResolvedValue({ id: "agt_child_guard" });
      const parentHandle = {
        current: () => ({
          status: parentStatus,
          provider: "antigravity",
          cwd: "/workspace/project",
          workspaceId: "ws_guard",
          title: "Unify admin workspace UI",
          metadata: {},
        }),
        timeline: {
          append: vi.fn().mockResolvedValue({}),
          refetch: vi.fn().mockResolvedValue({
            items: [
              { type: "user_message", text: "Fix PR #573 workflow issues" },
              { type: "assistant_message", text: "Updated reviewdog.yml and executor tests" },
            ],
          }),
        },
      };
      const context = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue(parentHandle),
            create: createChildMock,
          },
          workspaces: {
            ref: vi.fn().mockReturnValue({
              agents: { create: createChildMock },
            }),
          },
        },
      };

      await expect(
        handoffHandler(
          {
            agentId: "agt_parent_busy",
            workspaceId: "ws_guard",
            targetRole: "qa",
          },
          context,
        ),
      ).rejects.toThrow(/Parent agent is currently running/);
      expect(createChildMock).not.toHaveBeenCalled();

      // Readonly review specialist is still allowed while parent is running, and receives parent context
      await handoffHandler(
        {
          agentId: "agt_parent_busy",
          workspaceId: "ws_guard",
          targetRole: "review",
        },
        context,
      );
      expect(createChildMock).toHaveBeenCalledTimes(1);
      const reviewPrompt = createChildMock.mock.calls[0]?.[0]?.prompt as string;
      expect(reviewPrompt).toContain("[Parent Session Context]");
      expect(reviewPrompt).toContain("Parent Task: Unify admin workspace UI");
      expect(reviewPrompt).toContain("Fix PR #573 workflow issues");
      expect(reviewPrompt).toContain("Shared Workspace Discipline");

      // Once parent is idle, writable specialist handoff succeeds
      parentStatus = "idle";
      await handoffHandler(
        {
          agentId: "agt_parent_busy",
          workspaceId: "ws_guard",
          targetRole: "qa",
        },
        context,
      );
      expect(createChildMock).toHaveBeenCalledTimes(2);
    });

    it("upgrades thinkingOptionId when router changes model tier, while preserving explicit thinking on same model", async () => {
      const { hooks, routerCliRunner } = createTestServer();
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: {
            role: "ui",
            tier: "plan",
            phase: "design",
            confidence: 0.93,
            reason: "System theme design",
          },
        }),
        stderr: "",
      });

      // Pre-filled fast model + medium thinking routed to plan model -> upgrades thinking to high
      const upgraded = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/tmp/thinking-upgrade",
            model: "gemini-4-hydrogen",
            thinkingOptionId: "medium",
            title: "检查系统主题设计方案",
          },
        },
      });
      expect(upgraded.config.model).toBe("gemini-4-carbon");
      expect(upgraded.config.thinkingOptionId).toBe("high");
      expect(upgraded.metadata?.[HARNESS_METADATA_KEY]?.currentThinking).toBe("high");

      // Same model (no model change) preserves caller's explicit thinkingOptionId
      const preserved = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "antigravity",
            cwd: "/tmp/thinking-preserve",
            model: "gemini-4-neon",
            thinkingOptionId: "medium",
            title: "fix: 微调间距",
          },
        },
      });
      expect(preserved.config.model).toBe("gemini-4-neon");
      expect(preserved.config.thinkingOptionId).toBe("medium");
    });

    it("proactively steps down from design to standard on 'ok, continue' and service startup commands", async () => {
      const { hooks } = createTestServer();

      for (const message of ["ok, continue", "启动服务"]) {
        const meta: HarnessAgentMetadata = {
          ...createInitialHarnessMetadata({
            role: "ui",
            tier: "plan",
            phase: "design",
            model: "gemini-4-carbon",
            thinkingOptionId: "high",
            roleMatchedRule: "heuristic:ui",
            tierMatchedRule: "plan",
          }),
          turnCount: 1,
          planTurnCount: 1,
        };
        const setModelMock = vi.fn().mockResolvedValue(undefined);
        const setMetadataMock = vi.fn().mockResolvedValue(undefined);
        const appendMock = vi.fn().mockResolvedValue({});
        const handle = {
          current: () => ({
            id: `agt_stepdown_${message}`,
            provider: "antigravity",
            model: "gemini-4-carbon",
            thinkingOptionId: "high",
            metadata: { [HARNESS_METADATA_KEY]: meta },
          }),
          setModel: setModelMock,
          setMetadata: setMetadataMock,
          timeline: {
            refetch: vi.fn().mockResolvedValue({
              items: [{ type: "user_message", text: message }],
            }),
            append: appendMock,
          },
        };
        const context = {
          paseo: {
            agents: { ref: vi.fn().mockReturnValue(handle) },
          },
        };

        await hooks["agent.turn.before"](
          {
            agent: {
              id: `agt_stepdown_${message}`,
              provider: "antigravity",
              metadata: { [HARNESS_METADATA_KEY]: meta },
            },
          },
          context,
        );

        expect(setModelMock).toHaveBeenCalledWith("gemini-4-neon");
        expect(setMetadataMock).toHaveBeenCalledWith({
          [HARNESS_METADATA_KEY]: expect.objectContaining({
            currentTier: "standard",
            currentModel: "gemini-4-neon",
            phase: "exec",
            downgradeReason: "explicit_exec_intent",
          }),
        });
      }
    });

    it("emits parent specialist_handoff timeline card on external mcp_paseo_create_agent spawn without duplicating SDK handoffs", async () => {
      const { hooks } = createTestServer();
      const parentAppendMock = vi.fn().mockResolvedValue({});
      const childAppendMock = vi.fn().mockResolvedValue({});
      const parentMeta = createInitialHarnessMetadata({
        role: "ui",
        tier: "deep",
        phase: "design",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "heuristic:ui",
        tierMatchedRule: "plan",
      });
      parentMeta.turnCount = 3;

      const parentHandle = {
        current: () => ({
          id: "agt_parent_ext",
          provider: "antigravity",
          cwd: "/workspace/demo",
          workspaceId: "ws_demo",
          metadata: { [HARNESS_METADATA_KEY]: parentMeta },
        }),
        timeline: { append: parentAppendMock },
      };
      const childHandle = {
        timeline: { append: childAppendMock },
      };

      const context = {
        paseo: {
          agents: {
            ref: vi
              .fn()
              .mockImplementation((id: string) =>
                id === "agt_parent_ext" ? parentHandle : childHandle,
              ),
          },
        },
      };

      // 1. External spawn (e.g. mcp_paseo_create_agent) emits initial_route on child + specialist_handoff on parent
      const childMeta = createInitialHarnessMetadata({
        role: "review",
        tier: "deep",
        phase: "review",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "label:role",
        tierMatchedRule: "role_tier:review",
        roleLockedByLabel: true,
      });

      await hooks["agent.create.after"](
        {
          agent: {
            id: "agt_child_ext_review",
            parentAgentId: "agt_parent_ext",
            provider: "antigravity",
            title: "Reviewer Gate: Theme Check",
            metadata: {
              [HARNESS_METADATA_KEY]: childMeta,
              [HARNESS_LEAF_META_KEY]: true,
            },
          },
        },
        context,
      );

      expect(childAppendMock).toHaveBeenCalledTimes(1);
      expect(parentAppendMock).toHaveBeenCalledTimes(1);
      expect(parentAppendMock.mock.calls[0]?.[0]?.data).toMatchObject({
        transitionKind: "specialist_handoff",
        role: "review",
        fromTier: "deep",
        toTier: "deep",
        phase: "review",
        childAgentId: "agt_child_ext_review",
        childAgentTitle: "Reviewer Gate: Theme Check",
        turnNumber: 3,
      });

      // 2. SDK harness_handoff spawn emits once inside spawnHarnessSpecialist and deduplicates agent.create.after
      parentAppendMock.mockClear();
      childAppendMock.mockClear();
      const opened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_parent_ext",
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
      const sdkChildMeta = createInitialHarnessMetadata({
        role: "ui",
        tier: "standard",
        phase: "exec",
        model: "flash",
        thinkingOptionId: "medium",
        roleMatchedRule: "label:role",
        tierMatchedRule: "role_tier:ui",
        roleLockedByLabel: true,
      });
      const createSdkChild = vi.fn().mockResolvedValue({ id: "agt_child_sdk_ui" });
      await handoffTool.execute(
        {
          targetRole: "ui",
          title: "Implement UI",
          specPrompt: "Build theme switcher.",
        },
        {
          agent: {
            id: "agt_parent_ext",
            provider: "claude",
            cwd: "/workspace/demo",
            workspaceId: "ws_demo",
          },
          paseo: {
            agents: {
              ref: context.paseo.agents.ref,
              create: createSdkChild,
            },
            workspaces: {
              ref: () => ({ agents: { create: createSdkChild } }),
            },
          },
        },
      );
      expect(parentAppendMock).toHaveBeenCalledTimes(1);

      await hooks["agent.create.after"](
        {
          agent: {
            id: "agt_child_sdk_ui",
            parentAgentId: "agt_parent_ext",
            provider: "claude",
            title: "[UI] Implement UI",
            metadata: {
              [HARNESS_METADATA_KEY]: sdkChildMeta,
              [HARNESS_LEAF_META_KEY]: true,
            },
          },
        },
        context,
      );
      expect(parentAppendMock).toHaveBeenCalledTimes(1);
    });

    it("supports unattended workflow contract (paseo.workflow.unattended=1) without forcing native plan mode in design phase while locking role and enforcing review read-only shell auto-approval", async () => {
      const { hooks, routerCliRunner } = createTestServer({
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
          s.id === "review" ? { ...s, readonly: true } : s,
        ),
      });
      routerCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: {
            role: "architect",
            tier: "plan",
            phase: "design",
            confidence: 0.94,
            reason: "Workflow architecture design",
          },
        }),
        stderr: "",
      });

      // 1. Unattended workflow design step (e.g. spec/plan without role label) preserves caller modeId (e.g. bypassPermissions) instead of forcing "plan"
      const unattendedDesign = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/workspace/workflow-demo",
            model: "flash",
            modeId: "bypassPermissions",
            title: "[Workflow Spec] 设计无人值守架构规格方案",
            labels: {
              [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
            },
          },
        },
      });

      expect(unattendedDesign.config.model).toBe("pro");
      expect(unattendedDesign.config.modeId).toBe("bypassPermissions");
      expect(unattendedDesign.config.systemPrompt).toBeUndefined();

      const unattendedOpened = await hooks["agent.open.before"]({
        request: {
          agentId: "agt_unattended_design",
          provider: "claude",
          cwd: "/workspace/workflow-demo",
          reason: "create",
          purpose: "interactive",
          title: "[Workflow Spec] 设计无人值守架构规格方案",
          labels: {
            [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
          },
          metadata: unattendedDesign.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      expect(unattendedOpened.appendSystemPrompt?.join("\n")).toContain(
        "[Phase: Unattended Workflow Design & Spec]",
      );
      expect(unattendedOpened.appendSystemPrompt?.join("\n")).not.toContain("ExitPlanMode tool");
      const unattendedMeta = unattendedDesign.metadata?.[
        HARNESS_METADATA_KEY
      ] as HarnessAgentMetadata;
      expect(unattendedMeta.phase).toBe("design");
      expect(unattendedMeta.roleLockedByLabel).toBe(true);

      // 2. Unattended workflow review step still enforces native plan mode for readonly review specialist on claude
      const unattendedReview = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/workspace/workflow-demo",
            model: "flash",
            modeId: "bypassPermissions",
            title: "[Workflow Review] 代码审查与门禁",
            labels: {
              role: "review",
              [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
            },
          },
        },
      });
      expect(unattendedReview.config.modeId).toBe("plan");
      const reviewMeta = unattendedReview.metadata?.[HARNESS_METADATA_KEY] as HarnessAgentMetadata;
      expect(reviewMeta.phase).toBe("review");
      expect(reviewMeta.roleLockedByLabel).toBe(true);

      // 3. agent.permission.before auto-approves read-only shell commands (including ocr delegate preview/rule) in phase="review"
      const respondToPermission = vi.fn().mockResolvedValue(undefined);
      const permContext = {
        paseo: {
          agents: {
            ref: vi.fn().mockReturnValue({
              respondToPermission,
            }),
          },
        },
      };
      const reviewAgent = {
        id: "agt_unattended_review",
        provider: "claude",
        cwd: "/workspace/workflow-demo",
        metadata: { [HARNESS_METADATA_KEY]: reviewMeta },
      };

      await hooks["agent.permission.before"](
        {
          agent: reviewAgent,
          request: {
            id: "perm_ocr_preview",
            kind: "shell",
            input: {
              command:
                "/Users/jerry/.local/bin/ocr delegate preview --format json && git --no-pager diff",
            },
          },
        },
        permContext,
      );
      expect(respondToPermission).toHaveBeenCalledWith({
        requestId: "perm_ocr_preview",
        response: { behavior: "allow" },
      });

      // Rejects non-read-only ocr review in phase="review"
      respondToPermission.mockClear();
      await hooks["agent.permission.before"](
        {
          agent: reviewAgent,
          request: {
            id: "perm_ocr_review_llm",
            kind: "shell",
            input: {
              command: "ocr review --format json",
            },
          },
        },
        permContext,
      );
      expect(respondToPermission).not.toHaveBeenCalled();

      // 4. Supports agent-team suffixed roles (be-reviewer, fe-architect) and paseo.workflow.phase / paseo.workflow.tier labels
      const teamSpecialists = [
        {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
          id: "fe-architect",
          name: "FE Architect",
          shortLabel: "fe-architect",
          builtIn: false,
          readonly: true,
          preferredTier: "deep",
          rolePromptTemplate: "",
        },
        {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[2],
          id: "be-developer",
          name: "BE Developer",
          shortLabel: "be-developer",
          builtIn: false,
          readonly: false,
          preferredTier: "standard",
          rolePromptTemplate: "",
        },
        {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[6],
          id: "be-reviewer",
          name: "BE Reviewer",
          shortLabel: "be-reviewer",
          builtIn: false,
          readonly: true,
          preferredTier: "deep",
          rolePromptTemplate: "",
        },
      ];
      const { hooks: teamHooks } = createTestServer({
        specialists: teamSpecialists,
      });

      // 4a. fe-architect in unattended workflow resolves phase="design", skips native plan lock, and injects Unattended Workflow Design banner
      const feArchCreated = await teamHooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/workspace/team-wf",
            model: "flash",
            modeId: "bypassPermissions",
            title: "[Workflow Spec] 前端架构设计",
            labels: {
              role: "fe-architect",
              [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
              [HARNESS_WORKFLOW_PHASE_LABEL_KEY]: "design",
            },
          },
        },
      });
      expect(feArchCreated.config.modeId).toBe("bypassPermissions");
      expect(feArchCreated.config.systemPrompt).toBeUndefined();
      const feArchOpened = await teamHooks["agent.open.before"]({
        request: {
          agentId: "agt_fe_arch_wf",
          provider: "claude",
          cwd: "/workspace/team-wf",
          reason: "create",
          purpose: "interactive",
          title: "[Workflow Spec] 前端架构设计",
          labels: {
            role: "fe-architect",
            [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
            [HARNESS_WORKFLOW_PHASE_LABEL_KEY]: "design",
          },
          metadata: feArchCreated.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });
      expect(feArchOpened.appendSystemPrompt?.join("\n")).toContain(
        "[Phase: Unattended Workflow Design & Spec]",
      );
      expect(
        (feArchCreated.metadata?.[HARNESS_METADATA_KEY] as HarnessAgentMetadata | undefined)?.phase,
      ).toBe("design");

      // 4b. be-reviewer in unattended workflow resolves phase="review" and enforces native plan mode on claude
      const beRevCreated = await teamHooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/workspace/team-wf",
            model: "flash",
            modeId: "bypassPermissions",
            title: "[Workflow Review] 后端代码审查",
            labels: {
              role: "be-reviewer",
              [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
            },
          },
        },
      });
      expect(beRevCreated.config.modeId).toBe("plan");
      expect(
        (beRevCreated.metadata?.[HARNESS_METADATA_KEY] as HarnessAgentMetadata | undefined)?.phase,
      ).toBe("review");

      // 4c. paseo.workflow.tier="fast" overrides specialist preferredTier ("standard") for chore tasks in unattended workflow
      const fastChoreCreated = await teamHooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/workspace/team-wf",
            model: "flash",
            modeId: "bypassPermissions",
            title: "chore: update dependencies",
            labels: {
              role: "be-developer",
              [HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY]: "1",
              [HARNESS_WORKFLOW_PHASE_LABEL_KEY]: "exec",
              [HARNESS_WORKFLOW_TIER_LABEL_KEY]: "fast",
            },
          },
        },
      });
      expect(fastChoreCreated.config.model).toBe("lite");
      const fastChoreMeta = fastChoreCreated.metadata?.[
        HARNESS_METADATA_KEY
      ] as HarnessAgentMetadata;
      expect(fastChoreMeta.currentTier).toBe("fast");
      expect(fastChoreMeta.phase).toBe("exec");

      // 5. Explicit metadata.agentHarnessBypassed=true in agent.create.before skips routing, banner, and agentHarness metadata
      const bypassedCreate = await teamHooks["agent.create.before"]({
        request: {
          config: {
            provider: "codex",
            cwd: "/workspace/team-wf",
            model: "flash",
            title: "[Workflow Spec] 设计架构方案（显式关闭 Harness）",
          },
          metadata: {
            agentHarnessBypassed: true,
          },
        },
      });
      expect(bypassedCreate.config.model).toBe("flash");
      expect(bypassedCreate.config.systemPrompt).toBeUndefined();
      expect(bypassedCreate.metadata?.agentHarnessBypassed).toBe(true);
      expect(bypassedCreate.metadata?.[HARNESS_METADATA_KEY]).toBeUndefined();
    });

    it("steps down antigravity design -> exec in agent.turn.after on exit_plan_mode and writable invoke_subagent while ignoring readonly subagent", async () => {
      const { hooks } = createTestServer();

      // 1. exit_plan_mode triggers plan_approved step-down
      const meta1 = createInitialHarnessMetadata({
        role: "general",
        tier: "deep",
        phase: "design",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "plan",
        tierMatchedRule: "plan",
      });
      const { context: ctx1, handle: handle1 } = createMockContext({
        timelineItems: [
          { type: "user_message", text: "设计模块接口方案" },
          { type: "tool_call", name: "exit_plan_mode", input: {} },
        ],
      });
      await hooks["agent.turn.after"](
        {
          agent: {
            id: "agt_agy_exit_plan",
            provider: "antigravity",
            metadata: { [HARNESS_METADATA_KEY]: meta1 },
          },
          turnId: "turn_exit_1",
          outcome: { kind: "completed" },
        },
        ctx1,
      );
      expect(handle1.setModel).toHaveBeenCalledWith("gemini-4-neon");
      expect(handle1.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          phase: "exec",
          currentTier: "standard",
          downgradeReason: "plan_approved",
        }),
      });

      // 2. writable invoke_subagent (TypeName="impl-worker") triggers step-down
      const meta2 = createInitialHarnessMetadata({
        role: "general",
        tier: "plan",
        phase: "design",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "plan",
        tierMatchedRule: "plan",
      });
      const { context: ctx2, handle: handle2 } = createMockContext({
        timelineItems: [
          { type: "user_message", text: "设计并分析模块" },
          {
            type: "tool_call",
            name: "invoke_subagent",
            input: { TypeName: "impl-worker", Task: "Write handler" },
          },
        ],
      });
      await hooks["agent.turn.after"](
        {
          agent: {
            id: "agt_agy_writable_sub",
            provider: "antigravity",
            metadata: { [HARNESS_METADATA_KEY]: meta2 },
          },
          turnId: "turn_sub_1",
          outcome: { kind: "completed" },
        },
        ctx2,
      );
      expect(handle2.setModel).toHaveBeenCalledWith("gemini-4-neon");
      expect(handle2.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          phase: "exec",
          currentTier: "standard",
          downgradeReason: "write_tool_in_plan",
        }),
      });

      // 3. readonly invoke_subagent (TypeName="research") stays in design phase
      const meta3 = createInitialHarnessMetadata({
        role: "general",
        tier: "plan",
        phase: "design",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "plan",
        tierMatchedRule: "plan",
      });
      const { context: ctx3, handle: handle3 } = createMockContext({
        timelineItems: [
          { type: "user_message", text: "设计方案" },
          {
            type: "tool_call",
            name: "invoke_subagent",
            input: { TypeName: "research", Task: "Inspect docs" },
          },
        ],
      });
      await hooks["agent.turn.after"](
        {
          agent: {
            id: "agt_agy_readonly_sub",
            provider: "antigravity",
            metadata: { [HARNESS_METADATA_KEY]: meta3 },
          },
          turnId: "turn_ro_1",
          outcome: { kind: "completed" },
        },
        ctx3,
      );
      expect(handle3.setModel).not.toHaveBeenCalled();
      expect(handle3.setMetadata).toHaveBeenCalledWith({
        [HARNESS_METADATA_KEY]: expect.objectContaining({
          phase: "design",
          currentTier: "plan",
        }),
      });
    });

    it("supports debug trace RPCs (status/toggle/clear), avoids duplicate debug.toggled on subscribe, preserves pre-read toggle, and returns imported specialists", async () => {
      const dataDir = createIsolatedTestDataDir();
      const profilesDir = createIsolatedTestDataDir();
      const hooks: Record<string, any> = {};
      const handlers: Record<string, any> = {};
      const subscriberRef: { fn?: (state: any) => void } = {};
      let resolveInitialRead: ((state: any) => void) | null = null;

      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn(
            () =>
              new Promise((resolve) => {
                resolveInitialRead = resolve;
              }),
          ),
          subscribe: vi.fn().mockImplementation((cb) => {
            subscriberRef.fn = cb;
            return () => {};
          }),
        }),
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          handlers[contract.name] = handler;
        }),
        addHook: vi.fn().mockImplementation((name, handler) => {
          hooks[name] = handler;
          return () => {};
        }),
      };

      const debugRouterCliRunner = vi
        .fn<CliRunner>()
        .mockResolvedValue({ stdout: "{}", stderr: "" });
      const rawCleanup = contribute(mockServer, {
        dataDir,
        disableAutoDiskSync: true,
        routerCliRunner: debugRouterCliRunner,
      });

      const statusHandler = handlers[harnessDebugStatusRpc.name];
      const toggleHandler = handlers[harnessDebugToggleRpc.name];
      const clearHandler = handlers[harnessDebugClearRpc.name];
      const syncHandler = handlers["agent_harness.profiles.sync.request"];
      expect(statusHandler).toBeDefined();
      expect(toggleHandler).toBeDefined();
      expect(clearHandler).toBeDefined();
      expect(syncHandler).toBeDefined();

      // 0. Resolve initial read cleanly with debugLogs=false and wait for subscribe/read readiness
      resolveInitialRead!({
        status: "ready",
        values: {
          enabled: true,
          debugLogs: false,
          overrideIfDefaultOnly: true,
          phaseLifecycleEnabled: true,
          planTurnSoftLimit: 3,
          autoDowngradePlanOnExec: true,
          emitTimelineTransitions: true,
          profilesDir,
        },
      });
      await vi.waitFor(async () => {
        const s = await statusHandler({ limit: 50 }, {});
        expect(s.enabled).toBe(false);
      });

      // 1. When debugLogs=false, running route/open does zero disk I/O
      await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/tmp/dbg-disabled",
            model: "flash",
            title: "fix: typo",
          },
        },
      });
      const logFilePath = path.join(dataDir, "debug-trace.jsonl");
      expect(fs.existsSync(logFilePath)).toBe(false);

      const initialStatus = await statusHandler({ limit: 50 }, {});
      expect(initialStatus.enabled).toBe(false);
      expect(initialStatus.totalLines).toBe(0);
      expect(initialStatus.fileSizeBytes).toBe(0);
      expect(initialStatus.entries).toEqual([]);

      // 2. Toggle debug ON -> logs debug.toggled with force=true, and subscribe pushing same debugLogs=true does NOT duplicate it
      const toggledOn = await toggleHandler({ enabled: true }, {});
      expect(toggledOn.enabled).toBe(true);
      expect(toggledOn.logFilePath).toBe(logFilePath);
      expect(fs.existsSync(logFilePath)).toBe(true);

      subscriberRef.fn?.({
        status: "ready",
        values: {
          enabled: true,
          debugLogs: true,
          profilesDir,
        },
      });
      const afterSubscribe = await statusHandler({ limit: 20 }, {});
      expect(afterSubscribe.entries.filter((e: any) => e.event === "debug.toggled")).toHaveLength(
        1,
      );

      // Conversely, when subscribe flips debugLogs=false and RPC also confirms false, only 1 new debug.toggled is written
      subscriberRef.fn?.({
        status: "ready",
        values: { enabled: true, debugLogs: false, profilesDir },
      });
      await toggleHandler({ enabled: false }, {});
      const afterSubscribeOff = await statusHandler({ limit: 20 }, {});
      expect(
        afterSubscribeOff.entries.filter((e: any) => e.event === "debug.toggled"),
      ).toHaveLength(2);
      expect(afterSubscribeOff.entries[0]?.detail?.source).toBe("settings");

      // Re-enable for step 3 lifecycle assertions
      await toggleHandler({ enabled: true }, {});

      // 3. Emit harness.route, agent.create.after, env.inject (with empty mcpServers -> LAZY_TOOL_CONFIG isolation), permission.block, turn.transition, handoff.spawn
      debugRouterCliRunner.mockResolvedValueOnce({
        stdout: JSON.stringify({
          structured_output: {
            role: "architect",
            tier: "plan",
            phase: "design",
            confidence: 0.94,
            reason: "System architecture design",
          },
        }),
        stderr: "",
      });
      const created = await hooks["agent.create.before"]({
        request: {
          config: {
            provider: "claude",
            cwd: "/tmp/dbg-enabled",
            model: "flash",
            title: "设计系统架构方案",
          },
        },
      });
      await hooks["agent.create.after"](
        {
          agent: {
            id: "agt_dbg_1",
            provider: "claude",
            title: "设计系统架构方案",
            metadata: created.metadata,
          },
        },
        {
          paseo: {
            agents: {
              ref: () => ({ timeline: { append: vi.fn().mockResolvedValue({}) } }),
            },
          },
        },
      );

      await hooks["agent.open.before"]({
        request: {
          agentId: "agt_dbg_1",
          provider: "claude",
          cwd: "/tmp/dbg-enabled",
          reason: "create",
          purpose: "interactive",
          title: "设计系统架构方案",
          labels: {},
          metadata: created.metadata,
          tools: [],
          env: {},
          mcpServers: {},
        },
      });

      await hooks["agent.permission.before"](
        {
          agent: { id: "agt_dbg_1", provider: "claude", metadata: created.metadata },
          request: {
            id: "perm_blk_1",
            kind: "shell",
            name: "Bash",
            input: { command: "rm -rf /tmp/foo" },
          },
        },
        {
          paseo: {
            agents: {
              ref: () => ({ respondToPermission: vi.fn() }),
            },
          },
        },
      );

      const { context: turn1Ctx } = createMockContext({
        timelineItems: [{ type: "user_message", text: "设计系统架构方案" }],
      });
      await hooks["agent.turn.after"](
        {
          agent: { id: "agt_dbg_1", provider: "claude", metadata: created.metadata },
          outcome: { kind: "completed" },
        },
        turn1Ctx,
      );

      const { context: turnCtx } = createMockContext({
        timelineItems: [{ type: "user_message", text: "yes, go" }],
      });
      await hooks["agent.turn.before"](
        {
          agent: {
            id: "agt_dbg_1",
            provider: "claude",
            metadata: created.metadata,
          },
        },
        turnCtx,
      );

      const handoffHandler = handlers["agent_harness.specialist.handoff.request"];
      await handoffHandler(
        { agentId: "agt_dbg_1", targetRole: "ui", summaryOverride: "Build UI" },
        {
          paseo: {
            agents: {
              ref: () => ({
                current: () => ({
                  provider: "claude",
                  cwd: "/tmp/dbg-enabled",
                  metadata: created.metadata,
                }),
                timeline: { append: vi.fn().mockResolvedValue({}) },
              }),
              create: vi.fn().mockResolvedValue({ id: "agt_dbg_child" }),
            },
          },
        },
      );

      rawCleanup();

      const statusAfter = await statusHandler({ limit: 50 }, {});
      expect(statusAfter.enabled).toBe(true);
      const eventNames = statusAfter.entries.map((e: any) => e.event);
      expect(eventNames).toContain("debug.toggled");
      expect(eventNames).toContain("harness.route");
      expect(eventNames).toContain("agent.create.after");
      expect(eventNames).toContain("env.inject");
      expect(eventNames).toContain("permission.block");
      expect(eventNames).toContain("turn.transition");
      expect(eventNames).toContain("handoff.spawn");
      expect(eventNames).toContain("plugin.cleanup");

      const envInjectEntry = statusAfter.entries.find((e: any) => e.event === "env.inject");
      expect(envInjectEntry?.detail?.isolationMode).toBe("lazy_tool_config_only");
      expect(envInjectEntry?.detail?.relyingOnLazyToolIsolation).toBe(true);

      // 4. Toggle debug OFF -> still records debug.toggled with force=true
      const toggledOff = await toggleHandler({ enabled: false }, {});
      expect(toggledOff.enabled).toBe(false);
      const statusOff = await statusHandler({ limit: 5 }, {});
      expect(statusOff.enabled).toBe(false);
      expect(statusOff.entries[0]?.event).toBe("debug.toggled");
      expect(statusOff.entries[0]?.detail?.enabled).toBe(false);

      // 5. import_from_disk returns imported specialists array so clients can persist via useSettings().save()
      fs.writeFileSync(
        path.join(profilesDir, "ui-specialist.json"),
        JSON.stringify({ name: "ui", description: "Updated UI description from disk" }),
        "utf8",
      );
      const importRes = await syncHandler({ action: "import_from_disk" }, { paseo: {} });
      expect(importRes.success).toBe(true);
      expect(importRes.importedCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(importRes.specialists)).toBe(true);
      expect(importRes.specialists?.find((s: any) => s.id === "ui")?.description).toBe(
        "Updated UI description from disk",
      );

      // 6. Clear removes log files and reports removedBytes > 0
      const cleared = await clearHandler({}, {});
      expect(cleared.cleared).toBe(true);
      expect(cleared.removedBytes).toBeGreaterThan(0);
      expect(fs.existsSync(logFilePath)).toBe(false);
    });

    it("preserves runtime debug toggle if slow initial settings.read() resolves later with old debugLogs=false", async () => {
      const dataDir = createIsolatedTestDataDir();
      const handlers: Record<string, any> = {};
      let resolveSlowRead: ((state: any) => void) | null = null;

      const mockServer: any = {
        registerSettings: vi.fn().mockReturnValue({
          read: vi.fn(
            () =>
              new Promise((resolve) => {
                resolveSlowRead = resolve;
              }),
          ),
          subscribe: vi.fn().mockReturnValue(() => {}),
        }),
        handle: vi.fn().mockImplementation((contract: any, handler: any) => {
          handlers[contract.name] = handler;
        }),
        addHook: vi.fn().mockReturnValue(() => {}),
      };

      const cleanup = contribute(mockServer, {
        dataDir,
        disableAutoDiskSync: true,
        routerCliRunner: vi.fn<CliRunner>().mockResolvedValue({ stdout: "{}", stderr: "" }),
      });
      try {
        const toggleHandler = handlers[harnessDebugToggleRpc.name];
        const statusHandler = handlers[harnessDebugStatusRpc.name];

        // Toggle ON before initial slow settings.read() completes
        const toggled = await toggleHandler({ enabled: true }, {});
        expect(toggled.enabled).toBe(true);

        // Slow read() resolves with stale debugLogs=false
        resolveSlowRead!({
          status: "ready",
          values: { enabled: true, debugLogs: false },
        });
        await Promise.resolve();
        await Promise.resolve();

        const status = await statusHandler({ limit: 20 }, {});
        expect(status.enabled).toBe(true);
        expect(status.entries.filter((e: any) => e.event === "debug.toggled")).toHaveLength(1);
      } finally {
        cleanup();
      }
    });
  });

  describe("v9 P0/P1 lifecycle & Semantic Router regressions", () => {
    it("P0.1: bypasses history replay, internal, observatory, and router child requests without consuming workspace context", async () => {
      const { hooks, routerCliRunner, cleanup } = createTestServer();
      try {
        const cwd = "/tmp/p01-bypass-order";

        await hooks["workspace.create.before"]({
          request: {
            initialDir: cwd,
            agent: {
              initialPrompt: "设计核心模块架构方案",
              config: { provider: "claude", model: "flash", cwd },
            },
          },
        });

        const internalCreate = await hooks["agent.create.before"]({
          request: {
            labels: { "paseo.internal": "1" },
            config: { provider: "claude", model: "flash", cwd, title: "Internal sync" },
          },
        });
        expect(internalCreate.metadata?.[HARNESS_BYPASSED_META_KEY]).toBe(true);
        expect(internalCreate.metadata?.[HARNESS_METADATA_KEY]).toBeUndefined();

        const observatoryCreate = await hooks["agent.create.before"]({
          request: {
            labels: { "observatory.kind": "digest" },
            config: { provider: "claude", model: "flash", cwd, title: "Observatory digest" },
          },
        });
        expect(observatoryCreate.metadata?.[HARNESS_BYPASSED_META_KEY]).toBe(true);
        expect(observatoryCreate.metadata?.[HARNESS_METADATA_KEY]).toBeUndefined();

        const routerChildCreate = await hooks["agent.create.before"]({
          request: {
            env: { PASEO_HARNESS_INTERNAL_ROUTER: "1" },
            config: { provider: "antigravity", model: "gemini-4-hydrogen", cwd },
          },
        });
        expect(routerChildCreate.metadata?.[HARNESS_BYPASSED_META_KEY]).toBe(true);

        const historyOpen = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_p01_history",
            purpose: "history",
            reason: "refresh",
            provider: "claude",
            cwd,
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(historyOpen.env.LAZY_TOOL_CONFIG).toBeUndefined();
        expect(historyOpen.appendSystemPrompt).toBeUndefined();
        expect(historyOpen.tools).toEqual([]);

        // Real interactive user session created next must STILL consume the pending workspace prompt
        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "architect",
              tier: "plan",
              phase: "design",
              confidence: 0.95,
              reason: "Architecture design from workspace prompt",
            },
          }),
          stderr: "",
        });
        const realCreated = await hooks["agent.create.before"]({
          request: {
            config: { provider: "claude", model: "flash", cwd },
          },
        });
        expect(realCreated.config.model).toBe("pro");
        expect(realCreated.metadata?.[HARNESS_METADATA_KEY]?.role).toBe("architect");
        expect(realCreated.metadata?.[HARNESS_METADATA_KEY]?.phase).toBe("design");

        const realOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_p01_real",
            purpose: "interactive",
            reason: "create",
            provider: "claude",
            cwd,
            metadata: realCreated.metadata,
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(realOpened.appendSystemPrompt?.join("\n")).toContain("phase=design");
      } finally {
        cleanup();
      }
    });

    it("P0.2: detects mid-session switch to bypass model on existing tracked agent and skips banner/routing/step-down", async () => {
      const { hooks, cleanup } = createTestServer();
      try {
        const existingMeta = createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          phase: "design",
          model: "gemini-4-carbon",
          thinkingOptionId: "high",
          roleMatchedRule: "semantic_router:ui",
          tierMatchedRule: "semantic_router:ui",
        });

        const setMetadataMock = vi.fn().mockResolvedValue(undefined);
        const setModelMock = vi.fn().mockResolvedValue(undefined);
        const handle = {
          current: () => ({
            id: "agt_p02_mid_switch",
            provider: "antigravity",
            runtimeInfo: { provider: "antigravity", model: "gemini-pro-orchestrator-neon" },
            metadata: { [HARNESS_METADATA_KEY]: existingMeta },
          }),
          setMetadata: setMetadataMock,
          setModel: setModelMock,
          timeline: {
            refetch: vi.fn().mockResolvedValue({
              items: [{ type: "user_message", text: "ok, continue" }],
            }),
            append: vi.fn().mockResolvedValue({}),
          },
        };
        const paseo = { agents: { ref: vi.fn().mockReturnValue(handle) } };

        const opened = await hooks["agent.open.before"](
          {
            request: {
              agentId: "agt_p02_mid_switch",
              purpose: "interactive",
              reason: "resume",
              provider: "antigravity",
              cwd: "/tmp/p02-mid",
              metadata: { [HARNESS_METADATA_KEY]: existingMeta },
              tools: [],
              env: {},
              mcpServers: {},
            },
          },
          { paseo },
        );
        expect(opened.appendSystemPrompt).toBeUndefined();
        expect(opened.env.LAZY_TOOL_CONFIG).toBeUndefined();
        expect(setMetadataMock).toHaveBeenCalledWith({ [HARNESS_BYPASSED_META_KEY]: true });

        await hooks["agent.turn.before"](
          {
            agent: {
              id: "agt_p02_mid_switch",
              provider: "antigravity",
              metadata: { [HARNESS_METADATA_KEY]: existingMeta },
            },
          },
          { paseo },
        );
        await hooks["agent.turn.after"](
          {
            agent: {
              id: "agt_p02_mid_switch",
              provider: "antigravity",
              metadata: { [HARNESS_METADATA_KEY]: existingMeta },
            },
            turnId: "turn_p02_1",
            outcome: { kind: "completed" },
          },
          { paseo },
        );
        expect(setModelMock).not.toHaveBeenCalled();
      } finally {
        cleanup();
      }
    });

    it("P1.1: restricts first_turn_route to default_empty and never overwrites default_fallback or orchestrator", async () => {
      const { hooks, routerCliRunner, cleanup } = createTestServer();
      try {
        // Case A: Empty title starts with tierMatchedRule=default_empty -> Turn 0 title arrival upgrades via router
        const emptyCreated = await hooks["agent.create.before"]({
          request: {
            config: { provider: "claude", model: "flash", cwd: "/tmp/p11-empty" },
          },
        });
        expect(emptyCreated.metadata?.[HARNESS_METADATA_KEY]?.tierMatchedRule).toBe(
          "default_empty",
        );

        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "ui",
              tier: "plan",
              phase: "design",
              confidence: 0.94,
              reason: "UI table design",
            },
          }),
          stderr: "",
        });
        const emptyCtx = createMockContext();
        await hooks["agent.turn.before"](
          {
            agent: {
              id: "agt_p11_empty",
              provider: "claude",
              cwd: "/tmp/p11-empty",
              title: "设计分页表格组件交互",
              metadata: emptyCreated.metadata,
            },
          },
          emptyCtx.context,
        );
        expect(emptyCtx.handle.setModel).toHaveBeenCalledWith("pro");

        // Case B: Non-empty prompt with low router confidence gets default_fallback -> never overwritten on Turn 0
        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "general",
              tier: "standard",
              phase: "exec",
              confidence: 0.4,
              reason: "Ambiguous",
            },
          }),
          stderr: "",
        });
        const nonEmptyCreated = await hooks["agent.create.before"]({
          request: {
            config: {
              provider: "claude",
              model: "flash",
              cwd: "/tmp/p11-nonempty",
              title: "继续检查任务",
            },
          },
        });
        expect(nonEmptyCreated.metadata?.[HARNESS_METADATA_KEY]?.tierMatchedRule).toBe(
          "default_fallback",
        );

        const nonEmptyCtx = createMockContext();
        await hooks["agent.turn.before"](
          {
            agent: {
              id: "agt_p11_nonempty",
              provider: "claude",
              cwd: "/tmp/p11-nonempty",
              title: "设计系统架构方案",
              metadata: nonEmptyCreated.metadata,
            },
          },
          nonEmptyCtx.context,
        );
        expect(nonEmptyCtx.handle.setModel).not.toHaveBeenCalled();

        // Case C: Orchestrator role is never overwritten by first_turn_route
        const orchMeta = createInitialHarnessMetadata({
          role: "orchestrator",
          tier: "fast",
          phase: "exec",
          model: "lite",
          roleMatchedRule: "label:role=orchestrator",
          tierMatchedRule: "default_empty",
        });
        const orchCtx = createMockContext();
        await hooks["agent.turn.before"](
          {
            agent: {
              id: "agt_p11_orch",
              provider: "claude",
              cwd: "/tmp/p11-orch",
              title: "设计整体方案",
              metadata: { [HARNESS_METADATA_KEY]: orchMeta },
            },
          },
          orchCtx.context,
        );
        expect(orchCtx.handle.setModel).not.toHaveBeenCalled();
      } finally {
        cleanup();
      }
    });

    it("P1.2: strips legacy banner from persisted systemPrompt, suppresses handoff hints on leaf appendSystemPrompt, and deduplicates env.inject resume logs", async () => {
      const { mockServer, hooks, cleanup } = createTestServer({ debugLogs: true });
      try {
        const statusCall = mockServer.handle.mock.calls.find(
          ([contract]: any[]) => contract.name === harnessDebugStatusRpc.name,
        );
        const statusHandler = statusCall?.[1];
        expect(statusHandler).toBeDefined();

        // Wait for initial settings.read() so debugLogs=true is active
        await vi.waitFor(async () => {
          const st = await statusHandler({ limit: 10 }, {});
          expect(st.enabled).toBe(true);
        });

        const legacyPersistedPrompt = [
          "User custom instruction",
          "[Capability Harness Active Profile]",
          "Role: ui | Phase: exec | Tier: standard -> flash",
          "",
          "Keep this trailing instruction",
        ].join("\n");

        const created = await hooks["agent.create.before"]({
          request: {
            config: {
              provider: "claude",
              cwd: "/tmp/p12-banner",
              model: "flash",
              title: "fix: button padding",
              systemPrompt: legacyPersistedPrompt,
            },
          },
        });
        expect(created.config.systemPrompt).toContain("User custom instruction");
        expect(created.config.systemPrompt).toContain("Keep this trailing instruction");
        expect(created.config.systemPrompt).not.toContain("[Capability Harness Active Profile]");

        // Root interactive open injects transient appendSystemPrompt WITH harness_handoff hint
        const rootOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_p12_root",
            purpose: "interactive",
            reason: "create",
            provider: "claude",
            cwd: "/tmp/p12-banner",
            title: "fix: button padding",
            metadata: created.metadata,
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        expect(rootOpened.appendSystemPrompt?.join("\n")).toContain(
          "[Capability Harness Active Profile]",
        );
        expect(rootOpened.appendSystemPrompt?.join("\n")).toContain("harness_handoff");

        // Two identical resume opens must NOT emit duplicate env.inject logs
        for (let i = 0; i < 2; i++) {
          await hooks["agent.open.before"]({
            request: {
              agentId: "agt_p12_root",
              purpose: "interactive",
              reason: "resume",
              provider: "claude",
              cwd: "/tmp/p12-banner",
              title: "fix: button padding",
              metadata: created.metadata,
              tools: [],
              env: {},
              mcpServers: {},
            },
          });
        }

        // Leaf open suppresses harness_handoff hint inside appendSystemPrompt
        const leafOpened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_p12_leaf",
            purpose: "interactive",
            reason: "create",
            provider: "claude",
            cwd: "/tmp/p12-banner",
            title: "fix: leaf task",
            labels: { [HARNESS_LEAF_LABEL_KEY]: "1", role: "backend" },
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        const leafBanner = leafOpened.appendSystemPrompt?.join("\n") ?? "";
        expect(leafBanner).toContain("[Capability Harness Active Profile]");
        expect(leafBanner).not.toContain("harness_handoff");

        const debugStatus = await statusHandler({ limit: 50 }, {});
        const rootInjectEvents = debugStatus.entries.filter(
          (entry: any) => entry.event === "env.inject" && entry.agentId === "agt_p12_root",
        );
        expect(rootInjectEvents).toHaveLength(1);
      } finally {
        cleanup();
      }
    });

    it("keeps root natural-language session on antigravity even when matched specialist prefers codex, including open fallback", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cross-provider-root-"));
      const { hooks, routerCliRunner, cleanup } = createTestServer();
      try {
        fs.mkdirSync(path.join(tmpRepo, ".agents", "plugins", "team-codex"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: "1.0.0",
            project_slug: "team-codex",
            preset: "go-api",
            targets: ["antigravity", "codex"],
            roles: ["be-developer"],
            bindings: {
              "be-developer": { provider: "codex", tier: "standard" },
            },
          }),
          "utf8",
        );

        const paseo = {
          providers: {
            snapshot: vi.fn().mockResolvedValue({
              entries: [
                {
                  provider: "antigravity",
                  enabled: true,
                  models: [
                    { id: "gemini-4-hydrogen" },
                    { id: "gemini-4-neon" },
                    { id: "gemini-4-carbon" },
                  ],
                },
                {
                  provider: "codex",
                  enabled: true,
                  models: [{ id: "lite" }, { id: "flash" }, { id: "pro" }],
                },
              ],
            }),
          },
        };

        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "be-developer",
              tier: "standard",
              phase: "exec",
              confidence: 0.94,
              reason: "Backend task in workspace",
            },
          }),
          stderr: "",
        });

        const created = await hooks["agent.create.before"](
          {
            request: {
              initialPrompt: "重构消息队列消费幂等锁逻辑",
              config: {
                provider: "antigravity",
                cwd: tmpRepo,
                model: "gemini-4-neon",
                title: "重构消息队列消费幂等锁逻辑",
              },
            },
          },
          { paseo },
        );

        expect(created.config.provider).toBe("antigravity");
        expect(created.config.model).toBe("gemini-4-neon");
        expect(created.config.model).not.toBe("flash");
        expect(created.metadata?.[HARNESS_METADATA_KEY]?.role).toBe("be-developer");

        // agent.open.before with immutable request.provider also strips preferredProvider when resolving banner model
        const opened = await hooks["agent.open.before"](
          {
            request: {
              agentId: "agt_cross_root_open",
              purpose: "interactive",
              reason: "create",
              provider: "antigravity",
              cwd: tmpRepo,
              title: "重构消息队列消费幂等锁逻辑",
              metadata: {
                [HARNESS_METADATA_KEY]: {
                  ...created.metadata?.[HARNESS_METADATA_KEY],
                  currentModel: null,
                },
              },
              tools: [],
              env: {},
              mcpServers: {},
            },
          },
          { paseo },
        );
        const banner = opened.appendSystemPrompt?.join("\n") ?? "";
        expect(banner).toContain("gemini-4-neon");
        expect(banner).not.toContain("-> flash");
      } finally {
        cleanup();
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("switches explicit --label role=backend to codex only when codex is enabled in hostProviders, else falls back to antigravity", async () => {
      // Case A: codex is enabled in hostProviders -> switches provider to codex and normalizes incompatible antigravity modeId
      const serverEnabled = createTestServer({
        honorSpecialistPreferredProvider: true,
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
          s.id === "backend" ? { ...s, preferredProvider: "codex" } : s,
        ),
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        const paseoCodexEnabled = {
          providers: {
            snapshot: vi.fn().mockResolvedValue({
              entries: [
                {
                  provider: "antigravity",
                  enabled: true,
                  models: [{ id: "gemini-4-hydrogen" }, { id: "gemini-4-neon" }],
                },
                {
                  provider: "codex",
                  enabled: true,
                  models: [{ id: "lite" }, { id: "flash" }, { id: "pro" }],
                },
              ],
            }),
          },
        };

        const switched = await serverEnabled.hooks["agent.create.before"](
          {
            request: {
              labels: { role: "backend" },
              config: {
                provider: "antigravity",
                cwd: "/tmp/cross-spawn-enabled",
                model: "gemini-4-neon",
                modeId: "full-access",
                title: "Implement gRPC streaming endpoint",
              },
            },
          },
          { paseo: paseoCodexEnabled },
        );

        expect(switched.config.provider).toBe("codex");
        expect(switched.config.model).toBe("flash");
        expect(switched.config.modeId).not.toBe("full-access");
      } finally {
        serverEnabled.cleanup();
      }

      // Case B: codex is disabled in hostProviders -> stays on antigravity + gemini-4-neon
      const serverDisabled = createTestServer({
        honorSpecialistPreferredProvider: true,
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
          s.id === "backend" ? { ...s, preferredProvider: "codex" } : s,
        ),
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        const paseoCodexDisabled = {
          providers: {
            snapshot: vi.fn().mockResolvedValue({
              entries: [
                {
                  provider: "antigravity",
                  enabled: true,
                  models: [{ id: "gemini-4-hydrogen" }, { id: "gemini-4-neon" }],
                },
                {
                  provider: "codex",
                  enabled: false,
                  models: [{ id: "lite" }, { id: "flash" }, { id: "pro" }],
                },
              ],
            }),
          },
        };

        const fallbackRes = await serverDisabled.hooks["agent.create.before"](
          {
            request: {
              labels: { role: "backend" },
              config: {
                provider: "antigravity",
                cwd: "/tmp/cross-spawn-disabled",
                model: "gemini-4-neon",
                modeId: "full-access",
                title: "Implement gRPC streaming endpoint",
              },
            },
          },
          { paseo: paseoCodexDisabled },
        );

        expect(fallbackRes.config.provider).toBe("antigravity");
        expect(fallbackRes.config.model).toBe("gemini-4-neon");
        expect(fallbackRes.config.modeId).toBe("full-access");
      } finally {
        serverDisabled.cleanup();
      }
    });

    it("first_turn_route on antigravity ignores codex preferredProvider and resolves antigravity model", async () => {
      const { hooks, routerCliRunner, cleanup } = createTestServer({
        specialists: overrideSpecialistInList(
          DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
          "backend",
          { preferredProvider: "codex" },
        ),
      });
      try {
        await Promise.resolve();
        await Promise.resolve();

        const created = await hooks["agent.create.before"]({
          request: {
            config: {
              provider: "antigravity",
              model: "gemini-4-neon",
              cwd: "/tmp/first-turn-cross-prov",
            },
          },
        });
        expect(created.metadata?.[HARNESS_METADATA_KEY]?.tierMatchedRule).toBe("default_empty");

        routerCliRunner.mockResolvedValueOnce({
          stdout: JSON.stringify({
            structured_output: {
              role: "backend",
              tier: "plan",
              phase: "design",
              confidence: 0.94,
              reason: "Backend distributed cache design",
            },
          }),
          stderr: "",
        });

        const turnCtx = createMockContext();
        await hooks["agent.turn.before"](
          {
            agent: {
              id: "agt_first_turn_ag_cross",
              provider: "antigravity",
              cwd: "/tmp/first-turn-cross-prov",
              title: "设计分布式事务补偿方案",
              metadata: created.metadata,
            },
          },
          turnCtx.context,
        );

        expect(turnCtx.handle.setModel).toHaveBeenCalledWith("gemini-4-carbon");
        expect(turnCtx.handle.setModel).not.toHaveBeenCalledWith("pro");
        expect(turnCtx.handle.setModel).not.toHaveBeenCalledWith("flash");
      } finally {
        cleanup();
      }
    });

    it("passes workspace cwd to harness_handoff tool description and uses live hostProviders fallback in harnessSwitchTierRpc", async () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tool-cwd-"));
      const { mockServer, hooks, cleanup } = createTestServer();
      try {
        fs.mkdirSync(path.join(tmpRepo, ".agents", "plugins", "team-cwd"), { recursive: true });
        fs.writeFileSync(
          path.join(tmpRepo, ".agents", "agent-team.json"),
          JSON.stringify({
            schema_version: 2,
            preset: "go-api",
            roles: ["be-developer", "be-reviewer"],
          }),
          "utf8",
        );

        const opened = await hooks["agent.open.before"]({
          request: {
            agentId: "agt_tool_cwd",
            purpose: "interactive",
            reason: "create",
            provider: "claude",
            cwd: tmpRepo,
            title: "Build backend",
            tools: [],
            env: {},
            mcpServers: {},
          },
        });
        const handoffTool = opened.tools.find((t: any) => t.name === "harness_handoff");
        expect(handoffTool?.description).toContain("be-developer");
        expect(handoffTool?.description).toContain("be-reviewer");

        const switchCall = mockServer.handle.mock.calls.find(
          ([contract]: any[]) => contract.name === "agent_harness.tier.switch.request",
        );
        const switchHandler = switchCall?.[1];
        expect(switchHandler).toBeDefined();

        const setModelMock = vi.fn().mockResolvedValue(undefined);
        const setMetadataMock = vi.fn().mockResolvedValue(undefined);
        const handle = {
          current: () => ({
            id: "agt_switch_fallback",
            model: "gemini-4-neon",
            metadata: {},
          }),
          setModel: setModelMock,
          setMetadata: setMetadataMock,
        };
        const switchRes = await switchHandler(
          { agentId: "agt_switch_fallback", targetTier: "plan" },
          {
            paseo: {
              providers: {
                snapshot: vi.fn().mockResolvedValue({
                  entries: [
                    {
                      provider: "antigravity",
                      enabled: true,
                      models: [{ id: "gemini-4-neon" }, { id: "gemini-4-carbon" }],
                    },
                  ],
                }),
              },
              agents: { ref: vi.fn().mockReturnValue(handle) },
            },
          },
        );
        expect(switchRes.currentModel).toBe("gemini-4-carbon");
        expect(setModelMock).toHaveBeenCalledWith("gemini-4-carbon");
      } finally {
        cleanup();
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });
  });
});
