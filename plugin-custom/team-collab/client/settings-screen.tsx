import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useRpc,
  useSettings,
  useTranslation,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  DEFAULT_TEAM_COLLAB_SETTINGS,
  MEMBER_ID_PATTERN,
  SYSTEM_BOT_MEMBER_ID,
  teamCollabMemberRemoveRpc,
  teamCollabMemberUpsertRpc,
  teamCollabRosterStatusRpc,
  teamCollabSettings,
  teamCollabSyncHostAccountsRpc,
  type DetectedServerHint,
  type DiscoveredHostAccount,
  type GitProviderKind,
  type MemberCredentialsInput,
  type MemberCredentialStatus,
  type RosterMemberStatus,
  type TeamCollabPolicies,
  type TeamCollabSettings,
} from "../shared/contracts.js";
import { messages } from "./messages.js";
import { ActionButton, monoFontFamily, StatusTag, type StatusTone } from "./ui-primitives.js";
import { useDefaultMemberId } from "./web.js";
import { notifyRosterUpdated, useRosterRefreshVersion } from "./workspace-store.js";

const NONE_DEVICE_MEMBER = "__none__" as const;
const PRESET_RETENTION_DAYS: readonly number[] = [30, 90, 180, 365];
const AUTH_MODE_ROWS: readonly (readonly [RemoteAuthMode, RemoteAuthMode])[] = [
  ["author-only", "ssh"],
  ["https", "both"],
];
const GIT_PROVIDER_ROWS: readonly (readonly [GitProviderKind, GitProviderKind])[] = [
  ["gitea", "gitlab"],
  ["github", "generic"],
];

type OptionalErrorText = string | null;
type OptionalSyncKey = string | null;
type RemoteAuthMode = "author-only" | "ssh" | "https" | "both";

interface MemberFormState {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
  authMode: RemoteAuthMode;
  gitProvider: GitProviderKind;
  httpServerUrl: string;
  gitUsername: string;
  httpToken: string;
  sshKeyPath: string;
  clearHttpToken: boolean;
  clearSshKey: boolean;
  useDiscoveredTeaLogin: string | null;
  selectedDiscoveredKey: string | null;
}

const EMPTY_MEMBER_FORM: MemberFormState = {
  id: "",
  name: "",
  email: "",
  enabled: true,
  authMode: "author-only",
  gitProvider: "gitea",
  httpServerUrl: "",
  gitUsername: "",
  httpToken: "",
  sshKeyPath: "",
  clearHttpToken: false,
  clearSshKey: false,
  useDiscoveredTeaLogin: null,
  selectedDiscoveredKey: null,
};

interface BadgeDescriptor {
  key: string;
  icon?: string;
  label: string;
  tone: StatusTone;
  mono: boolean;
}

function formatHostDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/+$/, "") || null;
  }
}

