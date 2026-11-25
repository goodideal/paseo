import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent, useComposers, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { normalizeTierAlias } from "../shared/config-resolver.js";
import {
  harnessDebugToggleRpc,
  harnessEffectiveConfigRpc,
  harnessHandoffRpc,
  harnessSwitchTierRpc,
} from "../shared/contracts.js";
import { isModelBypassed } from "../shared/intent-detector.js";
import { HARNESS_BYPASSED_META_KEY } from "../shared/lifecycle-state.js";
import { BUILTIN_BYPASS_MODELS, BUILTIN_SPECIALISTS } from "../shared/presets.js";
import { agentHarnessSettings } from "../shared/settings.js";
import type {
  AgentTeamSummary,
  HandoffTargetRole,
  HarnessSpecialistConfig,
  MatrixTier,
} from "../shared/types.js";
import {
  capitalize,
  extractAgentHarnessMetadata,
  formatRoleDisplayName,
  resolveHarnessPillIcon,
} from "./metadata-utils.js";
import { subscribeWorkspaceTeamUpdated } from "./team-events.js";

const IOS_SHEET_CLOSE_DELAY_MS = 250;

function resolveSpecialistDisplayName(
  specialist: HarnessSpecialistConfig,
  isDynamicWorkspaceTeam: boolean,
): string {
  if (isDynamicWorkspaceTeam || (!specialist.builtIn && specialist.shortLabel === specialist.id)) {
    return specialist.id;
  }
  if (specialist.shortLabel) {
    return `${specialist.shortLabel} Specialist`;
  }
  return specialist.name;
}

function resolveSourceSpecialists(
  workspaceSpecialists: HarnessSpecialistConfig[] | null,
  settings: { status: string; values?: { specialists?: HarnessSpecialistConfig[] } },
): readonly HarnessSpecialistConfig[] {
  if (workspaceSpecialists && workspaceSpecialists.length > 0) {
    return workspaceSpecialists;
  }
  if (settings.status === "ready" && Array.isArray(settings.values?.specialists)) {
    return settings.values.specialists;
  }
  return BUILTIN_SPECIALISTS;
}

function resolvePhaseBadgeText(
  meta: ReturnType<typeof extractAgentHarnessMetadata>,
  isBypassedSession: boolean,
): string {
  if (meta) {
    return `${formatRoleDisplayName(meta.role)} · ${meta.phase}`;
  }
  return isBypassedSession ? "NATIVE ORCHESTRATOR" : "UNTRACKED";
}

function resolveModeGateBadgeLabel(
  isPlanMode: boolean,
  isBypassedSession: boolean,
  currentTier: MatrixTier,
): string | null {
  if (isPlanMode) {
    return "Read-only Plan (steps down to Standard)";
  }
  if (!isBypassedSession && currentTier === "max") {
    return "Manual Max · High quota usage";
  }
  return null;
}

function formatTierWithThinking(tierLabel: string, thinking?: string | null): string {
  if (thinking) {
    return `${tierLabel} · ${thinking}`;
  }
  return tierLabel;
}

function resolveNextTurnDisplay(
  isBypassedSession: boolean,
  currentTier: MatrixTier,
  currentThinking?: string | null,
): string {
  if (isBypassedSession) {
    return "Native";
  }
  return formatTierWithThinking(capitalize(currentTier), currentThinking);
}

function resolveLastBilledDisplay(
  lastBilledTier: MatrixTier | null,
  lastBilledThinking?: string | null,
): string {
  if (!lastBilledTier) {
    return "—";
  }
  return formatTierWithThinking(capitalize(lastBilledTier), lastBilledThinking);
}

function chunkIntoPairs<T>(items: readonly T[]): Array<readonly [T, T | null]> {
  const pairs: Array<readonly [T, T | null]> = [];
  for (let i = 0; i < items.length; i += 2) {
    pairs.push([items[i]!, items[i + 1] ?? null]);
  }
  return pairs;
}

export type HarnessPopoverProps = PluginButtonContentProps & {
  workspaceId: string;
  agentId: string;
  onOpenSettings?: () => void;
  onOpenTeamEditor?: () => void;
};

