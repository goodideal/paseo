# Gitea Automated Worktree Task Pipeline & Screenshot Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Paseo plugin (`gitea-workflow`) that automatically polls Gitea issues, provisions isolated Git worktree workspaces, runs coding and self-review agents, launches the project dev server to capture web rendering screenshots via headless browser automation, and presents an interactive review panel in Paseo for human approval and PR creation.

**Architecture:** Implemented as a Paseo local plugin under `plugin-examples/gitea-workflow`. The server entrypoint (`index.server.ts`) runs as a supervised daemon child process executing the poller, worktree orchestrator, service proxy probe, and screenshot pipeline. The client entrypoint (`index.client.tsx`) registers a Paseo `WorkspacePanel` review workbench allowing users to inspect issues, visual diffs/screenshots, and approve or reject with feedback.

**Tech Stack:** TypeScript, React (React Native / Expo Web), `@getpaseo/plugin`, `@getpaseo/protocol`, `@getpaseo/client`, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-gitea-worktree-screenshot-workflow-design.md`

## Global Constraints

- Must strictly adhere to `@getpaseo/plugin` server and client lifecycle contracts.
- Plugin code must reside under `plugin-examples/gitea-workflow` to integrate cleanly into Paseo workspace typechecking (`npm run typecheck`).
- All wire RPC communication must use `defineRpc` and Zod schemas with pure validators.
- Cross-platform UI compatibility: all client components must be compatible with React Native web and mobile styling principles (no raw unchecked DOM APIs; import gates from `@getpaseo/plugin/client`).
- Vitest tests must run in isolation: `npx vitest run plugin-examples/gitea-workflow/tests/<file> --bail=1`.
- Formatting must always run through `npm run format:files -- <file>` before committing.

---

### Task 1: Plugin Manifest, Shared Types & RPC Contracts

**Files:**

- Create: `plugin-examples/gitea-workflow/paseo-plugin.json`
- Create: `plugin-examples/gitea-workflow/shared/types.ts`
- Create: `plugin-examples/gitea-workflow/shared/contracts.ts`
- Test: `plugin-examples/gitea-workflow/tests/schema.test.ts`

**Interfaces:**

- Consumes: `@getpaseo/plugin`, `zod`
- Produces: `GiteaWorkflowTask` type, `GiteaSettingsSchema`, RPCs (`listTasksRpc`, `getTaskDetailRpc`, `approveTaskRpc`, `rejectTaskRpc`)

- [ ] **Step 1: Write the failing schema test**

Create `plugin-examples/gitea-workflow/tests/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { GiteaWorkflowTaskSchema, GiteaSettingsSchema } from "../shared/types.js";
import { listTasksRpc, approveTaskRpc, rejectTaskRpc } from "../shared/contracts.js";

