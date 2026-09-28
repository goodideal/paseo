import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, type GestureResponderEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, Layers, Archive } from "lucide-react-native";
import { useSubagentsForParent } from "@/subagents/select";
import { useArchiveFinishedSubagents } from "@/subagents";
import type { Theme } from "@/styles/theme";
import { SubagentItemRow } from "./subagent-item-row";

const ThemedArchive = withUnistyles(Archive);
const bulkArchiveColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface MilestoneSubagentsSectionProps {
  serverId?: string | null;
  parentAgentId: string;
  onNavigateToAgent?: (agentId: string) => void;
}

export function MilestoneSubagentsSection({
  serverId,
  parentAgentId,
  onNavigateToAgent,
}: MilestoneSubagentsSectionProps) {
  const rows = useSubagentsForParent({
    serverId: serverId ?? "",
    parentAgentId,
  });

  const { archiveFinished } = useArchiveFinishedSubagents({
    serverId: serverId ?? "",
    parentAgentId,
    rows,
  });

  const { runningCount, errorCount, completedCount, hasActiveOrError } = useMemo(() => {
    let running = 0;
    let error = 0;
    let completed = 0;
    for (const r of rows) {
      const isFailedOrError = r.status === "error" || (r as { status: string }).status === "failed";
      if (r.status === "running") {
        running++;
      } else if (isFailedOrError || r.requiresAttention) {
        error++;
      } else {
        completed++;
      }
    }
    const hasActive = rows.some(
      (r) =>
        r.status === "running" ||
        r.requiresAttention ||
        r.status === "error" ||
        (r as { status: string }).status === "failed",
    );
    return {
      runningCount: running,
      errorCount: error,
      completedCount: completed,
      hasActiveOrError: hasActive,
    };
  }, [rows]);

  const [isExpanded, setIsExpanded] = useState<boolean>(hasActiveOrError);
  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleBulkArchive = useCallback(
    (e: GestureResponderEvent) => {
      (e as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
      void archiveFinished();
    },
    [archiveFinished],
  );

  if (rows.length === 0) {
    return null;
  }

  const headerSummaryText = `子任务流 (${rows.length})${
    runningCount > 0 ? ` · ${runningCount} 执行中` : ""
  }${errorCount > 0 ? ` · ${errorCount} 异常` : ""}${
    completedCount > 0 ? ` · ${completedCount} 已完成` : ""
  }`;

  return (
    <View style={styles.sectionContainer}>
      <Pressable
        style={styles.toggleHeader}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={headerSummaryText}
      >
        <View style={styles.headerLeft}>
          <Layers size={13} color="#6b7280" />
          <Text style={styles.headerTitle}>{headerSummaryText}</Text>
        </View>

        <View style={styles.headerRight}>
          {completedCount > 1 && (
            <Pressable
              style={styles.bulkArchiveBtn}
              onPress={handleBulkArchive}
              accessibilityRole="button"
              accessibilityLabel="一键清理已完成"
              hitSlop={6}
            >
              <ThemedArchive size={12} uniProps={bulkArchiveColorMapping} />
              <Text style={styles.bulkArchiveText}>一键清理已完成</Text>
            </Pressable>
          )}
          {isExpanded ? (
            <ChevronDown size={14} color="#6b7280" />
          ) : (
            <ChevronRight size={14} color="#6b7280" />
          )}
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.subagentList}>
          {rows.map((row) => (
            <SubagentItemRow
              key={row.id}
              row={row}
              serverId={serverId}
              onNavigateToAgent={onNavigateToAgent}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionContainer: {
    marginTop: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    overflow: "hidden",
  },
  toggleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
    backgroundColor: theme.colors.surface1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  bulkArchiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    marginRight: 6,
  },
  bulkArchiveText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  subagentList: {
    padding: theme.spacing[2],
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
  },
}));
