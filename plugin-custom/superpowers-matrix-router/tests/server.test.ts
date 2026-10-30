import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";

describe("superpowers-matrix-router server contribute", () => {
  it("registers hook on agent.create.before and routes plan intent", async () => {
    let hookHandler: any = null;
    const mockServer: any = {
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          values: { enabled: true, overrideIfDefaultOnly: true },
        }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      }),
      addHook: vi.fn().mockImplementation((name, handler) => {
        if (name === "agent.create.before") {
          hookHandler = handler;
        }
        return () => {};
      }),
    };

    contribute(mockServer);
    expect(mockServer.addHook).toHaveBeenCalledWith("agent.create.before", expect.any(Function));
    expect(hookHandler).toBeTypeOf("function");

    const request = {
      config: {
        provider: "opencode",
        cwd: "/dummy",
        model: "custom/flash",
        title: "分析一下线上的hub环境：为什么reader没有任何关联的数据？分析根因。",
      },
    };

    const transformed = await hookHandler({ request });
    expect(transformed.config.model).toBe("custom/plan");
  });

  it("does not override model if execution task", async () => {
    let hookHandler: any = null;
    const mockServer: any = {
      registerSettings: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({ status: "ready", values: { enabled: true } }),
        subscribe: vi.fn().mockReturnValue(() => {}),
      }),
      addHook: vi.fn().mockImplementation((name, handler) => {
        if (name === "agent.create.before") {
          hookHandler = handler;
        }
        return () => {};
      }),
    };

    contribute(mockServer);

    const request = {
      config: {
        provider: "opencode",
        cwd: "/dummy",
        model: "custom/flash",
        title: "fix: 修复样式重叠问题",
      },
    };

    const transformed = await hookHandler({ request });
    expect(transformed.config.model).toBe("custom/flash");
  });
});
