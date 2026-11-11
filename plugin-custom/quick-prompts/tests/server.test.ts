import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QuickPromptsStore } from "../server/quick-prompts-store.js";
import { DEFAULT_QUICK_PROMPT_ITEMS, type QuickPromptItem } from "../shared/contracts.js";

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
});
