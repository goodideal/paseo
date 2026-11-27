import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

function initTempGitRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-qp-labels-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@paseo.local"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Paseo Test"], { cwd: dir, stdio: "ignore" });
  writeFileSync(path.join(dir, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore" });
  return dir;
}

async function getWorkspaceLabels(
  client: DaemonClient,
  workspaceId: string,
): Promise<string[] | undefined> {
  const list = await client.fetchWorkspaces();
  return list.entries.find((entry) => entry.id === workspaceId)?.labels;
}

describe("quick-tools plugin end-to-end", () => {
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

  it("loads quick-tools plugin, verifies running status, and executes RPCs across process boundaries", async () => {
    daemon = await createTestPaseoDaemon({
      daemonVersion: "0.17.3-custom.test",
      pluginsEnabled: true,
    });
    process.env.PASEO_HOME = daemon.paseoHome;

    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();

    const pluginDirectory = fileURLToPath(
      new URL("../../../../../plugin-custom/quick-tools", import.meta.url),
    );

    // 1. Install directory plugin
    const installResult = await client.installDirectoryPlugin(pluginDirectory);
    expect(installResult.id).toBe("quick-tools");
    expect(installResult.enabled).toBe(true);
    expect(installResult.status).toBe("running");

    // 2. Verify plugin is registered in daemon config
    const { config } = await client.getDaemonConfig();
    expect(config.plugins).toBeDefined();
    expect(config.plugins?.["quick-tools"]).toBeDefined();
    expect(config.plugins?.["quick-tools"]?.enabled).toBe(true);

    // 3. Test global get RPC - should return default items
    const globalGetRes = (await client.invokePluginRpc(
      "quick-tools",
      "quick_tools.prompts.global.get.request",
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
      "quick-tools",
      "quick_tools.prompts.global.set.request",
      { items: [customPrompt] },
    )) as { items: Array<{ id: string; label: string }>; success: boolean };

    expect(globalSetRes.success).toBe(true);
    expect(globalSetRes.items).toHaveLength(1);
    expect(globalSetRes.items[0].id).toBe("e2e-custom-prompt");

    // Re-query to verify persistence in isolated test home
    const reloadedGlobal = (await client.invokePluginRpc(
      "quick-tools",
      "quick_tools.prompts.global.get.request",
      {},
    )) as { items: Array<{ id: string; label: string }> };
    expect(reloadedGlobal.items).toHaveLength(1);
    expect(reloadedGlobal.items[0].id).toBe("e2e-custom-prompt");

    // 5. Test project set and get RPC
    const projectSetRes = (await client.invokePluginRpc(
      "quick-tools",
      "quick_tools.prompts.project.set.request",
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
      "quick-tools",
      "quick_tools.prompts.project.get.request",
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

  it("auto-labels local workspaces as Local and worktrees as WT via hook and sync RPC", async () => {
    const repoDir = initTempGitRepo();
    try {
      daemon = await createTestPaseoDaemon({
        daemonVersion: "0.17.3-custom.test",
        pluginsEnabled: true,
      });
      process.env.PASEO_HOME = daemon.paseoHome;

      client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
      await client.connect();

      const pluginDirectory = fileURLToPath(
        new URL("../../../../../plugin-custom/quick-tools", import.meta.url),
      );
      const installResult = await client.installDirectoryPlugin(pluginDirectory);
      expect(installResult.status).toBe("running");

      // 1. Create a local workspace -> hook should assign "Local"
      const localCreated = await client.createWorkspace({
        source: { kind: "directory", path: repoDir },
      });
      expect(localCreated.error).toBeNull();
      const localId = localCreated.workspace!.id;

      await vi.waitFor(
        async () => {
          expect(await getWorkspaceLabels(client!, localId)).toContain("Local");
        },
        { timeout: 5000 },
      );

      // 2. Create a worktree workspace -> hook should assign "WT"
      const wtCreated = await client.createWorkspace({
        source: { kind: "worktree", cwd: repoDir, worktreeSlug: "wt-label-test" },
      });
      expect(wtCreated.error).toBeNull();
      const wtId = wtCreated.workspace!.id;

      await vi.waitFor(
        async () => {
          expect(await getWorkspaceLabels(client!, wtId)).toContain("WT");
        },
        { timeout: 5000 },
      );

      // 3. Sync RPC should be idempotent when all workspaces already have matching labels
      const syncIdle = (await client.invokePluginRpc(
        "quick-tools",
        "quick_tools.workspace_labels.sync.request",
        {},
      )) as { tagged: number; skipped: number };
      expect(syncIdle).toEqual({ tagged: 0, skipped: 2 });

      // 4. Verify default colors in workspace label catalog (Local -> sky, WT -> violet)
      const initialCatalog = await client.listWorkspaceLabels();
      expect(initialCatalog.labels).toEqual(
        expect.arrayContaining([
          { name: "Local", color: "sky" },
          { name: "WT", color: "violet" },
        ]),
      );

      // 5. Sync with custom colors updates the label colors in the daemon catalog
      const syncCustomColors = (await client.invokePluginRpc(
        "quick-tools",
        "quick_tools.workspace_labels.sync.request",
        {
          force: true,
          localLabelColor: "emerald",
          worktreeLabelColor: "amber",
        },
      )) as { tagged: number; skipped: number };
      expect(syncCustomColors).toEqual({ tagged: 0, skipped: 2 });

      const updatedCatalog = await client.listWorkspaceLabels();
      expect(updatedCatalog.labels).toEqual(
        expect.arrayContaining([
          { name: "Local", color: "emerald" },
          { name: "WT", color: "amber" },
        ]),
      );
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }, 30000);
});
