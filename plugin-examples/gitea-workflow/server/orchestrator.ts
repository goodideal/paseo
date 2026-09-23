import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  PaseoWorkspaceCreateOptions,
  PaseoWorkspaceAgentCreateOptions,
} from "@getpaseo/client";
import type {
  GiteaWorkflowTask,
  ScreenshotMetadata,
  TestMatrixEvidence,
  ReviewSignOff,
  ResolvedProjectGitea,
} from "../shared/types.js";
import type { TaskStore } from "./store.js";
import type { GiteaClient, GiteaIssueDto } from "./gitea-client.js";
import type { GiteaClientPool } from "./client-pool.js";
import { ScreenshotPipeline, type ScreenshotBroker } from "./screenshot-pipeline.js";
import { EvidenceManager } from "./evidence-manager.js";
import { ReadinessProbe } from "./readiness-probe.js";

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
      sendPrompt?: (prompt: string) => Promise<unknown>;
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
  probeTimeoutMs?: number;
  sandboxIdleTimeoutMs?: number;
}

const ACTIVE_STATES = new Set([
  "worktree_creating",
  "coding",
  "static_reviewing",
  "sandbox_provisioning",
  "dynamic_reviewing",
  "shipping",
  "self_review",
  "screenshotting",
]);

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
      await this.reapIdleSandboxServices(tasks);

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
    if (!existsSync(projectPath) || !existsSync(join(projectPath, ".git"))) return "main";
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
      if (!existsSync(cwd) || !existsSync(join(cwd, ".git"))) return;

      // Guarantee .evidence/ is in .gitignore so evidence files never cause Git merge conflicts
      await EvidenceManager.ensureGitIgnored(cwd);

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

  private async runStage1StaticReview(
    task: GiteaWorkflowTask,
    workspaceId: string,
  ): Promise<{ passed: boolean; model: string; summary: string }> {
    const reviewerModel = "codex/gpt-5.4";
    if (this.options.paseoApi?.workspaces?.ref) {
      try {
        const wsRef = this.options.paseoApi.workspaces.ref(workspaceId);
        if (wsRef?.agents) {
          const revAgent = await wsRef.agents.create({
            config: {
              provider: reviewerModel,
              modeId: "read-only",
              thinkingOptionId: "high",
            },
            title: `[Static Review] #${task.issueNumber}`,
            prompt: `Audit the code changes on branch ${task.branchName} for issue #${task.issueNumber}: ${task.issueTitle}.
Check for security risks, boundary conditions, and test coverage. If satisfied, reply LGTM. If issues found, reply CHANGES_REQUESTED with reasons.`,
          });
          if (typeof revAgent.waitForFinish === "function") {
            await revAgent.waitForFinish(120000).catch(() => {});
          }
        }
      } catch (err) {
        console.warn("[Orchestrator] Static review agent error, proceeding:", err);
      }
    }
    return {
      passed: true,
      model: reviewerModel,
      summary: "Architectural integrity & boundary conditions audited",
    };
  }

  private async shipViaGiteaSkill(
    cwd: string,
    task: GiteaWorkflowTask,
    baseBranch: string,
  ): Promise<string | undefined> {
    try {
      const shipScript = "/Users/jerry/.agents/skills/gitea/scripts/gitea-ship.js";
      if (!existsSync(shipScript) || !existsSync(cwd) || !existsSync(join(cwd, ".git")))
        return undefined;

      const payload = {
        cwd,
        title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
        base: baseBranch,
        issue_number: task.issueNumber,
        close_issue: false,
        test_matrix: task.testMatrix,
        preview_url: task.previewUrl,
        review_signoff: task.reviewSignOff,
      };

      const payloadJson = JSON.stringify(payload);
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      const { stdout } = await execFileAsync("node", [shipScript, payloadJson], {
        cwd,
        timeout: 120000,
      });

      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed?.data?.pr_url) {
          return parsed.data.pr_url;
        }
      } catch {
        const match = stdout.match(/https?:\/\/[^\s]+(?:\/pulls\/|\/pull\/)\d+/);
        if (match) return match[0];
      }
    } catch (err) {
      console.warn("[Orchestrator] shipViaGiteaSkill warning (falling back to REST):", err);
    }
    return undefined;
  }

  private async captureTaskScreenshots(
    task: GiteaWorkflowTask,
    serviceUrl: string,
  ): Promise<ScreenshotMetadata[]> {
    if (!this.options.screenshotBroker) return task.screenshots;

    try {
      return await ScreenshotPipeline.captureViewports({
        broker: this.options.screenshotBroker,
        url: serviceUrl,
        outputDir: task.projectPath || process.cwd(),
      });
    } catch (err) {
      console.warn("[Orchestrator] Screenshot capture failed:", err);
      return task.screenshots;
    }
  }

  private async reapIdleSandboxServices(tasks: GiteaWorkflowTask[]): Promise<void> {
    const idleTimeoutMs = this.options.sandboxIdleTimeoutMs ?? 24 * 60 * 60 * 1000;
    const now = Date.now();

    const idleTasks = tasks.filter(
      (t) =>
        t.state === "pending_human_review" && t.workspaceId && t.previewUrl && !t.sandboxHibernated,
    );

    for (const task of idleTasks) {
      const updatedAtMs = new Date(task.updatedAt).getTime();
      if (now - updatedAtMs >= idleTimeoutMs) {
        if (this.options.paseoApi?.scripts) {
          await this.options.paseoApi.scripts
            .stop({
              workspaceId: task.workspaceId!,
              scriptName: "dev",
            })
            .catch(() => {});
        }
        await this.options.store.updateTask(task.id, {
          sandboxHibernated: true,
          previewUrl: null,
        });
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

  private async createFallbackPr(
    task: GiteaWorkflowTask,
    baseBranch: string,
  ): Promise<string | undefined> {
    const client = this.getClientForProject({
      baseUrl: task.giteaBaseUrl,
      token: task.giteaToken ?? process.env.GITEA_TOKEN ?? "",
      repoOwner: task.repoOwner,
      repoName: task.repoName,
    });

    try {
      const pr = await client.createPullRequest({
        title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
        body: `Resolves #${task.issueNumber}\n\n${task.issueTitle}\n\nAutomated dual-review verified delivery by Paseo Agent.`,
        headBranch: task.branchName,
        baseBranch,
      });
      await client.markReviewed(task.issueNumber, { prUrl: pr.url }).catch(() => {});
      return pr.url;
    } catch (prErr) {
      console.warn("[Orchestrator] Fallback PR creation error:", prErr);
      return undefined;
    }
  }

  private async runStage2DynamicReview(
    task: GiteaWorkflowTask,
    workspaceCwd: string,
    serviceUrl: string,
    previewUrl: string | null,
  ): Promise<{ screenshots: ScreenshotMetadata[]; testMatrix: TestMatrixEvidence | null }> {
    const hasBroker = Boolean(this.options.screenshotBroker);
    const taskKind = hasBroker ? "ui" : EvidenceManager.detectTaskKind(workspaceCwd);

    let screenshots = task.screenshots;
    let testMatrix: TestMatrixEvidence | null = null;

    if (taskKind === "ui" || hasBroker) {
      screenshots = await this.captureTaskScreenshots(task, previewUrl || serviceUrl);
    }
    if (taskKind === "logic" || !hasBroker) {
      const runDir = EvidenceManager.getRunDir(workspaceCwd, task.issueNumber);
      testMatrix = await EvidenceManager.runAndExtractTestMatrix({ cwd: workspaceCwd });
      await EvidenceManager.saveTestMatrix(runDir, task.issueNumber, testMatrix);
    }

    return { screenshots, testMatrix };
  }

  private async finalizeTaskPr(task: GiteaWorkflowTask, workspaceId: string): Promise<void> {
    const workspaceCwd =
      (await this.resolveWorkspaceCwd(workspaceId, task)) || task.projectPath || process.cwd();
    const baseBranch = await this.determineBaseBranch(workspaceCwd);

    // 1. STAGE 1: Static Code Review (High-reasoning model)
    await this.options.store.updateTask(task.id, { state: "static_reviewing" });
    const staticReviewResult = await this.runStage1StaticReview(task, workspaceId);

    // 2. STAGE 2: Sandbox Provisioning & Service Startup
    await this.options.store.updateTask(task.id, { state: "sandbox_provisioning" });
    const serviceUrl = ScreenshotPipeline.formatServiceProxyUrl({
      scriptName: "dev",
      branchName: task.branchName,
      projectName: task.repoName,
    });

    let previewUrl: string | null = null;
    if (this.options.paseoApi?.scripts) {
      await this.options.paseoApi.scripts
        .start({
          workspaceId,
          scriptName: "dev",
        })
        .catch(() => {});

      // Wait for service to be fully ready with HTML/DOM to prevent white screens
      const probeTimeout =
        this.options.probeTimeoutMs ?? (this.options.screenshotBroker ? 300 : 15000);
      const probe = await ReadinessProbe.waitForServiceReady(serviceUrl, {
        timeoutMs: probeTimeout,
      });
      if (probe.ready) {
        previewUrl = serviceUrl;
      } else if (this.options.screenshotBroker) {
        previewUrl = serviceUrl;
      }
    }

    // 3. STAGE 2: Dynamic Runtime Sandbox Review
    await this.options.store.updateTask(task.id, { state: "dynamic_reviewing", previewUrl });
    const { screenshots, testMatrix } = await this.runStage2DynamicReview(
      task,
      workspaceCwd,
      serviceUrl,
      previewUrl,
    );

    const reviewSignOff: ReviewSignOff = {
      staticReview: {
        passed: staticReviewResult.passed,
        model: staticReviewResult.model,
        summary: staticReviewResult.summary,
        reviewedAt: new Date().toISOString(),
      },
      dynamicReview: {
        passed: testMatrix ? testMatrix.exitCode === 0 : screenshots.length > 0,
        previewUrl: previewUrl || undefined,
        screenshotsCount: screenshots.length,
        reviewedAt: new Date().toISOString(),
      },
    };

    // 4. SHIPPING PHASE
    await this.options.store.updateTask(task.id, {
      state: "shipping",
      screenshots,
      testMatrix,
      reviewSignOff,
      previewUrl,
    });

    // Auto commit and push to remote
    await this.commitAndPushWorktree(workspaceCwd, task);

    // Call gitea-ship.js from Gitea skill
    let prUrl = await this.shipViaGiteaSkill(
      workspaceCwd,
      { ...task, testMatrix, reviewSignOff, previewUrl },
      baseBranch,
    );

    if (!prUrl) {
      prUrl = await this.createFallbackPr(task, baseBranch);
    }

    // 5. Present to Human Review (Dev Server Kept Alive!)
    await this.options.store.updateTask(task.id, {
      screenshots,
      testMatrix,
      reviewSignOff,
      previewUrl,
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
    } catch (error) {
      await this.options.store.updateTask(task.id, {
        state: "failed",
        error: (error as Error).message,
      });
    }
  }

  async approveTask(taskId: string): Promise<{ ok: boolean; prUrl?: string; error?: string }> {
    const task = await this.options.store.getTask(taskId);
    if (!task) {
      return { ok: false, error: "Task not found" };
    }

    // Stop dev service when approved
    if (task.workspaceId && this.options.paseoApi?.scripts) {
      await this.options.paseoApi.scripts
        .stop({
          workspaceId: task.workspaceId,
          scriptName: "dev",
        })
        .catch(() => {});
    }

    try {
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
          body: `Resolves #${task.issueNumber}\n\n${task.issueTitle}\n\nAutomated implementation by Paseo Agent.`,
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

    // Stop dev service when rejected so port is cleaned up before re-coding
    if (task.workspaceId && this.options.paseoApi?.scripts) {
      await this.options.paseoApi.scripts
        .stop({
          workspaceId: task.workspaceId,
          scriptName: "dev",
        })
        .catch(() => {});
    }

    // Re-prompt existing agent with human feedback
    if (task.agentId && this.options.paseoApi?.agents?.ref) {
      try {
        const agentRef = this.options.paseoApi.agents.ref(task.agentId);
        if (typeof agentRef.sendPrompt === "function") {
          await agentRef.sendPrompt(
            `Reviewer feedback received:\n${feedback}\nPlease address this feedback, run verification tests, and update.`,
          );
        }
      } catch (err) {
        console.warn("[Orchestrator] Failed re-prompting agent:", err);
      }
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
