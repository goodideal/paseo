import React, { memo, useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { harnessHandoffRpc, harnessSwitchTierRpc } from "../shared/contracts.js";
import type { HandoffTargetRole, MatrixTier } from "../shared/types.js";
import {
  capitalize,
  extractAgentHarnessMetadata,
  formatRoleDisplayName,
  resolveHarnessPillIcon,
} from "./metadata-utils.js";

export type HarnessPopoverProps = PluginButtonContentProps & {
  workspaceId: string;
  agentId: string;
  onOpenSettings?: () => void;
};

export const HarnessPopover = memo(function HarnessPopover({
  workspaceId,
  agentId,
  theme,
  layout,
  close,
  onOpenSettings,
}: HarnessPopoverProps) {
  const toast = useToast();
  const switchTierRpc = useRpc(harnessSwitchTierRpc);
  const handoffRpc = useRpc(harnessHandoffRpc);

  const agent = useAgent(agentId, (a) => ({
    status: a.status,
    provider: a.provider,
    model: a.model,
    currentModeId: a.currentModeId,
    metadata: a.metadata,
  }));

  const meta = useMemo(() => extractAgentHarnessMetadata(agent?.metadata), [agent?.metadata]);

  const [isSwitching, setIsSwitching] = useState(false);
  const [isHandoffRunning, setIsHandoffRunning] = useState(false);

  const currentTier: MatrixTier = meta?.currentTier ?? "flash";
  const lastBilledTier: MatrixTier | null = meta?.lastBilledTier ?? null;
  const isDualStateMismatched = lastBilledTier !== null && lastBilledTier !== currentTier;

  // Handle manual model tier switch
  const handleSwitchTier = useCallback(
    async (targetTier: MatrixTier) => {
      if (isSwitching) return;
      setIsSwitching(true);
      try {
        const res = await switchTierRpc({
          agentId,
          targetTier,
          currentModeId: agent?.currentModeId ?? null,
          reason: "Manual switch from Harness popover",
        });

        toast.show(`Switched to ${capitalize(targetTier)} (${res.currentModel})`, {
          variant: "success",
        });
      } catch (err) {
        toast.error(`Failed to switch tier: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSwitching(false);
      }
    },
    [agentId, isSwitching, switchTierRpc, toast],
  );

  // Handle specialist handoff
  const handleHandoff = useCallback(
    async (targetRole: HandoffTargetRole) => {
      if (isHandoffRunning) return;
      setIsHandoffRunning(true);
      try {
        const res = await handoffRpc({
          agentId,
          workspaceId,
          targetRole,
        });

        toast.show(`Spawned ${res.childTitle}`, { variant: "success" });
        close();
      } catch (err) {
        toast.error(`Handoff failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsHandoffRunning(false);
      }
    },
    [agentId, close, handoffRpc, isHandoffRunning, toast, workspaceId],
  );

  const pillIcon = useMemo(() => resolveHarnessPillIcon(meta), [meta]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 320,
          backgroundColor: layout.compact ? "transparent" : theme.colors.surface0,
          padding: 10,
          gap: 10,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 2,
        },
        headerLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        headerTitle: {
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          color: theme.colors.foreground,
          textTransform: "uppercase",
        },
        phaseBadge: {
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        phaseBadgeText: {
          fontSize: 9,
          fontWeight: "700",
          color: theme.colors.accent,
          textTransform: "uppercase",
        },
        iconButton: {
          width: 22,
          height: 22,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
        },
        dashboardBox: {
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 8,
          gap: 6,
        },
        dashboardRow: {
          flexDirection: "row",
          gap: 6,
        },
        metricCol: {
          flex: 1,
          backgroundColor: theme.colors.surface0,
          borderRadius: 6,
          padding: 6,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          gap: 2,
        },
        metricLabel: {
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.foregroundMuted,
          textTransform: "uppercase",
        },
        metricTierRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        },
        metricTier: {
          fontSize: 13,
          fontWeight: "700",
          color: theme.colors.foreground,
        },
        metricModel: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
          fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
        },
        modeGateBadge: {
          alignSelf: "flex-start",
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 4,
          paddingVertical: 1,
          borderRadius: 3,
          marginTop: 2,
        },
        modeGateText: {
          fontSize: 9,
          fontWeight: "600",
          color: theme.colors.statusWarning,
        },
        telemetryRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 4,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        },
        telemetryText: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
        },
        dualStateBanner: {
          backgroundColor: theme.colors.surface2,
          borderLeftWidth: 3,
          borderLeftColor: theme.colors.statusWarning,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: 5,
          gap: 2,
        },
        dualStateBannerText: {
          fontSize: 10,
          fontWeight: "500",
          color: theme.colors.foreground,
          lineHeight: 14,
        },
        sectionTitle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.5,
          color: theme.colors.foregroundMuted,
          textTransform: "uppercase",
        },
        tierGrid: {
          flexDirection: "row",
          gap: 6,
        },
        tierButton: {
          flex: 1,
          height: 32,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
        },
        tierButtonActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.surface2,
        },
        tierButtonText: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        tierButtonTextActive: {
          color: theme.colors.accent,
        },
        handoffRecommendation: {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          backgroundColor: theme.colors.surface1,
          paddingHorizontal: 8,
          paddingVertical: 5,
          borderRadius: 6,
          borderLeftWidth: 3,
          borderLeftColor: theme.colors.accent,
        },
        handoffRecommendationText: {
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        specialistGrid: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        },
        specialistCard: {
          width: "48.9%",
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 6,
          gap: 2,
        },
        specialistCardDesignHint: {
          borderColor: theme.colors.accent,
        },
        specialistHeader: {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
        },
        specialistName: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        specialistDesc: {
          fontSize: 9,
          color: theme.colors.foregroundMuted,
        },
        settingsLink: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          paddingVertical: 6,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        settingsLinkText: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foregroundMuted,
        },
      }),
    [theme, layout.compact, layout.platform],
  );

  const isPlanMode = agent?.currentModeId === "plan";
  const isDesignPhase = meta?.phase === "design";

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name={pillIcon} size={13} color={theme.colors.accent} />
          <Text style={styles.headerTitle}>Agent Harness</Text>
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseBadgeText}>
              {meta ? `${formatRoleDisplayName(meta.role)} · ${meta.phase}` : "UNTRACKED"}
            </Text>
          </View>
        </View>

        {onOpenSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Harness Settings"
            onPress={() => {
              onOpenSettings();
              close();
            }}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && { opacity: 0.6, backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Icon name="Settings" size={12} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Dual-State Billing Dashboard */}
      <View style={styles.dashboardBox}>
        <View style={styles.dashboardRow}>
          {/* Next Turn */}
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Next Turn</Text>
            <View style={styles.metricTierRow}>
              <Text style={styles.metricTier}>{capitalize(currentTier)}</Text>
            </View>
            <Text style={styles.metricModel} numberOfLines={1}>
              {meta?.currentModel ?? agent?.model ?? "—"}
            </Text>
            {isPlanMode ? (
              <View style={styles.modeGateBadge}>
                <Text style={styles.modeGateText}>Read-only Plan Gate</Text>
              </View>
            ) : null}
          </View>

          {/* Last Billed */}
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Last Billed</Text>
            <View style={styles.metricTierRow}>
              <Text style={styles.metricTier}>
                {lastBilledTier ? capitalize(lastBilledTier) : "—"}
              </Text>
            </View>
            <Text style={styles.metricModel} numberOfLines={1}>
              {meta?.lastBilledModel ?? "Not billed yet"}
            </Text>
          </View>
        </View>

        {/* Dual-State Notice Banner */}
        {isDualStateMismatched ? (
          <View style={styles.dualStateBanner}>
            <Text style={styles.dualStateBannerText}>
              Last turn billed as {capitalize(lastBilledTier!)}; next turn runs as{" "}
              {capitalize(currentTier)}.
            </Text>
          </View>
        ) : null}

        {/* Telemetry info */}
        <View style={styles.telemetryRow}>
          <Text style={styles.telemetryText}>
            Turns: {meta?.turnCount ?? 0} · Plan Turns: {meta?.planTurnCount ?? 0}
          </Text>
          <Text style={styles.telemetryText}>Mode: {agent?.currentModeId ?? "default"}</Text>
        </View>
      </View>

      {/* Manual Tier Switch */}
      <Text style={styles.sectionTitle}>Model Tier Switch</Text>
      <View style={styles.tierGrid}>
        {(["plan", "flash", "review"] as const).map((tier) => {
          const isActive = currentTier === tier;
          const tierIcon = tier === "plan" ? "Compass" : tier === "review" ? "ShieldCheck" : "Zap";

          return (
            <Pressable
              key={tier}
              disabled={isSwitching}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${tier}`}
              onPress={() => handleSwitchTier(tier)}
              style={({ pressed }) => [
                styles.tierButton,
                isActive && styles.tierButtonActive,
                pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Icon
                name={tierIcon}
                size={12}
                color={isActive ? theme.colors.accent : theme.colors.foregroundMuted}
              />
              <Text style={[styles.tierButtonText, isActive && styles.tierButtonTextActive]}>
                {capitalize(tier)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Specialist Handoff */}
      <Text style={styles.sectionTitle}>Specialist Handoff</Text>

      {isDesignPhase ? (
        <View style={styles.handoffRecommendation}>
          <Icon name="Sparkles" size={11} color={theme.colors.accent} />
          <Text style={styles.handoffRecommendationText}>
            Design ready: Handoff to Flash Specialist recommended
          </Text>
        </View>
      ) : null}

      <View style={styles.specialistGrid}>
        {(
          [
            {
              role: "ui" as const,
              name: "UI Specialist",
              desc: "Frontend & styles",
              icon: "Palette",
            },
            {
              role: "backend" as const,
              name: "Backend Specialist",
              desc: "API & services",
              icon: "Server",
            },
            {
              role: "qa" as const,
              name: "QA Gatekeeper",
              desc: "Tests & verify",
              icon: "CheckCircle2",
            },
            {
              role: "review" as const,
              name: "Reviewer (Gate)",
              desc: "Dual-axis audit",
              icon: "ShieldCheck",
            },
          ] as const
        ).map((spec) => {
          const isHighlight = isDesignPhase && (spec.role === "ui" || spec.role === "backend");

          return (
            <Pressable
              key={spec.role}
              disabled={isHandoffRunning}
              accessibilityRole="button"
              accessibilityLabel={spec.name}
              onPress={() => handleHandoff(spec.role)}
              style={({ pressed }) => [
                styles.specialistCard,
                isHighlight && styles.specialistCardDesignHint,
                pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
              ]}
            >
              <View style={styles.specialistHeader}>
                <Icon
                  name={spec.icon}
                  size={12}
                  color={isHighlight ? theme.colors.accent : theme.colors.foreground}
                />
                <Text style={styles.specialistName} numberOfLines={1}>
                  {spec.name}
                </Text>
              </View>
              <Text style={styles.specialistDesc} numberOfLines={1}>
                {spec.desc}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Open Settings Footer */}
      {onOpenSettings ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Harness Settings"
          onPress={() => {
            onOpenSettings();
            close();
          }}
          style={({ pressed }) => [
            styles.settingsLink,
            pressed && { opacity: 0.7, backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon name="Settings" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.settingsLinkText}>Configure Harness Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
});
