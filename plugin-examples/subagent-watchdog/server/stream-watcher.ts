import type { InFlightHeartbeat } from "../shared/types.js";
import type { PluginServerContext } from "@getpaseo/plugin/server";

export class StreamWatcher {
  private inFlightMap = new Map<
    string,
    {
      agentId: string;
      subagentNickname?: string;
      currentToolName: string;
      startTime: number;
      timer?: NodeJS.Timeout;
      heartbeatCallback: (hb: InFlightHeartbeat) => void;
    }
  >();

  constructor(private readonly heartbeatThresholdMs = 15000) {}

  public onToolCall(
    agentId: string,
    toolName: string,
    heartbeatCallback: (hb: InFlightHeartbeat) => void,
    subagentNickname?: string,
  ) {
    this.clearWatcher(agentId);

    const startTime = Date.now();
    const entry = {
      agentId,
      subagentNickname,
      currentToolName: toolName,
      startTime,
      heartbeatCallback,
      timer: setInterval(() => this.checkHeartbeat(agentId), 1000),
    };

    this.inFlightMap.set(agentId, entry);
  }

  public onToolResult(agentId: string) {
    this.clearWatcher(agentId);
  }

  private checkHeartbeat(agentId: string) {
    const entry = this.inFlightMap.get(agentId);
    if (!entry) return;

    const elapsedMs = Date.now() - entry.startTime;
    if (elapsedMs >= this.heartbeatThresholdMs) {
      entry.heartbeatCallback({
        agentId: entry.agentId,
        subagentNickname: entry.subagentNickname ?? null,
        currentToolName: entry.currentToolName,
        elapsedSeconds: Math.floor(elapsedMs / 1000),
        statusDescription: `Tool \`${entry.currentToolName}\` is still running...`,
      });
    }
  }

  public getInFlightHeartbeat(agentId: string): InFlightHeartbeat | null {
    const entry = this.inFlightMap.get(agentId);
    if (!entry) return null;

    const elapsedMs = Date.now() - entry.startTime;
    if (elapsedMs >= this.heartbeatThresholdMs) {
      return {
        agentId: entry.agentId,
        subagentNickname: entry.subagentNickname ?? null,
        currentToolName: entry.currentToolName,
        elapsedSeconds: Math.floor(elapsedMs / 1000),
        statusDescription: `Tool \`${entry.currentToolName}\` is still running...`,
      };
    }
    return null;
  }

  public clearWatcher(agentId: string) {
    const entry = this.inFlightMap.get(agentId);
    if (entry?.timer) {
      clearInterval(entry.timer);
    }
    this.inFlightMap.delete(agentId);
  }

  public clearAll() {
    for (const agentId of this.inFlightMap.keys()) {
      this.clearWatcher(agentId);
    }
  }
}
