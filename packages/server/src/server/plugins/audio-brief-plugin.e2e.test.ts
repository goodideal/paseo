import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

describe("audio-brief plugin end-to-end", () => {
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => undefined);
      client = null;
    }
    if (daemon) {
      await daemon.close().catch(() => undefined);
      daemon = null;
    }
  });

  it("loads audio-brief plugin, verifies running status, and executes RPC synthesis", async () => {
    daemon = await createTestPaseoDaemon({
      daemonVersion: "0.9.2-custom.252348",
      pluginsEnabled: true,
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();

    const pluginDirectory = fileURLToPath(
      new URL("../../../../../plugin-examples/audio-brief", import.meta.url),
    );

    // 1. Install directory plugin
    const installResult = await client.installDirectoryPlugin(pluginDirectory);
    expect(installResult.id).toBe("audio-brief");
    expect(installResult.enabled).toBe(true);
    expect(installResult.status).toBe("running");

    // 2. Verify plugin is registered in daemon config
    const { config } = await client.getDaemonConfig();
    expect(config.plugins).toBeDefined();
    expect(config.plugins?.["audio-brief"]).toBeDefined();
    expect(config.plugins?.["audio-brief"]?.enabled).toBe(true);

    // 3. Invoke the audio brief synthesis RPC through plugin IPC bridge
    const sampleAssistantMessage = [
      "# Feature Implementation Complete",
      "```typescript",
      "export const pluginReady = true;",
      "```",
      "All 16 unit tests passed without errors. Are you ready to ship this to production?",
    ].join("\n");

    const rpcResponse = await client.invokePluginRpc(
      "audio-brief",
      "audio_brief.synthesize.request",
      {
        agentId: "agent-123",
        turnId: "turn-456",
        text: sampleAssistantMessage,
      },
    );

    expect(rpcResponse).toBeDefined();
    const result = rpcResponse as {
      briefText: string;
      durationMs?: number;
      error?: string | null;
    };
    expect(result.briefText).toBeDefined();
    expect(result.briefText).toContain("All 16 unit tests passed without errors.");
    expect(result.briefText).not.toContain("```");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });
});
