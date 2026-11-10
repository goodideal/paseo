import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";

function setupServer() {
  let workspaceHook: any = null;
  let agentHook: any = null;
  const mockServer: any = {
    registerSettings: vi.fn().mockReturnValue({
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: { enabled: true, overrideIfDefaultOnly: true, debugLogs: false },
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    }),
    addHook: vi.fn().mockImplementation((name, handler) => {
      if (name === "workspace.create.before") workspaceHook = handler;
      if (name === "agent.create.before") agentHook = handler;
      return () => {};
    }),
  };
  contribute(mockServer);
  return { workspaceHook, agentHook };
}

describe("agent-harness workspace.create.before", () => {
  it("routes model when prompt comes via firstAgentContext", async () => {
    const { workspaceHook } = setupServer();
    const request = {
      source: { kind: "directory", path: "/tmp/demo" },
      agent: {
        config: { provider: "codex", cwd: "/tmp/demo", model: "flash" },
        initialPrompt:
          "分析一下线上的hub环境：为什么reader没有任何关联的数据？bug在哪里？分析根因。",
      },
      firstAgentContext: {
        prompt: "分析一下线上的hub环境：为什么reader没有任何关联的数据？bug在哪里？分析根因。",
      },
    };

    const result = await workspaceHook({ request });
    expect(result.agent.config.model).toBe("plan");
    expect(result.agent.config.title).toContain("分析一下线上的hub环境");
  });

  it("keeps flash for execution tasks", async () => {
    const { workspaceHook } = setupServer();
    const request = {
      source: { kind: "directory", path: "/tmp/demo" },
      agent: {
        config: { provider: "codex", cwd: "/tmp/demo", model: "flash" },
        initialPrompt: "/gitea dev and release beta",
      },
      firstAgentContext: { prompt: "/gitea dev and release beta" },
    };

    const result = await workspaceHook({ request });
    expect(result.agent.config.model).toBe("flash");
  });

  it("passes through when prompt is empty", async () => {
    const { workspaceHook } = setupServer();
    const request = {
      source: { kind: "directory", path: "/tmp/demo" },
      agent: { config: { provider: "codex", cwd: "/tmp/demo", model: "flash" } },
    };

    const result = await workspaceHook({ request });
    expect(result.agent.config.model).toBe("flash");
  });
});

describe("agent-harness agent.create.before fallback", () => {
  it("still routes plan intent when agent is created directly with title", async () => {
    const { agentHook } = setupServer();
    const request = {
      config: {
        provider: "opencode",
        cwd: "/dummy",
        model: "custom/flash",
        title: "设计一个多渠道 OAuth Provider 扩展方案",
      },
    };

    const result = await agentHook({ request });
    expect(result.config.model).toBe("custom/plan");
  });
});
