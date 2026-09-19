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
