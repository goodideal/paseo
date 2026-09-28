import type { AgentMilestoneRecord, AgentMilestoneStatus } from "@getpaseo/protocol/evolution";

export interface StoredAgentLike {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
  title?: string | null;
  lastStatus?: string | null;
  labels?: Record<string, string> | null;
  parentAgentId?: string | null;
  config?: {
    model?: string | null;
    systemPrompt?: string | null;
  } | null;
  runtimeInfo?: {
    model?: string | null;
  } | null;
  archivedAt?: string | null;
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
  const isCompleted = agent.archivedAt != null || agent.lastStatus === "idle";
  const isError = agent.lastStatus === "error";
  const status = deriveMilestoneStatus(isError, isCompleted);

  const completedAt = isCompleted ? (agent.updatedAt ?? agent.lastActivityAt ?? startedAt) : null;
  const durationMs = Math.max(
    0,
    new Date(completedAt ?? Date.now()).getTime() - new Date(startedAt).getTime(),
  );

  const intentPrompt = agent.title || agent.config?.systemPrompt || "执行工作区任务";
  const model = agent.config?.model ?? agent.runtimeInfo?.model ?? null;
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