function formatAccountChipLabel(acc: DiscoveredHostAccount): string {
  const host = formatHostDomain(acc.giteaUrl);
  const primary = acc.giteaUsername || acc.loginName || acc.suggestedId;
  if (host && !primary.includes(host)) {
    return `${primary} · ${host}`;
  }
  return acc.loginName || primary;
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

function resolveAuthModeFromFlags(hasToken: boolean, hasSshKey: boolean): RemoteAuthMode {
  if (hasToken && hasSshKey) {
    return "both";
  }
  if (hasToken) {
    return "https";
  }
  if (hasSshKey) {
    return "ssh";
  }
  return "author-only";
}

function normalizeSshKeyPathForMatch(rawPath: string | null | undefined): string {
  if (!rawPath) return "";
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  const sshMarkerIdx = trimmed.indexOf("/.ssh/");
  if (sshMarkerIdx >= 0) {
    return `~${trimmed.slice(sshMarkerIdx)}`;
  }
  return trimmed;
}

export type TeamCollabSettingsScreenProps = PluginSurfaceProps & {
  onOpenUsage(): void;
};

export const TeamCollabSettingsScreen = memo(function TeamCollabSettingsScreen({
  theme,
  layout,
  onOpenUsage,
}: TeamCollabSettingsScreenProps) {
  const { t } = useTranslation(messages);
  const toast = useToast();

  const getDiscoveredSourceLabel = useCallback(
    (source: DiscoveredHostAccount["source"]): string => {
      switch (source) {
        case "tea":
          return t("settings.discoveredSourceTea");
        case "gh":
          return t("settings.discoveredSourceGh");
        case "glab":
          return t("settings.discoveredSourceGlab");
        case "git-global":
        default:
          return t("settings.discoveredSourceGit");
      }
    },
    [t],
  );

  const getProviderChoiceLabel = useCallback(
    (provider: GitProviderKind): string => {
      switch (provider) {
        case "gitea":
          return t("settings.providerGitea");
        case "gitlab":
          return t("settings.providerGitlab");
        case "github":
          return t("settings.providerGithub");
        case "generic":
        default:
          return t("settings.providerGeneric");
      }
    },
    [t],
  );

  const getServerUrlPlaceholder = useCallback(
    (provider: GitProviderKind): string => {
      switch (provider) {
        case "gitlab":
          return t("settings.serverUrlPlaceholderGitlab");
        case "generic":
          return t("settings.serverUrlPlaceholderGeneric");
        case "gitea":
        case "github":
        default:
          return t("settings.serverUrlPlaceholderGitea");
      }
    },
    [t],
  );

  const getAuthModeMeta = useCallback(
    (mode: RemoteAuthMode): { label: string; icon: string } => {
      switch (mode) {
        case "author-only":
          return { label: t("settings.authModeAuthorOnly"), icon: "UserCheck" };
        case "ssh":
          return { label: t("settings.authModeSsh"), icon: "KeyRound" };
        case "https":
          return { label: t("settings.authModeHttps"), icon: "KeyRound" };
        case "both":
        default:
          return { label: t("settings.authModeBoth"), icon: "Check" };
      }
    },
    [t],
  );

  const formatTokenBadgeLabel = useCallback(
    (provider: GitProviderKind, preview: string | null): string => {
      const providerName = getProviderBadgeName(provider);
      if (preview) {
        return t("settings.badgeTokenWithPreview", {
          provider: providerName,
          preview,
        });
      }
      return t("settings.badgeTokenReady", {
        provider: providerName,
      });
    },
    [t],
  );

  const buildMemberCredentialBadges = useCallback(
    (
      credentials: MemberCredentialStatus,
      memberProvider: GitProviderKind | undefined,
    ): BadgeDescriptor[] => {
      const badges: BadgeDescriptor[] = [];

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
          ? t("settings.badgeSshWithPreview", { preview: credentials.sshKeyPathPreview })
          : t("settings.badgeSshReady");
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
          label: t("settings.badgeAuthorOnly"),
          tone: "neutral",
          mono: false,
        });
      }

      return badges;
    },
    [formatTokenBadgeLabel, t],
  );

  const buildDiscoveredAccountCredentialBadges = useCallback(
    (acc: DiscoveredHostAccount): BadgeDescriptor[] => {
      const badges: BadgeDescriptor[] = [];
      if (acc.giteaUrl) {
        badges.push({
          key: "url",
          label: acc.giteaUrl,
          tone: "neutral",
          mono: true,
        });
      }
      if (acc.hasToken) {
        badges.push({
          key: "token",
          icon: "KeyRound",
          label: formatTokenBadgeLabel(acc.gitProvider ?? "gitea", acc.tokenPreview),
          tone: "success",
          mono: true,
        });
      }
      if (acc.hasSshKey) {
        const sshLabel = acc.sshKeyPathPreview
          ? t("settings.badgeSshWithPreview", { preview: acc.sshKeyPathPreview })
          : t("settings.badgeSshReady");
        badges.push({
          key: "ssh",
          icon: "KeyRound",
          label: sshLabel,
          tone: "success",
          mono: true,
        });
      }
      if (!acc.hasToken && !acc.hasSshKey) {
        badges.push({
          key: "author-only",
          icon: "UserCheck",
          label: t("settings.badgeAuthorOnly"),
          tone: "neutral",
          mono: false,
        });
      }
      return badges;
    },
    [formatTokenBadgeLabel, t],
  );

  const buildMemberPlatformMetaBadges = useCallback(
    (member: RosterMemberStatus): BadgeDescriptor[] => {
      const badges: BadgeDescriptor[] = [];
      const provider: GitProviderKind =
        member.gitProvider ?? member.credentials.gitProvider ?? "gitea";

      const serverUrl = member.credentials.httpServerUrl ?? member.credentials.giteaUrl ?? null;
      if (serverUrl && provider !== "github" && serverUrl !== "https://github.com") {
        badges.push({
          key: "server-url",
          label: serverUrl,
          tone: "neutral",
          mono: true,
        });
      }

      const hasDistinctDualUsernames = Boolean(
        member.giteaUsername &&
        member.githubUsername &&
        member.giteaUsername !== member.githubUsername,
      );
      if (hasDistinctDualUsernames && member.giteaUsername && member.githubUsername) {
        badges.push({
          key: "user-gitea",
          label: t("settings.accountGitea", { username: member.giteaUsername }),
          tone: "neutral",
          mono: false,
        });
        badges.push({
          key: "user-github",
          label: t("settings.accountGithub", { username: member.githubUsername }),
          tone: "neutral",
          mono: false,
        });
        return badges;
      }

      const username = member.gitUsername ?? member.giteaUsername ?? member.githubUsername ?? null;
      if (username) {
        let accountLabel = t("settings.accountGitea", { username });
        if (provider === "gitlab") {
          accountLabel = t("settings.accountGitlab", { username });
        } else if (provider === "github") {
          accountLabel = t("settings.accountGithub", { username });
        } else if (provider === "generic") {
          accountLabel = t("settings.accountGeneric", { username });
        }
        badges.push({
          key: "user-primary",
          label: accountLabel,
          tone: "neutral",
          mono: false,
        });
      }

      return badges;
    },
    [t],
  );

  const settings = useSettings(teamCollabSettings);
  const queryRoster = useRpc(teamCollabRosterStatusRpc);
  const syncHostAccounts = useRpc(teamCollabSyncHostAccountsRpc);
  const upsertMember = useRpc(teamCollabMemberUpsertRpc);
  const removeMember = useRpc(teamCollabMemberRemoveRpc);

  const [defaultMemberId, setDefaultMemberId] = useDefaultMemberId();
  const rosterRefreshVersion = useRosterRefreshVersion();

  const [members, setMembers] = useState<RosterMemberStatus[]>([]);
  const [discoveredAccounts, setDiscoveredAccounts] = useState<DiscoveredHostAccount[]>([]);
  const [discoveredSshKeys, setDiscoveredSshKeys] = useState<string[]>([]);
  const [detectedServerHint, setDetectedServerHint] = useState<DetectedServerHint | null>(null);
  const [syncingHostKey, setSyncingHostKey] = useState<OptionalSyncKey>(null);
  const [rpcPolicies, setRpcPolicies] = useState<TeamCollabPolicies>({
    enforceWorktreeOnCreate: DEFAULT_TEAM_COLLAB_SETTINGS.enforceWorktreeOnCreate,
    blockUnclaimedGitCommitPush: DEFAULT_TEAM_COLLAB_SETTINGS.blockUnclaimedGitCommitPush,
    allowSharedLocalCheckoutCommit: DEFAULT_TEAM_COLLAB_SETTINGS.allowSharedLocalCheckoutCommit,
    retentionDays: DEFAULT_TEAM_COLLAB_SETTINGS.retentionDays,
  });
  const [loadingRoster, setLoadingRoster] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<RosterMemberStatus | null>(null);
  const [form, setForm] = useState<MemberFormState>(EMPTY_MEMBER_FORM);
  const [formError, setFormError] = useState<OptionalErrorText>(null);
  const [savingMember, setSavingMember] = useState(false);

  const [confirmRemoveTarget, setConfirmRemoveTarget] = useState<RosterMemberStatus | null>(null);
  const [removingMember, setRemovingMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void queryRoster({})
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members);
        setRpcPolicies(res.policies);
        setDiscoveredAccounts(res.discoveredAccounts ?? []);
        setDiscoveredSshKeys(res.discoveredSshKeys ?? []);
        setDetectedServerHint(res.detectedServerHint ?? null);
        setLoadingRoster(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadingRoster(false);
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(t("settings.toastSaveFailed", { error: msg }));
      });
    return () => {
      cancelled = true;
    };
  }, [queryRoster, rosterRefreshVersion, t, toast]);

  const effectivePolicies: TeamCollabPolicies = useMemo(() => {
    if (settings.status === "ready") {
      return {
        enforceWorktreeOnCreate: settings.values.enforceWorktreeOnCreate,
        blockUnclaimedGitCommitPush: settings.values.blockUnclaimedGitCommitPush,
        allowSharedLocalCheckoutCommit: settings.values.allowSharedLocalCheckoutCommit,
        retentionDays: settings.values.retentionDays,
      };
    }
    return rpcPolicies;
  }, [rpcPolicies, settings]);

  const updatePolicy = useCallback(
    async (patch: Partial<Omit<TeamCollabSettings, "members">>) => {
      if (settings.status !== "ready" || settings.saving) {
        return;
      }
      const nextValues: TeamCollabSettings = {
        ...settings.values,
        ...patch,
      };
      const saved = await settings.save(nextValues, settings.revision);
      if (saved) {
        notifyRosterUpdated();
        toast.show(t("settings.toastPolicySaved"), { variant: "success" });
      } else if (settings.saveError) {
        toast.error(t("settings.toastSaveFailed", { error: settings.saveError }));
      }
    },
    [settings, t, toast],
  );

  const deviceSelectOptions = useMemo(() => {
    const opts: Array<{ label: string; value: string }> = [
      { label: t("settings.deviceNoneOption"), value: NONE_DEVICE_MEMBER },
    ];
    for (const m of members) {
      if (m.enabled === false && m.id !== defaultMemberId) continue;
      opts.push({
        label: `${m.name} (@${m.id})`,
        value: m.id,
      });
    }
    if (defaultMemberId && !opts.some((opt) => opt.value === defaultMemberId)) {
      opts.push({
        label: `@${defaultMemberId}`,
        value: defaultMemberId,
      });
    }
    return opts;
  }, [defaultMemberId, members, t]);

  const retentionOptions = useMemo(() => {
    const daysSet = new Set(PRESET_RETENTION_DAYS);
    daysSet.add(effectivePolicies.retentionDays);
    return Array.from(daysSet)
      .sort((a, b) => a - b)
      .map((days) => ({
        label: t("settings.retentionDaysOption", { days }),
        value: String(days),
      }));
  }, [effectivePolicies.retentionDays, t]);

  const handleOpenAddModal = useCallback(() => {
    const hintProvider: GitProviderKind = detectedServerHint?.gitProvider ?? "gitea";
    let hintServerUrl = "";
    if (detectedServerHint?.serverUrl && hintProvider !== "github") {
      hintServerUrl = detectedServerHint.serverUrl;
    }
    setEditingMember(null);
    setForm({
      ...EMPTY_MEMBER_FORM,
      gitProvider: hintProvider,
      httpServerUrl: hintServerUrl,
    });
    setFormError(null);
    setModalOpen(true);
  }, [detectedServerHint]);

  const handleOpenEditModal = useCallback(
    (member: RosterMemberStatus) => {
      const hasHttp = Boolean(
        member.credentials.hasHttpToken ||
        member.credentials.hasGiteaToken ||
        member.credentials.hasGithubToken,
      );
      const hasSsh = Boolean(member.credentials.hasSshKey);
      const initialAuthMode = resolveAuthModeFromFlags(hasHttp, hasSsh);

      let initialProvider: GitProviderKind =
        member.gitProvider ??
        member.credentials.gitProvider ??
        detectedServerHint?.gitProvider ??
        "gitea";
      if (member.credentials.hasGithubToken && !member.credentials.hasGiteaToken) {
        initialProvider = "github";
      }

      let initialServerUrl =
        member.credentials.httpServerUrl ??
        member.credentials.giteaUrl ??
        detectedServerHint?.serverUrl ??
        "";
      if (initialProvider === "github" || initialServerUrl === "https://github.com") {
        initialServerUrl = "";
      }

      let initialUsername = member.gitUsername ?? "";
      if (!initialUsername) {
        if (initialProvider === "github") {
          initialUsername = member.githubUsername ?? member.giteaUsername ?? "";
        } else {
          initialUsername = member.giteaUsername ?? member.githubUsername ?? "";
        }
      }

      setEditingMember(member);
      setForm({
        id: member.id,
        name: member.name,
        email: member.email,
        enabled: member.enabled !== false,
        authMode: initialAuthMode,
        gitProvider: initialProvider,
        httpServerUrl: initialServerUrl,
        gitUsername: initialUsername,
        httpToken: "",
        sshKeyPath: "",
        clearHttpToken: false,
        clearSshKey: false,
        useDiscoveredTeaLogin: null,
        selectedDiscoveredKey: null,
      });
      setFormError(null);
      setModalOpen(true);
    },
    [detectedServerHint],
  );

  const handleSyncAllHostAccounts = useCallback(async () => {
    if (syncingHostKey !== null) return;
    setSyncingHostKey("__all__");
    try {
      const res = await syncHostAccounts({
        overwriteExistingCredentials: false,
      });
      setMembers(res.members);
      setDiscoveredAccounts(res.discoveredAccounts);
      if (!defaultMemberId && res.importedIds.length > 0) {
        setDefaultMemberId(res.importedIds[0]);
      }
      notifyRosterUpdated();
      if (res.importedIds.length > 0) {
        toast.show(t("settings.toastHostSynced", { count: res.importedIds.length }), {
          variant: "success",
        });
      } else {
        toast.show(t("settings.toastHostSyncUpToDate"), { variant: "info" });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(t("settings.toastSaveFailed", { error: msg }));
    } finally {
      setSyncingHostKey(null);
    }
  }, [defaultMemberId, setDefaultMemberId, syncHostAccounts, syncingHostKey, t, toast]);

  const handleSyncSingleHostAccount = useCallback(
    async (acc: DiscoveredHostAccount, overwriteExistingCredentials: boolean) => {
      if (syncingHostKey !== null) return;
      setSyncingHostKey(acc.loginName);
      try {
        const res = await syncHostAccounts({
          loginNames: [acc.loginName],
          overwriteExistingCredentials,
        });
        setMembers(res.members);
        setDiscoveredAccounts(res.discoveredAccounts);
        const targetId = res.importedIds[0] ?? acc.suggestedId;
        if (!defaultMemberId && targetId) {
          setDefaultMemberId(targetId);
        }
        notifyRosterUpdated();
        toast.show(
          overwriteExistingCredentials
            ? t("settings.toastHostCredsResynced", { id: targetId })
            : t("settings.toastHostAccountImported", { id: targetId }),
          { variant: "success" },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(t("settings.toastSaveFailed", { error: msg }));
      } finally {
        setSyncingHostKey(null);
      }
    },
    [defaultMemberId, setDefaultMemberId, syncHostAccounts, syncingHostKey, t, toast],
  );

  const handleSelectDiscoveredInModal = useCallback(
    (acc: DiscoveredHostAccount) => {
      const chipKey = `${acc.source}:${acc.loginName}`;
      setForm((prev) => {
        const canBindHostToken = acc.source !== "git-global" && acc.hasToken;
        if (prev.selectedDiscoveredKey === chipKey) {
          return {
            ...prev,
            useDiscoveredTeaLogin: null,
            selectedDiscoveredKey: null,
          };
        }
        const nextMode = resolveAuthModeFromFlags(acc.hasToken, acc.hasSshKey);
        const nextProvider: GitProviderKind = acc.gitProvider ?? "gitea";
        let nextServerUrl = acc.giteaUrl ?? "";
        if (nextProvider === "github" || nextServerUrl === "https://github.com") {
          nextServerUrl = "";
        }
        const rawSshPreview = acc.sshKeyPathPreview?.trim() ?? "";
        const isFullSshPath =
          !rawSshPreview.startsWith("…/") &&
          (rawSshPreview.startsWith("~/") || rawSshPreview.startsWith("/"));
        let nextSshKeyPath = "";
        if (acc.hasSshKey && !canBindHostToken && isFullSshPath) {
          nextSshKeyPath = rawSshPreview;
        }
        return {
          ...prev,
          id: editingMember ? prev.id : acc.suggestedId,
          name: acc.suggestedName,
          email: acc.suggestedEmail,
          authMode: nextMode,
          gitProvider: nextProvider,
          gitUsername: acc.giteaUsername ?? "",
          httpServerUrl: nextServerUrl,
          sshKeyPath: nextSshKeyPath,
          useDiscoveredTeaLogin: canBindHostToken ? acc.loginName : null,
          selectedDiscoveredKey: chipKey,
          clearHttpToken: false,
          clearSshKey: acc.hasSshKey ? false : prev.clearSshKey,
        };
      });
    },
    [editingMember],
  );

  const handleSelectGitProvider = useCallback(
    (nextProvider: GitProviderKind) => {
      setForm((prev) => {
        let nextUrl = prev.httpServerUrl;
        if (nextProvider === "github") {
          nextUrl = "";
        } else if (
          (!nextUrl || nextUrl === "https://github.com") &&
          detectedServerHint &&
          detectedServerHint.gitProvider === nextProvider
        ) {
          nextUrl = detectedServerHint.serverUrl;
        } else if (nextUrl === "https://github.com") {
          nextUrl = "";
        }
        return {
          ...prev,
          gitProvider: nextProvider,
          httpServerUrl: nextUrl,
          clearHttpToken: false,
        };
      });
    },
    [detectedServerHint],
  );

  const selectedDiscoveredAccount = useMemo(
    () =>
      form.selectedDiscoveredKey
        ? (discoveredAccounts.find(
            (a) => `${a.source}:${a.loginName}` === form.selectedDiscoveredKey,
          ) ?? null)
        : null,
    [discoveredAccounts, form.selectedDiscoveredKey],
  );

  const editingMemberHasStoredHttpToken =
    form.gitProvider === "github"
      ? Boolean(editingMember?.credentials.hasGithubToken)
      : Boolean(editingMember?.credentials.hasGiteaToken);
  const editingMemberStoredTokenPreview =
    form.gitProvider === "github"
      ? (editingMember?.credentials.githubTokenPreview ?? null)
      : (editingMember?.credentials.giteaTokenPreview ?? null);
  const editingMemberHasAnyStoredHttpToken = Boolean(
    editingMember?.credentials.hasHttpToken ||
    editingMember?.credentials.hasGiteaToken ||
    editingMember?.credentials.hasGithubToken,
  );
  const editingMemberHasAnyRemoteCreds = Boolean(
    editingMemberHasAnyStoredHttpToken || editingMember?.credentials.hasSshKey,
  );

  const handleSaveMember = useCallback(async () => {
    if (savingMember) return;
    const trimmedId = (editingMember ? editingMember.id : form.id).trim();
    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();

    if (!MEMBER_ID_PATTERN.test(trimmedId)) {
      setFormError(t("settings.validationIdInvalid"));
      return;
    }
    if (trimmedId === SYSTEM_BOT_MEMBER_ID) {
      setFormError(t("settings.validationIdReserved"));
      return;
    }
    if (!trimmedName) {
      setFormError(t("settings.validationNameRequired"));
      return;
    }
    if (trimmedEmail.length < 3 || !trimmedEmail.includes("@") || /\s/.test(trimmedEmail)) {
      setFormError(t("settings.validationEmailInvalid"));
      return;
    }

    const includesHttps = form.authMode === "https" || form.authMode === "both";
    const includesSsh = form.authMode === "ssh" || form.authMode === "both";
    const trimmedServerUrl = form.httpServerUrl.trim();

    if (includesHttps && form.gitProvider !== "github" && trimmedServerUrl) {
      let validUrl = false;
      try {
        const parsed = new URL(trimmedServerUrl);
        validUrl =
          (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
      } catch {
        validUrl = false;
      }
      if (!validUrl) {
        setFormError(t("settings.validationServerUrlInvalid"));
        return;
      }
    }

    const credentials: MemberCredentialsInput = {};

    if (form.authMode === "author-only") {
      credentials.httpToken = null;
      credentials.giteaToken = null;
      credentials.githubToken = null;
      credentials.httpServerUrl = null;
      credentials.giteaUrl = null;
      credentials.sshKeyPath = null;
    } else {
      if (includesHttps) {
        credentials.gitProvider = form.gitProvider;
        if (form.gitProvider === "github") {
          credentials.httpServerUrl = "https://github.com";
          if (editingMember?.credentials.giteaUrl) {
            credentials.giteaUrl = null;
          }
          if (editingMember?.credentials.hasGiteaToken) {
            credentials.giteaToken = null;
          }
        } else {
          if (trimmedServerUrl) {
            credentials.httpServerUrl = trimmedServerUrl;
            credentials.giteaUrl = trimmedServerUrl;
          } else if (
            editingMember?.credentials.giteaUrl ||
            editingMember?.credentials.httpServerUrl
          ) {
            credentials.httpServerUrl = null;
            credentials.giteaUrl = null;
          }
          if (editingMember?.credentials.hasGithubToken) {
            credentials.githubToken = null;
          }
        }

        if (form.clearHttpToken) {
          credentials.httpToken = null;
          credentials.giteaToken = null;
          credentials.githubToken = null;
        } else if (form.httpToken.trim()) {
          credentials.httpToken = form.httpToken.trim();
        } else if (form.useDiscoveredTeaLogin) {
          credentials.useDiscoveredTeaLogin = form.useDiscoveredTeaLogin;
        }
      } else {
        // SSH-only mode: clear any previously stored HTTP tokens
        if (
          editingMemberHasAnyStoredHttpToken ||
          editingMember?.credentials.giteaUrl ||
          editingMember?.credentials.httpServerUrl
        ) {
          credentials.httpToken = null;
          credentials.giteaToken = null;
          credentials.githubToken = null;
          credentials.httpServerUrl = null;
          credentials.giteaUrl = null;
        }
      }

      if (includesSsh) {
        if (form.clearSshKey) {
          credentials.sshKeyPath = null;
        } else if (form.sshKeyPath.trim()) {
          credentials.sshKeyPath = form.sshKeyPath.trim();
        }
      } else {
        // HTTPS-only mode: ensure no SSH key remains or gets attached from CLI login
        credentials.sshKeyPath = null;
      }
    }

    const trimmedGitUsername = form.gitUsername.trim();
    let giteaUsername: string | undefined;
    let githubUsername: string | undefined;
    if (trimmedGitUsername) {
      if (form.gitProvider === "github") {
        githubUsername = trimmedGitUsername;
      } else {
        giteaUsername = trimmedGitUsername;
      }
    }

    setSavingMember(true);
    setFormError(null);
    try {
      const res = await upsertMember({
        member: {
          id: trimmedId,
          name: trimmedName,
          email: trimmedEmail,
          gitProvider: form.gitProvider,
          gitUsername: trimmedGitUsername || undefined,
          giteaUsername,
          githubUsername,
          enabled: form.enabled,
        },
        credentials,
      });
      if (!defaultMemberId && res.member.enabled !== false) {
        setDefaultMemberId(res.member.id);
      } else if (defaultMemberId === res.member.id && res.member.enabled === false) {
        setDefaultMemberId(null);
      }
      notifyRosterUpdated();
      toast.show(t("settings.toastMemberSaved", { id: res.member.id }), {
        variant: "success",
      });
      setModalOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setFormError(msg);
    } finally {
      setSavingMember(false);
    }
  }, [
    defaultMemberId,
    editingMember,
    editingMemberHasAnyStoredHttpToken,
    form,
    savingMember,
    setDefaultMemberId,
    t,
    toast,
    upsertMember,
  ]);

  const handleConfirmRemove = useCallback(async () => {
    if (!confirmRemoveTarget || removingMember) return;
    setRemovingMember(true);
    try {
      const targetId = confirmRemoveTarget.id;
      await removeMember({ memberId: targetId });
      if (defaultMemberId === targetId) {
        setDefaultMemberId(null);
      }
      notifyRosterUpdated();
      toast.show(t("settings.toastMemberRemoved", { id: targetId }), {
        variant: "info",
      });
      setConfirmRemoveTarget(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(t("settings.toastSaveFailed", { error: msg }));
    } finally {
      setRemovingMember(false);
    }
  }, [
    confirmRemoveTarget,
    defaultMemberId,
    removeMember,
    removingMember,
    setDefaultMemberId,
    t,
    toast,
  ]);

  const mono = monoFontFamily(layout.platform);
  const policiesEditable = settings.status === "ready" && !settings.saving;
  const showHttpsFields = form.authMode === "https" || form.authMode === "both";
  const showSshFields = form.authMode === "ssh" || form.authMode === "both";

  if (settings.status === "loading" && loadingRoster) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={[styles.loadingText, { color: theme.colors.foregroundMuted }]}>
          {t("settings.loading")}
        </Text>
      </View>
    );
  }

  let storedTokenPlaceholder = t("settings.secretNewPlaceholder");
  if (form.useDiscoveredTeaLogin) {
    storedTokenPlaceholder = t("settings.modalTeaBindNotice", {
      loginName: form.useDiscoveredTeaLogin,
      preview: selectedDiscoveredAccount?.tokenPreview ?? t("settings.credUnset"),
    });
  } else if (editingMemberStoredTokenPreview) {
    storedTokenPlaceholder = t("settings.secretKeepPlaceholder", {
      preview: editingMemberStoredTokenPreview,
    });
  }

  let newTokenPlaceholder = t("settings.secretNewPlaceholder");
  if (form.useDiscoveredTeaLogin) {
    newTokenPlaceholder = t("settings.modalTeaBindNotice", {
      loginName: form.useDiscoveredTeaLogin,
      preview: selectedDiscoveredAccount?.tokenPreview ?? t("settings.credUnset"),
    });
  }

  return (
    <>
      {/* 1. Device Identity Section */}
      <SettingsSection title={t("settings.deviceSection")} info={t("settings.deviceInfo")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.deviceMemberLabel")}
            hint={
              layout.platform === "web"
                ? t("settings.deviceHintWeb")
                : t("settings.deviceHintNative")
            }
            value={defaultMemberId ?? NONE_DEVICE_MEMBER}
            options={deviceSelectOptions}
            onValueChange={(next) => setDefaultMemberId(next === NONE_DEVICE_MEMBER ? null : next)}
          />
          <SettingsAction
            label={t("settings.openUsageLabel")}
            hint={t("settings.openUsageHint")}
            actionLabel={t("settings.openUsageAction")}
            onPress={onOpenUsage}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 2. Team Roster & Masked Credentials Section */}
      <SettingsSection title={t("settings.rosterSection")} info={t("settings.rosterInfo")}>
        <SettingsCard>
          <SettingsAction
            label={t("settings.addMemberLabel")}
            hint={t("settings.addMemberHint")}
            actionLabel={t("settings.addMemberAction")}
            onPress={handleOpenAddModal}
          />
          <SettingsAction
            label={t("settings.syncHostLabel")}
            hint={t("settings.syncHostHint")}
            actionLabel={
              syncingHostKey === "__all__"
                ? t("settings.syncingHostAction")
                : t("settings.syncHostAction")
            }
            disabled={syncingHostKey !== null}
            onPress={() => void handleSyncAllHostAccounts()}
          />

          {discoveredAccounts.length > 0 ? (
            <View
              style={[
                styles.discoveredContainer,
                {
                  borderTopColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                },
              ]}
            >
              <Text
                style={[styles.discoveredSectionHeading, { color: theme.colors.foregroundMuted }]}
              >
                {t("settings.discoveredHeading")}
              </Text>
              {discoveredAccounts.map((acc, idx) => {
                const isBusy = syncingHostKey === acc.loginName;
                const canResyncCredentials =
                  acc.alreadyInRoster &&
                  (acc.source !== "git-global" || acc.hasToken || acc.hasSshKey);
                let discoveredActionNode: React.ReactNode = null;
                if (!acc.alreadyInRoster) {
                  const importLabel = isBusy
                    ? t("settings.syncingHostAction")
                    : t("settings.importAsMemberAction");
                  discoveredActionNode = (
                    <ActionButton
                      label={importLabel}
                      icon="UserCheck"
                      variant="secondary"
                      compactSize
                      disabled={syncingHostKey !== null}
                      theme={theme}
                      compactLayout={layout.compact}
                      onPress={() => void handleSyncSingleHostAccount(acc, false)}
                    />
                  );
                } else if (canResyncCredentials) {
                  const resyncLabel = isBusy
                    ? t("settings.syncingHostAction")
                    : t("settings.resyncCredentialsAction");
                  discoveredActionNode = (
                    <ActionButton
                      label={resyncLabel}
                      icon="KeyRound"
                      variant="outline"
                      compactSize
                      disabled={syncingHostKey !== null}
                      theme={theme}
                      compactLayout={layout.compact}
                      onPress={() => void handleSyncSingleHostAccount(acc, true)}
                    />
                  );
                }

                const discoveredBadges = buildDiscoveredAccountCredentialBadges(acc);

                return (
                  <View
                    key={`${acc.source}:${acc.loginName}`}
                    style={[
                      styles.discoveredRow,
                      {
                        borderTopWidth: idx > 0 ? StyleSheet.hairlineWidth : 0,
                        borderTopColor: theme.colors.border,
                      },
                    ]}
                  >
                    <View style={styles.memberInfoCol}>
                      <View style={styles.memberTitleLine}>
                        <Text style={[styles.memberNameText, { color: theme.colors.foreground }]}>
                          {acc.suggestedName}
                        </Text>
                        <Text
                          style={[
                            styles.memberHandleText,
                            {
                              color: theme.colors.foregroundMuted,
                              fontFamily: mono,
                            },
                          ]}
                        >
                          {acc.loginName} · @{acc.suggestedId}
                        </Text>
                        <StatusTag
                          label={getDiscoveredSourceLabel(acc.source)}
                          platform={layout.platform}
                          theme={theme}
                        />
                        <StatusTag
                          icon={acc.alreadyInRoster ? "Check" : undefined}
                          label={
                            acc.alreadyInRoster
                              ? t("settings.discoveredInRosterBadge")
                              : t("settings.discoveredUnimportedBadge")
                          }
                          tone={acc.alreadyInRoster ? "success" : "neutral"}
                          platform={layout.platform}
                          theme={theme}
                        />
                      </View>

                      <Text
                        style={[styles.memberEmailText, { color: theme.colors.foregroundMuted }]}
                      >
                        {acc.suggestedEmail}
                      </Text>

                      <View style={styles.badgeWrapRow}>
                        {discoveredBadges.map((badge) => (
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
                    </View>

                    {discoveredActionNode ? (
                      <View style={styles.memberActionsRow}>{discoveredActionNode}</View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {members.length === 0 ? (
            <SettingsRow label={t("settings.emptyRoster")} />
          ) : (
            members.map((member) => {
              const isDeviceDefault = defaultMemberId === member.id;
              const platformMetaBadges = buildMemberPlatformMetaBadges(member);
              const credentialBadges = buildMemberCredentialBadges(
                member.credentials,
                member.gitProvider,
              );
              return (
                <View
                  key={member.id}
                  style={[styles.memberCardRow, { borderTopColor: theme.colors.border }]}
                >
                  <View style={styles.memberInfoCol}>
                    <View style={styles.memberTitleLine}>
                      <Text style={[styles.memberNameText, { color: theme.colors.foreground }]}>
                        {member.name}
                      </Text>
                      <Text
                        style={[
                          styles.memberHandleText,
                          {
                            color: theme.colors.foregroundMuted,
                            fontFamily: mono,
                          },
                        ]}
                      >
                        @{member.id}
                      </Text>
                      {isDeviceDefault ? (
                        <StatusTag
                          icon="Check"
                          label={t("settings.deviceDefaultBadge")}
                          tone="accent"
                          platform={layout.platform}
                          theme={theme}
                        />
                      ) : null}
                      {member.enabled === false ? (
                        <StatusTag
                          label={t("settings.disabledBadge")}
                          tone="warning"
                          platform={layout.platform}
                          theme={theme}
                        />
                      ) : null}
                    </View>

                    <Text style={[styles.memberEmailText, { color: theme.colors.foregroundMuted }]}>
                      {member.email}
                    </Text>

                    <View style={styles.badgeWrapRow}>
                      {platformMetaBadges.map((badge) => (
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
                      {credentialBadges.map((badge) => (
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
                  </View>

                  <View style={styles.memberActionsRow}>
                    {!isDeviceDefault && member.enabled !== false ? (
                      <ActionButton
                        label={t("settings.setDefaultAction")}
                        variant="outline"
                        compactSize
                        theme={theme}
                        compactLayout={layout.compact}
                        onPress={() => setDefaultMemberId(member.id)}
                      />
                    ) : null}
                    <ActionButton
                      label={t("settings.editAction")}
                      icon="Pencil"
                      variant="secondary"
                      compactSize
                      theme={theme}
                      compactLayout={layout.compact}
                      onPress={() => handleOpenEditModal(member)}
                    />
                    <ActionButton
                      label={t("settings.removeAction")}
                      icon="Trash2"
                      variant="outline"
                      compactSize
                      theme={theme}
                      compactLayout={layout.compact}
                      onPress={() => setConfirmRemoveTarget(member)}
                    />
                  </View>
                </View>
              );
            })
          )}
        </SettingsCard>
      </SettingsSection>

      {/* 3. Guardrail Policies Section */}
      <SettingsSection title={t("settings.policiesSection")} info={t("settings.policiesInfo")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.policyEnforceWorktree")}
            hint={t("settings.policyEnforceWorktreeHint")}
            value={effectivePolicies.enforceWorktreeOnCreate}
            disabled={!policiesEditable}
            onValueChange={(val) => void updatePolicy({ enforceWorktreeOnCreate: val })}
          />
          <SettingsSwitch
            label={t("settings.policyBlockUnclaimed")}
            hint={t("settings.policyBlockUnclaimedHint")}
            value={effectivePolicies.blockUnclaimedGitCommitPush}
            disabled={!policiesEditable}
            onValueChange={(val) => void updatePolicy({ blockUnclaimedGitCommitPush: val })}
          />
          <SettingsSwitch
            label={t("settings.policyAllowMain")}
            hint={t("settings.policyAllowMainHint")}
            value={effectivePolicies.allowSharedLocalCheckoutCommit}
            disabled={!policiesEditable}
            onValueChange={(val) => void updatePolicy({ allowSharedLocalCheckoutCommit: val })}
          />
          <SettingsSelect
            label={t("settings.policyRetention")}
            hint={t("settings.policyRetentionHint")}
            value={String(effectivePolicies.retentionDays)}
            options={retentionOptions}
            disabled={!policiesEditable}
            onValueChange={(val) => {
              const parsed = Number.parseInt(val, 10);
              if (Number.isFinite(parsed) && parsed >= 7) {
                void updatePolicy({ retentionDays: parsed });
              }
            }}
          />
        </SettingsCard>
      </SettingsSection>

      {/* Add / Edit Member Modal: Progressive Two-Step Form */}
      <Modal
        title={
          editingMember
            ? t("settings.modalEditTitle", { id: editingMember.id })
            : t("settings.modalAddTitle")
        }
        open={modalOpen}
        onOpenChange={(open) => {
          if (!savingMember) {
            setModalOpen(open);
          }
        }}
      >
        <Modal.Content
          style={{ backgroundColor: theme.colors.surface0 }}
          contentContainerStyle={styles.modalContent}
        >
          {formError ? (
            <View
              style={[
                styles.errorBanner,
                {
                  backgroundColor: theme.colors.surface1,
                  borderColor: theme.colors.statusDanger,
                },
              ]}
            >
              <Text style={[styles.errorBannerText, { color: theme.colors.statusDanger }]}>
                {formError}
              </Text>
            </View>
          ) : null}

          {/* Optional Top Quick-Fill Bar from Host Discovered Accounts */}
          {discoveredAccounts.length > 0 ? (
            <View
              style={[
                styles.quickFillBox,
                {
                  backgroundColor: theme.colors.surface1,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.stepHeaderBlock}>
                <Text style={[styles.stepHeadingText, { color: theme.colors.foreground }]}>
                  {t("settings.modalQuickFillHeading")}
                </Text>
                <Text style={[styles.stepNoticeText, { color: theme.colors.foregroundMuted }]}>
                  {t("settings.modalQuickFillHint")}
                </Text>
              </View>

              <View style={styles.quickFillChipsRow}>
                {discoveredAccounts.map((acc) => {
                  const chipKey = `${acc.source}:${acc.loginName}`;
                  const selected = form.selectedDiscoveredKey === chipKey;
                  const sourceLabel = getDiscoveredSourceLabel(acc.source);
                  const chipLabel = `${formatAccountChipLabel(acc)} · ${sourceLabel}`;
                  return (
                    <Pressable
                      key={chipKey}
                      accessibilityRole="button"
                      accessibilityLabel={chipLabel}
                      accessibilityState={{ selected }}
                      disabled={savingMember}
                      onPress={() => handleSelectDiscoveredInModal(acc)}
                      style={({ pressed }) => [
                        styles.quickFillChip,
                        {
                          minHeight: layout.compact ? 40 : 34,
                          backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface0,
                          borderColor: selected ? theme.colors.accent : theme.colors.border,
                        },
                        pressed && { opacity: 0.78 },
                      ]}
                    >
                      <Icon
                        name={selected ? "Check" : "KeyRound"}
                        size={12}
                        color={selected ? theme.colors.accent : theme.colors.foregroundMuted}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.quickFillChipText,
                          {
                            color: selected
                              ? theme.colors.foreground
                              : theme.colors.foregroundMuted,
                            fontFamily: mono,
                          },
                        ]}
                      >
                        {formatAccountChipLabel(acc)}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.quickFillSourceTag,
                          { color: selected ? theme.colors.accent : theme.colors.foregroundMuted },
                        ]}
                      >
                        {sourceLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {form.useDiscoveredTeaLogin ? (
                <View
                  style={[
                    styles.teaBindNoticeBar,
                    {
                      backgroundColor: theme.colors.surface0,
                      borderColor: theme.colors.accent,
                    },
                  ]}
                >
                  <View style={styles.teaBindNoticeLeft}>
                    <Icon name="KeyRound" size={14} color={theme.colors.accent} />
                    <Text style={[styles.teaBindNoticeText, { color: theme.colors.foreground }]}>
                      {t("settings.modalTeaBindNotice", {
                        loginName: form.useDiscoveredTeaLogin,
                        preview: selectedDiscoveredAccount?.tokenPreview ?? t("settings.credUnset"),
                      })}
                    </Text>
                  </View>
                  <ActionButton
                    label={t("settings.modalTeaUnbindAction")}
                    variant="ghost"
                    compactSize
                    disabled={savingMember}
                    theme={theme}
                    compactLayout={layout.compact}
                    onPress={() =>
                      setForm((prev) => ({
                        ...prev,
                        useDiscoveredTeaLogin: null,
                        selectedDiscoveredKey: null,
                      }))
                    }
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Step 1: Universal Git Commit Author (3 required fields + Enable switch) */}
          <View
            style={[
              styles.stepSectionBox,
              {
                backgroundColor: theme.colors.surface1,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={styles.stepHeaderBlock}>
              <Text style={[styles.stepHeadingText, { color: theme.colors.foreground }]}>
                {t("settings.step1Heading")}
              </Text>
              <Text style={[styles.stepNoticeText, { color: theme.colors.foregroundMuted }]}>
                {t("settings.step1Notice")}
              </Text>
            </View>

            <FormField
              label={t("settings.fieldId")}
              hint={editingMember ? undefined : t("settings.fieldIdHint")}
              theme={theme}
            >
              <TextInput
                editable={!editingMember && !savingMember}
                autoCapitalize="none"
                autoCorrect={false}
                value={form.id}
                onChangeText={(text) => setForm((prev) => ({ ...prev, id: text }))}
                placeholder={t("settings.fieldIdPlaceholder")}
                placeholderTextColor={theme.colors.foregroundMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.colors.surface0,
                    borderColor: theme.colors.border,
                    color: theme.colors.foreground,
                    fontFamily: mono,
                    opacity: editingMember ? 0.6 : 1,
                  },
                ]}
              />
            </FormField>

            <View style={layout.compact ? styles.fieldStack : styles.twoColRow}>
              <View style={styles.colFlex}>
                <FormField label={t("settings.fieldName")} theme={theme}>
                  <TextInput
                    editable={!savingMember}
                    value={form.name}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, name: text }))}
                    placeholder={t("settings.fieldNamePlaceholder")}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.colors.surface0,
                        borderColor: theme.colors.border,
                        color: theme.colors.foreground,
                      },
                    ]}
                  />
                </FormField>
              </View>

              <View style={styles.colFlex}>
                <FormField label={t("settings.fieldEmail")} theme={theme}>
                  <TextInput
                    editable={!savingMember}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    value={form.email}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, email: text }))}
                    placeholder={t("settings.fieldEmailPlaceholder")}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.colors.surface0,
                        borderColor: theme.colors.border,
                        color: theme.colors.foreground,
                      },
                    ]}
                  />
                </FormField>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.fieldEnabled")}
              accessibilityState={{ checked: form.enabled }}
              disabled={savingMember}
              onPress={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
              style={[
                styles.toggleCardRow,
                {
                  backgroundColor: theme.colors.surface0,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text style={[styles.toggleRowLabel, { color: theme.colors.foreground }]}>
                {t("settings.fieldEnabled")}
              </Text>
              <View
                style={[
                  styles.checkPill,
                  {
                    backgroundColor: form.enabled ? theme.colors.accent : theme.colors.surface2,
                    borderColor: form.enabled ? theme.colors.accent : theme.colors.border,
                  },
                ]}
              >
                {form.enabled ? (
                  <Icon name="Check" size={12} color={theme.colors.accentForeground} />
                ) : null}
              </View>
            </Pressable>
          </View>

          {/* Step 2: Remote Push & Platform Authentication (4-mode selector, on-demand expansion) */}
          <View
            style={[
              styles.stepSectionBox,
              {
                backgroundColor: theme.colors.surface1,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={styles.stepHeaderBlock}>
              <Text style={[styles.stepHeadingText, { color: theme.colors.foreground }]}>
                {t("settings.step2Heading")}
              </Text>
              <Text style={[styles.stepNoticeText, { color: theme.colors.foregroundMuted }]}>
                {t("settings.step2Notice")}
              </Text>
            </View>

            {/* 2x2 Segmented Mode Grid (minHeight >= 40px) */}
            <View style={styles.gridStack}>
              {AUTH_MODE_ROWS.map((row, rowIdx) => (
                <View key={rowIdx} style={styles.gridRow}>
                  {row.map((mode) => {
                    const active = form.authMode === mode;
                    const meta = getAuthModeMeta(mode);
                    return (
                      <Pressable
                        key={mode}
                        accessibilityRole="button"
                        accessibilityLabel={meta.label}
                        accessibilityState={{ selected: active }}
                        disabled={savingMember}
                        onPress={() => setForm((prev) => ({ ...prev, authMode: mode }))}
                        style={({ pressed }) => [
                          styles.modeGridBtn,
                          {
                            minHeight: layout.compact ? 44 : 40,
                            backgroundColor: active ? theme.colors.surface2 : theme.colors.surface0,
                            borderColor: active ? theme.colors.accent : theme.colors.border,
                          },
                          pressed && { opacity: 0.78 },
                        ]}
                      >
                        <Icon
                          name={meta.icon}
                          size={14}
                          color={active ? theme.colors.accent : theme.colors.foregroundMuted}
                        />
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.modeGridBtnLabel,
                            {
                              color: active
                                ? theme.colors.foreground
                                : theme.colors.foregroundMuted,
                              fontWeight: active ? "500" : "400",
                            },
                          ]}
                        >
                          {meta.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Mode 1: Author Only (No extra inputs expanded) */}
            {form.authMode === "author-only" ? (
              <View
                style={[
                  styles.authorOnlyBox,
                  {
                    backgroundColor: theme.colors.surface0,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <Text style={[styles.authorOnlyDesc, { color: theme.colors.foregroundMuted }]}>
                  {t("settings.authModeAuthorOnlyDesc")}
                </Text>
                {editingMemberHasAnyRemoteCreds ? (
                  <Text style={[styles.authorOnlyWarn, { color: theme.colors.statusWarning }]}>
                    {t("settings.authModeAuthorOnlyClearWarn")}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Mode 3 & 4: HTTPS Platform & Token Configuration */}
            {showHttpsFields ? (
              <View style={styles.subSectionStack}>
                <FormField label={t("settings.fieldGitProvider")} theme={theme}>
                  <View style={styles.gridStack}>
                    {GIT_PROVIDER_ROWS.map((row, rowIdx) => (
                      <View key={rowIdx} style={styles.gridRow}>
                        {row.map((provider) => {
                          const active = form.gitProvider === provider;
                          const label = getProviderChoiceLabel(provider);
                          return (
                            <Pressable
                              key={provider}
                              accessibilityRole="button"
                              accessibilityLabel={label}
                              accessibilityState={{ selected: active }}
                              disabled={savingMember}
                              onPress={() => handleSelectGitProvider(provider)}
                              style={({ pressed }) => [
                                styles.providerGridBtn,
                                {
                                  minHeight: layout.compact ? 40 : 36,
                                  backgroundColor: active
                                    ? theme.colors.surface2
                                    : theme.colors.surface0,
                                  borderColor: active ? theme.colors.accent : theme.colors.border,
                                },
                                pressed && { opacity: 0.78 },
                              ]}
                            >
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.modeGridBtnLabel,
                                  {
                                    color: active
                                      ? theme.colors.foreground
                                      : theme.colors.foregroundMuted,
                                    fontWeight: active ? "500" : "400",
                                  },
                                ]}
                              >
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </FormField>

                {form.gitProvider === "github" ? (
                  <View
                    style={[
                      styles.readonlyUrlNotice,
                      {
                        backgroundColor: theme.colors.surface0,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.readonlyUrlDomain,
                        { color: theme.colors.foreground, fontFamily: mono },
                      ]}
                    >
                      https://github.com
                    </Text>
                    <Text style={[styles.readonlyUrlHint, { color: theme.colors.foregroundMuted }]}>
                      {t("settings.githubFixedUrlNote")}
                    </Text>
                  </View>
                ) : (
                  <FormField label={t("settings.fieldServerUrl")} theme={theme}>
                    <TextInput
                      editable={!savingMember}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={form.httpServerUrl}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, httpServerUrl: text }))}
                      placeholder={getServerUrlPlaceholder(form.gitProvider)}
                      placeholderTextColor={theme.colors.foregroundMuted}
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.colors.surface0,
                          borderColor: theme.colors.border,
                          color: theme.colors.foreground,
                          fontFamily: mono,
                        },
                      ]}
                    />
                  </FormField>
                )}

                <FormField
                  label={t("settings.fieldGitUsername")}
                  hint={t("settings.fieldGitUsernameHint")}
                  theme={theme}
                >
                  <TextInput
                    editable={!savingMember}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={form.gitUsername}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, gitUsername: text }))}
                    placeholder={t("settings.fieldGitUsernamePlaceholder")}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.colors.surface0,
                        borderColor: theme.colors.border,
                        color: theme.colors.foreground,
                      },
                    ]}
                  />
                </FormField>

                <SecretFieldBlock
                  label={t("settings.fieldHttpToken")}
                  value={form.httpToken}
                  onChangeText={(text) =>
                    setForm((prev) => ({
                      ...prev,
                      httpToken: text,
                      clearHttpToken: false,
                      useDiscoveredTeaLogin: text.trim() ? null : prev.useDiscoveredTeaLogin,
                    }))
                  }
                  hasStored={editingMemberHasStoredHttpToken}
                  storedPlaceholder={storedTokenPlaceholder}
                  newPlaceholder={newTokenPlaceholder}
                  clearRequested={form.clearHttpToken}
                  onToggleClear={() =>
                    setForm((prev) => ({
                      ...prev,
                      clearHttpToken: !prev.clearHttpToken,
                      httpToken: "",
                      useDiscoveredTeaLogin: null,
                    }))
                  }
                  clearLabel={t("settings.clearCredential")}
                  willClearLabel={t("settings.willClearBadge")}
                  secureTextEntry
                  disabled={savingMember}
                  platform={layout.platform}
                  theme={theme}
                />
              </View>
            ) : null}

            {/* Mode 2 & 4: SSH Private Key Configuration */}
            {showSshFields ? (
              <View
                style={[
                  styles.subSectionStack,
                  showHttpsFields && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                    paddingTop: 12,
                  },
                ]}
              >
                {discoveredSshKeys.length > 0 ? (
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.fieldHint, { color: theme.colors.foregroundMuted }]}>
                      {t("settings.sshDiscoveredKeysLabel")}
                    </Text>
                    <View style={styles.quickFillChipsRow}>
                      {discoveredSshKeys.map((sshKey) => {
                        const normalizedChipKey = normalizeSshKeyPathForMatch(sshKey);
                        const normalizedInputKey = normalizeSshKeyPathForMatch(form.sshKeyPath);
                        const normalizedStoredKey = normalizeSshKeyPathForMatch(
                          editingMember?.credentials.sshKeyPathPreview,
                        );
                        const activeNormalizedKey = normalizedInputKey || normalizedStoredKey;
                        const isSelectedKey =
                          !form.clearSshKey &&
                          Boolean(normalizedChipKey) &&
                          activeNormalizedKey === normalizedChipKey;
                        return (
                          <Pressable
                            key={sshKey}
                            accessibilityRole="button"
                            accessibilityLabel={sshKey}
                            accessibilityState={{ selected: isSelectedKey }}
                            disabled={savingMember}
                            onPress={() =>
                              setForm((prev) => ({
                                ...prev,
                                sshKeyPath: sshKey,
                                clearSshKey: false,
                              }))
                            }
                            style={({ pressed }) => [
                              styles.quickFillChip,
                              {
                                minHeight: layout.compact ? 40 : 32,
                                backgroundColor: isSelectedKey
                                  ? theme.colors.surface2
                                  : theme.colors.surface0,
                                borderColor: isSelectedKey
                                  ? theme.colors.accent
                                  : theme.colors.border,
                              },
                              pressed && { opacity: 0.78 },
                            ]}
                          >
                            <Icon
                              name={isSelectedKey ? "Check" : "KeyRound"}
                              size={12}
                              color={
                                isSelectedKey ? theme.colors.accent : theme.colors.foregroundMuted
                              }
                            />
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.quickFillChipText,
                                {
                                  color: isSelectedKey
                                    ? theme.colors.foreground
                                    : theme.colors.foregroundMuted,
                                  fontFamily: mono,
                                },
                              ]}
                            >
                              {sshKey}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                <SecretFieldBlock
                  label={t("settings.fieldSshKeyPath")}
                  value={form.sshKeyPath}
                  onChangeText={(text) =>
                    setForm((prev) => ({
                      ...prev,
                      sshKeyPath: text,
                      clearSshKey: false,
                    }))
                  }
                  hasStored={Boolean(editingMember?.credentials.hasSshKey)}
                  storedPlaceholder={
                    editingMember?.credentials.sshKeyPathPreview
                      ? t("settings.sshKeepPlaceholder", {
                          preview: editingMember.credentials.sshKeyPathPreview,
                        })
                      : t("settings.fieldSshKeyPlaceholder")
                  }
                  newPlaceholder={t("settings.fieldSshKeyPlaceholder")}
                  clearRequested={form.clearSshKey}
                  onToggleClear={() =>
                    setForm((prev) => ({
                      ...prev,
                      clearSshKey: !prev.clearSshKey,
                      sshKeyPath: "",
                    }))
                  }
                  clearLabel={t("settings.clearCredential")}
                  willClearLabel={t("settings.willClearBadge")}
                  secureTextEntry={false}
                  disabled={savingMember}
                  platform={layout.platform}
                  theme={theme}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.modalActionsRow}>
            <ActionButton
              label={t("settings.cancelAction")}
              variant="secondary"
              disabled={savingMember}
              theme={theme}
              compactLayout={layout.compact}
              onPress={() => setModalOpen(false)}
              style={styles.modalBtnFlex}
            />
            <ActionButton
              label={
                savingMember ? t("settings.savingMemberAction") : t("settings.saveMemberAction")
              }
              icon="Check"
              variant="primary"
              disabled={savingMember}
              theme={theme}
              compactLayout={layout.compact}
              onPress={() => void handleSaveMember()}
              style={styles.modalBtnFlex}
            />
          </View>
        </Modal.Content>
      </Modal>

      {/* Destructive Member Removal Confirmation Modal */}
      <Modal
        title={
          confirmRemoveTarget
            ? t("settings.confirmRemoveTitle", { id: confirmRemoveTarget.id })
            : t("settings.removeAction")
        }
        open={confirmRemoveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removingMember) {
            setConfirmRemoveTarget(null);
          }
        }}
      >
        <Modal.Content
          style={{ backgroundColor: theme.colors.surface0 }}
          contentContainerStyle={styles.modalContent}
        >
          {confirmRemoveTarget ? (
            <Text style={[styles.confirmBodyText, { color: theme.colors.foregroundMuted }]}>
              {t("settings.confirmRemoveDesc", {
                name: confirmRemoveTarget.name,
              })}
            </Text>
          ) : null}

          <View style={styles.modalActionsRow}>
            <ActionButton
              label={t("settings.cancelAction")}
              variant="secondary"
              disabled={removingMember}
              theme={theme}
              compactLayout={layout.compact}
              onPress={() => setConfirmRemoveTarget(null)}
              style={styles.modalBtnFlex}
            />
            <ActionButton
              label={
                removingMember ? t("settings.removingAction") : t("settings.confirmRemoveAction")
              }
              icon="Trash2"
              variant="danger"
              disabled={removingMember}
              theme={theme}
              compactLayout={layout.compact}
              onPress={() => void handleConfirmRemove()}
              style={styles.modalBtnFlex}
            />
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
});

const FormField = memo(function FormField({
  label,
  hint,
  theme,
  children,
}: {
  label: string;
  hint?: string;
  theme: PluginSurfaceProps["theme"];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: theme.colors.foreground }]}>{label}</Text>
      {children}
      {hint ? (
        <Text style={[styles.fieldHint, { color: theme.colors.foregroundMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const SecretFieldBlock = memo(function SecretFieldBlock({
  label,
  value,
  onChangeText,
  hasStored,
  storedPlaceholder,
  newPlaceholder,
  clearRequested,
  onToggleClear,
  clearLabel,
  willClearLabel,
  secureTextEntry,
  disabled,
  platform,
  theme,
}: {
  label: string;
  value: string;
  onChangeText(next: string): void;
  hasStored: boolean;
  storedPlaceholder: string;
  newPlaceholder: string;
  clearRequested: boolean;
  onToggleClear(): void;
  clearLabel: string;
  willClearLabel: string;
  secureTextEntry: boolean;
  disabled: boolean;
  platform: PluginSurfaceProps["layout"]["platform"];
  theme: PluginSurfaceProps["theme"];
}) {
  let clearControlNode: React.ReactNode = null;
  if (hasStored) {
    if (clearRequested) {
      clearControlNode = (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          disabled={disabled}
          onPress={onToggleClear}
          style={styles.clearLinkWrap}
        >
          <StatusTag
            icon="Trash2"
            label={willClearLabel}
            tone="warning"
            platform={platform}
            theme={theme}
          />
        </Pressable>
      );
    } else {
      clearControlNode = (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          disabled={disabled}
          onPress={onToggleClear}
          style={styles.clearLinkWrap}
        >
          <Text style={[styles.clearActionText, { color: theme.colors.foregroundMuted }]}>
            {clearLabel}
          </Text>
        </Pressable>
      );
    }
  }

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.secretHeaderRow}>
        <Text style={[styles.fieldLabel, { color: theme.colors.foreground }]}>{label}</Text>
        {clearControlNode}
      </View>

      <TextInput
        editable={!disabled && !clearRequested}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        value={value}
        onChangeText={onChangeText}
        placeholder={hasStored ? storedPlaceholder : newPlaceholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.surface0,
            borderColor: theme.colors.border,
            color: theme.colors.foreground,
            opacity: clearRequested ? 0.5 : 1,
          },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  loadingWrap: {
    paddingVertical: 24,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 13,
  },
  discoveredContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  discoveredSectionHeading: {
    fontSize: 12,
    fontWeight: "500",
  },
  discoveredRow: {
    paddingVertical: 12,
    gap: 12,
  },
  quickFillBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  quickFillChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickFillChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickFillChipText: {
    fontSize: 12,
    fontWeight: "500",
  },
  quickFillSourceTag: {
    fontSize: 11,
    fontWeight: "400",
  },
  teaBindNoticeBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  teaBindNoticeLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  teaBindNoticeText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  memberCardRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  memberInfoCol: {
    gap: 8,
  },
  memberTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  memberNameText: {
    fontSize: 14,
    fontWeight: "400",
  },
  memberHandleText: {
    fontSize: 12,
  },
  memberEmailText: {
    fontSize: 12,
  },
  badgeWrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  memberActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  modalContent: {
    padding: 20,
    gap: 16,
  },
  errorBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  errorBannerText: {
    fontSize: 12,
    lineHeight: 18,
  },
  stepSectionBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  stepHeaderBlock: {
    gap: 4,
  },
  stepHeadingText: {
    fontSize: 13,
    fontWeight: "500",
  },
  stepNoticeText: {
    fontSize: 12,
    lineHeight: 18,
  },
  gridStack: {
    gap: 8,
  },
  gridRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeGridBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  providerGridBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  modeGridBtnLabel: {
    fontSize: 12,
  },
  authorOnlyBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  authorOnlyDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  authorOnlyWarn: {
    fontSize: 12,
    lineHeight: 18,
  },
  subSectionStack: {
    gap: 12,
  },
  readonlyUrlNotice: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  readonlyUrlDomain: {
    fontSize: 13,
  },
  readonlyUrlHint: {
    fontSize: 12,
  },
  fieldStack: {
    gap: 12,
  },
  twoColRow: {
    flexDirection: "row",
    gap: 12,
  },
  colFlex: {
    flex: 1,
    minWidth: 0,
  },
  fieldBlock: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  toggleCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  toggleRowLabel: {
    fontSize: 13,
    fontWeight: "400",
  },
  checkPill: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secretHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  clearLinkWrap: {
    paddingVertical: 2,
  },
  clearActionText: {
    fontSize: 12,
    fontWeight: "500",
  },
  confirmBodyText: {
    fontSize: 13,
    lineHeight: 20,
  },
  modalActionsRow: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 4,
  },
  modalBtnFlex: {
    flex: 1,
  },
});
