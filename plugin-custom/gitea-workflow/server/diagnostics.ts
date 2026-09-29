import type { ProjectGiteaResolver } from "./resolver.js";
import type { GiteaClientPool } from "./client-pool.js";
import type { SettingsManager } from "./settings-manager.js";
import type { PaseoProjectItem } from "./poller.js";
import type { GiteaProjectDiagnostic } from "../shared/types.js";

export class DiagnosticsService {
  constructor(
    private readonly resolver: ProjectGiteaResolver,
    private readonly clientPool: GiteaClientPool,
    private readonly settings: SettingsManager,
  ) {}

  async diagnoseProjects(projects: PaseoProjectItem[]): Promise<GiteaProjectDiagnostic[]> {
    const results: GiteaProjectDiagnostic[] = [];
    for (const project of projects) {
      const authorized = this.settings.isProjectAuthorized(project.projectId);
      const readyLabel = this.settings.getReadyLabel(project.projectId);
      try {
        const resolved = await this.resolver.resolveProject(project);
        if (!resolved) {
          results.push({
            projectId: project.projectId,
            projectName: project.projectDisplayName || project.projectId,
            host: "",
            baseUrl: "",
            repoOwner: "",
            repoName: "",
            connectionStatus: "not_gitea",
            authSource: "none",
            authorized,
            readyLabel,
            errorMessage: "Not a recognized Gitea repository remote",
          });
          continue;
        }

        if (resolved.authSource === "anonymous" || !resolved.token) {
          results.push({
            projectId: project.projectId,
            projectName: resolved.projectName,
            host: resolved.host,
            baseUrl: resolved.baseUrl,
            repoOwner: resolved.repoOwner,
            repoName: resolved.repoName,
            connectionStatus: "unauthorized",
            authSource: "none",
            authorized,
            readyLabel,
            errorMessage: "No Gitea authentication token found via tea or environment",
          });
          continue;
        }

        let pendingIssueCount: number | undefined;
        let connectionStatus: GiteaProjectDiagnostic["connectionStatus"] = "connected";
        let errorMessage: string | undefined;

        try {
          const client = this.clientPool.getClient({
            giteaUrl: resolved.baseUrl,
            giteaToken: resolved.token,
            repoOwner: resolved.repoOwner,
            repoName: resolved.repoName,
            listenLabel: readyLabel,
          });
          const issues = await client.fetchReadyIssues();
          pendingIssueCount = issues.length;
        } catch (clientErr) {
          connectionStatus = "unreachable";
          errorMessage = (clientErr as Error).message;
        }

        results.push({
          projectId: project.projectId,
          projectName: resolved.projectName,
          host: resolved.host,
          baseUrl: resolved.baseUrl,
          repoOwner: resolved.repoOwner,
          repoName: resolved.repoName,
          connectionStatus,
          authSource: resolved.authSource,
          authorized,
          readyLabel,
          pendingIssueCount,
          errorMessage,
        });
      } catch (err) {
        results.push({
          projectId: project.projectId,
          projectName: project.projectDisplayName || project.projectId,
          host: "",
          baseUrl: "",
          repoOwner: "",
          repoName: "",
          connectionStatus: "unreachable",
          authSource: "none",
          authorized,
          readyLabel,
          errorMessage: (err as Error).message,
        });
      }
    }
    return results;
  }
}
