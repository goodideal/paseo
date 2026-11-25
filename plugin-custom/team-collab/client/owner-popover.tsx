import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useRpc,
  useTranslation,
  useWorkspace,
  type PluginButtonContentProps,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import {
  parseWorkspaceOwnerMetadata,
  SYSTEM_BOT_DEFAULT_NAME,
  SYSTEM_BOT_MEMBER_ID,
  TEAM_COLLAB_OWNER_META_KEY,
  teamCollabRosterStatusRpc,
  teamCollabSyncHostAccountsRpc,
  teamCollabWorkspaceAssignRpc,
  type DiscoveredHostAccount,
  type GitProviderKind,
  type MemberCredentialStatus,
  type RosterMemberStatus,
  type TeamCollabPolicies,
} from "../shared/contracts.js";
import { messages } from "./messages.js";
import { ActionButton, monoFontFamily, StatusTag, type StatusTone } from "./ui-primitives.js";
import { useDefaultMemberId } from "./web.js";
import {
  notifyRosterUpdated,
  setLiveWorkspaceOwner,
  useLiveWorkspaceRecord,
  useRosterRefreshVersion,
} from "./workspace-store.js";

const IOS_SHEET_CLOSE_DELAY_MS = 250;

type AssigningTarget = string | null;

interface PopoverBadgeDescriptor {
  key: string;
  icon?: string;
  label: string;
  tone: StatusTone;
  mono: boolean;
}

function getProviderBadgeName(provider: GitProviderKind): string {
  switch (provider) {
    case "gitea":
      return "Gitea";
    case "gitlab":
      return "GitLab";
    case "github":
      return "GitHub";
    case "generic":
    default:
      return "HTTPS";
  }
}

export type WorkspaceOwnerPopoverProps = PluginButtonContentProps & {
  workspaceId: string;
  onOpenSettings(): void;
  onOpenUsage(): void;
};

