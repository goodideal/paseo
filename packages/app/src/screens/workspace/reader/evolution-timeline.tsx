import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentMilestoneRecord } from "@getpaseo/protocol/evolution";
import { MilestoneCard } from "./milestone-card";

interface EvolutionTimelineProps {
  milestones: AgentMilestoneRecord[];
  onNavigateToAgent?: (agentId: string) => void;
}

export function EvolutionTimeline({ milestones, onNavigateToAgent }: EvolutionTimelineProps) {
  if (milestones.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>暂无智能体演进记录</Text>
        <Text style={styles.emptySubtitle}>
          当在本工作区创建或运行智能体时，演进脉络将自动汇聚在此。
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>⏳ 任务与演进脉络流</Text>

      <View style={styles.timelineList}>
        {milestones.map((milestone, idx) => {
          const isLast = idx === milestones.length - 1;
          const isRunning = milestone.status === "running";

          return (
            <View key={milestone.agentId} style={styles.timelineRow}>
              <View style={styles.trackCol}>
                <View
                  style={[styles.nodeDot, isRunning ? styles.runningDot : styles.completedDot]}
                />
                {!isLast && <View style={styles.trackLine} />}
              </View>

              <View style={styles.contentCol}>
                <MilestoneCard
                  milestone={milestone}
                  index={idx}
                  onNavigateToAgent={onNavigateToAgent}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[8],
    gap: theme.spacing[3],
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  timelineList: {
    gap: 0,
  },
  timelineRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  trackCol: {
    alignItems: "center",
    width: 16,
  },
  nodeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 14,
    borderWidth: 2,
    backgroundColor: theme.colors.surface0,
  },
  completedDot: {
    borderColor: "#10b981",
    backgroundColor: "#10b981",
  },
  runningDot: {
    borderColor: "#3b82f6",
    backgroundColor: "#3b82f6",
  },
  trackLine: {
    flex: 1,
    width: 2,
    backgroundColor: theme.colors.border,
    marginVertical: 4,
  },
  contentCol: {
    flex: 1,
    paddingBottom: theme.spacing[4],
  },
  emptyContainer: {
    padding: theme.spacing[8],
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  emptyTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  emptySubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    maxWidth: 320,
  },
}));
