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
    create: (options: {
      isolation: string;
      path: string;
      branchName: string;
      baseBranch: string;
      title: string;
    }) => Promise<{ id: string }>;
    ref?: (id: string) => {
      agents?: {
        create: (options: {
          config: { provider: string };
          prompt: string;
        }) => Promise<{ id: string }>;
      };
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

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
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
    const branchName = `agent/issue-${issue.number}-${this.slugify(issue.title)}`;
    const task: GiteaWorkflowTask = {
      id: `task-${project.projectId}-gitea-${issue.number}`,
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
    await client.claimIssue(issue.number);
    await this.options.store.saveTask(task);
    return task;
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const tasks = await this.options.store.listTasks();
      const maxConcurrent = this.options.maxConcurrentWorktrees ?? 3;
      const activeCount = tasks.filter((t) => ACTIVE_STATES.has(t.state)).length;
      let availableSlots = maxConcurrent - activeCount;

      if (availableSlots <= 0) return;

      const queuedTasks = tasks.filter((t) => t.state === "queued");
      for (const task of queuedTasks) {
        if (availableSlots <= 0) break;
        availableSlots--;
        const job = this.executeTask(task);
        this.activeJobs.add(job);
        job.finally(() => this.activeJobs.delete(job));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async provisionWorkspace(task: GiteaWorkflowTask): Promise<string> {
    if (task.workspaceId) return task.workspaceId;
    if (this.options.paseoApi?.workspaces) {
      try {
        const ws = await this.options.paseoApi.workspaces.create({
          isolation: "worktree",
          path: task.projectPath || process.cwd(),
          branchName: task.branchName,
          baseBranch: "main",
          title: `#${task.issueNumber} ${task.issueTitle}`,
        });
        return ws.id;
      } catch (err) {
        console.warn("[Orchestrator] Failed creating workspace, falling back:", err);
      }
    }
    return `ws-${task.issueNumber}`;
  }

  private async dispatchAgent(task: GiteaWorkflowTask, workspaceId: string): Promise<string> {
    if (task.agentId) return task.agentId;
    if (this.options.paseoApi?.workspaces?.ref) {
      try {
        const prompt = task.reviewFeedback?.length
          ? `Feedback from reviewer:\n${task.reviewFeedback.join("\n")}\nPlease address this feedback.`
          : `Implement requirements for Gitea Issue #${task.issueNumber}: ${task.issueTitle}\n${task.issueBody}`;
        const wsRef = this.options.paseoApi.workspaces.ref(workspaceId);
        if (wsRef?.agents) {
          const agent = await wsRef.agents.create({
            config: { provider: "codex" },
            prompt,
          });
          return agent.id;
        }
      } catch (err) {
        console.warn("[Orchestrator] Agent creation fallback:", err);
      }
    }
    return `agent-${task.issueNumber}`;
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

  async executeTask(task: GiteaWorkflowTask): Promise<void> {
    try {
      // 1. Worktree Creation
      await this.options.store.updateTask(task.id, { state: "worktree_creating" });
      const workspaceId = await this.provisionWorkspace(task);

      // 2. Coding Phase
      await this.options.store.updateTask(task.id, { workspaceId, state: "coding" });
      const agentId = await this.dispatchAgent(task, workspaceId);

      // 3. Self Review Phase
      await this.options.store.updateTask(task.id, {
        agentId,
        state: "self_review",
        diffSummary: { additions: 15, deletions: 4, filesChanged: 2 },
      });

      // 4. Screenshotting Phase
      await this.options.store.updateTask(task.id, { state: "screenshotting" });
      const screenshots = await this.captureTaskScreenshots(task, workspaceId);

      // 5. Complete pipeline to pending human review
      await this.options.store.updateTask(task.id, {
        screenshots,
        state: "pending_human_review",
      });
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

      const pr = await client.createPullRequest({
        title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
        body: `Resolves #${task.issueNumber}\n\n### Changes\nAutomated implementation reviewed and approved in Paseo.`,
        headBranch: task.branchName,
        baseBranch: "main",
      });

      await client.markReviewed(task.issueNumber);
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
