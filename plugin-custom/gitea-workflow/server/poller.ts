import type { ProjectGiteaResolver } from "./resolver.js";
import type { GiteaClientPool } from "./client-pool.js";
import type { SettingsManager } from "./settings-manager.js";
import type { IssueRunIndexStore } from "./store.js";
import type { PaseoWorkflowActions, PaseoWorkspaceActions } from "@getpaseo/client";
import { resolveIssueWorkflowPreset } from "./preset-resolver.js";

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
  getWorkspaces?: () => PaseoWorkspaceActions | undefined;
  resolveWorkspace?: (project: PaseoProjectItem) => Promise<string | null>;
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

  async resolveWorkspaceId(project: PaseoProjectItem): Promise<string | null> {
    if (this.options.resolveWorkspace) {
      return this.options.resolveWorkspace(project);
    }

    const workspaces = this.options.getWorkspaces?.();
    if (!workspaces) return null;

    try {
      const list = await workspaces.list({ filter: { projectId: project.projectId } });
      const entries = list?.entries ?? [];
      const preferred =
        entries.find(
          (e) =>
            !e.archivingAt &&
            (e.workspaceKind === "local_checkout" || e.workspaceKind === "checkout"),
        ) ||
        entries.find((e) => !e.archivingAt) ||
        entries[0];

      if (preferred?.id) {
        return preferred.id;
      }
    } catch (err) {
      console.warn(
        `[MultiProjectPoller] Failed to list workspaces for project ${project.projectId}:`,
        err,
      );
    }

    if (project.projectRootPath) {
      try {
        const handle = await workspaces.open({ cwd: project.projectRootPath });
        if (handle?.id) {
          return handle.id;
        }
      } catch (err) {
        console.error(
          `[MultiProjectPoller] Failed to open workspace for project ${project.projectId}:`,
          err,
        );
      }
    }

    return null;
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

          const workspaceId = await this.resolveWorkspaceId(project);
          if (!workspaceId) {
            console.warn(
              `[MultiProjectPoller] No active workspace found or opened for project ${project.projectId} (${project.projectDisplayName ?? project.projectRootPath}), skipping`,
            );
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
            const existingRunId = await this.options.indexStore.getRunIdForIssue(
              project.projectId,
              resolved.repoOwner,
              resolved.repoName,
              issue.number,
            );
            if (existingRunId) {
              try {
                const inspected = await workflows.runInspect?.({
                  projectId: project.projectId,
                  workspaceId,
                  runId: existingRunId,
                });
                if (
                  inspected?.run &&
                  (inspected.run.status === "running" ||
                    inspected.run.status === "waiting_approval")
                ) {
                  continue;
                }
              } catch {
                // inspect failed, proceed to clean and retry
              }
              await this.options.indexStore.removeRun(
                project.projectId,
                resolved.repoOwner,
                resolved.repoName,
                issue.number,
              );
            }

            const target = resolveIssueWorkflowPreset(issue.labels ?? []);
            const presetId = target
              ? target.presetId
              : policy === "issue_preapproved"
                ? "gitea.issue-to-pr.preapproved"
                : policy === "unattended"
                  ? "gitea.issue-to-pr.unattended"
                  : "gitea.issue-to-pr";
            const mode = target?.mode ?? (policy === "unattended" ? "auto" : "plan");
            const conflictWarning = target?.conflictWarning ?? false;

            const createRes = await workflows.runCreate({
              projectId: project.projectId,
              workspaceId,
              workflowId: presetId,
              input: {
                baseUrl: resolved.baseUrl,
                token: resolved.token,
                repoOwner: resolved.repoOwner,
                repoName: resolved.repoName,
                issueNumber: issue.number,
                issueTitle: issue.title,
                issueBody: issue.body,
                listenLabel: readyLabel,
                policy,
                mode,
                conflictWarning,
              },
            });

            if (createRes.runId) {
              await this.options.indexStore.recordRun({
                projectId: project.projectId,
                repoOwner: resolved.repoOwner,
                repoName: resolved.repoName,
                issueNumber: issue.number,
                runId: createRes.runId,
                baseUrl: resolved.baseUrl,
                token: resolved.token,
              });
            } else if (createRes.error) {
              console.error(
                `[MultiProjectPoller] Workflow run creation failed for ${resolved.repoOwner}/${resolved.repoName}#${issue.number}: ${createRes.error}`,
              );
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
