import type { AgentTopologyNode } from "../shared/types.js";

export interface RawAgentSummary {
  id: string;
  title?: string;
  lastStatus?: "initializing" | "idle" | "running" | "error" | "closed";
  labels?: Record<string, string>;
  runningTool?: string;
  durationMs?: number;
}

export interface ActiveToolInfo {
  toolName: string;
  durationMs: number;
}

export interface AgentTopology {
  rootAgentId: string;
  nodes: Record<string, AgentTopologyNode>;
}

export function buildAgentTopology(
  rootAgentId: string,
  agents: RawAgentSummary[],
  activeTools?: Record<string, ActiveToolInfo>,
): AgentTopology {
  const agentMap = new Map<string, RawAgentSummary>();
  const childrenMap = new Map<string, string[]>();

  for (const agent of agents) {
    agentMap.set(agent.id, agent);
    const parentId = agent.labels?.["paseo.parent-agent-id"];
    if (parentId) {
      const list = childrenMap.get(parentId) || [];
      list.push(agent.id);
      childrenMap.set(parentId, list);
    }
  }

  // Find all descendants starting from rootAgentId
  const includedIds = new Set<string>();
  const queue = [rootAgentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    includedIds.add(current);
    const children = childrenMap.get(current) || [];
    for (const child of children) {
      if (!includedIds.has(child)) {
        queue.push(child);
      }
    }
  }

  const nodes: Record<string, AgentTopologyNode> = {};

  for (const id of includedIds) {
    const raw = agentMap.get(id);
    const parentId = raw?.labels?.["paseo.parent-agent-id"];
    const children = childrenMap.get(id) || [];
    const activeTool = activeTools?.[id];

    nodes[id] = {
      agentId: id,
      parentAgentId: parentId ?? undefined,
      title: raw?.title || (id === rootAgentId ? "Root Agent" : "Subagent"),
      status: raw?.lastStatus || "idle",
      runningTool: activeTool?.toolName || raw?.runningTool,
      durationMs: activeTool?.durationMs ?? raw?.durationMs ?? 0,
      childAgentIds: children,
    };
  }

  return {
    rootAgentId,
    nodes,
  };
}
