import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import type { CrawlerTaskItem, Severity, TaskStatus } from "../../shared/types.js";
import { styles } from "./styles.js";

interface TaskBoardProps {
  tasks: CrawlerTaskItem[];
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
}

function getBadgeStyle(severity: Severity) {
  if (severity === "P0") return styles.badgeP0;
  if (severity === "P1") return styles.badgeP1;
  if (severity === "P2") return styles.badgeP2;
  return styles.badgeP3;
}

function getBadgeTextStyle(severity: Severity) {
  if (severity === "P0") return styles.badgeTextP0;
  if (severity === "P1") return styles.badgeTextP1;
  if (severity === "P2") return styles.badgeTextP2;
  return styles.badgeTextP3;
}

export const TaskBoard = React.memo(function TaskBoard({ tasks, onUpdateStatus }: TaskBoardProps) {
  const [filterSeverity, setFilterSeverity] = useState<Severity | "ALL">("ALL");

  const filteredTasks = useMemo(() => {
    if (filterSeverity === "ALL") return tasks;
    return tasks.filter((t) => t.severity === filterSeverity);
  }, [tasks, filterSeverity]);

  return (
    <ScrollView style={styles.container}>
      {/* Filter Tabs */}
      <View style={[styles.controlsRow, { paddingHorizontal: 16, paddingVertical: 8 }]}>
        {(["ALL", "P0", "P1", "P2", "P3"] as const).map((sev) => (
          <Pressable
            key={sev}
            style={[
              styles.buttonOutline,
              filterSeverity === sev ? { borderColor: "#58A6FF" } : undefined,
            ]}
            onPress={() => setFilterSeverity(sev)}
          >
            <Text style={styles.buttonOutlineText}>{sev}</Text>
          </Pressable>
        ))}
      </View>

      {/* Task Cards */}
      {filteredTasks.length === 0 ? (
        <View style={{ padding: 24, alignItems: "center" }}>
          <Text style={styles.hopsLabel}>No defects recorded in task list.</Text>
        </View>
      ) : (
        filteredTasks.map((task) => (
          <View key={task.id} style={styles.taskCard}>
            <View style={styles.taskTitleRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <View style={getBadgeStyle(task.severity)}>
                  <Text style={getBadgeTextStyle(task.severity)}>{task.severity}</Text>
                </View>
                <Text style={[styles.titleText, { fontSize: 13, flex: 1 }]} numberOfLines={1}>
                  {task.title}
                </Text>
              </View>
              <Text style={styles.hopsLabel}>
                {task.occurrenceCount} {task.occurrenceCount === 1 ? "hit" : "hits"}
              </Text>
            </View>

            {/* Affected URLs */}
            <Text style={styles.activeUrlLabel} numberOfLines={1}>
              URLs: {task.affectedUrls.join(", ")}
            </Text>

            {/* Reproduction steps summary */}
            {task.reproductionBreadcrumbs.length > 0 && (
              <View style={{ gap: 2 }}>
                <Text style={styles.inputLabel}>Reproduction steps:</Text>
                {task.reproductionBreadcrumbs.map((crumb) => (
                  <Text
                    key={`${crumb.hopNumber}-${crumb.action}`}
                    style={styles.taskBreadcrumbText}
                  >
                    #{crumb.hopNumber} {crumb.action} ({crumb.url})
                  </Text>
                ))}
              </View>
            )}

            {/* Evidence summary */}
            {task.evidence.consoleMessage && (
              <Text style={styles.evidenceText} numberOfLines={2}>
                {task.evidence.consoleMessage}
              </Text>
            )}
            {task.evidence.screenshotPath && (
              <Text style={styles.hopsLabel} numberOfLines={1}>
                Screenshot: {task.evidence.screenshotPath}
              </Text>
            )}

            {/* Action buttons */}
            <View style={[styles.controlsRow, { justifyContent: "flex-end", marginTop: 4 }]}>
              {task.status !== "resolved" && (
                <Pressable
                  style={styles.buttonPrimary}
                  onPress={() => onUpdateStatus(task.id, "resolved")}
                >
                  <Text style={styles.buttonPrimaryText}>Mark Done</Text>
                </Pressable>
              )}
              {task.status !== "ignored" && (
                <Pressable
                  style={styles.buttonOutline}
                  onPress={() => onUpdateStatus(task.id, "ignored")}
                >
                  <Text style={styles.buttonOutlineText}>Ignore</Text>
                </Pressable>
              )}
              {task.status !== "todo" && (
                <Pressable
                  style={styles.buttonSecondary}
                  onPress={() => onUpdateStatus(task.id, "todo")}
                >
                  <Text style={styles.buttonSecondaryText}>Reopen</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
});
