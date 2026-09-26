import React, { useEffect, useState } from "react";
import type { PluginClientContext, PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { BlockerReportSchema } from "./shared/types.js";
import { DecisionCard } from "./client/components/decision-card.js";
import { InFlightPill } from "./client/components/in-flight-pill.js";
import { getWatchdogStatusRpc } from "./shared/rpc.js";
import { useRpc } from "@getpaseo/plugin/client";
import { View, StyleSheet } from "react-native";

function WatchdogOverlay({ agentId }: { agentId: string }) {
  const getStatus = useRpc(getWatchdogStatusRpc);
  const [inFlight, setInFlight] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await getStatus({ agentId });
        if (mounted) {
          setInFlight(status.inFlight);
        }
      } catch (err) {
        // Silent catch during transient connection
      }

      if (mounted) {
        timer = setTimeout(poll, 2000);
      }
    };

    poll();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [agentId, getStatus]);

  if (!inFlight) return null;

  return (
    <View style={overlayStyles.container} pointerEvents="box-none">
      <InFlightPill heartbeat={inFlight} />
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
});

function WatchdogPanelHost(props: PluginAgentPanelProps) {
  return <WatchdogOverlay agentId={props.agentId} />;
}

export default function contribute(client: PluginClientContext) {
  const cleanups: (() => void)[] = [];

  // Register the blocker decision card as a timeline renderer
  const cleanupTimeline = client.addTimelineRenderer({
    kind: "watchdog_blocker",
    version: 1,
    schema: BlockerReportSchema,
    Component: DecisionCard,
  });
  cleanups.push(cleanupTimeline);

  // Register the watchdog panel for agent status overlay
  const cleanupPanel = client.addWorkspacePanel({
    id: "watchdog-overlay",
    title: "Watchdog Status",
    icon: "shield-alert",
    context: "agent",
    Component: WatchdogPanelHost,
  });
  cleanups.push(cleanupPanel);

  return () => {
    cleanups.forEach((c) => c());
  };
}
