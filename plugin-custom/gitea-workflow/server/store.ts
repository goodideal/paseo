import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  IssueRunIndexEntrySchema,
  type IssueRunIndexEntry,
  type GiteaWorkflowTask,
  GiteaWorkflowTaskSchema,
} from "../shared/types.js";

export class IssueRunIndexStore {
  private memoryCache: Map<string, IssueRunIndexEntry> = new Map();
  private initialized = false;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(private readonly storageFilePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    try {
      const content = await readFile(this.storageFilePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      const validation = IssueRunIndexEntrySchema.array().safeParse(parsed);
      if (validation.success) {
        for (const entry of validation.data) {
          this.memoryCache.set(entry.id, entry);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[IssueRunIndexStore] Failed to read index file:", error);
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

  private indexKey(
    projectId: string,
    repoOwner: string,
    repoName: string,
    issueNumber: number,
  ): string {
    return `${projectId}::${repoOwner.toLowerCase()}/${repoName.toLowerCase()}#${issueNumber}`;
  }

  async hasActiveRunForIssue(
    projectId: string,
    repoOwner: string,
    repoName: string,
    issueNumber: number,
  ): Promise<boolean> {
    await this.ensureLoaded();
    const key = this.indexKey(projectId, repoOwner, repoName, issueNumber);
    return this.memoryCache.has(key);
  }

  async recordRun(entry: {
    projectId: string;
    repoOwner: string;
    repoName: string;
    issueNumber: number;
    runId: string;
  }): Promise<void> {
    await this.ensureLoaded();
    const key = this.indexKey(entry.projectId, entry.repoOwner, entry.repoName, entry.issueNumber);
    const now = new Date().toISOString();
    const record: IssueRunIndexEntry = {
      id: key,
      projectId: entry.projectId,
      repoOwner: entry.repoOwner,
      repoName: entry.repoName,
      issueNumber: entry.issueNumber,
      runId: entry.runId,
      createdAt: now,
      updatedAt: now,
    };
    this.memoryCache.set(key, record);
    await this.flush();
  }

  async getRunIdForIssue(
    projectId: string,
    repoOwner: string,
    repoName: string,
    issueNumber: number,
  ): Promise<string | null> {
    await this.ensureLoaded();
    const key = this.indexKey(projectId, repoOwner, repoName, issueNumber);
    return this.memoryCache.get(key)?.runId ?? null;
  }

  async listEntries(projectId?: string): Promise<IssueRunIndexEntry[]> {
    await this.ensureLoaded();
    const entries = Array.from(this.memoryCache.values());
    if (projectId) {
      return entries.filter((e) => e.projectId === projectId);
    }
    return entries;
  }

  async rebuildFromRuns(
    runs: Array<{
      id: string;
      projectId: string;
      runInput?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    this.memoryCache.clear();
    const now = new Date().toISOString();
    for (const run of runs) {
      const input = run.runInput;
      if (
        input &&
        typeof input.repoOwner === "string" &&
        typeof input.repoName === "string" &&
        typeof input.issueNumber === "number"
      ) {
        const key = this.indexKey(
          run.projectId,
          input.repoOwner,
          input.repoName,
          input.issueNumber,
        );
        this.memoryCache.set(key, {
          id: key,
          projectId: run.projectId,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          issueNumber: input.issueNumber,
          runId: run.id,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    this.initialized = true;
    await this.flush();
  }
}

// Backward-compatible TaskStore adapter for legacy tests and custom-plugins.e2e
export class TaskStore {
  private memoryCache: Map<string, GiteaWorkflowTask> = new Map();
  private initialized = false;

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
      }
    } catch {
      // ignore
    }
    this.initialized = true;
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
    if (filter?.projectId) tasks = tasks.filter((t) => t.projectId === filter.projectId);
    if (filter?.workspaceId) tasks = tasks.filter((t) => t.workspaceId === filter.workspaceId);
    return tasks;
  }

  async saveTask(task: GiteaWorkflowTask): Promise<void> {
    await this.ensureLoaded();
    this.memoryCache.set(task.id, task);
  }

  async updateTask(
    id: string,
    patch: Partial<Omit<GiteaWorkflowTask, "id" | "createdAt">>,
  ): Promise<GiteaWorkflowTask> {
    await this.ensureLoaded();
    const existing = this.memoryCache.get(id) ?? {
      id,
      projectId: "default",
      projectPath: "",
      issueNumber: 0,
      issueTitle: "",
      issueUrl: "",
      issueBody: "",
      giteaBaseUrl: "",
      repoOwner: "",
      repoName: "",
      branchName: "",
      workspaceId: null,
      agentId: null,
      state: "queued" as const,
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.memoryCache.set(id, updated);
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await this.ensureLoaded();
    this.memoryCache.delete(id);
  }
}
