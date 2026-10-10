import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import {
  type PetDashboardSnapshot,
  type PetTaskState,
  type TrackedTask,
  type PendingDecision,
  type PetPriority,
  computeTaskPriority,
} from "../shared/types.js";

export class DesktopPetAgentProjection {
  private readonly agents = new Map<string, AgentSnapshotPayload>();
  private xp = 0;
  private level = 1;

  public setXpAndLevel(xp: number, level: number): void {
    this.xp = xp;
    this.level = level;
  }

  public handleSnapshot(agents: AgentSnapshotPayload[]): void {
    this.agents.clear();
    for (const agent of agents) {
      if (agent.status !== "closed" && !agent.archivedAt) {
        this.agents.set(agent.id, agent);
      }
    }
  }

  public handleUpdate(agent: AgentSnapshotPayload): void {
    if (agent.status === "closed" || agent.archivedAt) {
      this.agents.delete(agent.id);
    } else {
      this.agents.set(agent.id, agent);
    }
  }

  public handleRemove(agentId: string): void {
    this.agents.delete(agentId);
  }

  public getSnapshot(now: number = Date.now()): PetDashboardSnapshot {
    let runningCount = 0;
    let waitingCount = 0;
    let errorCount = 0;
    const tasks: TrackedTask[] = [];

    for (const agent of this.agents.values()) {
      const taskTitle =
        agent.title && agent.title.trim().length > 0
          ? agent.title.trim()
          : `未命名 agent · ${agent.id.slice(0, 6)}`;

      let state: PetTaskState = "IDLE";
      let startTimeMs: number | null = null;
      let pendingDecision: PendingDecision | undefined;

      const rawAgent = agent as any;
      if (agent.pendingPermissions && agent.pendingPermissions.length > 0) {
        state = "WAITING_DECISION";
        waitingCount++;
        const earliestPermission = agent.pendingPermissions[0] as any;
        if (earliestPermission.requestedAt) {
          startTimeMs = new Date(earliestPermission.requestedAt).getTime();
        } else if (rawAgent.statusEnteredAt) {
          startTimeMs = new Date(rawAgent.statusEnteredAt).getTime();
        } else {
          startTimeMs = null;
        }

        const timeoutSec =
          typeof earliestPermission.timeoutSeconds === "number"
            ? earliestPermission.timeoutSeconds
            : 60;
        const requestedAt = startTimeMs ?? now;
        const expiresAt = requestedAt + timeoutSec * 1000;

        pendingDecision = {
          requestId: earliestPermission.id,
          actionRequested:
            earliestPermission.kind === "shell"
              ? earliestPermission.command
              : earliestPermission.kind || "permission",
          riskHint: earliestPermission.riskHint || "medium",
          requestedAt,
          timeoutSeconds: timeoutSec,
          expiresAt,
        };
      } else if (agent.status === "initializing") {
        state = "STARTING";
        startTimeMs = rawAgent.statusEnteredAt
          ? new Date(rawAgent.statusEnteredAt).getTime()
          : new Date(agent.createdAt).getTime();
      } else if (agent.status === "running") {
        state = "RUNNING";
        runningCount++;
        startTimeMs = agent.activeTurn?.startedAt
          ? new Date(agent.activeTurn.startedAt).getTime()
          : rawAgent.statusEnteredAt
            ? new Date(rawAgent.statusEnteredAt).getTime()
            : null;
      } else if (agent.status === "idle") {
        state = "IDLE";
        startTimeMs = rawAgent.statusEnteredAt
          ? new Date(rawAgent.statusEnteredAt).getTime()
          : null;
      } else {
        state = "ERROR";
        errorCount++;
        startTimeMs = rawAgent.statusEnteredAt
          ? new Date(rawAgent.statusEnteredAt).getTime()
          : null;
      }

      const activeDurationMs =
        startTimeMs !== null && !Number.isNaN(startTimeMs) ? Math.max(0, now - startTimeMs) : null;

      const priority = computeTaskPriority({ state, pendingDecision });

      tasks.push({
        agentId: agent.id,
        taskTitle,
        state,
        priority,
        startedAt: startTimeMs,
        activeDurationMs,
        ...(pendingDecision ? { pendingDecision } : {}),
      });
    }

    // Stable sort: P0 > P1 > P2
    // P0: shortest remaining expiration first
    // P1: longest running duration first
    const priorityWeight: Record<PetPriority, number> = { P0: 0, P1: 1, P2: 2 };
    tasks.sort((a, b) => {
      const diff = priorityWeight[a.priority] - priorityWeight[b.priority];
      if (diff !== 0) return diff;
      if (a.priority === "P0" && a.pendingDecision && b.pendingDecision) {
        return (a.pendingDecision.expiresAt || 0) - (b.pendingDecision.expiresAt || 0);
      }
      if (a.priority === "P1") {
        return (b.activeDurationMs || 0) - (a.activeDurationMs || 0);
      }
      return 0;
    });

    let petMood: "idle" | "running" | "waiting" | "urgent" | "celebrating" | "dizzy" = "idle";
    if (waitingCount > 0) {
      const hasUrgent = tasks.some(
        (t) =>
          t.priority === "P0" &&
          (t.pendingDecision?.riskHint === "high" ||
            (t.pendingDecision?.expiresAt && t.pendingDecision.expiresAt - now < 30000)),
      );
      petMood = hasUrgent ? "urgent" : "waiting";
    } else if (runningCount > 0) {
      petMood = "running";
    } else if (errorCount > 0) {
      petMood = "dizzy";
    } else {
      petMood = "idle";
    }

    return {
      petMood,
      runningCount,
      waitingCount,
      stoppedCount: 0,
      petXp: this.xp,
      petLevel: this.level,
      xpToNextLevel: 500,
      tasks,
    };
  }
}
