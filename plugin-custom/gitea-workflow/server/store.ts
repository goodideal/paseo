import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
      await chmod(this.storageFilePath, 0o600).catch(() => {});
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
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700).catch(() => {});
      const tempPath = `${this.storageFilePath}.${randomUUID()}.tmp`;
      const data = JSON.stringify(Array.from(this.memoryCache.values()), null, 2);
      try {
        await writeFile(tempPath, data, { encoding: "utf8", mode: 0o600 });
        await chmod(tempPath, 0o600).catch(() => {});
        await rename(tempPath, this.storageFilePath);
        await chmod(this.storageFilePath, 0o600).catch(() => {});
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
    issueTitle?: string;
    issueBody?: string;
    runId: string;
    baseUrl?: string;
    token?: string;
    identityId?: string;
    identitySource?: "team-collab" | "tea" | "env";
    authorName?: string;
    authorEmail?: string;
    giteaUsername?: string;
    sshKeyPath?: string;
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
      issueTitle: entry.issueTitle,
      issueBody: entry.issueBody,
      runId: entry.runId,
      baseUrl: entry.baseUrl,
      token: entry.token,
      ...(entry.identityId ? { identityId: entry.identityId } : {}),
      ...(entry.identitySource ? { identitySource: entry.identitySource } : {}),
      ...(entry.authorName ? { authorName: entry.authorName } : {}),
      ...(entry.authorEmail ? { authorEmail: entry.authorEmail } : {}),
      ...(entry.giteaUsername ? { giteaUsername: entry.giteaUsername } : {}),
      ...(entry.sshKeyPath ? { sshKeyPath: entry.sshKeyPath } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.memoryCache.set(key, record);
    await this.flush();
  }

  async getEntryByRunId(runId: string): Promise<IssueRunIndexEntry | null> {
    await this.ensureLoaded();
    for (const entry of this.memoryCache.values()) {
      if (entry.runId === runId) return entry;
    }
    return null;
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

  async removeRun(
    projectId: string,
    repoOwner: string,
    repoName: string,
    issueNumber: number,
  ): Promise<void> {
    await this.ensureLoaded();
    const key = this.indexKey(projectId, repoOwner, repoName, issueNumber);
    if (this.memoryCache.delete(key)) {
      await this.flush();
    }
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
        let identitySource: "team-collab" | "tea" | "env" | undefined;
        if (
          input.identitySource === "team-collab" ||
          input.identitySource === "tea" ||
          input.identitySource === "env"
        ) {
          identitySource = input.identitySource;
        }
        this.memoryCache.set(key, {
          id: key,
          projectId: run.projectId,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          issueNumber: input.issueNumber,
          issueTitle: typeof input.issueTitle === "string" ? input.issueTitle : undefined,
          issueBody: typeof input.issueBody === "string" ? input.issueBody : undefined,
          runId: run.id,
          baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : undefined,
          token: typeof input.token === "string" ? input.token : undefined,
          identityId: typeof input.identityId === "string" ? input.identityId : undefined,
          identitySource,
          authorName: typeof input.authorName === "string" ? input.authorName : undefined,
          authorEmail: typeof input.authorEmail === "string" ? input.authorEmail : undefined,
          giteaUsername: typeof input.giteaUsername === "string" ? input.giteaUsername : undefined,
          sshKeyPath: typeof input.sshKeyPath === "string" ? input.sshKeyPath : undefined,
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
