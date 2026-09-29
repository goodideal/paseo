import type { PendingDecision, PetDashboardSnapshot, TrackedTask } from "../shared/types.js";

interface InternalTask {
  agentId: string;
  taskTitle: string;
  startedAt: number;
  stoppedAt?: number;
  state: "RUNNING" | "WAITING_DECISION" | "STOPPED" | "IDLE";
  pendingDecision?: PendingDecision;
}

export class AgentTracker {
  private tasks = new Map<string, InternalTask>();
  private xp = 0;
  private level = 1;

  public setXpAndLevel(xp: number, level: number): void {
    this.xp = xp;
    this.level = level;
  }

  public startTask(agentId: string, title: string, now: number = Date.now()): void {
    this.tasks.set(agentId, {
      agentId,
      taskTitle: title,
      startedAt: now,
      state: "RUNNING",
    });
  }

  public recordPermissionRequest(params: {
    agentId: string;
    requestId: string;
    actionRequested: string;
    timeoutSeconds: number;
    now?: number;
  }): PendingDecision {
    const now = params.now ?? Date.now();
    const task = this.tasks.get(params.agentId) ?? {
      agentId: params.agentId,
      taskTitle: `Task ${params.agentId.slice(0, 6)}`,
      startedAt: now,
      state: "RUNNING" as const,
    };

    const expiresAt = now + params.timeoutSeconds * 1000;
    const isDangerous = /\b(rm\s+-rf|force-push|reset\s+--hard)\b/i.test(params.actionRequested);
    const riskHint = isDangerous ? "high" : "low";

    const decision: PendingDecision = {
      requestId: params.requestId,
      actionRequested: params.actionRequested,
      riskHint,
      requestedAt: now,
      timeoutSeconds: params.timeoutSeconds,
      expiresAt,
    };

    task.state = "WAITING_DECISION";
    task.pendingDecision = decision;
    this.tasks.set(params.agentId, task);
    return decision;
  }

  public resolvePermission(agentId: string, requestId: string, _now: number = Date.now()): void {
    const task = this.tasks.get(agentId);
    if (!task) return;
    if (task.pendingDecision?.requestId === requestId) {
      task.pendingDecision = undefined;
      task.state = "RUNNING";
    }
  }

  public stopTask(agentId: string, now: number = Date.now()): void {
    const task = this.tasks.get(agentId);
    if (!task) return;
    task.stoppedAt = now;
    task.state = "STOPPED";
    task.pendingDecision = undefined;
  }

  public getExpiredPendingDecisions(now: number = Date.now()): Array<{
    agentId: string;
    decision: PendingDecision;
  }> {
    const expired: Array<{ agentId: string; decision: PendingDecision }> = [];
    for (const [agentId, task] of this.tasks.entries()) {
      if (task.state === "WAITING_DECISION" && task.pendingDecision) {
        if (now >= task.pendingDecision.expiresAt) {
          expired.push({ agentId, decision: task.pendingDecision });
        }
      }
    }
    return expired;
  }

  public getSnapshot(now: number = Date.now()): PetDashboardSnapshot {
    let runningCount = 0;
    let waitingCount = 0;
    let stoppedCount = 0;
    const trackedTasks: TrackedTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.state === "RUNNING") runningCount++;
      else if (task.state === "WAITING_DECISION") waitingCount++;
      else if (task.state === "STOPPED") stoppedCount++;

      const endTimestamp = task.stoppedAt ?? now;
      const rawDuration = endTimestamp - task.startedAt;
      const activeDurationMs = Math.max(0, rawDuration);

      trackedTasks.push({
        agentId: task.agentId,
        taskTitle: task.taskTitle,
        state: task.state,
        startedAt: task.startedAt,
        activeDurationMs,
        pendingDecision: task.pendingDecision,
      });
    }

    return {
      runningCount,
      waitingCount,
      stoppedCount,
      petXp: this.xp,
      petLevel: this.level,
      tasks: trackedTasks,
    };
  }
}
