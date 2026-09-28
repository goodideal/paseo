import { useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  CheckCircle2,
  Clock,
  ArrowRight,
  Bot,
  AlertCircle,
  Loader2,
  FileCode,
} from "lucide-react-native";
import type { AgentMilestoneRecord } from "@getpaseo/protocol/evolution";
import { MilestoneSubagentsSection } from "./subagents/milestone-subagents-section";

interface MilestoneCardProps {
  milestone: AgentMilestoneRecord;
  index?: number;
  totalCount?: number;
  displayIndex?: number;
  serverId?: string | null;
  onNavigateToAgent?: (agentId: string) => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function StatusIcon({ status }: { status: AgentMilestoneRecord["status"] }) {
  if (status === "running") {
    return <Loader2 size={16} color="#3b82f6" />;
  }
  if (status === "error") {
    return <AlertCircle size={16} color="#ef4444" />;
  }
  return <CheckCircle2 size={16} color="#10b981" />;
}

export function MilestoneCard({
  milestone,
  index,
  totalCount,
  displayIndex,
  serverId,
  onNavigateToAgent,
}: MilestoneCardProps) {
  const handleJump = useCallback(() => {
    onNavigateToAgent?.(milestone.agentId);
  }, [onNavigateToAgent, milestone.agentId]);

  let stageNum = 1;
  if (totalCount !== undefined && displayIndex !== undefined) {
    stageNum = totalCount - displayIndex;
  } else if (index !== undefined) {
    stageNum = index + 1;
  }

  const isCurrentActive = displayIndex === 0 && milestone.status === "running";
  let stageStatusText = "已完成";
  if (isCurrentActive) {
    stageStatusText = "当前推进中 (执行中)";
  } else if (milestone.status === "running") {
    stageStatusText = "执行中";
  }

  return (
    <View style={[styles.card, isCurrentActive && styles.activeCard]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <StatusIcon status={milestone.status} />
          <Text style={[styles.stageLabel, isCurrentActive && styles.activeStageLabel]}>
            阶段 {stageNum}: {stageStatusText}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.agentTag}>
            <Bot size={12} color="#6b7280" />
            <Text style={styles.agentTagText}>
              {milestone.provider}
              {milestone.model ? ` (${milestone.model})` : ""}
            </Text>
          </View>
          <View style={styles.timeTag}>
            <Clock size={12} color="#6b7280" />
            <Text style={styles.timeTagText}>{formatDuration(milestone.durationMs)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.intentBlock}>
        <Text style={styles.intentLabel}>🎯 目标意图</Text>
        <Text style={styles.intentText}>{milestone.intentPrompt}</Text>
      </View>

      <View style={styles.summaryBlock}>
        <Text style={styles.summaryLabel}>💡 阶段纪要与关键决策</Text>
        <Text style={styles.summaryText}>{milestone.executiveSummary}</Text>
        {milestone.keyDecisions.map((decision) => (
          <View key={`${milestone.agentId}-decision-${decision}`} style={styles.decisionRow}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.decisionText}>{decision}</Text>
          </View>
        ))}
      </View>

      <MilestoneSubagentsSection
        serverId={serverId}
        parentAgentId={milestone.agentId}
        onNavigateToAgent={onNavigateToAgent}
      />

      {milestone.modifiedFiles.length > 0 && (
        <View style={styles.filesBlock}>
          <View style={styles.filesLabelRow}>
            <FileCode size={13} color="#6b7280" />
            <Text style={styles.filesLabel}>改动文件 ({milestone.modifiedFiles.length}):</Text>
          </View>
          <Text style={styles.filesText} numberOfLines={2}>
            {milestone.modifiedFiles.join(", ")}
          </Text>
        </View>
      )}

      {onNavigateToAgent && (
        <View style={styles.footerRow}>
          <Pressable style={styles.jumpButton} onPress={handleJump}>
            <Text style={styles.jumpButtonText}>查看原始会话</Text>
            <ArrowRight size={12} color="#3b82f6" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  activeCard: {
    borderColor: theme.colors.accent,
    borderWidth: 1.5,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stageLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  activeStageLabel: {
    color: theme.colors.accent,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  agentTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.surface1,
  },
  agentTagText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
  timeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeTagText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  intentBlock: {
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[2],
    borderRadius: 6,
    gap: 2,
  },
  intentLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  intentText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  summaryBlock: {
    gap: 4,
  },
  summaryLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  summaryText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    lineHeight: 18,
  },
  decisionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  decisionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flex: 1,
    lineHeight: 18,
  },
  filesBlock: {
    gap: 2,
  },
  filesLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  filesLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  filesText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: theme.spacing[1],
  },
  jumpButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  jumpButtonText: {
    fontSize: theme.fontSize.sm,
    color: "#3b82f6",
    fontWeight: theme.fontWeight.medium,
  },
}));
