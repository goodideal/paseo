import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AgentMilestoneRecord,
  AgentMilestoneStatus,
  OverallEvolutionStatus,
  WorkspaceEvolutionDigest,
} from "../shared/contracts.js";

export interface StoredAgentLike {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
  title?: string | null;
  status?: string | null;
  lastStatus?: string | null;
  labels?: Record<string, string> | null;
  parentAgentId?: string | null;
  model?: string | null;
  config?: {
    model?: string | null;
    systemPrompt?: string | null;
  } | null;
  runtimeInfo?: {
    model?: string | null;
  } | null;
  archivedAt?: string | null;
}

export interface WorkspaceRecordLike {
  id: string;
  title?: string | null;
  name?: string | null;
  branch?: string | null;
  cwd?: string | null;
}

function deriveMilestoneStatus(isError: boolean, isCompleted: boolean): AgentMilestoneStatus {
  if (isError) return "error";
  if (isCompleted) return "completed";
  return "running";
}

function deriveDecisionsAndSummary(intentPrompt: string): {
  executiveSummary: string;
  keyDecisions: string[];
} {
  const keyDecisions: string[] = [];
  const titleLower = intentPrompt.toLowerCase();

  const isResearch =
    titleLower.includes("调研") ||
    titleLower.includes("research") ||
    titleLower.includes("explore");

  const isReview =
    titleLower.includes("review") || titleLower.includes("审计") || titleLower.includes("审查");

  const isDebugOrStart =
    titleLower.includes("启动") ||
    titleLower.includes("start") ||
    titleLower.includes("debug") ||
    titleLower.includes("调试");

  if (isResearch) {
    keyDecisions.push("完成技术可行性评估并形成方案草案");
    keyDecisions.push("确立后续编码与改造设计标准");
    return {
      executiveSummary: `完成阶段性技术与架构调研：${intentPrompt}`,
      keyDecisions,
    };
  }

  if (isReview) {
    keyDecisions.push("完成代码规范、异常分支与边界逻辑核对");
    keyDecisions.push("验证测试覆盖与类型定义完备性");
    return {
      executiveSummary: `执行代码审查与质量门禁：${intentPrompt}`,
      keyDecisions,
    };
  }

  if (isDebugOrStart) {
    keyDecisions.push("验证本地依赖连通性与端口配置");
    keyDecisions.push("确保服务就绪并进入可测状态");
    return {
      executiveSummary: `完成本地服务启动与联调验证：${intentPrompt}`,
      keyDecisions,
    };
  }

  keyDecisions.push("落地核心业务逻辑改造并更新相关配置");
  keyDecisions.push("完成单元验证与状态收敛");
  return {
    executiveSummary: `推进工作区任务开发与实现：${intentPrompt}`,
    keyDecisions,
  };
}

export function summarizeAgentMilestone(agent: StoredAgentLike): AgentMilestoneRecord {
  const startedAt = agent.createdAt;
  const effectiveStatus = agent.status ?? agent.lastStatus;
  const isCompleted =
    agent.archivedAt != null || effectiveStatus === "idle" || effectiveStatus === "closed";
  const isError = effectiveStatus === "error";
  const status = deriveMilestoneStatus(isError, isCompleted);

  const completedAt = isCompleted ? (agent.updatedAt ?? agent.lastActivityAt ?? startedAt) : null;
  const durationMs = Math.max(
    0,
    new Date(completedAt ?? Date.now()).getTime() - new Date(startedAt).getTime(),
  );

  const intentPrompt = agent.title || agent.config?.systemPrompt || "执行工作区任务";
  const model = agent.model ?? agent.config?.model ?? agent.runtimeInfo?.model ?? null;
  const { executiveSummary, keyDecisions } = deriveDecisionsAndSummary(intentPrompt);

  return {
    agentId: agent.id,
    provider: agent.provider,
    model,
    startedAt,
    completedAt,
    durationMs,
    status,
    intentPrompt,
    executiveSummary,
    keyDecisions,
    modifiedFiles: [],
    commits: [],
  };
}

