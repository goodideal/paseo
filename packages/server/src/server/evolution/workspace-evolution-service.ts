import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { summarizeAgentMilestone, type StoredAgentLike } from "./agent-milestone-summarizer.js";
import type {
  AgentMilestoneRecord,
  OverallEvolutionStatus,
  WorkspaceEvolutionDigest,
} from "@getpaseo/protocol/evolution";

export interface WorkspaceRecordLike {
  workspaceId: string;
  displayName?: string | null;
  title?: string | null;
  branch?: string | null;
  cwd?: string | null;
}

export interface WorkspaceEvolutionServiceDeps {
  cacheRoot: string;
  agentStorage: {
    list(): Promise<StoredAgentLike[]>;
    get(agentId: string): Promise<StoredAgentLike | null>;
  };
  workspaceRegistry: {
    get(workspaceId: string): Promise<WorkspaceRecordLike | null>;
  };
  logger?: Logger;
  onEvolutionUpdated?: (workspaceId: string, digest: WorkspaceEvolutionDigest) => void;
}

export class WorkspaceEvolutionService {
  private readonly cacheRoot: string;
  private readonly agentStorage: WorkspaceEvolutionServiceDeps["agentStorage"];
  private readonly workspaceRegistry: WorkspaceEvolutionServiceDeps["workspaceRegistry"];
  private readonly logger?: Logger;
  private readonly onEvolutionUpdated?: WorkspaceEvolutionServiceDeps["onEvolutionUpdated"];

  constructor(deps: WorkspaceEvolutionServiceDeps) {
    this.cacheRoot = deps.cacheRoot;
    this.agentStorage = deps.agentStorage;
    this.workspaceRegistry = deps.workspaceRegistry;
    this.logger = deps.logger?.child?.({ component: "workspace-evolution-service" });
    this.onEvolutionUpdated = deps.onEvolutionUpdated;
  }

  private workspaceDir(workspaceId: string): string {
    return path.join(this.cacheRoot, workspaceId);
  }

  private digestPath(workspaceId: string): string {
    return path.join(this.workspaceDir(workspaceId), "digest.json");
  }

  private agentMilestonePath(workspaceId: string, agentId: string): string {
    return path.join(this.workspaceDir(workspaceId), "agents", `${agentId}.json`);
  }

  async getDigest(
    workspaceId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<WorkspaceEvolutionDigest | null> {
    const digestFile = this.digestPath(workspaceId);

    if (!options?.forceRefresh) {
      try {
        const raw = await fs.readFile(digestFile, "utf8");
        const cached = JSON.parse(raw) as WorkspaceEvolutionDigest;
        if (cached && cached.workspaceId === workspaceId) {
          return cached;
        }
      } catch {
        // Cache miss or read failure, proceed to build
      }
    }

    return this.rebuildDigest(workspaceId);
  }

  async recordAgentCompletion(agentId: string): Promise<void> {
    try {
      const agent = await this.agentStorage.get(agentId);
      if (!agent || !agent.workspaceId) return;

      const digest = await this.rebuildDigest(agent.workspaceId);
      if (digest && this.onEvolutionUpdated) {
        this.onEvolutionUpdated(agent.workspaceId, digest);
      }
    } catch (err) {
      this.logger?.warn?.({ err, agentId }, "Failed to record agent completion for evolution");
    }
  }

  private async rebuildDigest(workspaceId: string): Promise<WorkspaceEvolutionDigest | null> {
    const workspace = await this.workspaceRegistry.get(workspaceId);
    const workspaceTitle = workspace?.title || workspace?.displayName || workspaceId;
    const branch = workspace?.branch || "main";

    const allAgents = await this.agentStorage.list();
    const workspaceAgents = allAgents.filter((a) => {
      if (a.workspaceId === workspaceId) return true;
      if (workspace?.cwd && a.cwd === workspace.cwd) return true;
      return false;
    });

    // Sort ascending by creation time
    workspaceAgents.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const milestones: AgentMilestoneRecord[] = [];

    for (const agent of workspaceAgents) {
      const milestoneFile = this.agentMilestonePath(workspaceId, agent.id);
      let milestone: AgentMilestoneRecord | null = null;

      const isCompleted = agent.archivedAt != null || agent.lastStatus === "idle";

      if (isCompleted) {
        try {
          const raw = await fs.readFile(milestoneFile, "utf8");
          milestone = JSON.parse(raw) as AgentMilestoneRecord;
        } catch {
          // not in cache yet
        }
      }

      if (!milestone) {
        milestone = summarizeAgentMilestone(agent);
        if (isCompleted) {
          await writeJsonFileAtomic(milestoneFile, milestone).catch((err) => {
            this.logger?.warn?.({ err, agentId: agent.id }, "Failed to cache agent milestone");
          });
        }
      }

      milestones.push(milestone);
    }

    let overallStatus: OverallEvolutionStatus = "completed";
    let currentStage = "已就绪";

    if (milestones.length > 0) {
      const hasRunning = milestones.some((m) => m.status === "running");
      const last = milestones[milestones.length - 1];

      if (hasRunning) {
        overallStatus = "in_progress";
        currentStage = `正在推进: ${last.intentPrompt}`;
      } else if (
        last.intentPrompt.toLowerCase().includes("review") ||
        last.intentPrompt.includes("审查") ||
        last.intentPrompt.includes("审计")
      ) {
        overallStatus = "ready_for_review";
        currentStage = "代码质量评审完成，待合流";
      } else {
        overallStatus = "completed";
        currentStage = `已完成阶段: ${last.intentPrompt}`;
      }
    }

    const executiveSummary =
      milestones.length === 0
        ? "当前工作区尚未记录到智能体运作历史。"
        : `本工作区已历经 ${milestones.length} 个智能体运作阶段。当前演进状态：${currentStage}。`;

    const digest: WorkspaceEvolutionDigest = {
      workspaceId,
      workspaceTitle,
      branch,
      executiveSummary,
      currentStage,
      overallStatus,
      updatedAt: new Date().toISOString(),
      milestones,
    };

    await writeJsonFileAtomic(this.digestPath(workspaceId), digest).catch((err) => {
      this.logger?.warn?.({ err, workspaceId }, "Failed to save workspace evolution digest");
    });

    return digest;
  }
}
