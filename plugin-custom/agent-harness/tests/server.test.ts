import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";

function createTestServer() {
  const hooks: Record<string, any> = {};
  const mockServer: any = {
    registerSettings: vi.fn().mockReturnValue({
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: { enabled: true, overrideIfDefaultOnly: true, debugLogs: false },
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    }),
    addHook: vi.fn().mockImplementation((name, handler) => {
      hooks[name] = handler;
      return () => {};
    }),
  };
  contribute(mockServer);
  return { mockServer, hooks };
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
});
