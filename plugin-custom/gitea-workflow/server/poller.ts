import type { ProjectGiteaResolver } from "./resolver.js";
import type { GiteaClientPool } from "./client-pool.js";
import type { SettingsManager } from "./settings-manager.js";
import type { IssueRunIndexStore } from "./store.js";
import type { PaseoWorkflowActions } from "@getpaseo/client";

export interface PaseoProjectItem {
  projectId: string;
  projectRootPath: string;
  projectDisplayName?: string;
  projectKind?: string;
}

export interface MultiProjectPollerOptions {
  settings: SettingsManager;
  resolver: ProjectGiteaResolver;
  clientPool: GiteaClientPool;
  indexStore: IssueRunIndexStore;
  getWorkflows: () => PaseoWorkflowActions | undefined;
  getProjects: () => Promise<PaseoProjectItem[]>;
  intervalMs?: number;
}

export class MultiProjectPoller {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly options: MultiProjectPollerOptions) {}

  start(): void {
    if (this.timer) return;
    const interval = Math.max(
      10_000,
      (this.options.settings.current.pollIntervalSeconds ?? 60) * 1000,
    );
    this.timer = setInterval(() => void this.poll(), interval);
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
    if (!this.options.settings.current.enabled) return;

    const workflows = this.options.getWorkflows();
    if (!workflows) return;

    this.isRunning = true;
    try {
      const allProjects = await this.options.getProjects();
      const authorizedProjects = allProjects.filter(
        (p) => p.projectKind === "git" && this.options.settings.isProjectAuthorized(p.projectId),
      );

      for (const project of authorizedProjects) {
        try {
          const resolved = await this.options.resolver.resolveProject(project);
          if (!resolved || !resolved.token || resolved.authSource === "anonymous") {
            continue;
          }

          const readyLabel = this.options.settings.getReadyLabel(project.projectId);
          const policy = this.options.settings.getWorkflowPolicy(project.projectId);

          const client = this.options.clientPool.getClient({
            giteaUrl: resolved.baseUrl,
            giteaToken: resolved.token,
            repoOwner: resolved.repoOwner,
            repoName: resolved.repoName,
            listenLabel: readyLabel,
          });

          const readyIssues = await client.fetchReadyIssues();
          for (const issue of readyIssues) {
            const alreadyHasRun = await this.options.indexStore.hasActiveRunForIssue(
              project.projectId,
              resolved.repoOwner,
              resolved.repoName,
              issue.number,
            );
            if (alreadyHasRun) continue;

            const presetId =
              policy === "issue_preapproved"
                ? "gitea.issue-to-pr.preapproved"
                : policy === "unattended"
                  ? "gitea.issue-to-pr.unattended"
                  : "gitea.issue-to-pr";

            const createRes = await workflows.runCreate({
              projectId: project.projectId,
              workspaceId: project.projectId,
              workflowId: presetId,
              input: {
                baseUrl: resolved.baseUrl,
                repoOwner: resolved.repoOwner,
                repoName: resolved.repoName,
                issueNumber: issue.number,
                issueTitle: issue.title,
                issueBody: issue.body,
                listenLabel: readyLabel,
                policy,
              },
            });

            if (createRes.runId) {
              await this.options.indexStore.recordRun({
                projectId: project.projectId,
                repoOwner: resolved.repoOwner,
                repoName: resolved.repoName,
                issueNumber: issue.number,
                runId: createRes.runId,
              });
            }
          }
        } catch (err) {
          console.error(`[MultiProjectPoller] Error polling project ${project.projectId}:`, err);
        }
      }
    } catch (fatalErr) {
      console.error("[MultiProjectPoller Fatal Error]", fatalErr);
    } finally {
      this.isRunning = false;
    }
  }
}
