import React, { useEffect, useState } from "react";
import type { PluginClientContext, PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { BlockerReportSchema } from "./shared/types.js";
import type { InFlightHeartbeat, WatchdogStatusOutput } from "./shared/types.js";
import { DecisionCard } from "./client/components/decision-card.js";
import { InFlightPill } from "./client/components/in-flight-pill.js";
import { getWatchdogStatusRpc } from "./shared/rpc.js";
import { useRpc } from "@getpaseo/plugin/client";
import { View, Text, StyleSheet } from "react-native";

function WatchdogPanelHost(props: PluginAgentPanelProps) {
  const getStatus = useRpc(getWatchdogStatusRpc);
  const [status, setStatus] = useState<WatchdogStatusOutput | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let interval = 5000;
      try {
        const res = await getStatus({ agentId: props.agentId });
        if (mounted) {
          setStatus(res);
          if (res.inFlight || res.blocker) {
            interval = 2000;
          }
        }
      } catch (err) {
        // Silent catch during transient connection
      }

      if (mounted) {
        timer = setTimeout(poll, interval);
      }
    };

    poll();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [props.agentId, getStatus]);

  return (
    <View style={panelStyles.container}>
      {status?.inFlight && <InFlightPill heartbeat={status.inFlight} />}
      {status?.blocker && (
        <DecisionCard
          item={{
            type: "plugin",
            kind: "watchdog-blocker",
            version: 1,
            data: status.blocker,
          }}
          agentId={props.agentId}
        />
      )}
      {!status?.inFlight && !status?.blocker && (
        <View style={panelStyles.emptyState}>
          <Text style={panelStyles.emptyTitle}>🛡️ Watchdog 运行中</Text>
          <Text style={panelStyles.emptyDesc}>
            实时监控子代理执行进度与长耗时工具调用，当前状态正常。
          </Text>
          {status && status.autoTurnCount > 0 && (
            <Text style={panelStyles.autoTurnText}>
              当前连续自动续推轮次: {status.autoTurnCount}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const panelStyles = StyleSheet.create({
  container: {
    padding: 16,
    flex: 1,
  },
  emptyState: {
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e9ecef",
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#212529",
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 12,
    color: "#6c757d",
    lineHeight: 18,
  },
  autoTurnText: {
    fontSize: 12,
    color: "#0a7ea4",
    marginTop: 8,
    fontWeight: "500",
  },
});

export default function contribute(client: PluginClientContext) {
  const cleanups: (() => void)[] = [];

  // Register the blocker decision card as a timeline renderer (must match /^[a-z][a-z0-9-]*$/)
  const cleanupTimeline = client.addTimelineRenderer({
    kind: "watchdog-blocker",
    version: 1,
    schema: BlockerReportSchema,
    Component: DecisionCard,
  });
  cleanups.push(cleanupTimeline);

  // Register the watchdog panel for agent status overlay (Lucide icon must be PascalCase, e.g. ShieldAlert)
  const cleanupPanel = client.addWorkspacePanel({
    id: "watchdog-overlay",
    title: "Watchdog Status",
    icon: "ShieldAlert",
    context: "agent",
    Component: WatchdogPanelHost,
  });
  cleanups.push(cleanupPanel);

  return () => {
    cleanups.forEach((c) => c());
  };
}
