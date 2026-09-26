import type { PluginServerContext } from "@getpaseo/plugin/server";
import { StreamWatcher } from "./server/stream-watcher.js";
import { ManagedGovernor } from "./server/managed-governor.js";
import { Synthesizer } from "./server/synthesizer.js";
import { Executor } from "./server/executor.js";
import { resolveDecisionRpc, interruptAgentRpc, getWatchdogStatusRpc } from "./shared/rpc.js";
import { watchdogSettings } from "./shared/settings.js";
import type { BlockerReport } from "./shared/types.js";

export default function contribute(server: PluginServerContext) {
  // Register host settings configurable in Paseo UI
  const settings = server.registerSettings(watchdogSettings);
  let configuredMaxAutoTurns = 5;
  let configuredHeartbeatThreshold = 15;

  const streamWatcher = new StreamWatcher(configuredHeartbeatThreshold);
  const governor = new ManagedGovernor(configuredMaxAutoTurns);
  const synthesizer = new Synthesizer();
  const executor = new Executor();

  settings.read().then((state) => {
    if (state.status === "ready") {
      configuredMaxAutoTurns = state.values.maxAutoTurns;
      configuredHeartbeatThreshold = state.values.heartbeatThresholdSeconds;
      governor.setMaxAutoTurns(configuredMaxAutoTurns);
      streamWatcher.setHeartbeatThresholdSeconds(configuredHeartbeatThreshold);
    }
  });

  settings.subscribe((state) => {
    if (state.status === "ready") {
      configuredMaxAutoTurns = state.values.maxAutoTurns;
      configuredHeartbeatThreshold = state.values.heartbeatThresholdSeconds;
      governor.setMaxAutoTurns(configuredMaxAutoTurns);
      streamWatcher.setHeartbeatThresholdSeconds(configuredHeartbeatThreshold);
    }
  });

  const activeBlockers = new Map<string, BlockerReport>();

  server.on("agent.turn_started", (event) => {
    streamWatcher.onToolCall(event.agent.id, "wait_agent", (hb) => {
      // In-flight progress observed
    });
  });

  server.on("agent.turn_ended", async (event, context) => {
    const agentId = event.agent.id;
    streamWatcher.onToolResult(agentId);

    let outputText = "";
    const toolCalls: string[] = [];
    if (event.outcome.kind === "completed" || event.outcome.kind === "failed") {
      for (const item of event.timeline) {
        if (item.type === "assistant_message") {
          outputText += item.text + "\n";
        }
        if (item.type === "tool_call") {
          toolCalls.push(item.name);
          const detailAny = item.detail as any;
          const inputAny = item.input as any;
          const itemInput = detailAny?.input ?? inputAny;
          const cmd = itemInput?.cmd ?? itemInput?.command ?? detailAny?.command;

          if (item.name === "exec_command" && cmd) {
            toolCalls.push(cmd);
          }
        }
      }
    } else if (event.outcome.kind === "canceled") {
      outputText = event.outcome.reason;
    }

    const intent = governor.evaluateOutput(agentId, outputText, toolCalls);

    if (intent === "AUTO_CONTINUE") {
      governor.incrementTurn(agentId);
      await executor.autoContinue(agentId, context);
    } else if (intent === "BLOCKER_ESCALATE") {
      let rootCause = "Reached auto-turn limit or detected flapping";
      if (outputText.includes("collab spawn failed: agent thread limit reached")) {
        rootCause = "Agent thread limit reached (collab spawn failed)";
      }

      const report = synthesizer.createBlockerReport(
        agentId,
        "Agent execution blocked",
        rootCause,
        [
          {
            id: "retry",
            label: "Retry",
            description: "Retry the last action",
            actionType: "retry_with_tip",
          },
          {
            id: "pause",
            label: "Pause",
            description: "Pause execution for manual review",
            actionType: "pause",
          },
        ],
        "ERR_BLOCKED",
      );
      activeBlockers.set(agentId, report);
    } else if (intent === "COMPLETED") {
      governor.resetTurn(agentId);
      activeBlockers.delete(agentId);
    }
  });

  server.on("agent.permission_requested", async (event, context) => {
    const { agent, request } = event;
    if (governor.getAutoTurnCount(agent.id) > 0) {
      const input = request.input as any;
      const cmd = input?.cmd ?? input?.command ?? request.title;
      if (cmd && governor.isSafeCommand(cmd)) {
        await executor.allowPermission(agent.id, request.id, context);
      }
    }
  });

  server.handle(resolveDecisionRpc, async (input, context) => {
    const report = activeBlockers.get(input.agentId);
    if (!report) {
      return { success: false, message: "No active blocker found for this agent" };
    }

    const option = report.options.find((o) => o.id === input.optionId);
    if (!option) {
      return { success: false, message: "Invalid option selected" };
    }

    activeBlockers.delete(input.agentId);
    governor.resetTurn(input.agentId);

    if (option.actionType === "retry_with_tip") {
      await context.paseo.agents
        .ref(input.agentId)
        .send("已由 Watchdog 批准继续执行，请重试该步骤并继续前进。");
    }

    return { success: true, message: `Resolved with option: ${option.label}` };
  });

  server.handle(interruptAgentRpc, async (input, context) => {
    try {
      await context.paseo.agents.ref(input.agentId).send("/cancel");
      return { success: true };
    } catch (err) {
      console.error("Failed to interrupt agent", err);
      return { success: false };
    }
  });

  server.handle(getWatchdogStatusRpc, async (input) => {
    return {
      inFlight: streamWatcher.getInFlightHeartbeat(input.agentId),
      blocker: activeBlockers.get(input.agentId) ?? null,
      autoTurnCount: governor.getAutoTurnCount(input.agentId),
    };
  });

  return () => {
    streamWatcher.clearAll();
  };
}
