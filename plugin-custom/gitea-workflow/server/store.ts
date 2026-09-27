import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GiteaWorkflowTaskSchema, type GiteaWorkflowTask } from "../shared/types.js";

export class TaskStore {
  private memoryCache: Map<string, GiteaWorkflowTask> = new Map();
  private initialized = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly storageFilePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    try {
      const content = await readFile(this.storageFilePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      const validation = GiteaWorkflowTaskSchema.array().safeParse(parsed);
      if (validation.success) {
        for (const task of validation.data) {
          this.memoryCache.set(task.id, task);
        }
      } else {
        console.error("[TaskStore] Invalid task records schema:", validation.error.format());
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[TaskStore] Failed to read storage file:", error);
      }
    }
    this.initialized = true;
  }

  private async flush(): Promise<void> {
    this.writeLock = this.writeLock.then(async () => {
      const dir = dirname(this.storageFilePath);
      await mkdir(dir, { recursive: true });
      const tempPath = `${this.storageFilePath}.${randomUUID()}.tmp`;
      const data = JSON.stringify(Array.from(this.memoryCache.values()), null, 2);
      try {
        await writeFile(tempPath, data, "utf8");
        await rename(tempPath, this.storageFilePath);
      } catch (err) {
        await unlink(tempPath).catch(() => {});
        throw err;
      }
      return undefined;
    });
    return this.writeLock;
  }

  async getTask(id: string): Promise<GiteaWorkflowTask | null> {
    await this.ensureLoaded();
    return this.memoryCache.get(id) ?? null;
  }

  async listTasks(filter?: {
    projectId?: string;
    workspaceId?: string;
  }): Promise<GiteaWorkflowTask[]> {
    await this.ensureLoaded();
    let tasks = Array.from(this.memoryCache.values());
    if (filter?.projectId) {
      tasks = tasks.filter((t) => t.projectId === filter.projectId);
    }
    if (filter?.workspaceId) {
      tasks = tasks.filter((t) => t.workspaceId === filter.workspaceId);
    }
    return tasks;
  }

  async saveTask(task: GiteaWorkflowTask): Promise<void> {
    await this.ensureLoaded();
    task.updatedAt = new Date().toISOString();
    this.memoryCache.set(task.id, task);
    await this.flush();
  }

  async updateTask(
    id: string,
    patch: Partial<Omit<GiteaWorkflowTask, "id" | "createdAt">>,
  ): Promise<GiteaWorkflowTask> {
    await this.ensureLoaded();
    const existing = this.memoryCache.get(id);
    if (!existing) {
      throw new Error(`Task ${id} not found`);
    }
    const updated: GiteaWorkflowTask = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.memoryCache.set(id, updated);
    await this.flush();
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await this.ensureLoaded();
    this.memoryCache.delete(id);
    await this.flush();
  }
}
