import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import {
  DEFAULT_QUICK_PROMPT_ITEMS,
  type QuickPromptItem,
  QuickPromptItemSchema,
  type ProjectQuickPromptsRecord,
  ProjectQuickPromptsRecordSchema,
} from "../shared/contracts.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function applyPrivateMode(target: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(target, mode);
  } catch {
    // Permissions are not portable; creation must still work on such filesystems.
  }
}

function ensurePrivateDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  applyPrivateMode(directoryPath, PRIVATE_DIRECTORY_MODE);
}

function ensurePrivateFile(filePath: string): void {
  applyPrivateMode(filePath, PRIVATE_FILE_MODE);
}

export function writePrivateFileAtomicSync(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): void {
  ensurePrivateDirectory(path.dirname(filePath));
  const parent = path.dirname(filePath);
  const temporary = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}`);
  try {
    writeFileSync(temporary, data, { mode: PRIVATE_FILE_MODE });
    renameSync(temporary, filePath);
    ensurePrivateFile(filePath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

const ProjectsStoreSchema = z.record(z.string(), ProjectQuickPromptsRecordSchema);

export class QuickPromptsStore {
  readonly pluginDataDir: string;
  readonly globalPath: string;
  readonly projectPath: string;
  readonly legacyGlobalPath: string;
  readonly legacyProjectPath: string;

  constructor(paseoHome?: string) {
    const home = paseoHome || process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
    this.pluginDataDir = path.join(home, "plugin-data", "quick-prompts");
    this.globalPath = path.join(this.pluginDataDir, "quick-prompts.json");
    this.projectPath = path.join(this.pluginDataDir, "project-quick-prompts.json");
    this.legacyGlobalPath = path.join(home, "quick-prompts.json");
    this.legacyProjectPath = path.join(home, "projects", "project-quick-prompts.json");

    ensurePrivateDirectory(this.pluginDataDir);
    this.migrateLegacyDataIfNeeded();
  }

  private migrateLegacyDataIfNeeded(): void {
    // 1. Global prompts migration
    if (!existsSync(this.globalPath) && existsSync(this.legacyGlobalPath)) {
      try {
        const raw = readFileSync(this.legacyGlobalPath, "utf-8");
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : parsed?.items;
        const result = z.array(QuickPromptItemSchema).safeParse(items);
        if (result.success) {
          writePrivateFileAtomicSync(this.globalPath, `${JSON.stringify(result.data, null, 2)}\n`);
          console.info(
            `[QuickPromptsStore] Successfully migrated legacy global prompts from ${this.legacyGlobalPath} to ${this.globalPath}`,
          );
        } else {
          console.warn(
            `[QuickPromptsStore] Failed to migrate legacy global prompts from ${this.legacyGlobalPath}: schema validation failed`,
            result.error,
          );
        }
      } catch (err) {
        console.warn(
          `[QuickPromptsStore] Error reading legacy global prompts from ${this.legacyGlobalPath}:`,
          err,
        );
      }
    }

    // 2. Project prompts migration
    if (!existsSync(this.projectPath) && existsSync(this.legacyProjectPath)) {
      try {
        const raw = readFileSync(this.legacyProjectPath, "utf-8");
        const parsed = JSON.parse(raw);
        const result = ProjectsStoreSchema.safeParse(parsed);
        if (result.success) {
          writePrivateFileAtomicSync(this.projectPath, `${JSON.stringify(result.data, null, 2)}\n`);
          console.info(
            `[QuickPromptsStore] Successfully migrated legacy project prompts from ${this.legacyProjectPath} to ${this.projectPath}`,
          );
        } else {
          console.warn(
            `[QuickPromptsStore] Failed to migrate legacy project prompts from ${this.legacyProjectPath}: schema validation failed`,
            result.error,
          );
        }
      } catch (err) {
        console.warn(
          `[QuickPromptsStore] Error reading legacy project prompts from ${this.legacyProjectPath}:`,
          err,
        );
      }
    }
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
      console.warn(
        `[QuickPromptsStore] Invalid quick prompt schema in ${this.globalPath}:`,
        result.error,
      );
    } catch (err) {
      console.warn(`[QuickPromptsStore] Failed to read ${this.globalPath}:`, err);
    }
    return [...DEFAULT_QUICK_PROMPT_ITEMS];
  }

  setGlobal(items: QuickPromptItem[]): QuickPromptItem[] {
    const validated = z.array(QuickPromptItemSchema).parse(items);
    writePrivateFileAtomicSync(this.globalPath, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
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
      console.warn(
        `[QuickPromptsStore] Invalid project quick prompt schema in ${this.projectPath}:`,
        result.error,
      );
    } catch (err) {
      console.warn(`[QuickPromptsStore] Failed to read ${this.projectPath}:`, err);
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
