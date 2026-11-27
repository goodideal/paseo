import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";
import type { CliRunner } from "../server/agent-intent-router.js";
import { HARNESS_METADATA_KEY } from "../shared/types.js";

const trackedDataDirs = new Set<string>();

afterEach(() => {
  for (const dir of Array.from(trackedDataDirs)) {
    trackedDataDirs.delete(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function setupServer(cliOutput?: Record<string, unknown>) {
  let workspaceHook: any = null;
  let agentHook: any = null;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-harness-ws-test-"));
  trackedDataDirs.add(dataDir);
  const routerCliRunner = vi.fn<CliRunner>().mockResolvedValue({
    stdout: JSON.stringify({
      structured_output: cliOutput ?? {
        role: "architect",
        tier: "plan",
        phase: "design",
        confidence: 0.92,
      },
    }),
    stderr: "",
  });
  const mockServer: any = {
    registerSettings: vi.fn().mockReturnValue({
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: { enabled: true, overrideIfDefaultOnly: true, debugLogs: false },
      }),
      subscribe: vi.fn().mockReturnValue(() => {}),
    }),
    handle: vi.fn(),
    addHook: vi.fn().mockImplementation((name, handler) => {
      if (name === "workspace.create.before") workspaceHook = handler;
      if (name === "agent.create.before") agentHook = handler;
      return () => {};
    }),
  };
  contribute(mockServer, { dataDir, disableAutoDiskSync: true, routerCliRunner });
  return { workspaceHook, agentHook, routerCliRunner };
}

describe("agent-harness workspace.create.before", () => {
  it("routes model via Semantic Router when prompt comes via firstAgentContext and avoids userModelLocked in agent.create.before", async () => {
    const { workspaceHook, agentHook, routerCliRunner } = setupServer({
      role: "architect",
      tier: "plan",
      phase: "design",
      confidence: 0.94,
    });
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

    const wsResult = await workspaceHook(request);
    expect(wsResult.agent.config.model).toBe("pro");
    expect(wsResult.agent.config.thinkingOptionId).toBe("high");
    expect(wsResult.agent.config.title).toContain("分析一下线上的hub环境");
    expect(routerCliRunner).toHaveBeenCalledTimes(1);

    // Subsequent agent.create.before receives workspace-routed model ("pro") and must NOT mark userModelLocked=true
    const agentResult = await agentHook({
      config: wsResult.agent.config,
      initialPrompt: request.agent.initialPrompt,
    });
    expect(agentResult.config.model).toBe("pro");
    expect(agentResult.metadata?.[HARNESS_METADATA_KEY]?.userModelLocked).toBe(false);
    expect(agentResult.config.systemPrompt).toBeUndefined();
  });

  it("keeps standard flash model deterministically via L0 without invoking Semantic Router CLI", async () => {
    const { workspaceHook, routerCliRunner } = setupServer();
    const request = {
      source: { kind: "directory", path: "/tmp/demo" },
      agent: {
        config: { provider: "codex", cwd: "/tmp/demo", model: "flash" },
        initialPrompt: "/gitea dev and release beta",
      },
      firstAgentContext: { prompt: "/gitea dev and release beta" },
    };

    const result = await workspaceHook(request);
    expect(result.agent.config.model).toBe("flash");
    expect(routerCliRunner).not.toHaveBeenCalled();
  });

  it("passes through when prompt is empty", async () => {
    const { workspaceHook, routerCliRunner } = setupServer();
    const request = {
      source: { kind: "directory", path: "/tmp/demo" },
      agent: { config: { provider: "codex", cwd: "/tmp/demo", model: "flash" } },
    };

    const result = await workspaceHook(request);
    expect(result).toBeUndefined();
    expect(routerCliRunner).not.toHaveBeenCalled();
  });
});

describe("agent-harness agent.create.before fallback", () => {
  it("routes plan design intent via Semantic Router when agent is created directly with title", async () => {
    const { agentHook } = setupServer({
      role: "architect",
      tier: "plan",
      phase: "design",
      confidence: 0.91,
    });
    const request = {
      config: {
        provider: "opencode",
        cwd: "/dummy",
        model: "custom/flash",
        title: "设计一个多渠道 OAuth Provider 扩展方案",
      },
    };

    const result = await agentHook(request);
    expect(result.config.model).toBe("custom/pro");
    expect(result.config.thinkingOptionId).toBe("high");
    expect(result.config.systemPrompt).toBeUndefined();
  });
});
