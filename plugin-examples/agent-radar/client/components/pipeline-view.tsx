import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { SuperpowerTaskStep } from "../../shared/types.js";

interface PipelineViewProps {
  superpower: {
    planSlug: string;
    planPath: string;
    tasks: SuperpowerTaskStep[];
    currentTaskId?: string;
  };
  onSelectTask?: (taskId: string) => void;
  selectedTaskId?: string;
}

export function PipelineView({ superpower, onSelectTask, selectedTaskId }: PipelineViewProps) {
  const getStatusBadge = (task: SuperpowerTaskStep) => {
    switch (task.status) {
      case "completed":
        return { label: "✓ 已完成", color: "#198754", bg: "#d1e7dd" };
      case "running":
        return { label: "⚡ 执行中", color: "#0d6efd", bg: "#cfe2ff" };
      case "fixing":
        return {
          label: `🛠️ Fix ${task.currentRound ?? 1}/${task.maxRounds ?? 5}`,
          color: "#fd7e14",
          bg: "#ffe5d0",
        };
      case "reviewing":
        return { label: "🔍 审阅中", color: "#6f42c1", bg: "#e2d9f3" };
      case "blocked":
        return { label: "🛑 阻断", color: "#dc3545", bg: "#f8d7da" };
      default:
        return { label: "⏳ 等待", color: "#6c757d", bg: "#e9ecef" };
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>⚡ Superpowers SDD 路线图</Text>
        <Text style={styles.headerSubtitle}>{superpower.planSlug}</Text>
      </View>

      <View style={styles.taskList}>
        {superpower.tasks.map((task, idx) => {
          const badge = getStatusBadge(task);
          const isSelected = selectedTaskId === task.id;
          const isCurrent = superpower.currentTaskId === task.id;

          return (
            <Pressable
              key={task.id}
              onPress={() => onSelectTask?.(task.id)}
              style={[
                styles.taskCard,
                isSelected && styles.taskCardSelected,
                isCurrent && styles.taskCardCurrent,
              ]}
            >
              <View style={styles.taskCardHeader}>
                <View style={styles.indexBadge}>
                  <Text style={styles.indexText}>{idx + 1}</Text>
                </View>
                <Text style={styles.taskTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              </View>

              {task.commits && task.commits.length > 0 && (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Commits:</Text>
                  <Text style={styles.metaValue}>{task.commits.join(", ")}</Text>
                </View>
              )}

              {task.rulings && task.rulings.length > 0 && (
                <View style={styles.rulingsRow}>
                  <Text style={styles.rulingText} numberOfLines={2}>
                    ⚖️ {task.rulings[0]}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#212529",
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#6c757d",
    marginTop: 2,
  },
  taskList: {
    gap: 8,
  },
  taskCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dee2e6",
    borderRadius: 8,
    padding: 10,
  },
  taskCardSelected: {
    borderColor: "#0d6efd",
    backgroundColor: "#f8faff",
  },
  taskCardCurrent: {
    borderLeftWidth: 4,
    borderLeftColor: "#0d6efd",
  },
  taskCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  indexBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#e9ecef",
    alignItems: "center",
    justifyContent: "center",
  },
  indexText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#495057",
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#212529",
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  metaLabel: {
    fontSize: 11,
    color: "#6c757d",
  },
  metaValue: {
    fontSize: 11,
    color: "#212529",
    fontFamily: "monospace",
  },
  rulingsRow: {
    marginTop: 6,
    backgroundColor: "#fef9e7",
    padding: 6,
    borderRadius: 4,
  },
  rulingText: {
    fontSize: 11,
    color: "#856404",
  },
});
