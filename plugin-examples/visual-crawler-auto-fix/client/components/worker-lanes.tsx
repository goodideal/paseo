import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import type { WorkerSlot } from "../../shared/types.js";
import { palette, styles } from "./styles.js";

interface WorkerLanesProps {
  slots: WorkerSlot[];
}

function getLaneBadgeStyle(status: string) {
  if (status === "provisioning" || status === "coding" || status === "verifying") {
    return styles.badgeCompleted;
  }
  if (status === "pr_created") {
    return styles.badgeRunning;
  }
  if (status === "failed") {
    return styles.badgeP0;
  }
  return styles.badgeIdle;
}

function getLaneBadgeTextStyle(status: string) {
  if (status === "provisioning" || status === "coding" || status === "verifying") {
    return styles.badgeTextCompleted;
  }
  if (status === "pr_created") {
    return styles.badgeTextRunning;
  }
  if (status === "failed") {
    return styles.badgeTextP0;
  }
  return styles.badgeText;
}

export const WorkerLanes = React.memo(function WorkerLanes({ slots }: WorkerLanesProps) {
  return (
    <View style={styles.lanesRow}>
      {slots.map((slot) => {
        const isIdle = slot.status === "idle";
        const isWorking =
          slot.status === "provisioning" || slot.status === "coding" || slot.status === "verifying";
        const isPrCreated = slot.status === "pr_created";
        const isFailed = slot.status === "failed";

        const badgeStyle = getLaneBadgeStyle(slot.status);
        const textStyle = getLaneBadgeTextStyle(slot.status);

        return (
          <View key={slot.slotIndex} style={styles.laneCard}>
            <View style={styles.laneHeader}>
              <Text style={styles.laneTitle}>Worker #{slot.slotIndex + 1}</Text>
              <View style={badgeStyle}>
                <Text style={textStyle}>{slot.status.toUpperCase()}</Text>
              </View>
            </View>

            {isWorking && (
              <View style={styles.actionWorkingRow}>
                <ActivityIndicator size="small" color={palette.accent} />
                <Text style={styles.laneWorkingText} numberOfLines={1}>
                  {slot.logMessage || "Executing..."}
                </Text>
              </View>
            )}

            {isIdle && <Text style={styles.laneIdleText}>Standing by for approved tasks</Text>}

            {isPrCreated && (
              <Text style={styles.lanePrText} numberOfLines={1}>
                {slot.prUrl || "PR submitted successfully"}
              </Text>
            )}

            {isFailed && (
              <Text style={styles.laneFailedText} numberOfLines={1}>
                {slot.logMessage || "Task failed"}
              </Text>
            )}

            {slot.branchName && (
              <Text style={styles.laneBranchText} numberOfLines={1}>
                🌿 {slot.branchName}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
});
