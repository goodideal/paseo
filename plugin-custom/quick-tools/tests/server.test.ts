import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.js";
import { QuickPromptsStore } from "../server/quick-prompts-store.js";
import {
  DEFAULT_QUICK_PROMPT_ITEMS,
  quickPromptsWorkspaceLabelsSyncRpc,
  type QuickPromptItem,
} from "../shared/contracts.js";

describe("QuickPromptsStore (Plugin)", () => {
  let tempHome: string;
  let store: QuickPromptsStore;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), "paseo-test-quick-prompts-plugin-"));
    store = new QuickPromptsStore(tempHome);
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("returns default global items when no file exists", () => {
    const items = store.getGlobal();
    expect(items).toEqual(DEFAULT_QUICK_PROMPT_ITEMS);
  });

  it("persists and reloads global items", () => {
    const customItem: QuickPromptItem = {
      id: "custom-1",
      label: "Build Project",
      content: "npm run build",
      triggerType: "fixed",
      enabled: true,
      createdAt: 100,
      order: 0,
    };
    store.setGlobal([customItem]);
    const reloaded = store.getGlobal();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe("custom-1");
    expect(reloaded[0].label).toBe("Build Project");
  });

  it("returns empty structure for unseen project", () => {
    const project = store.getProject("prj_abc123");
    expect(project.projectId).toBe("prj_abc123");
    expect(project.items).toEqual([]);
    expect(project.disabledGlobalIds).toEqual([]);
  });

  it("persists project-specific items and disabled global IDs with isolation", () => {
    const projectItem: QuickPromptItem = {
      id: "prj-item-1",
      label: "Cargo Test",
      content: "cargo test --all",
      triggerType: "fixed",
      enabled: true,
      createdAt: 200,
      order: 0,
    };
    store.setProject("prj_rust", {
      items: [projectItem],
      disabledGlobalIds: ["builtin-continue"],
    });

    const rustProject = store.getProject("prj_rust");
    expect(rustProject.items).toHaveLength(1);
    expect(rustProject.items[0].label).toBe("Cargo Test");
    expect(rustProject.disabledGlobalIds).toEqual(["builtin-continue"]);

    const otherProject = store.getProject("prj_node");
    expect(otherProject.items).toEqual([]);
    expect(otherProject.disabledGlobalIds).toEqual([]);
  });

  it("handles corrupted files gracefully", () => {
    writeFileSync(store.globalPath, "NOT_JSON");
    expect(store.getGlobal()).toEqual(DEFAULT_QUICK_PROMPT_ITEMS);
  });

  it("migrates legacy global prompts from $PASEO_HOME/quick-prompts.json", () => {
    const legacyHome = mkdtempSync(path.join(tmpdir(), "paseo-legacy-global-"));
    const legacyGlobalPath = path.join(legacyHome, "quick-prompts.json");
    const legacyItem: QuickPromptItem = {
      id: "legacy-1",
      label: "Legacy Deploy",
      content: "Deploy to production",
      triggerType: "fixed",
      enabled: true,
      createdAt: 50,
      order: 0,
    };
    writeFileSync(legacyGlobalPath, JSON.stringify([legacyItem], null, 2));

    // Initialize store with the legacy home directory
    const legacyStore = new QuickPromptsStore(legacyHome);
    expect(existsSync(legacyStore.globalPath)).toBe(true);

    const reloaded = legacyStore.getGlobal();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe("legacy-1");
    expect(reloaded[0].label).toBe("Legacy Deploy");

    rmSync(legacyHome, { recursive: true, force: true });
  });

  it("migrates legacy project prompts from $PASEO_HOME/projects/project-quick-prompts.json", () => {
    const legacyHome = mkdtempSync(path.join(tmpdir(), "paseo-legacy-project-"));
    const projectsDir = path.join(legacyHome, "projects");
    mkdirSync(projectsDir, { recursive: true });
    const legacyProjectPath = path.join(projectsDir, "project-quick-prompts.json");

    const legacyProjectRecord = {
      prj_legacy: {
        version: 1,
        projectId: "prj_legacy",
        items: [
          {
            id: "prj-legacy-item",
            label: "Legacy Test",
            content: "pytest",
            triggerType: "fixed" as const,
            enabled: true,
            createdAt: 10,
            order: 0,
          },
        ],
        disabledGlobalIds: ["builtin-fix"],
      },
    };
    writeFileSync(legacyProjectPath, JSON.stringify(legacyProjectRecord, null, 2));

    const legacyStore = new QuickPromptsStore(legacyHome);
    expect(existsSync(legacyStore.projectPath)).toBe(true);

    const projectData = legacyStore.getProject("prj_legacy");
    expect(projectData.projectId).toBe("prj_legacy");
    expect(projectData.items).toHaveLength(1);
    expect(projectData.items[0].id).toBe("prj-legacy-item");
    expect(projectData.disabledGlobalIds).toEqual(["builtin-fix"]);

    rmSync(legacyHome, { recursive: true, force: true });
  });

  it("migrates data from previous quick-prompts plugin-data directory to quick-tools", () => {
    const prevHome = mkdtempSync(path.join(tmpdir(), "paseo-prev-plugin-"));
    const prevPluginDir = path.join(prevHome, "plugin-data", "quick-prompts");
    mkdirSync(prevPluginDir, { recursive: true });

    const prevGlobalItem: QuickPromptItem = {
      id: "prev-global-1",
      label: "Prev Global",
      content: "Keep my prompt",
      triggerType: "fixed",
      enabled: true,
      createdAt: 100,
      order: 0,
    };
    writeFileSync(
      path.join(prevPluginDir, "quick-prompts.json"),
      JSON.stringify([prevGlobalItem], null, 2),
    );
    writeFileSync(
      path.join(prevPluginDir, "project-quick-prompts.json"),
      JSON.stringify(
        {
          prj_prev: {
            version: 1,
            projectId: "prj_prev",
            items: [],
            disabledGlobalIds: ["builtin-continue"],
          },
        },
        null,
        2,
      ),
    );

    const migratedStore = new QuickPromptsStore(prevHome);
    expect(migratedStore.pluginDataDir).toBe(path.join(prevHome, "plugin-data", "quick-tools"));
    expect(existsSync(migratedStore.globalPath)).toBe(true);
    expect(existsSync(migratedStore.projectPath)).toBe(true);
    expect(migratedStore.getGlobal()).toEqual([prevGlobalItem]);
    expect(migratedStore.getProject("prj_prev").disabledGlobalIds).toEqual(["builtin-continue"]);

    rmSync(prevHome, { recursive: true, force: true });
  });
});

