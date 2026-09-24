import React, { useCallback, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { CrawlTelemetry } from "../../shared/types.js";
import { styles } from "./styles.js";

interface TelemetryHeaderProps {
  telemetry: CrawlTelemetry;
  onStartCrawl: (maxHops: number) => void;
  onStopCrawl: () => void;
}

function getStateBadgeStyle(state: string) {
  if (state === "running") return styles.badgeRunning;
  if (state === "completed") return styles.badgeCompleted;
  return styles.badgeIdle;
}

function getStateBadgeTextStyle(state: string) {
  if (state === "running") return styles.badgeTextRunning;
  if (state === "completed") return styles.badgeTextCompleted;
  return styles.badgeText;
}

export const TelemetryHeader = React.memo(function TelemetryHeader({
  telemetry,
  onStartCrawl,
  onStopCrawl,
}: TelemetryHeaderProps) {
  const isRunning = telemetry.state === "running";
  const progressPct =
    telemetry.maxHops > 0
      ? Math.min(100, Math.round((telemetry.currentHop / telemetry.maxHops) * 100))
      : 0;

  const progressStyle = useMemo(
    () => StyleSheet.compose(styles.progressBarFill, { width: `${progressPct}%` as const }),
    [progressPct],
  );

  const handleStart50 = useCallback(() => onStartCrawl(50), [onStartCrawl]);
  const handleStart100 = useCallback(() => onStartCrawl(100), [onStartCrawl]);

  const stateBadgeStyle = getStateBadgeStyle(telemetry.state);
  const stateBadgeTextStyle = getStateBadgeTextStyle(telemetry.state);

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleCluster}>
          <Text style={styles.titleText}>Visual Crawler & Autonomous Fix</Text>
          <View style={stateBadgeStyle}>
            <Text style={stateBadgeTextStyle}>{telemetry.state.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.hopsLabel}>
          {telemetry.currentHop} / {telemetry.maxHops} Hops ({progressPct}%)
        </Text>
      </View>

      {/* Visual Progress Bar */}
      <View style={styles.progressBarTrack}>
        <View style={progressStyle} />
      </View>

      {/* Active URL & Stats */}
      <View style={styles.rowBetweenCenter}>
        <Text style={styles.activeUrlLabel} numberOfLines={1}>
          {telemetry.activeUrl
            ? `Visiting: ${telemetry.activeUrl}`
            : "Ready to explore local application"}
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statPillP0}>
            <Text style={styles.statPillTextP0}>P0: {telemetry.anomaliesBySeverity.P0 || 0}</Text>
          </View>
          <View style={styles.statPillP1}>
            <Text style={styles.statPillTextP1}>P1: {telemetry.anomaliesBySeverity.P1 || 0}</Text>
          </View>
          <View style={styles.statPillP2}>
            <Text style={styles.statPillTextP2}>P2: {telemetry.anomaliesBySeverity.P2 || 0}</Text>
          </View>
        </View>
      </View>

      {/* Quick Action Controls */}
      <View style={styles.controlsRow}>
        {!isRunning ? (
          <>
            <Pressable
              style={styles.buttonPrimary}
              onPress={handleStart50}
              accessibilityRole="button"
            >
              <Text style={styles.buttonPrimaryText}>Start Crawl (50 Hops)</Text>
            </Pressable>
            <Pressable
              style={styles.buttonSecondary}
              onPress={handleStart100}
              accessibilityRole="button"
            >
              <Text style={styles.buttonSecondaryText}>Deep Crawl (100 Hops)</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.buttonDanger} onPress={onStopCrawl} accessibilityRole="button">
            <Text style={styles.buttonDangerText}>Stop Crawl</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});
