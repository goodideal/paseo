import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import {
  type PetDashboardSnapshot,
  type PetTaskState,
  type TrackedTask,
  type PendingDecision,
  type PetPriority,
  computeTaskPriority,
} from "../shared/types.js";

function evaluateRisk(action: string, explicitHint?: string): "low" | "medium" | "high" {
  if (explicitHint === "high" || explicitHint === "medium" || explicitHint === "low") {
    return explicitHint;
  }
  const normalized = action.toLowerCase();
  if (
    normalized.includes("rm -rf") ||
    normalized.includes("git push --force") ||
    normalized.includes("git reset --hard") ||
    normalized.includes("mkfs") ||
    normalized.includes("dd ") ||
    normalized.includes("chmod -r 777") ||
    normalized.includes("drop table") ||
    normalized.includes("truncate")
  ) {
    return "high";
  }
  if (
    normalized.startsWith("git status") ||
    normalized.startsWith("git log") ||
    normalized.startsWith("git diff") ||
    normalized.startsWith("ls") ||
    normalized.startsWith("read ") ||
    normalized.startsWith("npm test")
  ) {
    return "low";
  }
  return "medium";
}

function extractActionDescription(permission: any): string {
  if (!permission) return "未知权限请求";
  if (permission.detail) {
    if (permission.detail.type === "shell" && permission.detail.command) {
      return permission.detail.command;
    }
    if (permission.detail.command) {
      return permission.detail.command;
    }
    if (permission.detail.filePath) {
      return `${permission.detail.type || "file"}: ${permission.detail.filePath}`;
    }
  }
  if (permission.input && typeof permission.input.command === "string") {
    return permission.input.command;
  }
  if (permission.title && permission.title.trim().length > 0) {
    return permission.title;
  }
  if (permission.description && permission.description.trim().length > 0) {
    return permission.description;
  }
  if (permission.name && permission.name !== "execute") {
    return `${permission.name} (${permission.kind || "tool"})`;
  }
  return permission.kind || "tool";
}

function getNextLevelThreshold(level: number): number {
  if (level >= 5) return 6000;
  if (level === 4) return 3000;
  if (level === 3) return 1500;
  if (level === 2) return 600;
  return 200;
}

export class DesktopPetAgentProjection {
  private readonly agents = new Map<string, AgentSnapshotPayload>();
  private readonly permissionTimers = new Map<
    string,
    { requestedAt: number; expiresAt: number; timeoutSeconds: number }
  >();
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
    const activePermissionIds = new Set<string>();

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
        const permId = earliestPermission.id;
        activePermissionIds.add(permId);

        let timer = this.permissionTimers.get(permId);
        if (!timer) {
          const timeoutSec =
            typeof earliestPermission.timeoutSeconds === "number"
              ? earliestPermission.timeoutSeconds
              : 60;
          const reqAt = earliestPermission.requestedAt
            ? new Date(earliestPermission.requestedAt).getTime()
            : now;
          timer = {
            requestedAt: reqAt,
            expiresAt: reqAt + timeoutSec * 1000,
            timeoutSeconds: timeoutSec,
          };
          this.permissionTimers.set(permId, timer);
        }

        startTimeMs = timer.requestedAt;
        const actionRequested = extractActionDescription(earliestPermission);
        const riskHint = evaluateRisk(actionRequested, earliestPermission.riskHint);

        pendingDecision = {
          requestId: permId,
          actionRequested,
          riskHint,
          requestedAt: timer.requestedAt,
          timeoutSeconds: timer.timeoutSeconds,
          expiresAt: timer.expiresAt,
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

    // Prune stale timers
    for (const permId of this.permissionTimers.keys()) {
      if (!activePermissionIds.has(permId)) {
        this.permissionTimers.delete(permId);
      }
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
    } else if (runningCount > 0 || tasks.some((t) => t.priority === "P1")) {
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
      xpToNextLevel: getNextLevelThreshold(this.level),
      tasks,
    };
  }
}