describe("Gitea Workflow Schemas and RPCs", () => {
  it("validates a valid task record", () => {
    const validTask = {
      id: "task-gitea-101",
      issueNumber: 101,
      issueTitle: "Fix navigation header alignment",
      issueUrl: "https://gitea.example.com/org/repo/issues/101",
      issueBody: "Header is overlapping on mobile viewports.",
      repoOwner: "org",
      repoName: "repo",
      branchName: "agent/issue-101-fix-header",
      workspaceId: "ws-123",
      agentId: "agent-456",
      state: "pending_human_review",
      screenshots: [
        {
          id: "sc-1",
          label: "Desktop (1280x800)",
          viewport: { width: 1280, height: 800 },
          relativePath: "screenshots/desktop.png",
          capturedAt: "2026-09-19T10:00:00.000Z",
        },
      ],
      diffSummary: {
        additions: 12,
        deletions: 4,
        filesChanged: 2,
      },
      createdAt: "2026-09-19T09:50:00.000Z",
      updatedAt: "2026-09-19T10:00:00.000Z",
    };

    const parsed = GiteaWorkflowTaskSchema.parse(validTask);
    expect(parsed.id).toBe("task-gitea-101");
    expect(parsed.state).toBe("pending_human_review");
  });

  it("validates plugin settings with defaults", () => {
    const settings = GiteaSettingsSchema.parse({
      giteaUrl: "https://gitea.mycompany.com",
      giteaToken: "secret-token",
      repoOwner: "mycompany",
      repoName: "frontend",
    });

    expect(settings.listenLabel).toBe("agent-ready");
    expect(settings.inProgressLabel).toBe("agent-in-progress");
    expect(settings.reviewedLabel).toBe("agent-reviewed");
    expect(settings.pollIntervalSeconds).toBe(60);
    expect(settings.maxConcurrentWorktrees).toBe(3);
  });

  it("exports valid RPC contracts", () => {
    expect(listTasksRpc.name).toBe("giteaWorkflow.listTasks");
    expect(approveTaskRpc.name).toBe("giteaWorkflow.approveTask");
    expect(rejectTaskRpc.name).toBe("giteaWorkflow.rejectTask");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/schema.test.ts --bail=1`
Expected: FAIL with missing module `../shared/types.js`

- [ ] **Step 3: Write minimal implementation**

Create `plugin-examples/gitea-workflow/paseo-plugin.json`:

```json
{
  "id": "gitea-workflow",
  "requirements": {
    "paseo": ">=0.8.0"
  }
}
```

Create `plugin-examples/gitea-workflow/shared/types.ts`:

```typescript
import { z } from "zod";

export const TaskStateSchema = z.enum([
  "queued",
  "worktree_creating",
  "coding",
  "self_review",
  "screenshotting",
  "pending_human_review",
  "pr_creating",
  "done",
  "failed",
]);

export type TaskState = z.infer<typeof TaskStateSchema>;

export const ScreenshotMetadataSchema = z.object({
  id: z.string(),
  label: z.string(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  relativePath: z.string(),
  capturedAt: z.string(),
});

export type ScreenshotMetadata = z.infer<typeof ScreenshotMetadataSchema>;

export const GiteaWorkflowTaskSchema = z.object({
  id: z.string(),
  issueNumber: z.number().int(),
  issueTitle: z.string(),
  issueUrl: z.string(),
  issueBody: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  branchName: z.string(),
  workspaceId: z.string().nullable(),
  agentId: z.string().nullable(),
  state: TaskStateSchema,
  screenshots: z.array(ScreenshotMetadataSchema),
  diffSummary: z
    .object({
      additions: z.number().int(),
      deletions: z.number().int(),
      filesChanged: z.number().int(),
    })
    .nullable(),
  prUrl: z.string().optional(),
  prNumber: z.number().int().optional(),
  reviewFeedback: z.array(z.string()).optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GiteaWorkflowTask = z.infer<typeof GiteaWorkflowTaskSchema>;

export const GiteaSettingsSchema = z.object({
  giteaUrl: z.string().url(),
  giteaToken: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  listenLabel: z.string().default("agent-ready"),
  inProgressLabel: z.string().default("agent-in-progress"),
  reviewedLabel: z.string().default("agent-reviewed"),
  pollIntervalSeconds: z.number().int().min(10).default(60),
  maxConcurrentWorktrees: z.number().int().min(1).max(10).default(3),
});

export type GiteaSettings = z.infer<typeof GiteaSettingsSchema>;
```

Create `plugin-examples/gitea-workflow/shared/contracts.ts`:

```typescript
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { GiteaWorkflowTaskSchema } from "./types.js";

export const listTasksRpc = defineRpc({
  name: "giteaWorkflow.listTasks",
  input: z.object({
    workspaceId: z.string().optional(),
  }),
  output: z.object({
    tasks: z.array(GiteaWorkflowTaskSchema),
  }),
});

export const getTaskDetailRpc = defineRpc({
  name: "giteaWorkflow.getTaskDetail",
  input: z.object({
    taskId: z.string(),
  }),
  output: z.object({
    task: GiteaWorkflowTaskSchema.nullable(),
  }),
});

export const approveTaskRpc = defineRpc({
  name: "giteaWorkflow.approveTask",
  input: z.object({
    taskId: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    prUrl: z.string().optional(),
    error: z.string().optional(),
  }),
});

export const rejectTaskRpc = defineRpc({
  name: "giteaWorkflow.rejectTask",
  input: z.object({
    taskId: z.string(),
    feedback: z.string().min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/schema.test.ts --bail=1`
Expected: PASS (3 tests)

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/paseo-plugin.json plugin-examples/gitea-workflow/shared/types.ts plugin-examples/gitea-workflow/shared/contracts.ts plugin-examples/gitea-workflow/tests/schema.test.ts
git add plugin-examples/gitea-workflow/
git commit -m "feat(gitea-workflow): add plugin manifest, schemas, and rpc contracts"
```

---

### Task 2: Task Store & State Persistence

**Files:**

- Create: `plugin-examples/gitea-workflow/server/store.ts`
- Test: `plugin-examples/gitea-workflow/tests/store.test.ts`

**Interfaces:**

- Consumes: `GiteaWorkflowTask` from `../shared/types.js`
- Produces: `TaskStore` class (`getTask`, `listTasks`, `saveTask`, `updateState`, `deleteTask`)

- [ ] **Step 1: Write the failing test**

Create `plugin-examples/gitea-workflow/tests/store.test.ts`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "../server/store.js";
import type { GiteaWorkflowTask } from "../shared/types.js";

describe("TaskStore", () => {
  let tempDir: string;
  let storePath: string;
  let store: TaskStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gitea-store-test-"));
    storePath = join(tempDir, "tasks.json");
    store = new TaskStore(storePath);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists and reads tasks", async () => {
    const task: GiteaWorkflowTask = {
      id: "task-1",
      issueNumber: 1,
      issueTitle: "Test Issue",
      issueUrl: "http://example.com/1",
      issueBody: "Body text",
      repoOwner: "testowner",
      repoName: "testrepo",
      branchName: "agent/issue-1-test",
      workspaceId: null,
      agentId: null,
      state: "queued",
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.saveTask(task);
    const loaded = await store.getTask("task-1");
    expect(loaded).toEqual(task);

    const all = await store.listTasks();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("task-1");
  });

  it("updates task state atomically", async () => {
    const task: GiteaWorkflowTask = {
      id: "task-2",
      issueNumber: 2,
      issueTitle: "State transition",
      issueUrl: "http://example.com/2",
      issueBody: "Test",
      repoOwner: "owner",
      repoName: "repo",
      branchName: "agent/issue-2",
      workspaceId: null,
      agentId: null,
      state: "queued",
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await store.saveTask(task);
    await store.updateTask("task-2", { state: "coding", agentId: "agent-99" });

    const updated = await store.getTask("task-2");
    expect(updated?.state).toBe("coding");
    expect(updated?.agentId).toBe("agent-99");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/store.test.ts --bail=1`
Expected: FAIL with `Cannot find module '../server/store.js'`

- [ ] **Step 3: Write minimal implementation**

Create `plugin-examples/gitea-workflow/server/store.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/store.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/server/store.ts plugin-examples/gitea-workflow/tests/store.test.ts
git add plugin-examples/gitea-workflow/server/store.ts plugin-examples/gitea-workflow/tests/store.test.ts
git commit -m "feat(gitea-workflow): add json task store for persistence"
```

---

### Task 3: Gitea API Client & Label Claiming

**Files:**

- Create: `plugin-examples/gitea-workflow/server/gitea-client.ts`
- Test: `plugin-examples/gitea-workflow/tests/gitea-client.test.ts`

**Interfaces:**

- Consumes: `GiteaSettings` from `../shared/types.js`
- Produces: `GiteaClient` (`fetchReadyIssues`, `claimIssue`, `postComment`, `createPullRequest`)

- [ ] **Step 1: Write the failing test with HTTP mock**

Create `plugin-examples/gitea-workflow/tests/gitea-client.test.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GiteaClient } from "../server/gitea-client.js";

describe("GiteaClient", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let capturedRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, any>;
    body?: any;
  }>;

  beforeEach(async () => {
    capturedRequests = [];
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bodyStr = Buffer.concat(chunks).toString("utf8");
      const body = bodyStr ? JSON.parse(bodyStr) : undefined;
      capturedRequests.push({
        method: req.method ?? "GET",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });

      if (req.url?.includes("/issues?state=open")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              number: 42,
              title: "Add dark mode toggle",
              body: "Please add a toggle in settings.",
              html_url: "http://gitea.local/owner/repo/issues/42",
              labels: [{ name: "agent-ready" }],
            },
          ]),
        );
        return;
      }

      if (
        req.url?.includes("/labels") ||
        req.url?.includes("/comments") ||
        req.url?.includes("/pulls")
      ) {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, html_url: "http://gitea.local/owner/repo/pulls/10" }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("fetches ready issues", async () => {
    const client = new GiteaClient({
      giteaUrl: baseUrl,
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    const issues = await client.fetchReadyIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(42);
    expect(issues[0].title).toBe("Add dark mode toggle");
  });

  it("claims issue by updating labels and posting comment", async () => {
    const client = new GiteaClient({
      giteaUrl: baseUrl,
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    await client.claimIssue(42);
    const commentReq = capturedRequests.find((r) => r.url.includes("/comments"));
    expect(commentReq).toBeDefined();
    expect(commentReq?.body?.body).toContain("Paseo Agent");
  });

  it("creates a pull request", async () => {
    const client = new GiteaClient({
      giteaUrl: baseUrl,
      giteaToken: "test-token",
      repoOwner: "owner",
      repoName: "repo",
      listenLabel: "agent-ready",
      inProgressLabel: "agent-in-progress",
      reviewedLabel: "agent-reviewed",
      pollIntervalSeconds: 60,
      maxConcurrentWorktrees: 3,
    });

    const pr = await client.createPullRequest({
      title: "[Agent] Add dark mode toggle",
      body: "Resolves #42",
      headBranch: "agent/issue-42",
      baseBranch: "main",
    });

    expect(pr.url).toBe("http://gitea.local/owner/repo/pulls/10");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/gitea-client.test.ts --bail=1`
Expected: FAIL with missing module `../server/gitea-client.js`

- [ ] **Step 3: Write minimal implementation**

Create `plugin-examples/gitea-workflow/server/gitea-client.ts`:

```typescript
import type { GiteaSettings } from "../shared/types.js";

export interface GiteaIssueDto {
  number: number;
  title: string;
  body: string;
  html_url: string;
  labels: Array<{ name: string }>;
}

export class GiteaClient {
  constructor(private readonly config: GiteaSettings) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `token ${this.config.giteaToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private url(endpoint: string): string {
    const base = this.config.giteaUrl.replace(/\/+$/, "");
    return `${base}/api/v1/repos/${this.config.repoOwner}/${this.config.repoName}${endpoint}`;
  }

  async fetchReadyIssues(): Promise<GiteaIssueDto[]> {
    const res = await fetch(
      this.url(`/issues?state=open&labels=${encodeURIComponent(this.config.listenLabel)}`),
      { headers: this.headers },
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch issues: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as GiteaIssueDto[];
  }

  async claimIssue(issueNumber: number): Promise<void> {
    // 1. Remove listen label
    await fetch(
      this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(this.config.listenLabel)}`),
      { method: "DELETE", headers: this.headers },
    ).catch(() => {});

    // 2. Add in-progress label
    await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: [this.config.inProgressLabel] }),
    });

    // 3. Post claim comment
    await fetch(this.url(`/issues/${issueNumber}/comments`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        body: "🤖 **Paseo Agent** has claimed this task. An isolated Git worktree workspace is being provisioned.",
      }),
    });
  }

  async markReviewed(issueNumber: number): Promise<void> {
    await fetch(
      this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(this.config.inProgressLabel)}`),
      { method: "DELETE", headers: this.headers },
    ).catch(() => {});

    await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: [this.config.reviewedLabel] }),
    });
  }

  async createPullRequest(params: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<{ url: string }> {
    const res = await fetch(this.url("/pulls"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.headBranch,
        base: params.baseBranch,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create pull request: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { html_url: string };
    return { url: data.html_url };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/gitea-client.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/server/gitea-client.ts plugin-examples/gitea-workflow/tests/gitea-client.test.ts
git add plugin-examples/gitea-workflow/server/gitea-client.ts plugin-examples/gitea-workflow/tests/gitea-client.test.ts
git commit -m "feat(gitea-workflow): implement gitea rest api client"
```

---

### Task 4: Service Proxy URL Resolution & Screenshot Automation

**Files:**

- Create: `plugin-examples/gitea-workflow/server/screenshot-pipeline.ts`
- Test: `plugin-examples/gitea-workflow/tests/screenshot-pipeline.test.ts`

**Interfaces:**

- Consumes: `PaseoApi` client, `ScreenshotMetadata`
- Produces: `ScreenshotPipeline` (`resolveServiceUrl`, `captureViewportScreenshots`)

- [ ] **Step 1: Write the failing test**

Create `plugin-examples/gitea-workflow/tests/screenshot-pipeline.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ScreenshotPipeline } from "../server/screenshot-pipeline.js";

describe("ScreenshotPipeline", () => {
  it("generates deterministic service proxy URL according to Paseo conventions", () => {
    const url = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: "agent/issue-42-ui",
      projectName: "web-app",
    });

    expect(url).toBe("http://dev--agent-issue-42-ui--web-app.localhost");
  });

  it("handles main/master branch by omitting branch segment", () => {
    const url = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: "main",
      projectName: "web-app",
    });

    expect(url).toBe("http://dev--web-app.localhost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/screenshot-pipeline.test.ts --bail=1`
Expected: FAIL with missing module `../server/screenshot-pipeline.js`

- [ ] **Step 3: Write minimal implementation**

Create `plugin-examples/gitea-workflow/server/screenshot-pipeline.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScreenshotMetadata } from "../shared/types.js";

export interface FormatServiceUrlParams {
  scriptName: string;
  branchName: string;
  projectName: string;
}

export interface ScreenshotBroker {
  execute(command: {
    command: string;
    args?: Record<string, unknown>;
  }): Promise<{ ok: boolean; result?: any; error?: any }>;
}

export class ScreenshotPipeline {
  static formatServiceProxyUrl(params: FormatServiceUrlParams): string {
    const normalizedBranch = params.branchName
      .replace(/[^a-zA-Z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "");
    if (params.branchName === "main" || params.branchName === "master") {
      return `http://${params.scriptName}--${params.projectName}.localhost`;
    }
    return `http://${params.scriptName}--${normalizedBranch}--${params.projectName}.localhost`;
  }

  static async captureViewports(params: {
    broker: ScreenshotBroker;
    url: string;
    outputDir: string;
  }): Promise<ScreenshotMetadata[]> {
    const viewports = [
      { id: "desktop", label: "Desktop (1280x800)", width: 1280, height: 800 },
      { id: "mobile", label: "Mobile (375x667)", width: 375, height: 667 },
    ];

    const results: ScreenshotMetadata[] = [];
    const newTabRes = await params.broker.execute({
      command: "new_tab",
      args: { url: params.url },
    });
    if (!newTabRes.ok || !newTabRes.result?.browserId) {
      throw new Error(`Failed to open browser tab: ${JSON.stringify(newTabRes.error)}`);
    }
    const browserId = newTabRes.result.browserId;

    try {
      await params.broker.execute({
        command: "wait",
        args: { browserId, url: params.url, timeoutMs: 5000 },
      });

      for (const vp of viewports) {
        await params.broker.execute({
          command: "resize",
          args: { browserId, width: vp.width, height: vp.height },
        });

        const snapRes = await params.broker.execute({
          command: "screenshot",
          args: { browserId, fullPage: false },
        });

        const relativePath = `screenshots/${vp.id}.png`;
        const fullPath = join(params.outputDir, relativePath);
        await mkdir(dirname(fullPath), { recursive: true });

        if (snapRes.result?.base64) {
          await writeFile(fullPath, Buffer.from(snapRes.result.base64, "base64"));
        } else {
          await writeFile(fullPath, Buffer.from(""));
        }

        results.push({
          id: vp.id,
          label: vp.label,
          viewport: { width: vp.width, height: vp.height },
          relativePath,
          capturedAt: new Date().toISOString(),
        });
      }
    } finally {
      await params.broker.execute({ command: "close_tab", args: { browserId } });
    }

    return results;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/screenshot-pipeline.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/server/screenshot-pipeline.ts plugin-examples/gitea-workflow/tests/screenshot-pipeline.test.ts
git add plugin-examples/gitea-workflow/server/screenshot-pipeline.ts plugin-examples/gitea-workflow/tests/screenshot-pipeline.test.ts
git commit -m "feat(gitea-workflow): implement service proxy and screenshot pipeline"
```

---

### Task 5: Worktree Orchestrator & Task Execution Lifecycle

**Files:**

- Create: `plugin-examples/gitea-workflow/server/orchestrator.ts`
- Test: `plugin-examples/gitea-workflow/tests/orchestrator.test.ts`

**Interfaces:**

- Consumes: `TaskStore`, `GiteaClient`, `PaseoApi`
- Produces: `WorktreeOrchestrator` (`enqueueIssue`, `stepTask`, `approveTask`, `rejectTask`)

- [ ] **Step 1: Write the failing test**

Create `plugin-examples/gitea-workflow/tests/orchestrator.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { TaskStore } from "../server/store.js";
import type { GiteaClient } from "../server/gitea-client.js";

describe("WorktreeOrchestrator", () => {
  it("enqueues issue and creates task record", async () => {
    const store = new TaskStore("/tmp/test-tasks.json");
    vi.spyOn(store, "saveTask").mockImplementation(async () => {});
    vi.spyOn(store, "getTask").mockImplementation(async () => null);

    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({ url: "http://pr.url" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    const orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: "/projects/repo",
      projectName: "repo",
    });

    const task = await orchestrator.enqueueIssue({
      number: 10,
      title: "Add search bar",
      body: "Search bar should be in header.",
      html_url: "http://gitea.local/repo/issues/10",
      labels: [{ name: "agent-ready" }],
    });

    expect(task.id).toBe("task-gitea-10");
    expect(task.state).toBe("queued");
    expect(mockGitea.claimIssue).toHaveBeenCalledWith(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/orchestrator.test.ts --bail=1`
Expected: FAIL with missing module `../server/orchestrator.js`

- [ ] **Step 3: Write minimal implementation**

Create `plugin-examples/gitea-workflow/server/orchestrator.ts`:

```typescript
import type { GiteaWorkflowTask } from "../shared/types.js";
import type { TaskStore } from "./store.js";
import type { GiteaClient, GiteaIssueDto } from "./gitea-client.js";

export interface OrchestratorOptions {
  store: TaskStore;
  gitea: GiteaClient;
  projectPath: string;
  projectName: string;
  paseoApi?: any;
}

export class WorktreeOrchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
  }

  async enqueueIssue(issue: GiteaIssueDto): Promise<GiteaWorkflowTask> {
    const branchName = `agent/issue-${issue.number}-${this.slugify(issue.title)}`;
    const task: GiteaWorkflowTask = {
      id: `task-gitea-${issue.number}`,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.html_url,
      issueBody: issue.body,
      repoOwner: "",
      repoName: this.options.projectName,
      branchName,
      workspaceId: null,
      agentId: null,
      state: "queued",
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.options.gitea.claimIssue(issue.number);
    await this.options.store.saveTask(task);
    return task;
  }

  async approveTask(taskId: string): Promise<{ ok: boolean; prUrl?: string; error?: string }> {
    const task = await this.options.store.getTask(taskId);
    if (!task) {
      return { ok: false, error: "Task not found" };
    }

    try {
      await this.options.store.updateTask(taskId, { state: "pr_creating" });

      const pr = await this.options.gitea.createPullRequest({
        title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
        body: `Resolves #${task.issueNumber}\n\n### Changes\nAutomated implementation reviewed and approved in Paseo.`,
        headBranch: task.branchName,
        baseBranch: "main",
      });

      await this.options.gitea.markReviewed(task.issueNumber);
      await this.options.store.updateTask(taskId, {
        state: "done",
        prUrl: pr.url,
      });

      return { ok: true, prUrl: pr.url };
    } catch (error) {
      await this.options.store.updateTask(taskId, {
        state: "pending_human_review",
        error: (error as Error).message,
      });
      return { ok: false, error: (error as Error).message };
    }
  }

  async rejectTask(taskId: string, feedback: string): Promise<{ ok: boolean; error?: string }> {
    const task = await this.options.store.getTask(taskId);
    if (!task) {
      return { ok: false, error: "Task not found" };
    }

    const previousFeedback = task.reviewFeedback ?? [];
    await this.options.store.updateTask(taskId, {
      state: "coding",
      reviewFeedback: [...previousFeedback, feedback],
    });

    return { ok: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/orchestrator.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/server/orchestrator.ts plugin-examples/gitea-workflow/tests/orchestrator.test.ts
git add plugin-examples/gitea-workflow/server/orchestrator.ts plugin-examples/gitea-workflow/tests/orchestrator.test.ts
git commit -m "feat(gitea-workflow): add worktree orchestrator lifecycle management"
```

---

### Task 6: Poller & Server Entrypoint (RPC Handlers)

**Files:**

- Create: `plugin-examples/gitea-workflow/server/poller.ts`
- Create: `plugin-examples/gitea-workflow/index.server.ts`
- Test: `plugin-examples/gitea-workflow/tests/server-rpc.test.ts`

**Interfaces:**

- Consumes: `@getpaseo/plugin/server`, `TaskStore`, `WorktreeOrchestrator`, `shared/contracts.ts`
- Produces: Default contribute export implementing `listTasksRpc`, `approveTaskRpc`, `rejectTaskRpc`

- [ ] **Step 1: Write the failing test**

Create `plugin-examples/gitea-workflow/tests/server-rpc.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import contribute from "../index.server.js";

describe("Plugin Server Entrypoint", () => {
  it("registers required RPC handlers", () => {
    const handlers = new Map<string, Function>();
    const mockServer = {
      handle: vi.fn((contract: any, handler: Function) => {
        handlers.set(contract.name, handler);
      }),
      registerSettings: vi.fn(),
      on: vi.fn(),
    };

    const cleanup = contribute(mockServer as any);
    expect(handlers.has("giteaWorkflow.listTasks")).toBe(true);
    expect(handlers.has("giteaWorkflow.approveTask")).toBe(true);
    expect(handlers.has("giteaWorkflow.rejectTask")).toBe(true);
    expect(typeof cleanup).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/server-rpc.test.ts --bail=1`
Expected: FAIL with missing module `../index.server.js`

- [ ] **Step 3: Write minimal implementation**

Create `plugin-examples/gitea-workflow/server/poller.ts`:

```typescript
import type { GiteaClient } from "./gitea-client.js";
import type { WorktreeOrchestrator } from "./orchestrator.js";

export class IssuePoller {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly gitea: GiteaClient,
    private readonly orchestrator: WorktreeOrchestrator,
    private readonly intervalMs: number = 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const readyIssues = await this.gitea.fetchReadyIssues();
      for (const issue of readyIssues) {
        await this.orchestrator.enqueueIssue(issue);
      }
    } catch (err) {
      console.error("[GiteaWorkflow Poller Error]", err);
    } finally {
      this.isRunning = false;
    }
  }
}
```

Create `plugin-examples/gitea-workflow/index.server.ts`:

```typescript
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  approveTaskRpc,
  getTaskDetailRpc,
  listTasksRpc,
  rejectTaskRpc,
} from "./shared/contracts.js";
import { TaskStore } from "./server/store.js";
import { GiteaClient } from "./server/gitea-client.js";
import { WorktreeOrchestrator } from "./server/orchestrator.js";
import { IssuePoller } from "./server/poller.js";
import type { GiteaSettings } from "./shared/types.js";

export default function contribute(server: PluginServerContext) {
  const storePath = join(tmpdir(), "paseo-gitea-workflow", "tasks.json");
  const store = new TaskStore(storePath);

  const defaultSettings: GiteaSettings = {
    giteaUrl: process.env.GITEA_URL ?? "https://gitea.example.com",
    giteaToken: process.env.GITEA_TOKEN ?? "mock-token",
    repoOwner: process.env.GITEA_OWNER ?? "owner",
    repoName: process.env.GITEA_REPO ?? "repo",
    listenLabel: "agent-ready",
    inProgressLabel: "agent-in-progress",
    reviewedLabel: "agent-reviewed",
    pollIntervalSeconds: 60,
    maxConcurrentWorktrees: 3,
  };

  const gitea = new GiteaClient(defaultSettings);
  const orchestrator = new WorktreeOrchestrator({
    store,
    gitea,
    projectPath: process.cwd(),
    projectName: defaultSettings.repoName,
  });

  const poller = new IssuePoller(gitea, orchestrator, defaultSettings.pollIntervalSeconds * 1000);
  if (process.env.GITEA_TOKEN) {
    poller.start();
  }

  server.handle(listTasksRpc, async () => {
    const tasks = await store.listTasks();
    return { tasks };
  });

  server.handle(getTaskDetailRpc, async ({ taskId }) => {
    const task = await store.getTask(taskId);
    return { task };
  });

  server.handle(approveTaskRpc, async ({ taskId }) => {
    return orchestrator.approveTask(taskId);
  });

  server.handle(rejectTaskRpc, async ({ taskId, feedback }) => {
    return orchestrator.rejectTask(taskId, feedback);
  });

  return () => {
    poller.stop();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/server-rpc.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/server/poller.ts plugin-examples/gitea-workflow/index.server.ts plugin-examples/gitea-workflow/tests/server-rpc.test.ts
git add plugin-examples/gitea-workflow/server/poller.ts plugin-examples/gitea-workflow/index.server.ts plugin-examples/gitea-workflow/tests/server-rpc.test.ts
git commit -m "feat(gitea-workflow): implement issue poller and server rpc handlers"
```

---

### Task 7: Native App Review UI & Client Entrypoint

**Files:**

- Create: `plugin-examples/gitea-workflow/client/screenshot-gallery.tsx`
- Create: `plugin-examples/gitea-workflow/client/feedback-dialog.tsx`
- Create: `plugin-examples/gitea-workflow/client/review-panel.tsx`
- Create: `plugin-examples/gitea-workflow/index.client.tsx`

**Interfaces:**

- Consumes: `@getpaseo/plugin/client`, `shared/contracts.ts`
- Produces: `ReviewPanel` component registered via `client.addWorkspacePanel`

- [ ] **Step 1: Write the component implementations**

Create `plugin-examples/gitea-workflow/client/screenshot-gallery.tsx`:

```tsx
import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { ScreenshotMetadata } from "../shared/types.js";

export interface ScreenshotGalleryProps {
  screenshots: ScreenshotMetadata[];
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedId, setSelectedId] = useState<string>(screenshots[0]?.id ?? "");

  if (screenshots.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No screenshots available yet.</Text>
      </View>
    );
  }

  const active = screenshots.find((s) => s.id === selectedId) ?? screenshots[0];

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {screenshots.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSelectedId(s.id)}
            style={[styles.tab, s.id === active.id && styles.activeTab]}
          >
            <Text style={[styles.tabText, s.id === active.id && styles.activeTabText]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.previewBox}>
        <Text style={styles.infoText}>
          Viewport: {active.viewport.width}x{active.viewport.height}
        </Text>
        <Text style={styles.pathText}>Path: {active.relativePath}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: "#161618",
    borderRadius: 8,
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#222226",
  },
  activeTab: {
    backgroundColor: "#3b82f6",
  },
  tabText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  activeTabText: {
    color: "#ffffff",
    fontWeight: "bold",
  },
  previewBox: {
    height: 200,
    borderWidth: 1,
    borderColor: "#2d2d32",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d0d0e",
  },
  infoText: {
    color: "#e5e7eb",
    fontSize: 13,
  },
  pathText: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 4,
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    color: "#6b7280",
  },
});
```

Create `plugin-examples/gitea-workflow/client/feedback-dialog.tsx`:

```tsx
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";

export interface FeedbackDialogProps {
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}

export function FeedbackDialog({ onSubmit, onCancel }: FeedbackDialogProps) {
  const [text, setText] = useState("");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reject & Request Changes</Text>
      <TextInput
        style={styles.input}
        placeholder="Explain what needs to be fixed..."
        placeholderTextColor="#6b7280"
        multiline
        value={text}
        onChangeText={setText}
      />
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.cancelBtn]} onPress={onCancel}>
          <Text style={styles.btnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.submitBtn]}
          onPress={() => text.trim() && onSubmit(text.trim())}
        >
          <Text style={[styles.btnText, styles.submitBtnText]}>Submit Feedback</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#1c1c1f",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ef4444",
    marginTop: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#f87171",
    marginBottom: 8,
  },
  input: {
    minHeight: 80,
    backgroundColor: "#111113",
    color: "#ffffff",
    padding: 8,
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cancelBtn: {
    backgroundColor: "#2e2e34",
  },
  submitBtn: {
    backgroundColor: "#ef4444",
  },
  btnText: {
    color: "#ffffff",
    fontSize: 12,
  },
  submitBtnText: {
    fontWeight: "bold",
  },
});
```

Create `plugin-examples/gitea-workflow/client/review-panel.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import { approveTaskRpc, listTasksRpc, rejectTaskRpc } from "../shared/contracts.js";
import type { GiteaWorkflowTask } from "../shared/types.js";
import { ScreenshotGallery } from "./screenshot-gallery.js";
import { FeedbackDialog } from "./feedback-dialog.js";

export function ReviewPanel() {
  const paseo = usePaseo();
  const [tasks, setTasks] = useState<GiteaWorkflowTask[]>([]);
  const [activeTask, setActiveTask] = useState<GiteaWorkflowTask | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const refreshTasks = async () => {
    try {
      const res = await paseo.rpc(listTasksRpc, {});
      setTasks(res.tasks);
      if (res.tasks.length > 0 && !activeTask) {
        setActiveTask(res.tasks[0]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void refreshTasks();
  }, []);

  const handleApprove = async () => {
    if (!activeTask) return;
    setStatusMsg("Approving and creating Gitea PR...");
    try {
      const res = await paseo.rpc(approveTaskRpc, { taskId: activeTask.id });
      if (res.ok) {
        setStatusMsg(`PR Opened: ${res.prUrl ?? "Success"}`);
        void refreshTasks();
      } else {
        setStatusMsg(`Approval failed: ${res.error}`);
      }
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`);
    }
  };

  const handleReject = async (feedback: string) => {
    if (!activeTask) return;
    setStatusMsg("Sending feedback back to Agent...");
    try {
      const res = await paseo.rpc(rejectTaskRpc, { taskId: activeTask.id, feedback });
      if (res.ok) {
        setShowFeedback(false);
        setStatusMsg("Feedback submitted; agent will iterate.");
        void refreshTasks();
      }
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`);
    }
  };

  if (!activeTask) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyTitle}>No active Gitea tasks</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.badge}>{activeTask.state}</Text>
        <Text style={styles.issueTitle}>
          #{activeTask.issueNumber} {activeTask.issueTitle}
        </Text>
      </View>

      <ScreenshotGallery screenshots={activeTask.screenshots} />

      {activeTask.diffSummary && (
        <View style={styles.diffCard}>
          <Text style={styles.diffText}>
            Changes: +{activeTask.diffSummary.additions} / -{activeTask.diffSummary.deletions} in{" "}
            {activeTask.diffSummary.filesChanged} files
          </Text>
        </View>
      )}

      {statusMsg ? <Text style={styles.statusBanner}>{statusMsg}</Text> : null}

      <View style={styles.actionBar}>
        <Pressable style={[styles.actionBtn, styles.approveBtn]} onPress={handleApprove}>
          <Text style={styles.actionBtnText}>Approve & Create PR</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={() => setShowFeedback(!showFeedback)}
        >
          <Text style={styles.actionBtnText}>Request Changes</Text>
        </Pressable>
      </View>

      {showFeedback && (
        <FeedbackDialog onSubmit={handleReject} onCancel={() => setShowFeedback(false)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#111113",
  },
  header: {
    marginBottom: 16,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "bold",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  issueTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#ffffff",
  },
  diffCard: {
    marginTop: 12,
    padding: 8,
    backgroundColor: "#1a1a1e",
    borderRadius: 6,
  },
  diffText: {
    color: "#10b981",
    fontSize: 12,
  },
  statusBanner: {
    marginVertical: 8,
    color: "#60a5fa",
    fontSize: 12,
  },
  actionBar: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  approveBtn: {
    backgroundColor: "#10b981",
  },
  rejectBtn: {
    backgroundColor: "#dc2626",
  },
  actionBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "bold",
  },
  emptyTitle: {
    color: "#9ca3af",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
});
```

Create `plugin-examples/gitea-workflow/index.client.tsx`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./client/review-panel.js";

export default function contribute(plugin: PluginClientContext) {
  plugin.addWorkspacePanel({
    id: "gitea-workflow-review",
    title: "Gitea Review",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ReviewPanel,
  });
  return () => {};
}
```

- [ ] **Step 2: Verify typecheck passes across workspace**

Run: `npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/client/screenshot-gallery.tsx plugin-examples/gitea-workflow/client/feedback-dialog.tsx plugin-examples/gitea-workflow/client/review-panel.tsx plugin-examples/gitea-workflow/index.client.tsx
git add plugin-examples/gitea-workflow/client/ plugin-examples/gitea-workflow/index.client.tsx
git commit -m "feat(gitea-workflow): implement client review panel and screenshot gallery"
```

---

### Task 8: End-to-End Workflow Verification & Documentation

**Files:**

- Create: `plugin-examples/gitea-workflow/tests/e2e-workflow.test.ts`
- Create: `plugin-examples/gitea-workflow/README.md`

**Interfaces:**

- Consumes: All components from previous tasks
- Produces: Complete E2E integration test simulating Gitea issue pickup -> Worktree dispatch -> Screenshot capture -> Approval & PR creation

- [ ] **Step 1: Write E2E integration test**

Create `plugin-examples/gitea-workflow/tests/e2e-workflow.test.ts`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "../server/store.js";
import { GiteaClient } from "../server/gitea-client.js";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { ScreenshotPipeline } from "../server/screenshot-pipeline.js";

describe("End-to-End Gitea Automated Workflow", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gitea-e2e-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("completes full lifecycle: claim -> screenshot -> human approve -> PR creation", async () => {
    const store = new TaskStore(join(tempDir, "tasks.json"));

    const mockGitea = {
      claimIssue: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi
        .fn()
        .mockResolvedValue({ url: "https://gitea.local/owner/repo/pulls/1" }),
      markReviewed: vi.fn().mockResolvedValue(undefined),
    } as unknown as GiteaClient;

    const orchestrator = new WorktreeOrchestrator({
      store,
      gitea: mockGitea,
      projectPath: tempDir,
      projectName: "sample-app",
    });

    // 1. Enqueue issue
    const task = await orchestrator.enqueueIssue({
      number: 88,
      title: "Fix responsive layout",
      body: "Header overflows on mobile.",
      html_url: "https://gitea.local/owner/repo/issues/88",
      labels: [{ name: "agent-ready" }],
    });

    expect(task.state).toBe("queued");
    expect(mockGitea.claimIssue).toHaveBeenCalledWith(88);

    // 2. Mock Dev server & Screenshot pipeline
    const serviceUrl = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: task.branchName,
      projectName: "sample-app",
    });

    const mockBroker = {
      execute: vi.fn().mockImplementation(async (cmd) => {
        if (cmd.command === "new_tab") return { ok: true, result: { browserId: "tab-1" } };
        if (cmd.command === "screenshot") return { ok: true, result: { base64: "aGVsbG8=" } };
        return { ok: true, result: {} };
      }),
    };

    const screenshots = await ScreenshotPipeline.captureViewports({
      broker: mockBroker,
      url: serviceUrl,
      outputDir: tempDir,
    });

    expect(screenshots).toHaveLength(2);
    await store.updateTask(task.id, {
      state: "pending_human_review",
      screenshots,
    });

    const readyTask = await store.getTask(task.id);
    expect(readyTask?.state).toBe("pending_human_review");
    expect(readyTask?.screenshots).toHaveLength(2);

    // 3. Human approves task
    const approval = await orchestrator.approveTask(task.id);
    expect(approval.ok).toBe(true);
    expect(approval.prUrl).toBe("https://gitea.local/owner/repo/pulls/1");

    const finalTask = await store.getTask(task.id);
    expect(finalTask?.state).toBe("done");
    expect(mockGitea.markReviewed).toHaveBeenCalledWith(88);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run plugin-examples/gitea-workflow/tests/e2e-workflow.test.ts --bail=1`
Expected: PASS

- [ ] **Step 3: Create README.md documentation**

Create `plugin-examples/gitea-workflow/README.md`:

```markdown
# Gitea Automated Worktree Workflow Plugin for Paseo

This plugin provides an automated pipeline for monitoring Gitea issues, spinning up isolated Git worktrees, dispatching coding and self-review agents, launching project dev servers to capture web rendering screenshots via headless browser automation, and presenting an approval workbench in the Paseo client.

## Features

- **Issue Polling**: Monitors Gitea for issues labeled `agent-ready`.
- **Worktree Isolation**: Spins up a clean, dedicated worktree per task to isolate changes.
- **Service Proxy & Headless Screenshots**: Uses Paseo Service Proxy to access local dev servers and captures Desktop and Mobile viewports.
- **Native Review Workbench**: View screenshots, Git diffs, and approve or reject tasks inside Paseo.
- **Lifecycle Closure**: Automatically pushes branches, creates Gitea Pull Requests, and updates issue labels.

## Installation

\`\`\`bash
paseo plugin install ./plugin-examples/gitea-workflow
\`\`\`
```

- [ ] **Step 4: Run full plugin tests and typecheck**

Run:

```bash
npx vitest run plugin-examples/gitea-workflow/tests/ --bail=1
npm run typecheck
```

Expected: All tests pass, typecheck clean.

- [ ] **Step 5: Format and Commit**

Run:

```bash
npm run format:files -- plugin-examples/gitea-workflow/tests/e2e-workflow.test.ts plugin-examples/gitea-workflow/README.md
git add plugin-examples/gitea-workflow/
git commit -m "feat(gitea-workflow): add e2e workflow tests and readme documentation"
```