export const WorkspaceOwnerPopover = memo(function WorkspaceOwnerPopover({
  workspaceId,
  theme,
  layout,
  close,
  onOpenSettings,
  onOpenUsage,
}: WorkspaceOwnerPopoverProps) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const queryRoster = useRpc(teamCollabRosterStatusRpc);
  const syncHostAccounts = useRpc(teamCollabSyncHostAccountsRpc);
  const assignWorkspace = useRpc(teamCollabWorkspaceAssignRpc);

  const getHostSourceLabel = useCallback(
    (source: DiscoveredHostAccount["source"]): string => {
      switch (source) {
        case "tea":
          return t("popover.sourceTea");
        case "gh":
          return t("popover.sourceGh");
        case "glab":
          return t("popover.sourceGlab");
        case "git-global":
        default:
          return t("popover.sourceGit");
      }
    },
    [t],
  );

  const formatTokenBadgeLabel = useCallback(
    (provider: GitProviderKind, preview: string | null): string => {
      const providerName = getProviderBadgeName(provider);
      if (preview) {
        return t("popover.badgeTokenWithPreview", {
          provider: providerName,
          preview,
        });
      }
      return t("popover.badgeTokenReady", {
        provider: providerName,
      });
    },
    [t],
  );

  const buildOwnerCredentialBadges = useCallback(
    (
      credentials: MemberCredentialStatus,
      memberProvider: GitProviderKind | undefined,
    ): PopoverBadgeDescriptor[] => {
      const badges: PopoverBadgeDescriptor[] = [];

      if (credentials.hasGiteaToken && credentials.hasGithubToken) {
        let primaryProvider: GitProviderKind = "gitea";
        if (credentials.gitProvider === "gitlab" || credentials.gitProvider === "generic") {
          primaryProvider = credentials.gitProvider;
        }
        badges.push({
          key: "token-primary",
          icon: "KeyRound",
          label: formatTokenBadgeLabel(primaryProvider, credentials.giteaTokenPreview),
          tone: "success",
          mono: true,
        });
        badges.push({
          key: "token-github",
          icon: "KeyRound",
          label: formatTokenBadgeLabel("github", credentials.githubTokenPreview),
          tone: "success",
          mono: true,
        });
      } else if (
        credentials.hasHttpToken ||
        credentials.hasGiteaToken ||
        credentials.hasGithubToken
      ) {
        let effectiveProvider: GitProviderKind =
          credentials.gitProvider ?? memberProvider ?? "gitea";
        if (credentials.hasGithubToken && !credentials.hasGiteaToken) {
          effectiveProvider = "github";
        }
        const preview =
          credentials.httpTokenPreview ??
          credentials.giteaTokenPreview ??
          credentials.githubTokenPreview;
        badges.push({
          key: "token-http",
          icon: "KeyRound",
          label: formatTokenBadgeLabel(effectiveProvider, preview),
          tone: "success",
          mono: true,
        });
      }

      if (credentials.hasSshKey) {
        const sshLabel = credentials.sshKeyPathPreview
          ? t("popover.badgeSshWithPreview", { preview: credentials.sshKeyPathPreview })
          : t("popover.badgeSshReady");
        badges.push({
          key: "ssh-key",
          icon: "KeyRound",
          label: sshLabel,
          tone: "success",
          mono: true,
        });
      }

      if (badges.length === 0) {
        badges.push({
          key: "author-only",
          icon: "UserCheck",
          label: t("popover.badgeAuthorOnly"),
          tone: "neutral",
          mono: false,
        });
      }

      return badges;
    },
    [formatTokenBadgeLabel, t],
  );

  const [defaultMemberId, setDefaultMemberId] = useDefaultMemberId();
  const rosterRefreshVersion = useRosterRefreshVersion();
  const liveRecord = useLiveWorkspaceRecord(workspaceId);

  const workspaceSnap = useWorkspace(workspaceId, (ws) => ({
    kind: ws.kind,
    branch: ws.branch,
    rawOwner:
      (ws as { metadata?: Record<string, unknown> | null }).metadata?.[
        TEAM_COLLAB_OWNER_META_KEY
      ] ?? null,
  }));

  const [members, setMembers] = useState<RosterMemberStatus[]>([]);
  const [discoveredAccounts, setDiscoveredAccounts] = useState<DiscoveredHostAccount[]>([]);
  const [policies, setPolicies] = useState<TeamCollabPolicies | null>(null);
  const [assigningId, setAssigningId] = useState<AssigningTarget>(null);

  useEffect(() => {
    let cancelled = false;
    void queryRoster({})
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members);
        setPolicies(res.policies);
        setDiscoveredAccounts(res.discoveredAccounts ?? []);
      })
      .catch(() => {
        // Ignore background refresh error inside popover
      });
    return () => {
      cancelled = true;
    };
  }, [queryRoster, rosterRefreshVersion]);

  const owner = useMemo(() => {
    return parseWorkspaceOwnerMetadata(workspaceSnap?.rawOwner) ?? liveRecord?.owner ?? null;
  }, [liveRecord?.owner, workspaceSnap?.rawOwner]);

  const isWorktree = useMemo(() => {
    if (workspaceSnap?.kind) {
      return workspaceSnap.kind === "worktree";
    }
    return liveRecord?.isWorktree ?? false;
  }, [liveRecord?.isWorktree, workspaceSnap?.kind]);

  const branch = workspaceSnap?.branch ?? liveRecord?.branch ?? null;

  const enabledMembers = useMemo(() => members.filter((m) => m.enabled !== false), [members]);

  const unimportedHostAccounts = useMemo(
    () => discoveredAccounts.filter((acc) => !acc.alreadyInRoster),
    [discoveredAccounts],
  );

  const ownerMemberDetail = useMemo(
    () => (owner ? (members.find((m) => m.id === owner.id) ?? null) : null),
    [members, owner],
  );

  const defaultMember = useMemo(
    () => (defaultMemberId ? (enabledMembers.find((m) => m.id === defaultMemberId) ?? null) : null),
    [defaultMemberId, enabledMembers],
  );

  const ownerCredentialBadges = useMemo(() => {
    if (!ownerMemberDetail) {
      return [];
    }
    return buildOwnerCredentialBadges(ownerMemberDetail.credentials, ownerMemberDetail.gitProvider);
  }, [buildOwnerCredentialBadges, ownerMemberDetail]);

  const runAfterClose = useCallback(
    (action: () => void) => {
      close();
      if (layout.platform === "ios") {
        setTimeout(() => {
          action();
        }, IOS_SHEET_CLOSE_DELAY_MS);
        return;
      }
      action();
    },
    [close, layout.platform],
  );

  const handleAssign = useCallback(
    async (memberId: string | null, rememberAsDefault = false) => {
      if (assigningId !== null) return;
      const busyKey = memberId ?? "__clear__";
      setAssigningId(busyKey);
      try {
        const res = await assignWorkspace({
          workspaceId,
          memberId,
        });
        setLiveWorkspaceOwner(workspaceId, res.owner, {
          isWorktree: res.isWorktree,
        });
        if (
          memberId &&
          memberId !== SYSTEM_BOT_MEMBER_ID &&
          (rememberAsDefault || !defaultMemberId)
        ) {
          setDefaultMemberId(memberId);
        }
        if (res.owner) {
          toast.show(t("popover.toastClaimed", { id: res.owner.id }), {
            variant: "success",
          });
        } else {
          toast.show(t("popover.toastCleared"), { variant: "info" });
        }
        close();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(t("popover.toastAssignFailed", { error: msg }));
      } finally {
        setAssigningId(null);
      }
    },
    [
      assignWorkspace,
      assigningId,
      close,
      defaultMemberId,
      setDefaultMemberId,
      t,
      toast,
      workspaceId,
    ],
  );

  const handleImportAndAssign = useCallback(
    async (acc: DiscoveredHostAccount) => {
      if (assigningId !== null) return;
      const busyKey = `host:${acc.loginName}`;
      setAssigningId(busyKey);
      try {
        const syncRes = await syncHostAccounts({
          loginNames: [acc.loginName],
          overwriteExistingCredentials: false,
        });
        setMembers(syncRes.members);
        setDiscoveredAccounts(syncRes.discoveredAccounts);
        notifyRosterUpdated();

        const targetMemberId = syncRes.importedIds[0] ?? acc.suggestedId;
        const assignRes = await assignWorkspace({
          workspaceId,
          memberId: targetMemberId,
        });
        setLiveWorkspaceOwner(workspaceId, assignRes.owner, {
          isWorktree: assignRes.isWorktree,
        });
        if (!defaultMemberId && targetMemberId !== SYSTEM_BOT_MEMBER_ID) {
          setDefaultMemberId(targetMemberId);
        }
        toast.show(
          t("popover.toastImportedAndClaimed", {
            id: assignRes.owner?.id ?? targetMemberId,
          }),
          { variant: "success" },
        );
        close();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(t("popover.toastAssignFailed", { error: msg }));
      } finally {
        setAssigningId(null);
      }
    },
    [
      assignWorkspace,
      assigningId,
      close,
      defaultMemberId,
      setDefaultMemberId,
      syncHostAccounts,
      t,
      toast,
      workspaceId,
    ],
  );

  const mono = monoFontFamily(layout.platform);

  const discoveredHostSection =
    unimportedHostAccounts.length > 0 ? (
      <View style={styles.hostGroupBlock}>
        <Text style={[styles.sectionHeading, { color: theme.colors.foregroundMuted }]}>
          {t("popover.hostAccountsHeading")}
        </Text>
        <View
          style={[
            styles.memberListCard,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
            },
          ]}
        >
          {unimportedHostAccounts.map((acc, index) => {
            const busyKey = `host:${acc.loginName}`;
            const isBusy = assigningId === busyKey;
            const sourceLabel = getHostSourceLabel(acc.source);
            return (
              <Pressable
                key={`${acc.source}:${acc.loginName}`}
                accessibilityRole="button"
                accessibilityLabel={`${acc.suggestedName} (@${acc.suggestedId})`}
                disabled={assigningId !== null}
                onPress={() => void handleImportAndAssign(acc)}
                style={({ pressed }) => [
                  styles.memberRow,
                  {
                    minHeight: layout.compact ? 48 : 40,
                    borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: theme.colors.border,
                    backgroundColor: "transparent",
                  },
                  pressed && { backgroundColor: theme.colors.surface2 },
                  assigningId !== null && !isBusy && { opacity: 0.5 },
                ]}
              >
                <View style={styles.memberRowTextCol}>
                  <View style={styles.memberRowTop}>
                    <Text
                      numberOfLines={1}
                      style={[styles.memberRowName, { color: theme.colors.foreground }]}
                    >
                      {acc.suggestedName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.memberRowId,
                        {
                          color: theme.colors.foregroundMuted,
                          fontFamily: mono,
                        },
                      ]}
                    >
                      @{acc.suggestedId}
                    </Text>
                    <StatusTag label={sourceLabel} platform={layout.platform} theme={theme} />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.memberRowEmail, { color: theme.colors.foregroundMuted }]}
                  >
                    {acc.giteaUrl ? `${acc.suggestedEmail} · ${acc.giteaUrl}` : acc.suggestedEmail}
                  </Text>
                </View>
                <StatusTag
                  icon="KeyRound"
                  label={
                    isBusy ? t("popover.claimingAction") : t("popover.hostImportAndClaimBadge")
                  }
                  tone="accent"
                  platform={layout.platform}
                  theme={theme}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    ) : null;

  let worktreeTagLabel = t("popover.sharedWorkspace");
  if (isWorktree) {
    worktreeTagLabel = branch
      ? `${t("popover.worktreeIsolated")} · ${branch}`
      : t("popover.worktreeIsolated");
  }

  return (
    <View style={[styles.container, { width: layout.compact ? "100%" : 336 }]}>
      {/* Current Owner / Unclaimed Status Card */}
      <View
        style={[
          styles.statusCard,
          {
            backgroundColor: theme.colors.surface1,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {owner ? (
          <View style={styles.ownerBlock}>
            <View style={styles.ownerTopRow}>
              <View style={styles.ownerIdentityGroup}>
                <Icon
                  name={owner.kind === "bot" ? "Bot" : "UserCheck"}
                  size={16}
                  color={owner.kind === "bot" ? theme.colors.accent : theme.colors.statusSuccess}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.ownerName, { color: theme.colors.foreground }]}
                >
                  {owner.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.ownerHandle,
                    { color: theme.colors.foregroundMuted, fontFamily: mono },
                  ]}
                >
                  @{owner.id}
                </Text>
              </View>
            </View>

            <Text
              numberOfLines={1}
              style={[styles.ownerEmail, { color: theme.colors.foregroundMuted }]}
            >
              {owner.email}
            </Text>

            <View style={styles.tagRow}>
              <StatusTag
                icon="GitBranch"
                label={worktreeTagLabel}
                tone={isWorktree ? "success" : "warning"}
                platform={layout.platform}
                theme={theme}
              />
              {owner.kind === "bot" ? (
                <StatusTag
                  icon="Bot"
                  label={t("popover.botIdentityTag")}
                  tone="accent"
                  platform={layout.platform}
                  theme={theme}
                />
              ) : null}
              {owner.kind === "member" && defaultMemberId === owner.id ? (
                <StatusTag
                  icon="Check"
                  label={t("popover.deviceDefaultTag")}
                  tone="neutral"
                  platform={layout.platform}
                  theme={theme}
                />
              ) : null}
            </View>

            {owner.kind === "member" && ownerCredentialBadges.length > 0 ? (
              <View style={styles.tagRow}>
                {ownerCredentialBadges.map((badge) => (
                  <StatusTag
                    key={badge.key}
                    icon={badge.icon}
                    label={badge.label}
                    tone={badge.tone}
                    mono={badge.mono}
                    platform={layout.platform}
                    theme={theme}
                  />
                ))}
              </View>
            ) : null}

            {owner.kind === "member" && defaultMemberId !== owner.id ? (
              <View style={styles.inlineActionRow}>
                <ActionButton
                  label={t("popover.setDeviceDefault")}
                  icon="Check"
                  variant="outline"
                  compactSize
                  theme={theme}
                  compactLayout={layout.compact}
                  onPress={() => setDefaultMemberId(owner.id)}
                />
                <ActionButton
                  label={t("popover.clearOwnerAction")}
                  variant="ghost"
                  compactSize
                  disabled={assigningId !== null}
                  theme={theme}
                  compactLayout={layout.compact}
                  onPress={() => void handleAssign(null)}
                />
              </View>
            ) : (
              <View style={styles.inlineActionRow}>
                <ActionButton
                  label={t("popover.clearOwnerAction")}
                  variant="outline"
                  compactSize
                  disabled={assigningId !== null}
                  theme={theme}
                  compactLayout={layout.compact}
                  onPress={() => void handleAssign(null)}
                />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.unclaimedBlock}>
            <View style={styles.unclaimedTitleRow}>
              <Icon name="AlertTriangle" size={16} color={theme.colors.statusWarning} />
              <Text style={[styles.unclaimedHeading, { color: theme.colors.foreground }]}>
                {t("popover.unclaimedHeading")}
              </Text>
            </View>
            <Text style={[styles.unclaimedNote, { color: theme.colors.foregroundMuted }]}>
              {policies?.blockUnclaimedGitCommitPush !== false
                ? t("popover.unclaimedGuardNote")
                : t("popover.unclaimedCalmNote")}
            </Text>

            {defaultMember ? (
              <ActionButton
                label={
                  assigningId === defaultMember.id
                    ? t("popover.claimingAction")
                    : t("popover.quickClaimAction", {
                        name: defaultMember.name,
                        id: defaultMember.id,
                      })
                }
                icon="UserCheck"
                variant="primary"
                disabled={assigningId !== null}
                theme={theme}
                compactLayout={layout.compact}
                onPress={() => void handleAssign(defaultMember.id, true)}
              />
            ) : null}
          </View>
        )}
      </View>

      {/* Member & Discovered Host Picker (host popover surface already provides outer scroll container) */}
      <View style={styles.scrollContentStack}>
        {/* Discovered Host Accounts placed at top when roster is empty */}
        {enabledMembers.length === 0 ? discoveredHostSection : null}

        <View style={styles.hostGroupBlock}>
          <Text style={[styles.sectionHeading, { color: theme.colors.foregroundMuted }]}>
            {t("popover.switchHeading")}
          </Text>

          {enabledMembers.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: theme.colors.surface1,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text style={[styles.emptyNote, { color: theme.colors.foregroundMuted }]}>
                {t("popover.emptyRosterNote")}
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.memberListCard,
                {
                  backgroundColor: theme.colors.surface1,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              {enabledMembers.map((member, index) => {
                const isSelected = owner?.kind === "member" && owner.id === member.id;
                const isBusy = assigningId === member.id;
                return (
                  <Pressable
                    key={member.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${member.name} (@${member.id})`}
                    disabled={assigningId !== null}
                    onPress={() => void handleAssign(member.id, false)}
                    style={({ pressed }) => [
                      styles.memberRow,
                      {
                        minHeight: layout.compact ? 48 : 40,
                        borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                        borderTopColor: theme.colors.border,
                        backgroundColor: isSelected ? theme.colors.surface2 : "transparent",
                      },
                      pressed && { backgroundColor: theme.colors.surface2 },
                      assigningId !== null && !isBusy && { opacity: 0.5 },
                    ]}
                  >
                    <View style={styles.memberRowTextCol}>
                      <View style={styles.memberRowTop}>
                        <Text
                          numberOfLines={1}
                          style={[styles.memberRowName, { color: theme.colors.foreground }]}
                        >
                          {member.name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.memberRowId,
                            {
                              color: theme.colors.foregroundMuted,
                              fontFamily: mono,
                            },
                          ]}
                        >
                          @{member.id}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.memberRowEmail, { color: theme.colors.foregroundMuted }]}
                      >
                        {member.email}
                      </Text>
                    </View>
                    {isSelected ? (
                      <Icon name="Check" size={16} color={theme.colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}

              {/* Optional System Bot row */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={SYSTEM_BOT_DEFAULT_NAME}
                disabled={assigningId !== null}
                onPress={() => void handleAssign(SYSTEM_BOT_MEMBER_ID, false)}
                style={({ pressed }) => [
                  styles.memberRow,
                  {
                    minHeight: layout.compact ? 44 : 36,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                    backgroundColor: owner?.kind === "bot" ? theme.colors.surface2 : "transparent",
                  },
                  pressed && { backgroundColor: theme.colors.surface2 },
                ]}
              >
                <View style={styles.botRowLeft}>
                  <Icon name="Bot" size={14} color={theme.colors.foregroundMuted} />
                  <Text
                    numberOfLines={1}
                    style={[styles.botRowLabel, { color: theme.colors.foregroundMuted }]}
                  >
                    {t("popover.assignSystemBot")}
                  </Text>
                </View>
                {owner?.kind === "bot" ? (
                  <Icon name="Check" size={16} color={theme.colors.accent} />
                ) : null}
              </Pressable>
            </View>
          )}
        </View>

        {/* Discovered Host Accounts placed below member list when roster is non-empty */}
        {enabledMembers.length > 0 ? discoveredHostSection : null}
      </View>

      {/* Footer Navigation */}
      <View style={styles.footerRow}>
        <ActionButton
          label={t("popover.openUsageAction")}
          icon="BarChart3"
          variant="secondary"
          compactSize
          theme={theme}
          compactLayout={layout.compact}
          onPress={() => runAfterClose(onOpenUsage)}
          style={styles.footerBtn}
        />
        <ActionButton
          label={t("popover.openSettingsAction")}
          icon="KeyRound"
          variant="outline"
          compactSize
          theme={theme}
          compactLayout={layout.compact}
          onPress={() => runAfterClose(onOpenSettings)}
          style={styles.footerBtn}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 12,
    paddingVertical: 4,
  },
  statusCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  ownerBlock: {
    gap: 8,
  },
  ownerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  ownerIdentityGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  ownerName: {
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  ownerHandle: {
    fontSize: 12,
    fontWeight: "400",
  },
  ownerEmail: {
    fontSize: 12,
    fontWeight: "400",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  inlineActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
  },
  unclaimedBlock: {
    gap: 8,
  },
  unclaimedTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  unclaimedHeading: {
    fontSize: 14,
    fontWeight: "500",
  },
  unclaimedNote: {
    fontSize: 12,
    lineHeight: 18,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: "500",
    paddingHorizontal: 4,
  },
  hostGroupBlock: {
    gap: 8,
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  emptyNote: {
    fontSize: 12,
    lineHeight: 18,
  },
  scrollContentStack: {
    gap: 12,
  },
  memberListCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  memberRowTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  memberRowTop: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  memberRowName: {
    fontSize: 13,
    fontWeight: "400",
    flexShrink: 1,
  },
  memberRowId: {
    fontSize: 12,
  },
  memberRowEmail: {
    fontSize: 11,
  },
  botRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  botRowLabel: {
    fontSize: 12,
  },
  footerRow: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 4,
  },
  footerBtn: {
    flex: 1,
  },
});
