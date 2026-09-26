import { parseSuperpowerStatus, type SuperpowerPlanStatus } from "./sdd-parser.js";
import {
  buildAgentTopology,
  type RawAgentSummary,
  type ActiveToolInfo,
} from "./topology-builder.js";
import type { StreamWatcher } from "./stream-watcher.js";
import type { ManagedGovernor } from "./managed-governor.js";
import type { RadarSnapshot, BlockerReport } from "../shared/types.js";

export interface RadarEngineOptions {
  workspaceCwd: string;
  streamWatcher: StreamWatcher;
  governor: ManagedGovernor;
  activeBlockers: Map<string, BlockerReport>;
}

export class RadarEngine {
  private workspaceCwd: string;
  private streamWatcher: StreamWatcher;
  private governor: ManagedGovernor;
  private activeBlockers: Map<string, BlockerReport>;

  constructor(options: RadarEngineOptions) {
    this.workspaceCwd = options.workspaceCwd;
    this.streamWatcher = options.streamWatcher;
    this.governor = options.governor;
    this.activeBlockers = options.activeBlockers;
  }

  setWorkspaceCwd(cwd: string) {
    this.workspaceCwd = cwd;
  }

  async getSnapshot(agentId: string, agentList: RawAgentSummary[] = []): Promise<RadarSnapshot> {
    // 1. Detect Superpower SDD mode
    let superpowerStatus: SuperpowerPlanStatus | null = null;
    try {
      superpowerStatus = await parseSuperpowerStatus(this.workspaceCwd);
    } catch {}

    const isSuperpower = Boolean(superpowerStatus && superpowerStatus.tasks.length > 0);

    // 2. Active tools map for topology
    const activeTools: Record<string, ActiveToolInfo> = {};
    for (const a of agentList) {
      const hb = this.streamWatcher.getInFlightHeartbeat(a.id);
      if (hb) {
        activeTools[a.id] = {
          toolName: hb.currentToolName,
          durationMs: hb.elapsedSeconds * 1000,
        };
      }
    }

    // Include target agentId if not present
    const allAgents = [...agentList];
    if (!allAgents.some((a) => a.id === agentId)) {
      allAgents.push({ id: agentId, title: "Main Agent", lastStatus: "running" });
    }

    const topology = buildAgentTopology(agentId, allAgents, activeTools);

    // 3. Find active heartbeat or blocker across the hierarchy
    let activeHeartbeat = this.streamWatcher.getInFlightHeartbeat(agentId);
    let activeBlocker = this.activeBlockers.get(agentId) ?? null;

    if (!activeHeartbeat) {
      for (const nodeId of Object.keys(topology.nodes)) {
        const childHb = this.streamWatcher.getInFlightHeartbeat(nodeId);
        if (childHb) {
          activeHeartbeat = childHb;
          break;
        }
      }
    }

    if (!activeBlocker) {
      for (const nodeId of Object.keys(topology.nodes)) {
        const childBlk = this.activeBlockers.get(nodeId);
        if (childBlk) {
          activeBlocker = childBlk;
          break;
        }
      }
    }

    // 4. Map superpower tasks with agent linkage if matching
    let superpowerPayload = undefined;
    if (isSuperpower && superpowerStatus) {
      superpowerPayload = {
        planSlug: superpowerStatus.planSlug,
        planPath: superpowerStatus.planPath,
        tasks: superpowerStatus.tasks,
        currentTaskId: superpowerStatus.currentTaskId,
      };
    }

    return {
      mode: isSuperpower ? "superpower" : "generic",
      superpower: superpowerPayload,
      topology,
      watchdog: {
        activeHeartbeat: activeHeartbeat ?? null,
        activeBlocker: activeBlocker ?? null,
        autoTurnCount: this.governor.getAutoTurnCount(agentId),
        maxAutoTurns: this.governor.getMaxAutoTurns(),
      },
    };
  }
}