export const HarnessPopover = memo(function HarnessPopover({
  workspaceId,
  agentId,
  theme,
  layout,
  close,
  onOpenSettings,
  onOpenTeamEditor,
}: HarnessPopoverProps) {
  const toast = useToast();
  const composers = useComposers({ agentId });
  const switchTierRpc = useRpc(harnessSwitchTierRpc);
  const handoffRpc = useRpc(harnessHandoffRpc);
  const effectiveConfigRpc = useRpc(harnessEffectiveConfigRpc);
  const debugToggleRpc = useRpc(harnessDebugToggleRpc);
  const settings = useSettings(agentHarnessSettings);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const agent = useAgent(agentId, (a) => ({
    status: a.status,
    provider: a.provider,
    model: a.model,
    cwd: a.cwd,
    currentModeId: a.currentModeId,
    metadata: a.metadata,
  }));

  const [workspaceSpecialists, setWorkspaceSpecialists] = useState<
    HarnessSpecialistConfig[] | null
  >(null);
  const [workspaceAgentTeam, setWorkspaceAgentTeam] = useState<AgentTeamSummary | null>(null);
  const [teamRefreshTick, setTeamRefreshTick] = useState(0);

  useEffect(() => {
    return subscribeWorkspaceTeamUpdated(workspaceId, () => {
      setTeamRefreshTick((prev) => prev + 1);
    });
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    if (!effectiveConfigRpc) return;
    Promise.resolve(effectiveConfigRpc({ workspaceId, cwd: agent?.cwd ?? null }))
      .then((res) => {
        if (cancelled || !res || typeof res !== "object") return;
        const cfg = (res as { config?: unknown }).config as
          | { specialists?: unknown; agentTeam?: AgentTeamSummary | null }
          | undefined;
        if (cfg && Array.isArray(cfg.specialists)) {
          setWorkspaceSpecialists(cfg.specialists as HarnessSpecialistConfig[]);
        }
        if (cfg && "agentTeam" in cfg) {
          setWorkspaceAgentTeam(cfg.agentTeam ?? null);
        }
      })
      .catch(() => {
        // Keep fallback specialists from host settings
      });
    return () => {
      cancelled = true;
    };
  }, [agent?.cwd, effectiveConfigRpc, teamRefreshTick, workspaceId]);

  const meta = useMemo(() => extractAgentHarnessMetadata(agent?.metadata), [agent?.metadata]);
  const isBypassedSession = useMemo(() => {
    if (meta) return false;
    const rawMeta = agent?.metadata as Record<string, unknown> | undefined;
    if (Boolean(rawMeta?.[HARNESS_BYPASSED_META_KEY])) {
      return true;
    }
    const configuredBypassModels =
      settings.status === "ready" && Array.isArray(settings.values.bypassModels)
        ? settings.values.bypassModels
        : BUILTIN_BYPASS_MODELS;
    return isModelBypassed(agent?.model, configuredBypassModels);
  }, [agent?.metadata, agent?.model, meta, settings]);

  const handoffSpecialists = useMemo(() => {
    const isDynamicWorkspaceTeam = Boolean(workspaceAgentTeam);
    const mapSpecialist = (s: HarnessSpecialistConfig) => {
      const displayName = resolveSpecialistDisplayName(s, isDynamicWorkspaceTeam);
      const targetProvider =
        s.preferredProvider?.trim() || (isDynamicWorkspaceTeam ? "inherit" : "");
      const targetModel =
        s.modelOverride?.trim() ||
        (s.preferredTier ? normalizeTierAlias(s.preferredTier) : "standard");
      return {
        role: s.id as HandoffTargetRole,
        name: displayName,
        desc: targetProvider
          ? `${targetProvider} · ${targetModel}`
          : s.description || `Role: ${s.id}`,
        icon: s.icon || "Bot",
        readonly: Boolean(s.readonly || (s.builtIn && s.id === "review")),
      };
    };

    const sourceSpecialists = resolveSourceSpecialists(workspaceSpecialists, settings);

    const configured = sourceSpecialists
      .filter((s) => s.enabled && s.handoffEnabled)
      .slice()
      .sort((a, b) => (a.handoffPriority ?? 50) - (b.handoffPriority ?? 50))
      .map(mapSpecialist);

    return configured.length > 0
      ? configured
      : BUILTIN_SPECIALISTS.filter((s) => s.handoffEnabled)
          .slice()
          .sort((a, b) => (a.handoffPriority ?? 50) - (b.handoffPriority ?? 50))
          .map(mapSpecialist);
  }, [settings, workspaceAgentTeam, workspaceSpecialists]);

  const [isSwitching, setIsSwitching] = useState(false);
  const [isHandoffRunning, setIsHandoffRunning] = useState(false);
  const settingsDebugEnabled =
    settings.status === "ready" ? Boolean(settings.values?.debugLogs) : false;
  const [localDebugEnabled, setLocalDebugEnabled] = useState<boolean>(settingsDebugEnabled);
  const [isDebugToggling, setIsDebugToggling] = useState(false);
  const debugToggleLockRef = useRef(false);
  const [settingsHovered, setSettingsHovered] = useState(false);
  const [debugHovered, setDebugHovered] = useState(false);

  useEffect(() => {
    if (settings.status === "ready") {
      setLocalDebugEnabled(settingsDebugEnabled);
    }
  }, [settings.status, settingsDebugEnabled]);

  const rawTier: MatrixTier = meta?.currentTier ?? "standard";
  const currentTier: MatrixTier = normalizeTierAlias(rawTier);
  const lastBilledTier: MatrixTier | null = meta?.lastBilledTier
    ? normalizeTierAlias(meta.lastBilledTier)
    : null;
  const isDualStateMismatched = lastBilledTier !== null && lastBilledTier !== currentTier;

  // Handle manual model tier switch
  const handleSwitchTier = useCallback(
    async (targetTier: MatrixTier) => {
      if (isSwitching || isBypassedSession) return;
      setIsSwitching(true);
      try {
        const res = await switchTierRpc({
          agentId,
          targetTier,
          currentModeId: agent?.currentModeId ?? null,
          reason: "Manual switch from Harness popover",
        });

        const activeComposer = composers[0];
        if (activeComposer) {
          if (res.recommendedModeId && typeof activeComposer.setMode === "function") {
            await activeComposer.setMode(res.recommendedModeId).catch(() => {});
          }
          if (res.recommendedThinkingOptionId && typeof activeComposer.setThinking === "function") {
            await activeComposer.setThinking(res.recommendedThinkingOptionId).catch(() => {});
          }
        }

        toast.show(`Switched to ${capitalize(targetTier)} (${res.currentModel})`, {
          variant: "success",
        });
      } catch (err) {
        toast.error(`Failed to switch tier: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSwitching(false);
      }
    },
    [
      agent?.currentModeId,
      agentId,
      composers,
      isBypassedSession,
      isSwitching,
      switchTierRpc,
      toast,
    ],
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

  // Handle persistent Debug Trace quick toggle
  const handleToggleDebug = useCallback(async () => {
    if (debugToggleLockRef.current || isDebugToggling) return;
    if (settings.status !== "ready") {
      toast.error("Agent Harness settings are not ready");
      return;
    }
    if (settings.saving) return;

    const nextEnabled = !localDebugEnabled;
    debugToggleLockRef.current = true;
    setIsDebugToggling(true);
    try {
      if (typeof settings.save === "function") {
        const ok = await settings.save(
          { ...settings.values, debugLogs: nextEnabled },
          settings.revision,
        );
        if (ok === false) {
          toast.error(settings.saveError || "Failed to save debug trace setting");
          return;
        }
      }
      const res = await debugToggleRpc({ enabled: nextEnabled });
      const confirmedEnabled = typeof res?.enabled === "boolean" ? res.enabled : nextEnabled;
      if (isMountedRef.current) {
        setLocalDebugEnabled(confirmedEnabled);
      }
      toast.show(confirmedEnabled ? "Debug trace enabled" : "Debug trace disabled", {
        variant: "success",
      });
    } catch (err) {
      toast.error(
        `Failed to toggle debug trace: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      debugToggleLockRef.current = false;
      if (isMountedRef.current) {
        setIsDebugToggling(false);
      }
    }
  }, [debugToggleRpc, isDebugToggling, localDebugEnabled, settings, toast]);

  const pillIcon = useMemo(() => resolveHarnessPillIcon(meta), [meta]);
  const specialistRows = useMemo(() => chunkIntoPairs(handoffSpecialists), [handoffSpecialists]);

  const runAfterClose = useCallback(
    (action: () => void) => {
      const invoke = () => {
        try {
          action();
        } catch (err) {
          toast.error(`Unable to open view: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      close();
      if (layout.platform === "ios") {
        // Defer native navigation past iOS sheet teardown without clearing on unmount (close unmounts this surface).
        setTimeout(invoke, IOS_SHEET_CLOSE_DELAY_MS);
        return;
      }
      invoke();
    },
    [close, layout.platform, toast],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 320,
          backgroundColor: "transparent",
          paddingHorizontal: layout.compact ? 0 : 2,
          paddingTop: layout.compact ? 0 : 2,
          paddingBottom: layout.compact ? 4 : 2,
          gap: 10,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingBottom: 2,
        },
        headerLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          flexShrink: 1,
          minWidth: 0,
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
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          flexShrink: 1,
        },
        phaseBadgeText: {
          fontSize: 9,
          fontWeight: "700",
          color: theme.colors.accent,
          textTransform: "uppercase",
        },
        iconButton: {
          width: layout.compact ? 32 : 24,
          height: layout.compact ? 32 : 24,
          borderRadius: 6,
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
          minWidth: 0,
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
          gap: 8,
        },
        telemetryText: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
          flexShrink: 1,
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
          gap: 5,
        },
        tierButton: {
          flex: 1,
          minWidth: 0,
          minHeight: layout.compact ? 38 : 32,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          paddingHorizontal: 4,
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
          fontSize: 11,
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
          flexShrink: 1,
        },
        specialistGrid: {
          flexDirection: "column",
          gap: 6,
        },
        specialistRow: {
          flexDirection: "row",
          gap: 6,
        },
        specialistSpacer: {
          flex: 1,
        },
        specialistNameRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flex: 1,
          minWidth: 0,
          gap: 4,
        },
        readonlyTag: {
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 4,
          paddingVertical: 1,
          borderRadius: 3,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        readonlyTagText: {
          fontSize: 8,
          fontWeight: "700",
          color: theme.colors.statusWarning,
        },
        specialistCard: {
          flex: 1,
          minWidth: 0,
          minHeight: layout.compact ? 46 : undefined,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: layout.compact ? 8 : 6,
          gap: 2,
          justifyContent: "center",
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
          flexShrink: 1,
        },
        specialistDesc: {
          fontSize: 9,
          color: theme.colors.foregroundMuted,
        },
        settingsLink: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          minHeight: layout.compact ? 44 : 32,
          paddingHorizontal: 10,
          paddingVertical: layout.compact ? 8 : 6,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        settingsLinkText: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foregroundMuted,
          flexShrink: 1,
        },
        footerRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        footerLinkWrap: {
          position: "relative",
          flex: 1,
          minWidth: 0,
        },
        debugButtonWrap: {
          position: "relative",
          flexShrink: 0,
        },
        debugButton: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          minHeight: layout.compact ? 44 : 32,
          paddingHorizontal: 10,
          paddingVertical: layout.compact ? 8 : 6,
          borderRadius: 6,
          backgroundColor: theme.colors.surface0,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        debugButtonActive: {
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.accent ?? theme.colors.border,
        },
        debugDot: {
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.foregroundMuted,
        },
        debugDotActive: {
          backgroundColor: theme.colors.accent ?? theme.colors.foreground,
        },
        debugButtonText: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foregroundMuted,
        },
        debugButtonTextActive: {
          color: theme.colors.accent ?? theme.colors.foreground,
        },
      }),
    [theme, layout.compact, layout.platform],
  );

  const isPlanMode = agent?.currentModeId === "plan";
  const isParentRunning = agent?.status === "running";
  const isDesignPhase = meta?.phase === "design";
  const phaseBadgeText = resolvePhaseBadgeText(meta, isBypassedSession);
  const modeGateLabel = resolveModeGateBadgeLabel(isPlanMode, isBypassedSession, currentTier);
  const nextTurnDisplay = resolveNextTurnDisplay(
    isBypassedSession,
    currentTier,
    meta?.currentThinking,
  );
  const lastBilledDisplay = resolveLastBilledDisplay(lastBilledTier, meta?.lastBilledThinking);
  const isDebugButtonDisabled =
    settings.status !== "ready" || Boolean(settings.saving) || isDebugToggling;
  const headerSettingsIconSize = layout.compact ? 15 : 12;

  return (
    <View style={styles.container}>
      {/* Header (menu sheet header already owns the title on compact layouts) */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name={pillIcon} size={13} color={theme.colors.accent} />
          {!layout.compact ? <Text style={styles.headerTitle}>Agent Harness</Text> : null}
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseBadgeText} numberOfLines={1}>
              {phaseBadgeText}
            </Text>
          </View>
        </View>

        {onOpenSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Harness Settings"
            hitSlop={8}
            onPress={() => runAfterClose(onOpenSettings)}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && { opacity: 0.6, backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Icon
              name="Settings"
              size={headerSettingsIconSize}
              color={theme.colors.foregroundMuted}
            />
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
              <Text style={styles.metricTier}>{nextTurnDisplay}</Text>
            </View>
            <Text style={styles.metricModel} numberOfLines={1}>
              {meta?.currentModel ?? agent?.model ?? "—"}
            </Text>
            {modeGateLabel ? (
              <View style={styles.modeGateBadge}>
                <Text style={styles.modeGateText}>{modeGateLabel}</Text>
              </View>
            ) : null}
          </View>

          {/* Last Billed */}
          <View style={styles.metricCol}>
            <Text style={styles.metricLabel}>Last Billed</Text>
            <View style={styles.metricTierRow}>
              <Text style={styles.metricTier}>{lastBilledDisplay}</Text>
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
          <Text style={styles.telemetryText} numberOfLines={1}>
            Mode: {agent?.currentModeId ?? "default"}
          </Text>
        </View>
      </View>

      {/* Manual Tier Switch */}
      <Text style={styles.sectionTitle}>Model Tier Switch</Text>
      {isBypassedSession ? (
        <View style={styles.dualStateBanner}>
          <Text style={styles.dualStateBannerText}>
            Managed natively by Orchestrator — tier switching disabled.
          </Text>
        </View>
      ) : null}
      <View style={styles.tierGrid}>
        {(
          [
            { id: "fast", label: "Fast", icon: "Zap" },
            { id: "standard", label: "Standard", icon: "Cpu" },
            { id: "deep", label: "Deep", icon: "Compass" },
            { id: "max", label: "Max", icon: "Flame" },
          ] as const
        ).map(({ id: tier, label, icon: tierIcon }) => {
          const isActive = !isBypassedSession && currentTier === tier;

          return (
            <Pressable
              key={tier}
              disabled={isSwitching || isBypassedSession}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${tier}`}
              onPress={() => handleSwitchTier(tier)}
              style={({ pressed }) => [
                styles.tierButton,
                isActive && styles.tierButtonActive,
                isBypassedSession && { opacity: 0.45 },
                pressed && !isBypassedSession && { opacity: 0.7, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Icon
                name={tierIcon}
                size={11}
                color={isActive ? theme.colors.accent : theme.colors.foregroundMuted}
              />
              <Text
                style={[styles.tierButtonText, isActive && styles.tierButtonTextActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Specialist Handoff */}
      <Text style={styles.sectionTitle}>Specialist Handoff</Text>

      {isParentRunning ? (
        <View style={styles.dualStateBanner}>
          <Text style={styles.dualStateBannerText}>
            Parent turn running — writable specialists locked until turn ends
          </Text>
        </View>
      ) : null}

      {isDesignPhase ? (
        <View style={styles.handoffRecommendation}>
          <Icon name="Sparkles" size={11} color={theme.colors.accent} />
          <Text style={styles.handoffRecommendationText}>
            Design ready: Handoff to Standard Specialist recommended
          </Text>
        </View>
      ) : null}

      <View style={styles.specialistGrid}>
        {specialistRows.map(([left, right]) => (
          <View key={`${left.role}-${right ? right.role : "empty"}`} style={styles.specialistRow}>
            {[left, right].map((spec, colIdx) => {
              if (!spec) {
                return <View key={`spacer-${colIdx}`} style={styles.specialistSpacer} />;
              }
              const isHighlight = isDesignPhase && (spec.role === "ui" || spec.role === "backend");
              const isWritableBlocked = isParentRunning && !spec.readonly;
              const isDisabled = isHandoffRunning || isWritableBlocked;

              return (
                <Pressable
                  key={spec.role}
                  disabled={isDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={spec.name}
                  onPress={() => handleHandoff(spec.role)}
                  style={({ pressed }) => [
                    styles.specialistCard,
                    isHighlight && styles.specialistCardDesignHint,
                    isWritableBlocked && { opacity: 0.45 },
                    pressed && !isDisabled && { opacity: 0.7, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <View style={styles.specialistHeader}>
                    <Icon
                      name={spec.icon}
                      size={12}
                      color={isHighlight ? theme.colors.accent : theme.colors.foreground}
                    />
                    <View style={styles.specialistNameRow}>
                      <Text style={styles.specialistName} numberOfLines={1}>
                        {spec.name}
                      </Text>
                      {spec.readonly ? (
                        <View style={styles.readonlyTag}>
                          <Text style={styles.readonlyTagText}>RO</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.specialistDesc} numberOfLines={1}>
                    {spec.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Open Workspace Team & Settings + Debug Footer */}
      {onOpenTeamEditor ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Configure workspace team"
          onPress={() => runAfterClose(onOpenTeamEditor)}
          style={({ pressed }) => [
            styles.settingsLink,
            pressed && { opacity: 0.7, backgroundColor: theme.colors.surface2 },
          ]}
        >
          <Icon name="Users" size={12} color={theme.colors.accent} />
          <Text style={styles.settingsLinkText} numberOfLines={1}>
            Configure workspace team
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.footerRow}>
        {onOpenSettings ? (
          <View
            style={styles.footerLinkWrap}
            onPointerEnter={() => setSettingsHovered(true)}
            onPointerLeave={() => setSettingsHovered(false)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Harness Settings"
              onPress={() => runAfterClose(onOpenSettings)}
              style={({ pressed }) => [
                styles.settingsLink,
                settingsHovered && { backgroundColor: theme.colors.surface2 },
                pressed && { opacity: 0.7, backgroundColor: theme.colors.surface2 },
              ]}
            >
              <Icon name="Settings" size={12} color={theme.colors.foregroundMuted} />
              <Text style={styles.settingsLinkText} numberOfLines={1}>
                Configure Harness Settings
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={onOpenSettings ? styles.debugButtonWrap : styles.footerLinkWrap}
          onPointerEnter={() => setDebugHovered(true)}
          onPointerLeave={() => setDebugHovered(false)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={localDebugEnabled ? "Debug: ON" : "Debug: OFF"}
            accessibilityHint="Toggle persistent agent harness debug trace"
            accessibilityState={{
              checked: localDebugEnabled,
              disabled: isDebugButtonDisabled,
              busy: isDebugToggling,
            }}
            disabled={isDebugButtonDisabled}
            onPress={() => void handleToggleDebug()}
            style={({ pressed }) => [
              styles.debugButton,
              localDebugEnabled && styles.debugButtonActive,
              debugHovered &&
                !isDebugButtonDisabled &&
                !localDebugEnabled && { backgroundColor: theme.colors.surface1 },
              isDebugButtonDisabled && { opacity: 0.5 },
              pressed && !isDebugButtonDisabled && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.debugDot, localDebugEnabled && styles.debugDotActive]} />
            <Text
              style={[styles.debugButtonText, localDebugEnabled && styles.debugButtonTextActive]}
              numberOfLines={1}
            >
              {localDebugEnabled ? "Debug: ON" : "Debug: OFF"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});
