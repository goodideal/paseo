import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

describe("all custom plugins end-to-end daemon verification", () => {
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

  const customPluginCases = [
    {
      name: "agent-radar",
      rpc: "radar.get_snapshot",
      input: { agentId: "test-agent" },
    },
    {
      name: "audio-brief",
      rpc: "audio_brief.synthesize.request",
      input: { agentId: "test-agent", turnId: "t-1", text: "Task completed successfully." },
    },
    {
      name: "quick-prompts",
      rpc: "quick_prompts.global.get.request",
      input: {},
    },
    {
      name: "gitea-workflow",
      rpc: "gitea.tasks.list",
      input: {},
    },
    {
      name: "visual-crawler-auto-fix",
      rpc: "visual_crawler.crawl.status",
      input: {},
    },
    {
      name: "web-inspector",
      rpc: "web_inspector.attachment.search",
      input: { query: "not-http" },
    },
  ];

  it.each(customPluginCases)(
    "installs, verifies running status, and executes RPC for [$name]",
    async ({ name, rpc, input }) => {
      daemon = await createTestPaseoDaemon({
        daemonVersion: "0.9.2-custom.252348",
        pluginsEnabled: true,
      });
      process.env.PASEO_HOME = daemon.paseoHome;

      client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
      await client.connect();

      const pluginDir = fileURLToPath(
        new URL(`../../../../../plugin-custom/${name}`, import.meta.url),
      );

      // 1. Install directory plugin
      const installResult = await client.installDirectoryPlugin(pluginDir);
      expect(installResult.id).toBe(name);
      expect(installResult.enabled).toBe(true);
      expect(installResult.status).toBe("running");

      // 2. Verify config reflects installed status
      const { config } = await client.getDaemonConfig();
      expect(config.plugins?.[name]?.enabled).toBe(true);

      // 3. Invoke plugin RPC across process boundaries
      const rpcResult = await client.invokePluginRpc(name, rpc, input);
      expect(rpcResult).toBeDefined();
    },
    30000,
  );
});
