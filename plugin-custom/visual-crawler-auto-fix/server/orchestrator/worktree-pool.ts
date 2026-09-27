import type { FixDirective, WorkerSlot } from "../../shared/types.js";
import type { TaskStore } from "../store/task-store.js";

export interface WorktreeAdapter {
  createWorktree(branchName: string, worktreeSlug: string): Promise<{ worktreePath: string }>;
  removeWorktree(worktreePath: string): Promise<void>;
  dispatchCodingAgent(
    worktreePath: string,
    prompt: string,
  ): Promise<{ success: boolean; error?: string }>;
  runVerification(worktreePath: string): Promise<{ passed: boolean; output: string }>;
  pushAndCreatePr(branchName: string, title: string, body: string): Promise<{ prUrl: string }>;
}

export class WorktreeFixPool {
  private store: TaskStore;
  private adapter: WorktreeAdapter;
  private maxConcurrency: number;
  private queue: string[] = []; // Directive IDs
  private isProcessing = false;

  constructor(store: TaskStore, adapter: WorktreeAdapter, maxConcurrency = 3) {
    this.store = store;
    this.adapter = adapter;
    this.maxConcurrency = maxConcurrency;
    this.store.setConcurrency(maxConcurrency);
  }

  public enqueueDirective(directiveId: string): void {
    const directive = this.store.getDirective(directiveId);
    if (!directive) return;

    directive.status = "approved";
    directive.updatedAt = Date.now();
    this.store.upsertDirective(directive);

    if (!this.queue.includes(directiveId)) {
      this.queue.push(directiveId);
    }

    void this.processQueue();
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const idleSlot = this.findIdleSlot();
        if (!idleSlot) {
          // All slots busy, wait for a worker to finish
          break;
        }

        const directiveId = this.queue.shift();
        if (!directiveId) break;

        const directive = this.store.getDirective(directiveId);
        if (!directive || directive.status !== "approved") continue;

        // Run worker asynchronously in the background
        this.runWorker(idleSlot.slotIndex, directive).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.store.updateSlot(idleSlot.slotIndex, {
            status: "failed",
            logMessage: `Worker failed: ${msg}`,
          });
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private findIdleSlot(): WorkerSlot | undefined {
    return this.store.getSlots().find((s) => s.status === "idle");
  }

  private async runWorker(slotIndex: number, directive: FixDirective): Promise<void> {
    const branchName = `fix/crawler-${directive.id}-${Date.now().toString(36)}`;
    const portOffset = 3000 + slotIndex;

    directive.status = "in_progress";
    directive.branchName = branchName;
    directive.updatedAt = Date.now();
    this.store.upsertDirective(directive);

    // 1. Provision Worktree
    this.store.updateSlot(slotIndex, {
      status: "provisioning",
      currentDirectiveId: directive.id,
      branchName,
      startedAt: Date.now(),
      logMessage: `Creating Git Worktree for branch ${branchName}...`,
    });

    let worktreePath = "";
    try {
      const res = await this.adapter.createWorktree(
        branchName,
        `wt-slot-${slotIndex}-${directive.id}`,
      );
      worktreePath = res.worktreePath;

      this.store.updateSlot(slotIndex, {
        worktreePath,
        status: "coding",
        logMessage: `Agent fixing in worktree (Port: ${portOffset})...`,
      });

      // 2. Dispatch Coding Agent
      const agentPrompt = this.generatePrompt(directive, portOffset);
      const agentResult = await this.adapter.dispatchCodingAgent(worktreePath, agentPrompt);
      if (!agentResult.success) {
        throw new Error(agentResult.error || "Coding agent failed to resolve issue");
      }

      // 3. Run Verification Gate
      this.store.updateSlot(slotIndex, {
        status: "verifying",
        logMessage: "Running verification tests & typecheck...",
      });

      const verification = await this.adapter.runVerification(worktreePath);
      if (!verification.passed) {
        throw new Error(`Verification failed:\n${verification.output}`);
      }

      // 4. Push Branch & Create PR
      this.store.updateSlot(slotIndex, {
        status: "pr_created",
        logMessage: "Creating Pull Request...",
      });

      const prBody = this.generatePrBody(directive);
      const prResult = await this.adapter.pushAndCreatePr(branchName, directive.title, prBody);

      directive.status = "resolved";
      directive.prUrl = prResult.prUrl;
      directive.updatedAt = Date.now();
      this.store.upsertDirective(directive);

      this.store.updateSlot(slotIndex, {
        prUrl: prResult.prUrl,
        logMessage: `PR opened: ${prResult.prUrl}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      directive.status = "approved"; // Return to approved to allow re-run or inspection
      directive.updatedAt = Date.now();
      this.store.upsertDirective(directive);

      this.store.updateSlot(slotIndex, {
        status: "failed",
        logMessage: msg,
      });
      return;
    } finally {
      // Allow user to view final PR state for a short moment, then reset slot to idle
      setTimeout(() => {
        const slot = this.store.getSlots()[slotIndex];
        if (slot?.status === "pr_created") {
          this.store.updateSlot(slotIndex, {
            status: "idle",
            currentDirectiveId: undefined,
            prUrl: undefined,
            logMessage: undefined,
            startedAt: undefined,
          });
          void this.processQueue();
        }
      }, 500);
    }
  }

  private generatePrompt(directive: FixDirective, port: number): string {
    return [
      `# Autonomous Fix Task: ${directive.title}`,
      `Severity: ${directive.severity}`,
      `Category: ${directive.category}`,
      directive.sourceHint ? `Target File: ${directive.sourceHint.filePath}` : "",
      `Error Message: ${directive.errorDetails.message}`,
      directive.errorDetails.stack ? `Stack Trace:\n${directive.errorDetails.stack}` : "",
      `Suggested Fix: ${directive.suggestedFix}`,
      `Assigned Dev Server Port: ${port}`,
      "Requirements:",
      "1. Locate and fix the bug in the assigned repository workspace.",
      "2. Ensure clean compilation, linting, and no regressions.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private generatePrBody(directive: FixDirective): string {
    return [
      `## 🤖 Autonomous Fix: ${directive.title}`,
      `**Severity**: ${directive.severity} | **Category**: ${directive.category}`,
      `**Occurrences**: ${directive.occurrenceCount} across ${directive.affectedPages.length} routes.`,
      "",
      "### Issue Details",
      "```",
      directive.errorDetails.message,
      directive.errorDetails.stack || "",
      "```",
      "",
      "### Remediation",
      directive.suggestedFix,
      "",
      "---",
      "*Generated automatically by Paseo Visual Crawler & Fix Workflow*",
    ].join("\n");
  }
}
