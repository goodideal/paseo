import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GiteaWorkflowTask } from "../shared/types.js";

export class TaskStore {
  private memoryCache: Map<string, GiteaWorkflowTask> = new Map();
  private initialized = false;

  constructor(private readonly storageFilePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    try {
      const content = await readFile(this.storageFilePath, "utf8");
      const records = JSON.parse(content) as GiteaWorkflowTask[];
      for (const task of records) {
        this.memoryCache.set(task.id, task);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    this.initialized = true;
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.storageFilePath), { recursive: true });
    const data = JSON.stringify(Array.from(this.memoryCache.values()), null, 2);
    await writeFile(this.storageFilePath, data, "utf8");
  }

  async getTask(id: string): Promise<GiteaWorkflowTask | null> {
    await this.ensureLoaded();
    return this.memoryCache.get(id) ?? null;
  }

  async listTasks(): Promise<GiteaWorkflowTask[]> {
    await this.ensureLoaded();
    return Array.from(this.memoryCache.values());
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
