import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

describe("quick-prompts plugin end-to-end", () => {
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;
  const previousPaseoHome = process.env.PASEO_HOME;

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => undefined);
      client = null;
    }
    if (daemon) {
      await daemon.close().catch(() => undefined);
      daemon = null;
    }
    if (previousPaseoHome !== undefined) {
      process.env.PASEO_HOME = previousPaseoHome;
    } else {
      delete process.env.PASEO_HOME;
    }
  });

  it("loads quick-prompts plugin, verifies running status, and executes RPCs across process boundaries", async () => {
    daemon = await createTestPaseoDaemon({
      daemonVersion: "0.9.2-custom.252348",
      pluginsEnabled: true,
    });
    process.env.PASEO_HOME = daemon.paseoHome;

    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();

    const pluginDirectory = fileURLToPath(
      new URL("../../../../../plugin-examples/quick-prompts", import.meta.url),
    );

    // 1. Install directory plugin
    const installResult = await client.installDirectoryPlugin(pluginDirectory);
    expect(installResult.id).toBe("quick-prompts");
    expect(installResult.enabled).toBe(true);
    expect(installResult.status).toBe("running");

    // 2. Verify plugin is registered in daemon config
    const { config } = await client.getDaemonConfig();
    expect(config.plugins).toBeDefined();
    expect(config.plugins?.["quick-prompts"]).toBeDefined();
    expect(config.plugins?.["quick-prompts"]?.enabled).toBe(true);

    // 3. Test global get RPC - should return default items
    const globalGetRes = (await client.invokePluginRpc(
      "quick-prompts",
      "quick_prompts.global.get.request",
      {},
    )) as { items: Array<{ id: string; label: string }> };

    expect(globalGetRes).toBeDefined();
    expect(Array.isArray(globalGetRes.items)).toBe(true);
    expect(globalGetRes.items.length).toBeGreaterThan(0);
    expect(globalGetRes.items.some((i) => i.id === "builtin-continue")).toBe(true);

    // 4. Test global set RPC - save a custom prompt
    const customPrompt = {
      id: "e2e-custom-prompt",
      label: "E2E Custom",
      content: "Please execute end to end verification.",
      shortcut: "e2e",
      triggerType: "fixed" as const,
      enabled: true,
      createdAt: Date.now(),
      order: 99,
    };

    const globalSetRes = (await client.invokePluginRpc(
      "quick-prompts",
      "quick_prompts.global.set.request",
      { items: [customPrompt] },
    )) as { items: Array<{ id: string; label: string }>; success: boolean };

    expect(globalSetRes.success).toBe(true);
    expect(globalSetRes.items).toHaveLength(1);
    expect(globalSetRes.items[0].id).toBe("e2e-custom-prompt");

    // Re-query to verify persistence in isolated test home
    const reloadedGlobal = (await client.invokePluginRpc(
      "quick-prompts",
      "quick_prompts.global.get.request",
      {},
    )) as { items: Array<{ id: string; label: string }> };
    expect(reloadedGlobal.items).toHaveLength(1);
    expect(reloadedGlobal.items[0].id).toBe("e2e-custom-prompt");

    // 5. Test project set and get RPC
    const projectSetRes = (await client.invokePluginRpc(
      "quick-prompts",
      "quick_prompts.project.set.request",
      {
        projectId: "proj-e2e-1",
        items: [
          {
            id: "proj-prompt-1",
            label: "Project Task",
            content: "Run project tests",
            triggerType: "fixed" as const,
            enabled: true,
            createdAt: Date.now(),
            order: 0,
          },
        ],
        disabledGlobalIds: ["e2e-custom-prompt"],
      },
    )) as {
      projectId: string;
      items: Array<{ id: string; label: string }>;
      disabledGlobalIds: string[];
      success: boolean;
    };

    expect(projectSetRes.success).toBe(true);
    expect(projectSetRes.projectId).toBe("proj-e2e-1");
    expect(projectSetRes.items).toHaveLength(1);
    expect(projectSetRes.disabledGlobalIds).toEqual(["e2e-custom-prompt"]);

    const projectGetRes = (await client.invokePluginRpc(
      "quick-prompts",
      "quick_prompts.project.get.request",
      { projectId: "proj-e2e-1" },
    )) as {
      projectId: string;
      items: Array<{ id: string; label: string }>;
      disabledGlobalIds: string[];
    };

    expect(projectGetRes.projectId).toBe("proj-e2e-1");
    expect(projectGetRes.items).toHaveLength(1);
    expect(projectGetRes.items[0].id).toBe("proj-prompt-1");
    expect(projectGetRes.disabledGlobalIds).toEqual(["e2e-custom-prompt"]);
  });
});