function resolveEvolutionStatus(milestones: AgentMilestoneRecord[]): {
  overallStatus: OverallEvolutionStatus;
  currentStage: string;
} {
  if (milestones.length === 0) {
    return { overallStatus: "completed", currentStage: "已就绪" };
  }

  const hasRunning = milestones.some((m) => m.status === "running");
  const current = milestones[0];

  if (hasRunning) {
    return {
      overallStatus: "in_progress",
      currentStage: `正在推进: ${current.intentPrompt}`,
    };
  }

  const lower = current.intentPrompt.toLowerCase();
  if (
    lower.includes("review") ||
    current.intentPrompt.includes("审查") ||
    current.intentPrompt.includes("审计")
  ) {
    return {
      overallStatus: "ready_for_review",
      currentStage: "代码质量评审完成，待合流",
    };
  }

  return {
    overallStatus: "completed",
    currentStage: `已完成阶段: ${current.intentPrompt}`,
  };
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export interface EvolutionServiceDataSource {
  listAgents(workspaceId: string): Promise<StoredAgentLike[]>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecordLike | null>;
}

export class WorkspaceEvolutionService {
  private readonly cacheRoot: string;
  private readonly onUpdated?: (workspaceId: string, digest: WorkspaceEvolutionDigest) => void;

  constructor(options: {
    cacheRoot: string;
    onUpdated?: (workspaceId: string, digest: WorkspaceEvolutionDigest) => void;
  }) {
    this.cacheRoot = options.cacheRoot;
    this.onUpdated = options.onUpdated;
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
    source: EvolutionServiceDataSource,
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
        // Cache miss
      }
    }
    return this.rebuildDigest(workspaceId, source);
  }

  async refreshAndNotify(
    workspaceId: string,
    source: EvolutionServiceDataSource,
  ): Promise<WorkspaceEvolutionDigest | null> {
    const digest = await this.rebuildDigest(workspaceId, source);
    if (digest && this.onUpdated) {
      this.onUpdated(workspaceId, digest);
    }
    return digest;
  }

  private async rebuildDigest(
    workspaceId: string,
    source: EvolutionServiceDataSource,
  ): Promise<WorkspaceEvolutionDigest | null> {
    const workspace = await source.getWorkspace(workspaceId);
    const workspaceTitle = workspace?.title || workspace?.name || workspaceId;
    const branch = workspace?.branch || "main";

    const allAgents = await source.listAgents(workspaceId);
    const rootAgents = allAgents.filter((a) => {
      const isMatchWorkspace =
        a.workspaceId === workspaceId || (workspace?.cwd && a.cwd === workspace.cwd);
      if (!isMatchWorkspace) return false;
      const isSubagent = Boolean(a.parentAgentId || a.labels?.["paseo.parent-agent-id"]);
      return !isSubagent;
    });

    rootAgents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const milestones: AgentMilestoneRecord[] = [];
    for (const agent of rootAgents) {
      const milestoneFile = this.agentMilestonePath(workspaceId, agent.id);
      const effectiveStatus = agent.status ?? agent.lastStatus;
      const isCompleted =
        agent.archivedAt != null || effectiveStatus === "idle" || effectiveStatus === "closed";

      let milestone: AgentMilestoneRecord | null = null;
      if (isCompleted) {
        try {
          const raw = await fs.readFile(milestoneFile, "utf8");
          milestone = JSON.parse(raw) as AgentMilestoneRecord;
        } catch {
          // Not cached yet
        }
      }
      if (!milestone) {
        milestone = summarizeAgentMilestone(agent);
        if (isCompleted) {
          await writeJsonAtomic(milestoneFile, milestone).catch(() => undefined);
        }
      }
      milestones.push(milestone);
    }

    const { overallStatus, currentStage } = resolveEvolutionStatus(milestones);
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

    await writeJsonAtomic(this.digestPath(workspaceId), digest).catch(() => undefined);
    return digest;
  }
}