describe("Quick Prompts Server Entrypoint (Auto Workspace Labels)", () => {
  function createMockServer(autoLabelWorkspaces = true) {
    const handlers = new Map<string, (input: any, ctx: any) => Promise<any>>();
    const hooks = new Map<string, (event: any, ctx: any) => Promise<void>>();
    const removeHook = vi.fn();

    const server = {
      registerSettings: vi.fn(() => ({
        read: vi.fn().mockResolvedValue({
          status: "ready",
          revision: "rev-1",
          values: { aiSuggestions: true, autoLabelWorkspaces },
        }),
        subscribe: vi.fn(() => () => {}),
      })),
      handle: vi.fn(
        (contract: { name: string }, handler: (input: any, ctx: any) => Promise<any>) => {
          handlers.set(contract.name, handler);
        },
      ),
      addHook: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<void>) => {
        hooks.set(name, handler);
        return removeHook;
      }),
    } as unknown as PluginServerContext;

    return { server, handlers, hooks, removeHook };
  }

  it("tags newly created worktree workspace with WT on workspace.create.after", async () => {
    const { server, hooks, removeHook } = createMockServer(true);
    const cleanup = contribute(server);

    const setLabel = vi.fn().mockResolvedValue({ labels: ["WT"] });
    const refresh = vi.fn().mockResolvedValue({
      id: "ws-wt-1",
      workspaceKind: "worktree",
      labels: [],
      background: false,
      archivingAt: null,
    });
    const paseo = {
      workspaces: {
        ref: vi.fn(() => ({ refresh, setLabel })),
        list: vi.fn(),
      },
    };

    const hook = hooks.get("workspace.create.after");
    expect(hook).toBeDefined();
    await hook!(
      {
        workspace: {
          id: "ws-wt-1",
          projectId: "p1",
          cwd: "/tmp/wt",
          name: "wt",
          archivedAt: null,
          metadata: {},
        },
      },
      { paseo, signal: new AbortController().signal },
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setLabel).toHaveBeenCalledWith("WT", { assigned: true });

    await cleanup();
    expect(removeHook).toHaveBeenCalledTimes(1);
  });

  it("skips auto-labeling on workspace.create.after when disabled in settings", async () => {
    const { server, hooks } = createMockServer(false);
    contribute(server);

    const refresh = vi.fn();
    const paseo = {
      workspaces: {
        ref: vi.fn(() => ({ refresh, setLabel: vi.fn() })),
        list: vi.fn(),
      },
    };

    const hook = hooks.get("workspace.create.after");
    await hook!(
      {
        workspace: {
          id: "ws-local-1",
          projectId: "p1",
          cwd: "/tmp/local",
          name: "local",
          archivedAt: null,
          metadata: {},
        },
      },
      { paseo, signal: new AbortController().signal },
    );

    expect(refresh).not.toHaveBeenCalled();
  });

  it("syncs existing workspaces via RPC and respects autoLabelWorkspaces unless forced", async () => {
    const { server, handlers } = createMockServer(false);
    contribute(server);

    const setLabel = vi.fn().mockResolvedValue({ labels: ["Local"] });
    const list = vi.fn().mockResolvedValue({
      requestId: "req-1",
      entries: [{ id: "ws-1", workspaceKind: "local_checkout", labels: [] }],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
    const paseo = {
      workspaces: {
        list,
        ref: vi.fn(() => ({ setLabel })),
      },
    };

    const syncHandler = handlers.get(quickPromptsWorkspaceLabelsSyncRpc.name);
    expect(syncHandler).toBeDefined();

    // Non-forced sync is skipped when setting is disabled
    expect(await syncHandler!({}, { paseo })).toEqual({ tagged: 0, skipped: 0 });
    expect(list).not.toHaveBeenCalled();

    // Forced sync runs regardless of setting
    expect(await syncHandler!({ force: true }, { paseo })).toEqual({ tagged: 1, skipped: 0 });
    expect(setLabel).toHaveBeenCalledWith("Local", { assigned: true });
  });
});
