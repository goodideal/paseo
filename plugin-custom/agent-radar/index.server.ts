import type { PluginServerContext } from "@getpaseo/plugin/server";
import { StreamWatcher } from "./server/stream-watcher.js";
import { ManagedGovernor } from "./server/managed-governor.js";
import { Synthesizer } from "./server/synthesizer.js";
import { Executor } from "./server/executor.js";
import { RadarEngine } from "./server/radar-engine.js";
import {
  resolveDecisionRpc,
  interruptAgentRpc,
  getWatchdogStatusRpc,
  radarGetSnapshotRpc,
  radarResolveDecisionRpc,
  radarToggleAutoContinueRpc,
} from "./shared/rpc.js";
import { watchdogSettings } from "./shared/settings.js";
import type { BlockerReport, DecisionOption } from "./shared/types.js";

export default function contribute(server: PluginServerContext) {
  // Register host settings configurable in Paseo UI
  const settings = server.registerSettings(watchdogSettings);
  let configuredMaxAutoTurns = 5;
  let configuredHeartbeatThreshold = 15;
  let configuredAutoContinue = false;
  let configuredAutoApprovePermissions = true;
  let configuredAutoContinuePrompt = "请继续执行下一步任务，直到交付并验证完成。";

  const streamWatcher = new StreamWatcher(configuredHeartbeatThreshold);
  const governor = new ManagedGovernor(configuredMaxAutoTurns);
  const synthesizer = new Synthesizer();
  const executor = new Executor();
  const activeBlockers = new Map<string, BlockerReport>();
  const activeSubscriptions = new Map<string, () => void>();

  const radarEngine = new RadarEngine({
    workspaceCwd: process.cwd(),
    streamWatcher,
    governor,
    activeBlockers,
  });

  const updateFromSettings = (values: any) => {
    if (!values) return;
    if (typeof values.maxAutoTurns === "number") {
      configuredMaxAutoTurns = values.maxAutoTurns;
      governor.setMaxAutoTurns(configuredMaxAutoTurns);
    }
    if (typeof values.heartbeatThresholdSeconds === "number") {
      configuredHeartbeatThreshold = values.heartbeatThresholdSeconds;
      streamWatcher.setHeartbeatThresholdSeconds(configuredHeartbeatThreshold);
    }
    if (typeof values.autoContinue === "boolean") {
      configuredAutoContinue = values.autoContinue;
    }
    if (typeof values.autoApprovePermissions === "boolean") {
      configuredAutoApprovePermissions = values.autoApprovePermissions;
    }
    if (
      typeof values.autoContinuePrompt === "string" &&
      values.autoContinuePrompt.trim().length > 0
    ) {
      configuredAutoContinuePrompt = values.autoContinuePrompt;
    }
    if (Array.isArray(values.safeCommandWhitelist)) {
      governor.setSafeCommandWhitelist(values.safeCommandWhitelist);
    }
    if (typeof values.consecutiveErrorTolerance === "number") {
      governor.setConsecutiveErrorTolerance(values.consecutiveErrorTolerance);
    }
  };

  settings.read().then((state) => {
    if (state.status === "ready") {
      updateFromSettings(state.values);
    }
  });

  settings.subscribe((state) => {
    if (state.status === "ready") {
      updateFromSettings(state.values);
    }
  });

  server.on("agent.turn_started", (event, context) => {
    const agentId = event.agent.id;
    // Clear any previous stale blocker on new turn start to avoid ghost cards
    activeBlockers.delete(agentId);
    try {
      const agentRef = context.paseo?.agents?.ref(agentId);
      if (agentRef?.timeline?.subscribe) {
        const sub = agentRef.timeline.subscribe((streamEvent: any) => {
          if (
            streamEvent &&
            "event" in streamEvent &&
            streamEvent.event?.type === "timeline" &&
            streamEvent.event.item?.type === "tool_call"
          ) {
            const item = streamEvent.event.item;
            if (item.status === "running") {
              streamWatcher.onToolCall(agentId, item.name, () => {
                // Heartbeat triggered for long running tool
              });
            } else if (
              item.status === "completed" ||
              item.status === "failed" ||
              item.status === "canceled"
            ) {
              streamWatcher.onToolResult(agentId);
            }
          }
        });
        activeSubscriptions.set(agentId, () => {
          if (typeof sub === "function") sub();
          else if (typeof (sub as any).release === "function") (sub as any).release();
        });
      }
    } catch {
      streamWatcher.clearWatcher(agentId);
    }
  });

  server.on("agent.turn_ended", async (event, context) => {
    const agentId = event.agent.id;
    const unsub = activeSubscriptions.get(agentId);
    if (unsub) {
      unsub();
      activeSubscriptions.delete(agentId);
    }
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
    const isAutoContinueEnabled = governor.isAgentAutoContinueEnabled(
      agentId,
      configuredAutoContinue,
    );

    if (intent === "AUTO_CONTINUE") {
      if (isAutoContinueEnabled) {
        governor.incrementTurn(agentId);
        await executor.autoContinue(agentId, context, configuredAutoContinuePrompt);
      }
    } else if (intent === "BLOCKER_ESCALATE") {
      const isExplicitCrash = outputText.includes(
        "collab spawn failed: agent thread limit reached",
      );
      const isPrMerge = governor.isPrMergeIntent(outputText, toolCalls);

      // Blocker escalation should strictly gate on auto-continue being active,
      // UNLESS it's an explicit subprocess crash (thread limit) or PR merge gate.
      // Normal turns with auto-continue disabled should end naturally without blocker cards.
      if (!isAutoContinueEnabled && !isExplicitCrash && !isPrMerge) {
        return;
      }

      let rootCause =
        governor.getLastBlockerReason(agentId) ?? "Reached auto-turn limit or detected flapping";
      if (isExplicitCrash) {
        rootCause = "Agent thread limit reached (collab spawn failed)";
      }

      const isAutoTurnLimit = rootCause.includes("auto-turn limit");
      let options: DecisionOption[] = [
        {
          id: "continue",
          label: "继续推进",
          description: isAutoTurnLimit ? "授权继续按原定计划自主推进下一步" : "继续执行下一步任务",
          actionType: "retry_with_tip",
        },
        {
          id: "pause",
          label: "暂停",
          description: "暂停自动推进，转为人工介入",
          actionType: "pause",
        },
      ];

      if (rootCause.includes("PR merge")) {
        options = [
          {
            id: "approve_pr",
            label: "Approve & Merge",
            description: "Authorize and proceed with PR merge",
            actionType: "retry_with_tip",
          },
          {
            id: "pause",
            label: "Pause for Review",
            description: "Keep PR open and review manually",
            actionType: "pause",
          },
        ];
      }

      const report = synthesizer.createBlockerReport(
        agentId,
        "Agent execution blocked",
        rootCause,
        options,
        "ERR_BLOCKED",
      );
      activeBlockers.set(agentId, report);

      try {
        await context.paseo?.agents?.ref(agentId)?.timeline?.append({
          type: "plugin",
          id: `watchdog-blocker-${Date.now()}`,
          kind: "watchdog-blocker",
          version: 1,
          data: report,
        });
      } catch (err) {
        console.error("Failed to append watchdog blocker to timeline", err);
      }
    } else if (intent === "COMPLETED") {
      governor.resetTurn(agentId);
      activeBlockers.delete(agentId);
    }
  });

  server.on("agent.permission_requested", async (event, context) => {
    if (!configuredAutoApprovePermissions) return;
    const { agent, request } = event;
    if (governor.getAutoTurnCount(agent.id) > 0) {
      const input = request.input as any;
      const cmd = input?.cmd ?? input?.command ?? request.title;
      // Strict guard: never allow PR merge or unsafe commands automatically
      if (cmd && governor.isSafeCommand(cmd) && !governor.isPrMergeIntent(cmd, [cmd])) {
        await executor.allowPermission(agent.id, request.id, context);
      }
    }
  });

  const handleResolveDecision = async (
    input: { agentId: string; optionId: string; customFeedback?: string },
    context: any,
  ) => {
    const report = activeBlockers.get(input.agentId);
    if (!report) {
      return { success: false, message: "No active blocker found for this agent" };
    }

    const option = report.options.find(
      (o) => o.id === input.optionId || (input.optionId === "retry" && o.id === "continue"),
    );
    if (!option) {
      return { success: false, message: "Invalid option selected" };
    }

    activeBlockers.delete(input.agentId);
    governor.resetTurn(input.agentId);

    if (option.actionType === "retry_with_tip") {
      let prompt =
        "【自动推进提示】用户已授权继续推进任务，请按原定计划与步骤继续执行下一步，无须重复上一轮动作。";
      if (option.id === "approve_pr") {
        prompt = "已由用户在 Agent Radar 手动批准 PR 合并，请继续执行合并与验证。";
      }
      await context.paseo.agents.ref(input.agentId).send(prompt);
    }

    return { success: true, message: `Resolved with option: ${option.label}` };
  };

  server.handle(resolveDecisionRpc, handleResolveDecision);
  server.handle(radarResolveDecisionRpc, handleResolveDecision);

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

  server.handle(radarToggleAutoContinueRpc, async (input) => {
    const current = governor.isAgentAutoContinueEnabled(input.agentId, configuredAutoContinue);
    const next = input.enabled !== undefined ? input.enabled : !current;
    governor.setAgentAutoContinue(input.agentId, next);
    return { agentId: input.agentId, enabled: next };
  });

  server.handle(radarGetSnapshotRpc, async (input, context) => {
    let agentsList: any[] = [];
    try {
      if (typeof context?.paseo?.agents?.list === "function") {
        const res: any = await context.paseo.agents.list();
        if (res && Array.isArray(res.entries)) {
          agentsList = res.entries.map((e: any) => e.agent ?? e);
        } else if (Array.isArray(res)) {
          agentsList = res;
        }
      }
    } catch {}

    return await radarEngine.getSnapshot(input.agentId, agentsList, configuredAutoContinue);
  });

  return () => {
    for (const unsub of activeSubscriptions.values()) {
      unsub();
    }
    activeSubscriptions.clear();
    streamWatcher.clearAll();
  };
}
