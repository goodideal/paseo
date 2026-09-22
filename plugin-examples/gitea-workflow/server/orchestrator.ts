import type {
  PaseoWorkspaceCreateOptions,
  PaseoWorkspaceAgentCreateOptions,
} from "@getpaseo/client";
import type {
  GiteaWorkflowTask,
  ScreenshotMetadata,
  ResolvedProjectGitea,
} from "../shared/types.js";
import type { TaskStore } from "./store.js";
import type { GiteaClient, GiteaIssueDto } from "./gitea-client.js";
import type { GiteaClientPool } from "./client-pool.js";
import { ScreenshotPipeline, type ScreenshotBroker } from "./screenshot-pipeline.js";

export interface OrchestratorPaseoApi {
  workspaces?: {
    create: (options: PaseoWorkspaceCreateOptions) => Promise<{ id: string }>;
    ref?: (id: string) => {
      directory?: string | null;
      refresh?: () => Promise<{ workspaceDirectory?: string } | null>;
      agents?: {
        create: (
          options: PaseoWorkspaceAgentCreateOptions,
        ) => Promise<{ id: string; waitForFinish?: (timeoutMs?: number) => Promise<unknown> }>;
      };
    };
  };
  agents?: {
    ref?: (id: string) => {
      status?: string | null;
      refresh?: () => Promise<{ agent?: { status?: string } | null } | null>;
      waitForFinish?: (timeoutMs?: number) => Promise<unknown>;
    };
  };
  scripts?: {
    start: (options: { workspaceId: string; scriptName: string }) => Promise<void>;
    stop: (options: { workspaceId: string; scriptName: string }) => Promise<void>;
  };
}

export interface OrchestratorOptions {
  store: TaskStore;
  clientPool: GiteaClientPool;
  maxConcurrentWorktrees?: number;
  paseoApi?: OrchestratorPaseoApi;
  screenshotBroker?: ScreenshotBroker;
}

const ACTIVE_STATES = new Set(["worktree_creating", "coding", "self_review", "screenshotting"]);

export class WorktreeOrchestrator {
  private isProcessing = false;
  private activeJobs = new Set<Promise<unknown>>();

  constructor(private readonly options: OrchestratorOptions) {}

  setPaseoApi(api: OrchestratorPaseoApi): void {
    this.options.paseoApi = api;
  }

  get hasPaseoApi(): boolean {
    return Boolean(this.options.paseoApi);
  }

  private slugify(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
    return slug || "task";
  }

  async waitForIdle(): Promise<void> {
    while (this.activeJobs.size > 0) {
      await Promise.all(Array.from(this.activeJobs));
    }
  }

  getClientForProject(project: {
    baseUrl: string;
    token: string;
    repoOwner: string;
    repoName: string;
  }): GiteaClient {
    return this.options.clientPool.getClient({
      giteaUrl: project.baseUrl,
      giteaToken: project.token,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
    });
  }

