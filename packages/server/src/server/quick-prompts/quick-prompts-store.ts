import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_QUICK_PROMPT_ITEMS,
  type QuickPromptItem,
  QuickPromptItemSchema,
  type ProjectQuickPromptsRecord,
  ProjectQuickPromptsRecordSchema,
} from "@getpaseo/protocol/quick-prompts";
import { writePrivateFileAtomicSync } from "../private-files.js";

const ProjectsStoreSchema = z.record(z.string(), ProjectQuickPromptsRecordSchema);

export class QuickPromptsStore {
  private readonly globalPath: string;
  private readonly projectPath: string;

  constructor(paseoHome: string) {
    this.globalPath = path.join(paseoHome, "quick-prompts.json");
    this.projectPath = path.join(paseoHome, "projects", "project-quick-prompts.json");
  }

  getGlobal(): QuickPromptItem[] {
    if (!existsSync(this.globalPath)) {
      return [...DEFAULT_QUICK_PROMPT_ITEMS];
    }
    try {
      const raw = readFileSync(this.globalPath, "utf-8");
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed?.items;
      const result = z.array(QuickPromptItemSchema).safeParse(items);
      if (result.success) {
        return result.data;
      }
    } catch {
      // Fallback on corrupt file
    }
    return [...DEFAULT_QUICK_PROMPT_ITEMS];
  }

  setGlobal(items: QuickPromptItem[]): void {
    const validated = z.array(QuickPromptItemSchema).parse(items);
    writePrivateFileAtomicSync(this.globalPath, `${JSON.stringify(validated, null, 2)}\n`);
  }

  private readProjectsRecord(): Record<string, ProjectQuickPromptsRecord> {
    if (!existsSync(this.projectPath)) {
      return {};
    }
    try {
      const raw = readFileSync(this.projectPath, "utf-8");
      const parsed = JSON.parse(raw);
      const result = ProjectsStoreSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
    } catch {
      // Fallback
    }
    return {};
  }

  getProject(projectId: string): ProjectQuickPromptsRecord {
    const all = this.readProjectsRecord();
    const existing = all[projectId];
    if (existing) {
      return existing;
    }
    return {
      version: 1,
      projectId,
      items: [],
      disabledGlobalIds: [],
    };
  }

  setProject(
    projectId: string,
    patch: Partial<ProjectQuickPromptsRecord>,
  ): ProjectQuickPromptsRecord {
    const all = this.readProjectsRecord();
    const existing = this.getProject(projectId);
    const updated: ProjectQuickPromptsRecord = {
      version: 1,
      projectId,
      items: patch.items ?? existing.items,
      disabledGlobalIds: patch.disabledGlobalIds ?? existing.disabledGlobalIds,
      order: patch.order ?? existing.order,
    };
    const validated = ProjectQuickPromptsRecordSchema.parse(updated);
    all[projectId] = validated;
    writePrivateFileAtomicSync(this.projectPath, `${JSON.stringify(all, null, 2)}\n`);
    return validated;
  }
}
