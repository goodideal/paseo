import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, type GestureResponderEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  AlertTriangle,
  Square,
  RefreshCw,
  Archive,
} from "lucide-react-native";
import { getProviderIcon } from "@/components/provider-icons";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useArchiveSubagent } from "@/subagents";
import type { SubagentRow } from "@/subagents/select";
import type { Theme } from "@/styles/theme";
import { SubagentInlineRetryBar } from "./subagent-inline-retry-bar";

const ThemedLoader2 = withUnistyles(Loader2);
const ThemedAlertCircle = withUnistyles(AlertCircle);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedCheckCircle2 = withUnistyles(CheckCircle2);
const ThemedSquare = withUnistyles(Square);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedArchive = withUnistyles(Archive);

const runningColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotRunning });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotWarning });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotDanger });
const successColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotSuccess });
const dangerSquareColorMapping = (theme: Theme) => ({
  color: theme.colors.statusDotDanger,
  fill: theme.colors.statusDotDanger,
});
const blueRetryColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.blue[500],
});
const mutedArchiveColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export interface SubagentItemRowProps {
  row: SubagentRow;
  serverId?: string | null;
  onNavigateToAgent?: (agentId: string) => void;
}

function formatElapsed(createdAt: Date): string {
  const elapsedMs = Math.max(0, Date.now() - createdAt.getTime());
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function SubagentItemRow({ row, serverId, onNavigateToAgent }: SubagentItemRowProps) {
  const client = useHostRuntimeClient(serverId ?? "");
  const archiveSubagent = useArchiveSubagent({ serverId: serverId ?? "" });
  const [isRetrying, setIsRetrying] = useState<boolean>(false);

  const ProviderIcon = useMemo(
    () => getProviderIcon(row.provider, serverId ?? ""),
    [row.provider, serverId],
  );

  const handleClick = useCallback(() => {
    onNavigateToAgent?.(row.id);
  }, [onNavigateToAgent, row.id]);

  const handleInterrupt = useCallback(
    (e: GestureResponderEvent) => {
      (e as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
      if (client) {
        void client.cancelAgent(row.id);
      }
    },
    [client, row.id],
  );

  const handleRetryPress = useCallback((e: GestureResponderEvent) => {
    (e as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
    setIsRetrying((prev) => !prev);
  }, []);

  const handleArchivePress = useCallback(
    (e: GestureResponderEvent) => {
      (e as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
      archiveSubagent(row.id);
    },
    [archiveSubagent, row.id],
  );

  const handleConfirmRetry = useCallback(
    (prompt: string) => {
      if (client) {
        void client.sendMessage(row.id, prompt);
      }
      setIsRetrying(false);
    },
    [client, row.id],
  );

  const handleCancelRetry = useCallback(() => {
    setIsRetrying(false);
  }, []);

  const displayTitle = row.title || row.description || "子任务";
  const durationText = useMemo(() => formatElapsed(row.createdAt), [row.createdAt]);

  const isRunning = row.status === "running";
  const isFailedOrError = row.status === "error" || (row as { status: string }).status === "failed";
  const requiresAttention = Boolean(row.requiresAttention);

  const statusPill = useMemo(() => {
    if (isRunning) {
      return (
        <View style={[styles.statusBadge, styles.statusBadgeRunning]}>
          <ThemedLoader2 size={12} uniProps={runningColorMapping} />
          <Text style={[styles.statusText, styles.statusTextRunning]}>执行中</Text>
        </View>
      );
    }
    if (requiresAttention) {
      return (
        <View style={[styles.statusBadge, styles.statusBadgeWarning]}>
          <ThemedAlertTriangle size={12} uniProps={warningColorMapping} />
          <Text style={[styles.statusText, styles.statusTextWarning]}>待确认</Text>
        </View>
      );
    }
    if (isFailedOrError) {
      return (
        <View style={[styles.statusBadge, styles.statusBadgeError]}>
          <ThemedAlertCircle size={12} uniProps={dangerColorMapping} />
          <Text style={[styles.statusText, styles.statusTextError]}>异常</Text>
        </View>
      );
    }
    return (
      <View style={[styles.statusBadge, styles.statusBadgeCompleted]}>
        <ThemedCheckCircle2 size={12} uniProps={successColorMapping} />
        <Text style={[styles.statusText, styles.statusTextCompleted]}>已完成</Text>
      </View>
    );
  }, [isRunning, requiresAttention, isFailedOrError]);

  return (
    <View style={styles.rowWrapper}>
      <Pressable
        style={styles.container}
        onPress={handleClick}
        accessibilityRole="button"
        accessibilityLabel={`子任务: ${displayTitle}`}
      >
        <View style={styles.leftCol}>
          <View style={styles.iconWrapper}>
            <ProviderIcon size={14} color="#6b7280" />
          </View>
          <Text style={styles.titleText} numberOfLines={1}>
            {displayTitle}
          </Text>
        </View>

        <View style={styles.rightCol}>
          <View style={styles.durationTag}>
            <Clock size={11} color="#9ca3af" />
            <Text style={styles.durationText}>{durationText}</Text>
          </View>
          {statusPill}
          <View style={styles.actionsCluster}>
            {isRunning && (
              <Pressable
                style={styles.actionBtn}
                onPress={handleInterrupt}
                accessibilityRole="button"
                accessibilityLabel="中断"
                hitSlop={6}
              >
                <ThemedSquare size={11} uniProps={dangerSquareColorMapping} />
              </Pressable>
            )}
            {isFailedOrError && (
              <Pressable
                style={styles.actionBtn}
                onPress={handleRetryPress}
                accessibilityRole="button"
                accessibilityLabel="重试"
                hitSlop={6}
              >
                <ThemedRefreshCw size={11} uniProps={blueRetryColorMapping} />
              </Pressable>
            )}
            {!isRunning && (
              <Pressable
                style={styles.actionBtn}
                onPress={handleArchivePress}
                accessibilityRole="button"
                accessibilityLabel="归档"
                hitSlop={6}
              >
                <ThemedArchive size={11} uniProps={mutedArchiveColorMapping} />
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>

      {isRetrying && (
        <SubagentInlineRetryBar onConfirm={handleConfirmRetry} onCancel={handleCancelRetry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowWrapper: {
    width: "100%",
  },
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.base,
    gap: theme.spacing[2],
  },
  leftCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  iconWrapper: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flex: 1,
  },
  rightCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  durationTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  durationText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  statusBadgeRunning: {
    backgroundColor: theme.colors.surface2,
  },
  statusBadgeWarning: {
    backgroundColor: theme.colors.statusWarningTint,
  },
  statusBadgeError: {
    backgroundColor: theme.colors.statusDangerTint,
  },
  statusBadgeCompleted: {
    backgroundColor: theme.colors.statusSuccessTint,
  },
  statusText: {
    fontSize: 11,
    fontWeight: theme.fontWeight.medium,
  },
  statusTextRunning: {
    color: theme.colors.statusDotRunning,
  },
  statusTextWarning: {
    color: theme.colors.statusDotWarning,
  },
  statusTextError: {
    color: theme.colors.statusDotDanger,
  },
  statusTextCompleted: {
    color: theme.colors.statusDotSuccess,
  },
  actionsCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 2,
  },
  actionBtn: {
    padding: 3,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
}));
