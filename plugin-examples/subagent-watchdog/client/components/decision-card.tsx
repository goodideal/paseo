import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { BlockerReport } from "../../shared/types.js";
import { ActionButtons } from "./action-buttons.js";
import { useDecisionRpc } from "../hooks/use-decision-rpc.js";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";

export function DecisionCard({ item, agentId, layout }: PluginTimelineItemProps<BlockerReport>) {
  const data = item.data;
  const { submitDecision, isSubmitting, error } = useDecisionRpc();
  const [resolvedOptionId, setResolvedOptionId] = useState<string | null>(null);

  const handleSelect = useCallback(
    async (optionId: string) => {
      const result = await submitDecision({
        agentId: data.agentId,
        optionId,
      });
      if (result?.success) {
        setResolvedOptionId(optionId);
      }
    },
    [submitDecision, data.agentId],
  );

  const isResolved = resolvedOptionId !== null;

  return (
    <View
      style={[styles.container, isResolved && styles.resolvedContainer]}
      accessibilityRole="summary"
      accessibilityLabel={`Watchdog 决策卡片: ${data.summary}`}
    >
      <View style={styles.header}>
        <View style={[styles.badge, isResolved ? styles.badgeResolved : styles.badgePending]}>
          <Text
            style={[
              styles.badgeText,
              isResolved ? styles.badgeTextResolved : styles.badgeTextPending,
            ]}
          >
            {isResolved ? "已恢复" : "待决策"}
          </Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          ⚡ WATCHDOG · 推进遇阻决策
        </Text>
      </View>

      <Text style={styles.summary} numberOfLines={2}>
        📌 {data.summary}
      </Text>

      <View style={styles.body}>
        <View style={styles.rootCauseBox}>
          <Text style={styles.rootCauseLabel}>⚠️ 阻断原因与诊断</Text>
          <Text style={styles.rootCauseText}>{data.rootCause}</Text>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {!isResolved ? (
          <View style={styles.optionsArea}>
            <Text style={styles.optionsPrompt}>💡 请选择恢复策略：</Text>
            <ActionButtons options={data.options} onSelect={handleSelect} disabled={isSubmitting} />
          </View>
        ) : (
          <View style={styles.resolvedInfo}>
            <Text style={styles.resolvedInfoText}>
              ✓ 已选择执行:{" "}
              {data.options.find((o) => o.id === resolvedOptionId)?.label || resolvedOptionId}
              ，代理已恢复自主运行
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e6e8eb",
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  resolvedContainer: {
    opacity: 0.85,
    borderColor: "#c3e6cb",
    backgroundColor: "#fcfdfc",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: "#495057",
    letterSpacing: 0.2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgePending: {
    backgroundColor: "#fff3cd",
    borderColor: "#ffeeba",
  },
  badgeResolved: {
    backgroundColor: "#d4edda",
    borderColor: "#c3e6cb",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  badgeTextPending: {
    color: "#856404",
  },
  badgeTextResolved: {
    color: "#155724",
  },
  summary: {
    fontSize: 15,
    fontWeight: "600",
    color: "#11181C",
    marginBottom: 8,
    lineHeight: 22,
  },
  body: {
    marginTop: 2,
  },
  rootCauseBox: {
    backgroundColor: "#fff8f6",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#e03131",
  },
  rootCauseLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#c92a2a",
    marginBottom: 4,
  },
  rootCauseText: {
    fontSize: 13,
    color: "#212529",
    lineHeight: 18,
    fontFamily: "monospace",
  },
  errorText: {
    color: "#e03131",
    fontSize: 12,
    marginBottom: 8,
  },
  optionsArea: {
    marginTop: 4,
  },
  optionsPrompt: {
    fontSize: 13,
    fontWeight: "600",
    color: "#495057",
    marginBottom: 4,
  },
  resolvedInfo: {
    marginTop: 8,
    padding: 10,
    backgroundColor: "#e8f5e9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c8e6c9",
  },
  resolvedInfoText: {
    fontSize: 13,
    color: "#2e7d32",
    fontWeight: "500",
  },
});
