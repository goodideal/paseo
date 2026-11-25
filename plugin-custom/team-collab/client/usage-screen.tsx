import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useRpc,
  useTranslation,
  type PluginScreenProps,
  type PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import {
  SYSTEM_BOT_DEFAULT_NAME,
  SYSTEM_BOT_MEMBER_ID,
  teamCollabRosterStatusRpc,
  teamCollabUsageExportRpc,
  teamCollabUsageQueryRpc,
  type MemberUsageSummary,
  type RecentTurnRecord,
  type RosterMemberStatus,
  type TeamCollabUsageQueryOutput,
  type UsageExportFormat,
} from "../shared/contracts.js";
import { messages, TEAM_USAGE_SCREEN_ID } from "./messages.js";
import {
  ActionButton,
  formatCompactNumber,
  formatDurationMs,
  formatShortTimestamp,
  formatUsd,
  monoFontFamily,
  resolveDateRangeFromPreset,
  SegmentedTabs,
  StatusTag,
  type DateRangePreset,
  type SegmentedOption,
} from "./ui-primitives.js";
import { useDefaultMemberId } from "./web.js";
import { useRosterRefreshVersion } from "./workspace-store.js";

const ALL_MEMBERS_FILTER: string = "__all__";
type MemberFilterValue = string;
type OptionalErrorText = string | null;

export const TeamSidebarFooterItem = memo(function TeamSidebarFooterItem({
  currentScreen,
  openScreen,
}: PluginSidebarItemProps) {
  const { t } = useTranslation(messages);
  const [defaultMemberId] = useDefaultMemberId();

  const label = defaultMemberId
    ? t("sidebar.teamWithIdentity", { id: defaultMemberId })
    : t("sidebar.teamUsage");

  return (
    <SidebarRow
      icon="Users"
      label={label}
      active={currentScreen?.screenId === TEAM_USAGE_SCREEN_ID}
      onPress={() => openScreen({ screenId: TEAM_USAGE_SCREEN_ID })}
    />
  );
});

export type TeamUsageScreenProps = PluginScreenProps & {
  onOpenSettings(): void;
};

