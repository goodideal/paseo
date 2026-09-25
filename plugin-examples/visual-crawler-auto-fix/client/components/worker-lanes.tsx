import React, { useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import type { WorkerSlot } from "../../shared/types.js";
import { styles } from "./styles.js";

export interface WorkflowRunLaneSummary {
  runId: string;
  name: string;
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "blocked"
    | "unknown";
  currentStepId?: string | null;
  branchName?: string;
  prUrl?: string;
}

interface WorkerLanesProps {
  slots?: WorkerSlot[];
  workflowRuns?: WorkflowRunLaneSummary[];
  onSelectRun?: (runId: string) => void;
}

const WorkflowRunLaneCard = React.memo(function WorkflowRunLaneCard({
  run,
  onSelect,
}: {
  run: WorkflowRunLaneSummary;
  onSelect: (runId: string) => void;
}) {
  const handlePress = useCallback(() => onSelect(run.runId), [onSelect, run.runId]);
  const isAwaiting = run.status === "waiting_approval";

  return (
    <Pressable
      onPress={handlePress}
      style={styles.laneCard}
      accessibilityRole="button"
      accessibilityLabel={`Workflow run ${run.name}, status ${run.status}`}
    >
      <View style={styles.laneHeader}>
        <Text style={styles.laneTitle} numberOfLines={1}>
          {run.name}
        </Text>
        <View style={styles.badgeRunning}>
          <Text style={styles.badgeTextRunning}>{run.status.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.laneWorkingText} numberOfLines={1}>
        {run.currentStepId ? `Current Step: ${run.currentStepId}` : `Status: ${run.status}`}
      </Text>

      {isAwaiting && (
        <Text style={styles.badgeTextP0} numberOfLines={1}>
          ⚠️ Awaiting Approval (Action Required)
        </Text>
      )}

      {run.branchName && (
        <Text style={styles.laneBranchText} numberOfLines={1}>
          🌿 {run.branchName}
        </Text>
      )}

      {run.prUrl && (
        <Text style={styles.lanePrText} numberOfLines={1}>
          PR: {run.prUrl}
        </Text>
      )}

      <Text style={styles.laneIdleText}>Tap to view run details →</Text>
    </Pressable>
  );
});

export const WorkerLanes = React.memo(function WorkerLanes({
  slots = [],
  workflowRuns = [],
  onSelectRun,
}: WorkerLanesProps) {
  const handleSelect = useCallback(
    (runId: string) => {
      onSelectRun?.(runId);
    },
    [onSelectRun],
  );

  // If workflow runs are available, display them as authoritative run summaries
  if (workflowRuns.length > 0) {
    return (
      <View style={styles.lanesRow}>
        {workflowRuns.map((run) => (
          <WorkflowRunLaneCard key={run.runId} run={run} onSelect={handleSelect} />
        ))}
      </View>
    );
  }

  // Fallback rendering for slots
  return (
    <View style={styles.lanesRow}>
      {slots.map((slot) => {
        const isIdle = slot.status === "idle";
        const isWorking =
          slot.status === "provisioning" || slot.status === "coding" || slot.status === "verifying";
        const isPrCreated = slot.status === "pr_created";
        const isFailed = slot.status === "failed";

        return (
          <View key={slot.slotIndex} style={styles.laneCard}>
            <View style={styles.laneHeader}>
              <Text style={styles.laneTitle}>Worker #{slot.slotIndex + 1}</Text>
              <View style={styles.badgeRunning}>
                <Text style={styles.badgeTextRunning}>{slot.status.toUpperCase()}</Text>
              </View>
            </View>

            {isWorking && (
              <Text style={styles.laneWorkingText} numberOfLines={1}>
                {slot.logMessage || "Executing..."}
              </Text>
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