  async enqueueIssue(
    project: ResolvedProjectGitea,
    issue: GiteaIssueDto,
  ): Promise<GiteaWorkflowTask> {
    const taskId = `task-${project.projectId}-gitea-${issue.number}`;
    const existing = await this.options.store.getTask(taskId);
    if (existing && existing.state !== "failed") {
      return existing;
    }

    const branchName = `agent/issue-${issue.number}-${this.slugify(issue.title)}`;
    const task: GiteaWorkflowTask = {
      id: taskId,
      projectId: project.projectId,
      projectPath: project.projectPath,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.html_url,
      issueBody: issue.body,
      giteaBaseUrl: project.baseUrl,
      giteaToken: project.token,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      branchName,
      workspaceId: null,
      agentId: null,
      state: "queued",
      screenshots: [],
      diffSummary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const client = this.getClientForProject(project);
    const listenLabelId = issue.labels?.find((l) => l.name === "agent-ready")?.id;
    await client.claimIssue(issue.number, listenLabelId);
    await this.options.store.saveTask(task);
    return task;
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const tasks = await this.options.store.listTasks();
      const maxPerProject = this.options.maxConcurrentWorktrees ?? 3;

      // 1. Reconcile in-flight tasks where agent finished but PR was not finalized
      await this.reconcileFinishedTasks(tasks);

      // 2. Schedule queued tasks
      const refreshedTasks = await this.options.store.listTasks();
      const activeByProject = new Map<string, number>();
      for (const t of refreshedTasks) {
        if (ACTIVE_STATES.has(t.state)) {
          const count = activeByProject.get(t.projectId) ?? 0;
          activeByProject.set(t.projectId, count + 1);
        }
      }

      const queuedTasks = refreshedTasks.filter((t) => t.state === "queued");
      for (const task of queuedTasks) {
        const activeCount = activeByProject.get(task.projectId) ?? 0;
        if (activeCount >= maxPerProject) {
          continue;
        }
        activeByProject.set(task.projectId, activeCount + 1);
        const job = this.executeTask(task);
        this.activeJobs.add(job);
        job.finally(() => this.activeJobs.delete(job));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async determineBaseBranch(projectPath: string): Promise<string> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      try {
        await execFileAsync("git", ["rev-parse", "--verify", "origin/develop"], {
          cwd: projectPath,
          timeout: 3000,
        });
        return "develop";
      } catch {
        await execFileAsync("git", ["rev-parse", "--verify", "develop"], {
          cwd: projectPath,
          timeout: 3000,
        });
        return "develop";
      }
    } catch {
      return "main";
    }
  }

  private async provisionWorkspace(task: GiteaWorkflowTask): Promise<string> {
    if (task.workspaceId) return task.workspaceId;
    if (this.options.paseoApi?.workspaces?.create) {
      try {
        const baseBranch = await this.determineBaseBranch(task.projectPath || process.cwd());
        const ws = await this.options.paseoApi.workspaces.create({
          source: {
            kind: "worktree",
            cwd: task.projectPath || process.cwd(),
            branchName: task.branchName,
            baseBranch,
          },
          title: `#${task.issueNumber} ${task.issueTitle}`,
        });
        return ws.id;
      } catch (err) {
        console.warn("[Orchestrator] Failed creating workspace, falling back:", err);
      }
    }
    return `ws-${task.issueNumber}`;
  }

  private async dispatchAgent(
    task: GiteaWorkflowTask,
    workspaceId: string,
  ): Promise<{ id: string; agentHandle?: unknown }> {
    if (task.agentId) return { id: task.agentId };
    if (this.options.paseoApi?.workspaces?.ref) {
      try {
        const prompt = task.reviewFeedback?.length
          ? `Feedback from reviewer:\n${task.reviewFeedback.join("\n")}\nPlease address this feedback, run tests to verify, stage and commit your changes when complete.`
          : `Implement requirements for Gitea Issue #${task.issueNumber}: ${task.issueTitle}\n\n${task.issueBody}\n\nPlease follow project guidelines, implement the changes, run tests and verification, and ensure all acceptance criteria are met. When complete and all tests pass, stage and commit your changes with a clear conventional commit message (e.g., "fix(...): ... (#${task.issueNumber})").`;
        const wsRef = this.options.paseoApi.workspaces.ref(workspaceId);
        if (wsRef?.agents) {
          const agent = await wsRef.agents.create({
            config: {
              provider: "codex/gemini-flash",
              modeId: "full-access",
              thinkingOptionId: "high",
            },
            title: `[#${task.issueNumber}] ${task.issueTitle}`,
            prompt,
          });
          return { id: agent.id, agentHandle: agent };
        }
      } catch (err) {
        console.warn("[Orchestrator] Agent creation fallback:", err);
      }
    }
    return { id: `agent-${task.issueNumber}` };
  }

  private async resolveWorkspaceCwd(
    workspaceId: string,
    task: GiteaWorkflowTask,
  ): Promise<string | null> {
    if (this.options.paseoApi?.workspaces?.ref) {
      try {
        const wsRef = this.options.paseoApi.workspaces.ref(workspaceId);
        const ws = await wsRef.refresh?.();
        if (ws?.workspaceDirectory) return ws.workspaceDirectory;
        if (wsRef.directory) return wsRef.directory;
      } catch (err) {
        console.warn("[Orchestrator] Failed resolving workspace cwd:", err);
      }
    }
    return task.projectPath || null;
  }

  private async commitAndPushWorktree(cwd: string, task: GiteaWorkflowTask): Promise<void> {
    try {
      const { existsSync } = await import("node:fs");
      if (!existsSync(cwd)) return;

      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], {
        cwd,
        timeout: 10000,
      });

      if (statusOut.trim().length > 0) {
        await execFileAsync("git", ["add", "-A"], { cwd, timeout: 10000 });
        const commitMsg = `fix(#${task.issueNumber}): ${task.issueTitle}`;
        await execFileAsync("git", ["commit", "-m", commitMsg], { cwd, timeout: 10000 });
      }

      await execFileAsync("git", ["push", "-u", "origin", task.branchName], {
        cwd,
        timeout: 30000,
      });
    } catch (err) {
      console.warn("[Orchestrator] Failed commitAndPushWorktree:", err);
    }
  }

  private async captureTaskScreenshots(
    task: GiteaWorkflowTask,
    workspaceId: string,
  ): Promise<ScreenshotMetadata[]> {
    if (!this.options.screenshotBroker) return task.screenshots;

    const serviceUrl = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: task.branchName,
      projectName: task.repoName,
    });

    try {
      if (this.options.paseoApi?.scripts) {
        await this.options.paseoApi.scripts
          .start({
            workspaceId,
            scriptName: "dev",
          })
          .catch(() => {});
      }

      return await ScreenshotPipeline.captureViewports({
        broker: this.options.screenshotBroker,
        url: serviceUrl,
        outputDir: task.projectPath || process.cwd(),
      });
    } catch (err) {
      console.warn("[Orchestrator] Screenshot capture failed:", err);
      return task.screenshots;
    } finally {
      if (this.options.paseoApi?.scripts) {
        await this.options.paseoApi.scripts
          .stop({
            workspaceId,
            scriptName: "dev",
          })
          .catch(() => {});
      }
    }
  }

  private async reconcileFinishedTasks(tasks: GiteaWorkflowTask[]): Promise<void> {
    const pendingTasks = tasks.filter(
      (t) => t.state === "coding" && !t.prUrl && t.workspaceId && t.agentId,
    );

    for (const task of pendingTasks) {
      if (!this.options.paseoApi?.agents?.ref) continue;
      try {
        const agentRef = this.options.paseoApi.agents.ref(task.agentId!);
        const res = await agentRef.refresh?.();
        if (res?.agent?.status === "idle") {
          await this.finalizeTaskPr(task, task.workspaceId!);
        }
      } catch (err) {
        console.warn(`[Orchestrator] Failed reconciling task ${task.id}:`, err);
      }
    }
  }

  private async finalizeTaskPr(task: GiteaWorkflowTask, workspaceId: string): Promise<void> {
    // 1. Auto commit and push to remote
    const workspaceCwd = await this.resolveWorkspaceCwd(workspaceId, task);
    if (workspaceCwd) {
      await this.commitAndPushWorktree(workspaceCwd, task);
    }

    // 2. Open Pull Request on Gitea
    const client = this.getClientForProject({
      baseUrl: task.giteaBaseUrl,
      token: task.giteaToken ?? process.env.GITEA_TOKEN ?? "",
      repoOwner: task.repoOwner,
      repoName: task.repoName,
    });

    const baseBranch = await this.determineBaseBranch(task.projectPath || process.cwd());
    let prUrl = task.prUrl;
    try {
      const pr = await client.createPullRequest({
        title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
        body: `Resolves #${task.issueNumber}\n\n${task.issueTitle}\n\nAutomated implementation by Paseo Agent.`,
        headBranch: task.branchName,
        baseBranch,
      });
      prUrl = pr.url;
    } catch (prErr) {
      console.warn("[Orchestrator] PR creation error/warning:", prErr);
    }

    // 3. Update Gitea issue labels and comment with PR URL
    await client.markReviewed(task.issueNumber, { prUrl }).catch((err) => {
      console.warn("[Orchestrator] Failed marking reviewed on Gitea:", err);
    });

    // 4. Screenshotting Phase
    await this.options.store.updateTask(task.id, { state: "screenshotting" });
    const screenshots = await this.captureTaskScreenshots(task, workspaceId);

    // 5. Complete pipeline to pending human review with PR populated
    await this.options.store.updateTask(task.id, {
      screenshots,
      ...(prUrl ? { prUrl } : {}),
      state: "pending_human_review",
    });
  }

  async executeTask(task: GiteaWorkflowTask): Promise<void> {
    try {
      // 1. Worktree Creation
      await this.options.store.updateTask(task.id, { state: "worktree_creating" });
      const workspaceId = await this.provisionWorkspace(task);

      // 2. Coding Phase
      await this.options.store.updateTask(task.id, { workspaceId, state: "coding" });
      const { id: agentId, agentHandle } = await this.dispatchAgent(task, workspaceId);
      await this.options.store.updateTask(task.id, { agentId });

      const waitPromise = (async () => {
        try {
          if (
            agentHandle &&
            typeof (agentHandle as { waitForFinish?: (timeout?: number) => Promise<unknown> })
              .waitForFinish === "function"
          ) {
            try {
              await (
                agentHandle as { waitForFinish: (timeout?: number) => Promise<unknown> }
              ).waitForFinish(30 * 60_000);
            } catch (waitErr) {
              console.warn("[Orchestrator] Error waiting for agent finish:", waitErr);
            }
          }

          // 3. Self Review Phase
          await this.options.store.updateTask(task.id, {
            state: "self_review",
            diffSummary: { additions: 0, deletions: 0, filesChanged: 0 },
          });

          await this.finalizeTaskPr(task, workspaceId);
        } catch (bgErr) {
          console.error("[Orchestrator] Background task error:", bgErr);
          await this.options.store
            .updateTask(task.id, {
              state: "failed",
              error: (bgErr as Error).message,
            })
            .catch(() => {});
        }
      })();

      this.activeJobs.add(waitPromise);
      waitPromise.finally(() => this.activeJobs.delete(waitPromise));
    } catch (err) {
      await this.options.store.updateTask(task.id, {
        state: "failed",
        error: (err as Error).message,
      });
    }
  }

  async approveTask(taskId: string): Promise<{ ok: boolean; prUrl?: string; error?: string }> {
    const task = await this.options.store.getTask(taskId);
    if (!task) {
      return { ok: false, error: "Task not found" };
    }

    try {
      await this.options.store.updateTask(taskId, { state: "pr_creating" });

      const client = this.getClientForProject({
        baseUrl: task.giteaBaseUrl,
        token: task.giteaToken ?? process.env.GITEA_TOKEN ?? "",
        repoOwner: task.repoOwner,
        repoName: task.repoName,
      });

      let prUrl = task.prUrl;
      if (!prUrl) {
        const baseBranch = await this.determineBaseBranch(task.projectPath || process.cwd());
        const pr = await client.createPullRequest({
          title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
          body: `Resolves #${task.issueNumber}\n\n### Changes\nAutomated implementation reviewed and approved in Paseo.`,
          headBranch: task.branchName,
          baseBranch,
        });
        prUrl = pr.url;
      }

      await client.markReviewed(task.issueNumber, { prUrl });
      await this.options.store.updateTask(taskId, {
        state: "done",
        prUrl,
      });

      return { ok: true, prUrl };
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
    const updated = await this.options.store.updateTask(taskId, {
      state: "coding",
      reviewFeedback: [...previousFeedback, feedback],
    });

    const job = this.executeTask(updated);
    this.activeJobs.add(job);
    job.finally(() => this.activeJobs.delete(job));

    return { ok: true };
  }
}
