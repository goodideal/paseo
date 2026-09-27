import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { BlockerReport, InFlightHeartbeat } from "../../shared/types.js";
import { DecisionCard } from "./decision-card.js";
import { InFlightPill } from "./in-flight-pill.js";

interface NodeInspectorProps {
  agentId: string;
  heartbeat?: InFlightHeartbeat | null;
  blocker?: BlockerReport | null;
  autoTurnCount?: number;
  maxAutoTurns?: number;
}

export function NodeInspector({
  agentId,
  heartbeat,
  blocker,
  autoTurnCount = 0,
  maxAutoTurns = 5,
}: NodeInspectorProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎯 节点运行态势</Text>

      {heartbeat && (
        <View style={styles.section}>
          <InFlightPill heartbeat={heartbeat} />
        </View>
      )}

      {blocker && (
        <View style={styles.section}>
          <DecisionCard
            item={{
              type: "plugin",
              kind: "watchdog-blocker",
              version: 1,
              data: blocker,
            }}
            agentId={agentId}
          />
        </View>
      )}

      {!heartbeat && !blocker && (
        <View style={styles.normalState}>
          <Text style={styles.normalTitle}>🛡️ 运行状态正常</Text>
          <Text style={styles.normalText}>
            看门狗与态势雷达正常监控中。当前自动推进轮次: {autoTurnCount} / {maxAutoTurns}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e9ecef",
    paddingTop: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: "#495057",
    marginBottom: 8,
  },
  section: {
    marginBottom: 8,
  },
  normalState: {
    backgroundColor: "#f8f9fa",
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  normalTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#212529",
    marginBottom: 4,
  },
  normalText: {
    fontSize: 11,
    color: "#6c757d",
    lineHeight: 16,
  },
});
