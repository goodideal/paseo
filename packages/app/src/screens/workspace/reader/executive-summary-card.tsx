import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Sparkles, Layers, Activity } from "lucide-react-native";
import type { OverallEvolutionStatus } from "@getpaseo/protocol/evolution";

interface ExecutiveSummaryCardProps {
  summary: string;
  currentStage: string;
  overallStatus: OverallEvolutionStatus;
  milestoneCount: number;
}

function statusBadgeConfig(status: OverallEvolutionStatus): {
  label: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case "in_progress":
      return { label: "推进中 (In Progress)", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.1)" };
    case "ready_for_review":
      return { label: "待合流 (Ready for PR)", color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" };
    case "blocked":
      return { label: "受阻 (Blocked)", color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)" };
    case "completed":
    default:
      return { label: "已完成 (Completed)", color: "#10b981", bg: "rgba(16, 185, 129, 0.1)" };
  }
}

export function ExecutiveSummaryCard({
  summary,
  currentStage,
  overallStatus,
  milestoneCount,
}: ExecutiveSummaryCardProps) {
  const badge = statusBadgeConfig(overallStatus);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color="#8b5cf6" />
          <Text style={styles.cardTitle}>工作区演进综述</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: badge.bg, borderColor: badge.color }]}>
          <Text style={[styles.statusBadgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      <Text style={styles.summaryText}>{summary}</Text>

      <View style={styles.metricsRow}>
        <View style={styles.metricItem}>
          <Layers size={13} color="#6b7280" />
          <Text style={styles.metricLabel}>阶段总数:</Text>
          <Text style={styles.metricValue}>{milestoneCount}</Text>
        </View>
        <View style={styles.metricItem}>
          <Activity size={13} color="#6b7280" />
          <Text style={styles.metricLabel}>当前节点:</Text>
          <Text style={styles.metricValue}>{currentStage}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    margin: theme.spacing[4],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  cardTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  summaryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[4],
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  metricItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  metricValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
