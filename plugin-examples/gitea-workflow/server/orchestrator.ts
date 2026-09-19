import type { GiteaWorkflowTask } from "../shared/types.js";
import type { TaskStore } from "./store.js";
import type { GiteaClient, GiteaIssueDto } from "./gitea-client.js";

export interface OrchestratorOptions {
  store: TaskStore;
  gitea: GiteaClient;
  projectPath: string;
  projectName: string;
  paseoApi?: unknown;
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