export const TeamUsageScreen = memo(function TeamUsageScreen({
  theme,
  layout,
  navigation,
  onOpenSettings,
}: TeamUsageScreenProps) {
  const { t } = useTranslation(messages);
  const toast = useToast();

  const queryRoster = useRpc(teamCollabRosterStatusRpc);
  const queryUsage = useRpc(teamCollabUsageQueryRpc);
  const exportUsage = useRpc(teamCollabUsageExportRpc);

  const [defaultMemberId, setDefaultMemberId] = useDefaultMemberId();
  const rosterRefreshVersion = useRosterRefreshVersion();

  const [rangePreset, setRangePreset] = useState<DateRangePreset>("30d");
  const [memberFilter, setMemberFilter] = useState<MemberFilterValue>(ALL_MEMBERS_FILTER);
  const [refreshTick, setRefreshTick] = useState(0);

  const [members, setMembers] = useState<RosterMemberStatus[]>([]);
  const [usage, setUsage] = useState<TeamCollabUsageQueryOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<OptionalErrorText>(null);
  const [exportingFormat, setExportingFormat] = useState<UsageExportFormat | null>(null);

  useEffect(() => {
    let cancelled = false;
    void queryRoster({})
      .then((res) => {
        if (!cancelled) {
          setMembers(res.members);
        }
      })
      .catch(() => {
        // Roster fallback comes from usage rows if needed
      });
    return () => {
      cancelled = true;
    };
  }, [queryRoster, rosterRefreshVersion, refreshTick]);

  const dateRange = useMemo(() => resolveDateRangeFromPreset(rangePreset), [rangePreset]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void queryUsage({
      ...dateRange,
      memberId: memberFilter === ALL_MEMBERS_FILTER ? undefined : memberFilter,
      limitTurns: 60,
    })
      .then((res) => {
        if (cancelled) return;
        setUsage(res);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : String(error);
        setLoadError(msg);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, memberFilter, queryUsage, refreshTick, rosterRefreshVersion]);

  const enabledMembers = useMemo(() => members.filter((m) => m.enabled !== false), [members]);

  const memberFilterOptions = useMemo(() => {
    const items: Array<{ id: string; label: string; isBot?: boolean }> = [
      { id: ALL_MEMBERS_FILTER, label: t("usage.memberAll") },
    ];
    const seen = new Set([ALL_MEMBERS_FILTER]);

    for (const m of members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      items.push({ id: m.id, label: `@${m.id}` });
    }
    if (usage) {
      for (const row of usage.byMember) {
        if (seen.has(row.ownerId)) continue;
        seen.add(row.ownerId);
        items.push({
          id: row.ownerId,
          label: `@${row.ownerId}`,
          isBot: row.kind === "bot" || row.ownerId === SYSTEM_BOT_MEMBER_ID,
        });
      }
    }
    if (!seen.has(SYSTEM_BOT_MEMBER_ID)) {
      items.push({
        id: SYSTEM_BOT_MEMBER_ID,
        label: `@${SYSTEM_BOT_MEMBER_ID}`,
        isBot: true,
      });
    }
    return items;
  }, [members, t, usage]);

  const rangeOptions: readonly SegmentedOption<DateRangePreset>[] = useMemo(
    () => [
      { value: "7d", label: t("usage.range7d") },
      { value: "30d", label: t("usage.range30d") },
      { value: "90d", label: t("usage.range90d") },
      { value: "all", label: t("usage.rangeAll") },
    ],
    [t],
  );

  const handleExport = useCallback(
    async (format: UsageExportFormat) => {
      if (exportingFormat !== null) return;
      setExportingFormat(format);
      try {
        const res = await exportUsage({
          ...dateRange,
          memberId: memberFilter === ALL_MEMBERS_FILTER ? undefined : memberFilter,
          format,
        });
        await copyText(res.content);
        toast.show(
          t("usage.toastExportCopied", {
            count: res.rowCount,
            format: format.toUpperCase(),
          }),
          { variant: "success" },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(t("usage.toastExportFailed", { error: msg }));
      } finally {
        setExportingFormat(null);
      }
    },
    [dateRange, exportUsage, exportingFormat, memberFilter, t, toast],
  );

  const rankedMembers = useMemo(() => {
    if (!usage) return [];
    return [...usage.byMember].sort((a, b) => {
      if (b.totalCostUsd !== a.totalCostUsd) {
        return b.totalCostUsd - a.totalCostUsd;
      }
      if (b.turns !== a.turns) {
        return b.turns - a.turns;
      }
      return b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens);
    });
  }, [usage]);

  const maxMemberWeight = useMemo(() => {
    if (rankedMembers.length === 0) return 1;
    const maxCost = Math.max(...rankedMembers.map((m) => m.totalCostUsd));
    if (maxCost > 0) return maxCost;
    const maxTurns = Math.max(...rankedMembers.map((m) => m.turns));
    return maxTurns > 0 ? maxTurns : 1;
  }, [rankedMembers]);

  const totals = usage?.totals ?? {
    turns: 0,
    completedTurns: 0,
    failedTurns: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    commitCount: 0,
  };

  const completionRate =
    totals.turns > 0 ? Math.round((totals.completedTurns / totals.turns) * 100) : 0;
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const avgCostPerTurn = totals.turns > 0 ? totals.totalCostUsd / totals.turns : 0;

  const mono = monoFontFamily(layout.platform);

  return (
    <ScrollView
      style={[styles.scrollRoot, { backgroundColor: theme.colors.surface0 }]}
      contentContainerStyle={[styles.scrollContent, { padding: layout.compact ? 16 : 24 }]}
    >
      <View style={styles.pageColumn}>
        {/* 1. Current Terminal Identity Bar */}
        <View
          style={[
            styles.identityCard,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View style={styles.identityHeaderRow}>
            <View style={styles.identityLabelCol}>
              <View style={styles.identityTitleRow}>
                <Icon
                  name={defaultMemberId ? "UserCheck" : "Users"}
                  size={16}
                  color={defaultMemberId ? theme.colors.accent : theme.colors.foregroundMuted}
                />
                <Text style={[styles.sectionLabel, { color: theme.colors.foreground }]}>
                  {t("usage.deviceIdentityLabel")}
                </Text>
              </View>
              <Text style={[styles.hintText, { color: theme.colors.foregroundMuted }]}>
                {layout.platform === "web"
                  ? t("usage.devicePersistenceWeb")
                  : t("usage.devicePersistenceNative")}
              </Text>
            </View>

            <ActionButton
              label={t("usage.manageMembersAction")}
              icon="KeyRound"
              variant="outline"
              compactSize
              theme={theme}
              compactLayout={layout.compact}
              onPress={onOpenSettings}
            />
          </View>

          <View style={styles.chipWrapRow}>
            <IdentityChip
              label={t("usage.identityNone")}
              selected={defaultMemberId === null}
              mono={false}
              platform={layout.platform}
              theme={theme}
              compactLayout={layout.compact}
              onPress={() => setDefaultMemberId(null)}
            />
            {enabledMembers.map((m) => (
              <IdentityChip
                key={m.id}
                label={`${m.name} · @${m.id}`}
                selected={defaultMemberId === m.id}
                mono={false}
                platform={layout.platform}
                theme={theme}
                compactLayout={layout.compact}
                onPress={() => setDefaultMemberId(m.id)}
              />
            ))}
          </View>
        </View>

        {/* 2. Filter & Export Toolbar */}
        <View style={styles.toolbarBlock}>
          <View style={styles.toolbarTopRow}>
            <SegmentedTabs<DateRangePreset>
              options={rangeOptions}
              value={rangePreset}
              onChange={setRangePreset}
              theme={theme}
              compactLayout={layout.compact}
            />

            <View style={styles.exportRow}>
              <ActionButton
                accessibilityLabel={t("usage.refreshAction")}
                icon="RefreshCw"
                variant="outline"
                compactSize
                disabled={loading}
                theme={theme}
                compactLayout={layout.compact}
                onPress={() => setRefreshTick((v) => v + 1)}
              />
              <ActionButton
                label={
                  exportingFormat === "csv" ? t("usage.copyingAction") : t("usage.copyCsvAction")
                }
                icon="Download"
                variant="secondary"
                compactSize
                disabled={exportingFormat !== null}
                theme={theme}
                compactLayout={layout.compact}
                onPress={() => void handleExport("csv")}
              />
              <ActionButton
                label={
                  exportingFormat === "json" ? t("usage.copyingAction") : t("usage.copyJsonAction")
                }
                icon="Download"
                variant="outline"
                compactSize
                disabled={exportingFormat !== null}
                theme={theme}
                compactLayout={layout.compact}
                onPress={() => void handleExport("json")}
              />
            </View>
          </View>

          <View style={styles.chipWrapRow}>
            {memberFilterOptions.map((opt) => (
              <IdentityChip
                key={opt.id}
                label={opt.label}
                icon={opt.isBot ? "Bot" : undefined}
                selected={memberFilter === opt.id}
                mono={opt.id !== ALL_MEMBERS_FILTER}
                platform={layout.platform}
                theme={theme}
                compactLayout={layout.compact}
                onPress={() => setMemberFilter(opt.id)}
              />
            ))}
          </View>
        </View>

        {/* Error / Initial Loading Banner */}
        {loadError ? (
          <View
            style={[
              styles.noticeCard,
              {
                backgroundColor: theme.colors.surface1,
                borderColor: theme.colors.statusDanger,
              },
            ]}
          >
            <Text style={[styles.noticeText, { color: theme.colors.statusDanger }]}>
              {t("usage.loadError", { error: loadError })}
            </Text>
          </View>
        ) : null}

        {/* 3. KPI Summary Cards */}
        {layout.compact ? (
          <View style={styles.kpiCompactStack}>
            <View style={styles.kpiRow}>
              <KpiStatCard
                label={t("usage.kpiTurns")}
                value={formatCompactNumber(totals.turns)}
                subtext={
                  totals.turns > 0
                    ? t("usage.kpiTurnsSub", {
                        rate: completionRate,
                        failed: totals.failedTurns,
                      })
                    : t("usage.kpiTurnsEmpty")
                }
                theme={theme}
              />
              <KpiStatCard
                label={t("usage.kpiCost")}
                value={formatUsd(totals.totalCostUsd)}
                subtext={t("usage.kpiCostSub", {
                  avg: formatUsd(avgCostPerTurn),
                })}
                highlight
                theme={theme}
              />
            </View>
            <View style={styles.kpiRow}>
              <KpiStatCard
                label={t("usage.kpiTokens")}
                value={formatCompactNumber(totalTokens)}
                subtext={t("usage.kpiTokensSub", {
                  input: formatCompactNumber(totals.inputTokens),
                  cache: formatCompactNumber(totals.cachedInputTokens),
                  output: formatCompactNumber(totals.outputTokens),
                })}
                theme={theme}
              />
              <KpiStatCard
                label={t("usage.kpiCommits")}
                value={String(totals.commitCount)}
                subtext={t("usage.kpiCommitsSub", {
                  duration: formatDurationMs(totals.durationMs),
                })}
                theme={theme}
              />
            </View>
          </View>
        ) : (
          <View style={styles.kpiRow}>
            <KpiStatCard
              label={t("usage.kpiTurns")}
              value={formatCompactNumber(totals.turns)}
              subtext={
                totals.turns > 0
                  ? t("usage.kpiTurnsSub", {
                      rate: completionRate,
                      failed: totals.failedTurns,
                    })
                  : t("usage.kpiTurnsEmpty")
              }
              theme={theme}
            />
            <KpiStatCard
              label={t("usage.kpiTokens")}
              value={formatCompactNumber(totalTokens)}
              subtext={t("usage.kpiTokensSub", {
                input: formatCompactNumber(totals.inputTokens),
                cache: formatCompactNumber(totals.cachedInputTokens),
                output: formatCompactNumber(totals.outputTokens),
              })}
              theme={theme}
            />
            <KpiStatCard
              label={t("usage.kpiCost")}
              value={formatUsd(totals.totalCostUsd)}
              subtext={t("usage.kpiCostSub", {
                avg: formatUsd(avgCostPerTurn),
              })}
              highlight
              theme={theme}
            />
            <KpiStatCard
              label={t("usage.kpiCommits")}
              value={String(totals.commitCount)}
              subtext={t("usage.kpiCommitsSub", {
                duration: formatDurationMs(totals.durationMs),
              })}
              theme={theme}
            />
          </View>
        )}

        {/* 4. Member Usage Leaderboard & Model Distribution */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionHeading, { color: theme.colors.foreground }]}>
            {t("usage.leaderboardTitle")}
          </Text>

          <View
            style={[
              styles.tableCard,
              {
                backgroundColor: theme.colors.surface1,
                borderColor: theme.colors.border,
              },
            ]}
          >
            {loading && !usage ? (
              <View style={styles.emptyBlock}>
                <Text style={[styles.emptyText, { color: theme.colors.foregroundMuted }]}>
                  {t("usage.loadingLedger")}
                </Text>
              </View>
            ) : null}

            {(!loading || usage) && rankedMembers.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={[styles.emptyText, { color: theme.colors.foregroundMuted }]}>
                  {t("usage.emptyLeaderboard")}
                </Text>
              </View>
            ) : null}

            {(!loading || usage) && rankedMembers.length > 0 ? (
              <>
                {!layout.compact ? (
                  <View style={[styles.tableHeaderRow, { borderBottomColor: theme.colors.border }]}>
                    <Text
                      style={[
                        styles.thText,
                        styles.colMember,
                        { color: theme.colors.foregroundMuted },
                      ]}
                    >
                      {t("usage.colMember")}
                    </Text>
                    <Text
                      style={[
                        styles.thText,
                        styles.colTurns,
                        { color: theme.colors.foregroundMuted },
                      ]}
                    >
                      {t("usage.colTurns")}
                    </Text>
                    <Text
                      style={[
                        styles.thText,
                        styles.colTokens,
                        { color: theme.colors.foregroundMuted },
                      ]}
                    >
                      {t("usage.colTokens")}
                    </Text>
                    <Text
                      style={[
                        styles.thText,
                        styles.colDuration,
                        { color: theme.colors.foregroundMuted },
                      ]}
                    >
                      {t("usage.colDuration")}
                    </Text>
                    <Text
                      style={[
                        styles.thText,
                        styles.colCommits,
                        { color: theme.colors.foregroundMuted },
                      ]}
                    >
                      {t("usage.colCommits")}
                    </Text>
                    <Text
                      style={[
                        styles.thText,
                        styles.colCost,
                        { color: theme.colors.foregroundMuted },
                      ]}
                    >
                      {t("usage.colCost")}
                    </Text>
                  </View>
                ) : null}

                {rankedMembers.map((row, index) => (
                  <MemberUsageRow
                    key={row.ownerId}
                    row={row}
                    index={index}
                    maxWeight={maxMemberWeight}
                    compact={layout.compact}
                    platform={layout.platform}
                    mono={mono}
                    theme={theme}
                  />
                ))}
              </>
            ) : null}
          </View>
        </View>

        {/* 5. Recent Turns & Prompt Audit Stream */}
        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionHeading, { color: theme.colors.foreground }]}>
            {t("usage.recentTurnsTitle")}
          </Text>

          <View
            style={[
              styles.tableCard,
              {
                backgroundColor: theme.colors.surface1,
                borderColor: theme.colors.border,
              },
            ]}
          >
            {!usage || usage.recentTurns.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Text style={[styles.emptyText, { color: theme.colors.foregroundMuted }]}>
                  {loading ? t("usage.loadingLedger") : t("usage.emptyRecentTurns")}
                </Text>
              </View>
            ) : (
              usage.recentTurns.map((turn, idx) => (
                <RecentTurnRow
                  key={`${turn.turnId ?? turn.agentId}-${turn.timestamp}-${idx}`}
                  turn={turn}
                  index={idx}
                  compact={layout.compact}
                  platform={layout.platform}
                  mono={mono}
                  theme={theme}
                  openWorkspaceLabel={t("usage.openWorkspaceAction")}
                  noPromptLabel={t("usage.noPromptPreview")}
                  onOpenWorkspace={
                    turn.workspaceId && navigation?.openWorkspace
                      ? () =>
                          navigation.openWorkspace({
                            workspaceId: turn.workspaceId!,
                          })
                      : undefined
                  }
                />
              ))
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
});

const IdentityChip = memo(function IdentityChip({
  label,
  icon,
  selected,
  mono,
  platform,
  theme,
  compactLayout,
  onPress,
}: {
  label: string;
  icon?: string;
  selected: boolean;
  mono: boolean;
  platform: PluginScreenProps["layout"]["platform"];
  theme: PluginScreenProps["theme"];
  compactLayout: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: compactLayout ? 36 : 28,
          backgroundColor: selected ? theme.colors.surface2 : "transparent",
          borderColor: selected ? theme.colors.accent : theme.colors.border,
        },
        pressed && { opacity: 0.78 },
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={12}
          color={selected ? theme.colors.accent : theme.colors.foregroundMuted}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          styles.chipLabel,
          {
            color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
            fontWeight: selected ? "500" : "400",
            fontFamily: mono ? monoFontFamily(platform) : undefined,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const KpiStatCard = memo(function KpiStatCard({
  label,
  value,
  subtext,
  highlight = false,
  theme,
}: {
  label: string;
  value: string;
  subtext: string;
  highlight?: boolean;
  theme: PluginScreenProps["theme"];
}) {
  return (
    <View
      style={[
        styles.kpiCard,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.kpiLabel, { color: theme.colors.foregroundMuted }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          styles.kpiFigure,
          {
            color: highlight ? theme.colors.accent : theme.colors.foreground,
          },
        ]}
      >
        {value}
      </Text>
      <Text numberOfLines={1} style={[styles.kpiSubtext, { color: theme.colors.foregroundMuted }]}>
        {subtext}
      </Text>
    </View>
  );
});

const MemberUsageRow = memo(function MemberUsageRow({
  row,
  index,
  maxWeight,
  compact,
  platform,
  mono,
  theme,
}: {
  row: MemberUsageSummary;
  index: number;
  maxWeight: number;
  compact: boolean;
  platform: PluginScreenProps["layout"]["platform"];
  mono: string;
  theme: PluginScreenProps["theme"];
}) {
  const { t } = useTranslation(messages);
  const isBot = row.kind === "bot" || row.ownerId === SYSTEM_BOT_MEMBER_ID;
  const weight = row.totalCostUsd > 0 ? row.totalCostUsd : row.turns;
  const shareRatio = Math.max(0.04, Math.min(1, weight / maxWeight));
  const isLead = index === 0 && weight > 0;
  const topModels = row.models.slice(0, 4);

  const tokenTriple = `${formatCompactNumber(row.inputTokens)} / ${formatCompactNumber(row.cachedInputTokens)} / ${formatCompactNumber(row.outputTokens)}`;

  if (compact) {
    return (
      <View
        style={[
          styles.compactMemberCard,
          {
            borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
            borderTopColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.compactMemberHeader}>
          <View style={styles.memberTitleGroup}>
            <Icon
              name={isBot ? "Bot" : "UserCheck"}
              size={14}
              color={isBot ? theme.colors.accent : theme.colors.foregroundMuted}
            />
            <Text numberOfLines={1} style={[styles.memberName, { color: theme.colors.foreground }]}>
              {row.ownerName || SYSTEM_BOT_DEFAULT_NAME}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.memberHandle,
                { color: theme.colors.foregroundMuted, fontFamily: mono },
              ]}
            >
              @{row.ownerId}
            </Text>
          </View>
          <Text
            style={[
              styles.costFigure,
              {
                color: isLead ? theme.colors.accent : theme.colors.foreground,
              },
            ]}
          >
            {formatUsd(row.totalCostUsd)}
          </Text>
        </View>

        <View style={[styles.shareTrack, { backgroundColor: theme.colors.surface2 }]}>
          <View
            style={[
              styles.shareFill,
              {
                width: `${Math.round(shareRatio * 100)}%`,
                backgroundColor: isLead ? theme.colors.accent : theme.colors.foregroundMuted,
              },
            ]}
          />
        </View>

        <View style={styles.compactMetricsLine}>
          <Text style={[styles.compactMetricText, { color: theme.colors.foregroundMuted }]}>
            {t("usage.compactMemberMetrics", {
              turns: row.turns,
              tokens: tokenTriple,
              duration: formatDurationMs(row.durationMs),
              commits: row.commitCount,
            })}
          </Text>
        </View>

        {topModels.length > 0 ? (
          <View style={styles.modelTagRow}>
            {topModels.map((m) => (
              <StatusTag
                key={`${m.provider}-${m.model}`}
                label={`${m.model || m.provider} · ${m.turns}`}
                mono
                platform={platform}
                theme={theme}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.desktopMemberBlock,
        {
          borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.tableDataRow}>
        <View style={[styles.colMember, styles.desktopMemberCell]}>
          <View style={styles.memberTitleGroup}>
            <Icon
              name={isBot ? "Bot" : "UserCheck"}
              size={14}
              color={isBot ? theme.colors.accent : theme.colors.foregroundMuted}
            />
            <Text numberOfLines={1} style={[styles.memberName, { color: theme.colors.foreground }]}>
              {row.ownerName || SYSTEM_BOT_DEFAULT_NAME}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.memberHandle,
                { color: theme.colors.foregroundMuted, fontFamily: mono },
              ]}
            >
              @{row.ownerId}
            </Text>
          </View>
          <View style={[styles.shareTrack, { backgroundColor: theme.colors.surface2 }]}>
            <View
              style={[
                styles.shareFill,
                {
                  width: `${Math.round(shareRatio * 100)}%`,
                  backgroundColor: isLead ? theme.colors.accent : theme.colors.foregroundMuted,
                },
              ]}
            />
          </View>
        </View>

        <Text style={[styles.tdNumber, styles.colTurns, { color: theme.colors.foreground }]}>
          {row.turns}
        </Text>
        <Text
          style={[
            styles.tdNumber,
            styles.colTokens,
            { color: theme.colors.foregroundMuted, fontFamily: mono },
          ]}
        >
          {tokenTriple}
        </Text>
        <Text
          style={[styles.tdNumber, styles.colDuration, { color: theme.colors.foregroundMuted }]}
        >
          {formatDurationMs(row.durationMs)}
        </Text>
        <Text style={[styles.tdNumber, styles.colCommits, { color: theme.colors.foreground }]}>
          {row.commitCount}
        </Text>
        <Text
          style={[
            styles.tdNumber,
            styles.colCost,
            {
              color: isLead ? theme.colors.accent : theme.colors.foreground,
              fontWeight: isLead ? "500" : "400",
            },
          ]}
        >
          {formatUsd(row.totalCostUsd)}
        </Text>
      </View>

      {topModels.length > 0 ? (
        <View style={styles.modelTagRow}>
          {topModels.map((m) => {
            const modelId = m.model ? `${m.provider}/${m.model}` : m.provider;
            return (
              <StatusTag
                key={`${m.provider}-${m.model}`}
                label={`${modelId} · ${m.turns}`}
                mono
                platform={platform}
                theme={theme}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const RecentTurnRow = memo(function RecentTurnRow({
  turn,
  index,
  compact,
  platform,
  mono,
  theme,
  openWorkspaceLabel,
  noPromptLabel,
  onOpenWorkspace,
}: {
  turn: RecentTurnRecord;
  index: number;
  compact: boolean;
  platform: PluginScreenProps["layout"]["platform"];
  mono: string;
  theme: PluginScreenProps["theme"];
  openWorkspaceLabel: string;
  noPromptLabel: string;
  onOpenWorkspace?: () => void;
}) {
  const { t } = useTranslation(messages);
  const outcomeLower = turn.outcome.toLowerCase();
  let dotColor = theme.colors.statusWarning;
  if (outcomeLower === "completed") {
    dotColor = theme.colors.statusSuccess;
  } else if (outcomeLower === "failed" || outcomeLower === "error") {
    dotColor = theme.colors.statusDanger;
  }

  const modelText = turn.model ? `${turn.provider}/${turn.model}` : turn.provider;
  const totalTurnTokens = turn.inputTokens + turn.outputTokens;
  const preview = turn.promptPreview?.trim().slice(0, 100) || null;

  return (
    <View
      style={[
        styles.turnRow,
        {
          borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.turnMetaRow}>
        <View style={styles.turnMetaLeft}>
          <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
          <Text
            style={[
              styles.turnTimestamp,
              { color: theme.colors.foregroundMuted, fontFamily: mono },
            ]}
          >
            {formatShortTimestamp(turn.timestamp)}
          </Text>
          <StatusTag
            icon={turn.ownerId === SYSTEM_BOT_MEMBER_ID ? "Bot" : undefined}
            label={`@${turn.ownerId}`}
            mono
            platform={platform}
            theme={theme}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.turnModelText,
              { color: theme.colors.foregroundMuted, fontFamily: mono },
            ]}
          >
            {modelText}
          </Text>
          {turn.branch ? (
            <StatusTag
              icon="GitBranch"
              label={turn.branch}
              mono
              platform={platform}
              theme={theme}
            />
          ) : null}
        </View>

        <View style={styles.turnMetaRight}>
          <Text
            style={[
              styles.turnMetricsText,
              { color: theme.colors.foregroundMuted, fontFamily: mono },
            ]}
          >
            {t("usage.turnMetricsSummary", {
              tokens: formatCompactNumber(totalTurnTokens),
              duration: formatDurationMs(turn.durationMs),
              cost: formatUsd(turn.costUsd),
            })}
          </Text>
          {onOpenWorkspace ? (
            <ActionButton
              accessibilityLabel={openWorkspaceLabel}
              label={compact ? undefined : openWorkspaceLabel}
              icon="GitBranch"
              variant="ghost"
              compactSize
              theme={theme}
              compactLayout={compact}
              onPress={onOpenWorkspace}
            />
          ) : null}
        </View>
      </View>

      <Text
        numberOfLines={2}
        style={[
          styles.turnPromptText,
          {
            color: preview ? theme.colors.foreground : theme.colors.foregroundMuted,
          },
        ]}
      >
        {preview ?? noPromptLabel}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  scrollRoot: {
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
  },
  pageColumn: {
    width: "100%",
    maxWidth: 1120,
    gap: 20,
  },
  identityCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  identityHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  identityLabelCol: {
    gap: 4,
    flexShrink: 1,
  },
  identityTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  hintText: {
    fontSize: 12,
  },
  chipWrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: 12,
  },
  toolbarBlock: {
    gap: 12,
  },
  toolbarTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  exportRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  noticeCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  noticeText: {
    fontSize: 13,
  },
  kpiCompactStack: {
    gap: 12,
  },
  kpiRow: {
    flexDirection: "row",
    gap: 12,
  },
  kpiCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  kpiFigure: {
    fontSize: 24,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  kpiSubtext: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  sectionBlock: {
    gap: 12,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: "500",
  },
  tableCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  emptyBlock: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 13,
  },
  tableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  thText: {
    fontSize: 12,
    fontWeight: "500",
  },
  colMember: {
    flex: 2,
    minWidth: 0,
  },
  colTurns: {
    width: 68,
    textAlign: "right",
  },
  colTokens: {
    width: 176,
    textAlign: "right",
  },
  colDuration: {
    width: 88,
    textAlign: "right",
  },
  colCommits: {
    width: 72,
    textAlign: "right",
  },
  colCost: {
    width: 92,
    textAlign: "right",
  },
  desktopMemberBlock: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  tableDataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  desktopMemberCell: {
    gap: 6,
  },
  memberTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "400",
    flexShrink: 1,
  },
  memberHandle: {
    fontSize: 12,
  },
  tdNumber: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  shareTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    width: "100%",
  },
  shareFill: {
    height: 4,
    borderRadius: 2,
  },
  modelTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  compactMemberCard: {
    padding: 16,
    gap: 8,
  },
  compactMemberHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  costFigure: {
    fontSize: 14,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  compactMetricsLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  compactMetricText: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  turnRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  turnMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  turnMetaLeft: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    flexShrink: 1,
  },
  turnMetaRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  turnTimestamp: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  turnModelText: {
    fontSize: 12,
    maxWidth: 240,
  },
  turnMetricsText: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  turnPromptText: {
    fontSize: 13,
    lineHeight: 20,
  },
});
