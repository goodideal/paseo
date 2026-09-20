import type { WorktreeOrchestrator } from "./orchestrator.js";
import type { ProjectGiteaResolver } from "./resolver.js";
import type { ResolvedProjectGitea } from "../shared/types.js";

export interface PaseoProjectItem {
  projectId: string;
  projectRootPath: string;
  projectDisplayName: string;
  projectKind: string;
}

export interface PaseoProjectsProvider {
  list: () => Promise<{ projects: PaseoProjectItem[] }>;
}

export class MultiProjectPoller {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private resolvedProjects = new Map<string, ResolvedProjectGitea>();

  constructor(
    private readonly resolver: ProjectGiteaResolver,
    private readonly orchestrator: WorktreeOrchestrator,
    private readonly projectsProvider?: PaseoProjectsProvider,
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

  async refreshProjects(): Promise<ResolvedProjectGitea[]> {
    if (!this.projectsProvider) return Array.from(this.resolvedProjects.values());
    try {
      const res = await this.projectsProvider.list();
      const gitProjects = res.projects.filter((p) => p.projectKind === "git");
      const resolvedList: ResolvedProjectGitea[] = [];

      for (const project of gitProjects) {
        const resolved = await this.resolver.resolveProject(project);
        if (resolved) {
          this.resolvedProjects.set(project.projectId, resolved);
          resolvedList.push(resolved);
        } else {
          this.resolvedProjects.delete(project.projectId);
        }
      }
      return resolvedList;
    } catch (err) {
      console.error("[MultiProjectPoller] Error listing projects:", err);
      return Array.from(this.resolvedProjects.values());
    }
  }

  async poll(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const projects = await this.refreshProjects();
      for (const project of projects) {
        try {
          const client = this.orchestrator.getClientForProject(project);
          const readyIssues = await client.fetchReadyIssues();
          for (const issue of readyIssues) {
            await this.orchestrator.enqueueIssue(project, issue);
          }
        } catch (err) {
          console.error(`[MultiProjectPoller] Error polling project ${project.projectName}:`, err);
        }
      }
      await this.orchestrator.processQueue();
    } catch (err) {
      console.error("[MultiProjectPoller Fatal Error]", err);
    } finally {
      this.isRunning = false;
    }
  }
}
