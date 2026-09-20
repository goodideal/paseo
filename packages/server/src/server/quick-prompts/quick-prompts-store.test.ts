import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QuickPromptsStore } from "./quick-prompts-store.js";
import { DEFAULT_QUICK_PROMPT_ITEMS, type QuickPromptItem } from "@getpaseo/protocol/quick-prompts";

describe("QuickPromptsStore", () => {
  let tempHome: string;
  let store: QuickPromptsStore;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), "paseo-test-quick-prompts-"));
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

    // Isolation check: another project has no items
    const otherProject = store.getProject("prj_node");
    expect(otherProject.items).toEqual([]);
    expect(otherProject.disabledGlobalIds).toEqual([]);
  });

  it("handles corrupted files gracefully", () => {
    const globalPath = path.join(tempHome, "quick-prompts.json");
    writeFileSync(globalPath, "NOT_JSON");
    expect(store.getGlobal()).toEqual(DEFAULT_QUICK_PROMPT_ITEMS);
  });
});
