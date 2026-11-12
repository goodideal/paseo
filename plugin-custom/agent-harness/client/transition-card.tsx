import React, { memo, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { HarnessTransitionPayload } from "../shared/contracts.js";
import { buildTransitionViewModel, type TransitionBadgeCategory } from "./metadata-utils.js";

interface NavigableHostProps {
  serverId?: string;
  host?: {
    id?: string;
  };
  navigation?: {
    openAgent: (input: { agentId: string; serverId?: string }) => void;
  };
}

export const HarnessTransitionCard = memo(function HarnessTransitionCard(
  props: PluginTimelineItemProps<HarnessTransitionPayload>,
) {
  const { item, theme, layout } = props;
  const payload = item.data;
  const navigation = (props as unknown as NavigableHostProps).navigation;

  const vm = useMemo(() => buildTransitionViewModel(payload), [payload]);

  const categoryColor = useMemo(() => {
    switch (vm.badgeCategory) {
      case "success":
        return theme.colors.statusSuccess;
      case "warning":
        return theme.colors.statusWarning;
      case "accent":
      default:
        return theme.colors.accent;
    }
  }, [vm.badgeCategory, theme.colors]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderLeftWidth: 3,
          borderLeftColor: categoryColor,
          borderRadius: 8,
          padding: 10,
          marginVertical: 4,
          gap: 6,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        },
        titleGroup: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          flexShrink: 1,
        },
        title: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.foreground,
          letterSpacing: 0.2,
        },
        pillRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        },
        turnPill: {
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        turnPillText: {
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.foregroundMuted,
        },
        phasePill: {
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        phasePillText: {
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.foregroundMuted,
          textTransform: "uppercase",
        },
        migrationRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: theme.colors.surface0,
          paddingHorizontal: 8,
          paddingVertical: 5,
          borderRadius: 5,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        migrationText: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foreground,
          fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
        },
        reasonText: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
          lineHeight: 16,
        },
        specialistRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 2,
          paddingTop: 6,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          gap: 8,
        },
        specialistInfo: {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          flexShrink: 1,
        },
        specialistTitle: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foreground,
        },
        openButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 5,
        },
        openButtonText: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
      }),
    [theme, layout.platform, categoryColor],
  );

  const handleOpenSpecialist = () => {
    if (vm.childAgentId && navigation?.openAgent) {
      const serverProps = props as unknown as NavigableHostProps;
      const serverId = serverProps.serverId ?? serverProps.host?.id;
      navigation.openAgent({
        agentId: vm.childAgentId,
        ...(serverId ? { serverId } : {}),
      });
    }
  };

  return (
    <View
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={`Harness transition: ${vm.title}, ${vm.fullMigrationSummary}`}
    >
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Icon name={vm.icon} size={14} color={categoryColor} />
          <Text style={styles.title} numberOfLines={1}>
            {vm.title}
          </Text>
        </View>

        <View style={styles.pillRow}>
          <View style={styles.phasePill}>
            <Text style={styles.phasePillText}>{vm.phase}</Text>
          </View>
          <View style={styles.turnPill}>
            <Text style={styles.turnPillText}>{vm.turnLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.migrationRow}>
        <Icon name="ArrowRight" size={12} color={theme.colors.foregroundMuted} />
        <Text style={styles.migrationText} numberOfLines={1}>
          {vm.fullMigrationSummary}
        </Text>
      </View>

      {vm.readableReason ? (
        <Text style={styles.reasonText} numberOfLines={2}>
          {vm.readableReason}
        </Text>
      ) : null}

      {vm.childAgentId ? (
        <View style={styles.specialistRow}>
          <View style={styles.specialistInfo}>
            <Icon name="GitFork" size={13} color={theme.colors.accent} />
            <Text style={styles.specialistTitle} numberOfLines={1}>
              {vm.childAgentTitle ?? `Specialist: ${vm.childAgentId.slice(0, 8)}`}
            </Text>
          </View>

          {navigation?.openAgent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Specialist"
              onPress={handleOpenSpecialist}
              style={({ pressed }) => [
                styles.openButton,
                pressed && { opacity: 0.7, backgroundColor: theme.colors.surface3 },
              ]}
            >
              <Text style={styles.openButtonText}>Open Specialist</Text>
              <Icon name="ArrowUpRight" size={11} color={theme.colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});
