import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  useFileText,
  useRpc,
  type PluginFilePanelProps,
  type PluginHostProps,
  type PluginTab,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  Icon,
  Loading,
  Modal,
  ScrollView,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  harnessTeamCleanRpc,
  harnessTeamDetectRpc,
  harnessTeamDoctorRpc,
  harnessTeamInspectRpc,
  harnessTeamSaveRpc,
  type HarnessTeamDoctorOutput,
  type HarnessTeamInspectOutput,
} from "../shared/contracts.js";
import {
  TEAM_BINDING_PROVIDERS,
  TEAM_GIT_MODE_OPTIONS,
  TEAM_TARGET_OPTIONS,
  TEAM_TIER_OPTIONS,
  TEAM_TRACKER_OPTIONS,
  areManifestsEqual,
  computeMissingRecommendedDeps,
  createManifestFromPreset,
  normalizeEditableManifest,
  toggleCapabilityWithAutoDeps,
  toggleGuardItem,
  toggleMcpWithAutoDeps,
  toggleRoleWithAutoDeps,
  toggleTargetItem,
  type AgentTeamCatalogRole,
  type AgentTeamEditableManifest,
  type AgentTeamRoleBinding,
  type AgentTeamTargetId,
} from "../shared/team-editor-utils.js";
import { notifyWorkspaceTeamUpdated, subscribeWorkspaceTeamUpdated } from "./team-events.js";

export interface WorkspaceTeamEditorProps {
  workspaceId: string;
  theme: PluginHostProps["theme"];
  layout: { compact: boolean; platform: "ios" | "android" | "web" };
  tab?: PluginTab;
  rawFileText?: string | null;
  rawFilePath?: string | null;
  rawFileError?: string | null;
}

function normalizeDisplayPath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function targetChipStatus(active: boolean, compiled: boolean): string {
  if (active) {
    return compiled ? "Compiled" : "Selected";
  }
  return compiled ? "Pending removal" : "Off";
}

function resolveSaveButtonLabel(isSaving: boolean, isInherited: boolean): string {
  if (isSaving) {
    return "Compiling...";
  }
  if (isInherited) {
    return "Materialize & compile in worktree";
  }
  return "Save & compile";
}

const TEAM_GROUP_ORDER: ReadonlyArray<{ id: "fe" | "be" | "ops"; label: string }> = [
  { id: "fe", label: "Frontend (FE)" },
  { id: "be", label: "Backend (BE)" },
  { id: "ops", label: "Operations & SRE (Ops)" },
];

export function WorkspaceTeamEditor({
  workspaceId,
  theme,
  layout,
  tab,
  rawFileText,
  rawFilePath,
  rawFileError,
}: WorkspaceTeamEditorProps) {
  const toast = useToast();
  const inspectRpc = useRpc(harnessTeamInspectRpc);
  const detectRpc = useRpc(harnessTeamDetectRpc);
  const saveRpc = useRpc(harnessTeamSaveRpc);
  const doctorRpc = useRpc(harnessTeamDoctorRpc);
  const cleanRpc = useRpc(harnessTeamCleanRpc);

  const [inspectData, setInspectData] = useState<HarnessTeamInspectOutput | null>(null);
  const [savedManifest, setSavedManifest] = useState<AgentTeamEditableManifest | null>(null);
  const [draftManifest, setDraftManifest] = useState<AgentTeamEditableManifest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningDoctor, setIsRunningDoctor] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [compileWarnings, setCompileWarnings] = useState<string[]>([]);
  const [detectNotes, setDetectNotes] = useState<string[]>([]);
  const [autoAddedNote, setAutoAddedNote] = useState<string | null>(null);
  const [doctorResult, setDoctorResult] = useState<HarnessTeamDoctorOutput | null>(null);

  const [cleanModalOpen, setCleanModalOpen] = useState(false);
  const [cleanDeleteManifest, setCleanDeleteManifest] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [externalUpdatePending, setExternalUpdatePending] = useState(false);
  const [resetSeq, setResetSeq] = useState(0);

  const toastRef = useRef(toast);
  const inspectRpcRef = useRef(inspectRpc);
  useEffect(() => {
    toastRef.current = toast;
    inspectRpcRef.current = inspectRpc;
  }, [toast, inspectRpc]);
  const suppressNextExternalReloadRef = useRef(false);
  const inspectSeqRef = useRef(0);
  const activeWorkspaceIdRef = useRef(workspaceId);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isDirty = useMemo(() => {
    if (!draftManifest) return false;
    if (!savedManifest) return true;
    return !areManifestsEqual(savedManifest, draftManifest);
  }, [draftManifest, savedManifest]);

  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    tab?.setModified(isDirty);
  }, [tab, isDirty]);

  const loadWorkspaceInspect = useCallback(async () => {
    const targetWorkspaceId = workspaceId;
    const seq = ++inspectSeqRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await inspectRpcRef.current({ workspaceId: targetWorkspaceId });
      if (
        !isMountedRef.current ||
        seq !== inspectSeqRef.current ||
        activeWorkspaceIdRef.current !== targetWorkspaceId
      ) {
        return;
      }
      setInspectData(res);
      setSavedManifest(res.manifest ?? null);
      setDraftManifest(res.manifest ?? null);
      setSaveError(null);
      setCompileWarnings([]);
      setAutoAddedNote(null);
      setExternalUpdatePending(false);
      setResetSeq((prev) => prev + 1);
    } catch (err) {
      if (
        !isMountedRef.current ||
        seq !== inspectSeqRef.current ||
        activeWorkspaceIdRef.current !== targetWorkspaceId
      ) {
        return;
      }
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isMountedRef.current && seq === inspectSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    activeWorkspaceIdRef.current = workspaceId;
    setInspectData(null);
    setSavedManifest(null);
    setDraftManifest(null);
    setIsDetecting(false);
    setIsSaving(false);
    setIsRunningDoctor(false);
    setIsCleaning(false);
    setLoadError(null);
    setSaveError(null);
    setCompileWarnings([]);
    setDetectNotes([]);
    setAutoAddedNote(null);
    setDoctorResult(null);
    setCleanModalOpen(false);
    setCleanDeleteManifest(false);
    setExternalUpdatePending(false);
    void loadWorkspaceInspect();
  }, [loadWorkspaceInspect, workspaceId]);

  useEffect(() => {
    return subscribeWorkspaceTeamUpdated(workspaceId, () => {
      if (suppressNextExternalReloadRef.current) {
        suppressNextExternalReloadRef.current = false;
        return;
      }
      if (isDirtyRef.current) {
        setExternalUpdatePending(true);
        return;
      }
      void loadWorkspaceInspect();
    });
  }, [loadWorkspaceInspect, workspaceId]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: theme.colors.surface0,
        },
        scrollContent: {
          padding: 16,
          gap: 16,
        },
        headerBar: {
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 12,
          gap: 8,
        },
        headerTopRow: {
          flexDirection: layout.compact ? "column" : "row",
          justifyContent: "space-between",
          alignItems: layout.compact ? "flex-start" : "center",
          gap: 8,
        },
        headerTitleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        },
        headerTitle: {
          fontSize: 15,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        badgeNeutral: {
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: theme.colors.surface2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        badgeNeutralText: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.foregroundMuted,
        },
        badgeSuccess: {
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.statusSuccess,
        },
        badgeSuccessText: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.statusSuccess,
        },
        badgeWarning: {
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.statusWarning,
        },
        badgeWarningText: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.statusWarning,
        },
        metaText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
        },
        bannerBase: {
          borderRadius: 8,
          borderWidth: 1,
          padding: 12,
          gap: 4,
        },
        bannerInfo: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.accent,
        },
        bannerWarn: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.statusWarning,
        },
        bannerError: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.statusDanger,
        },
        bannerTitle: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        bannerBody: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
        },
        bannerErrorText: {
          fontSize: 12,
          color: theme.colors.statusDanger,
        },
        columns: {
          flexDirection: layout.compact ? "column" : "row",
          gap: 16,
          alignItems: "stretch",
        },
        zoneLeft: {
          flex: layout.compact ? undefined : 1.15,
          minWidth: 0,
          gap: 16,
        },
        zoneRight: {
          flex: layout.compact ? undefined : 1,
          minWidth: 0,
          gap: 16,
        },
        sectionBlock: {
          gap: 8,
          padding: 12,
        },
        roleGroup: {
          gap: 6,
        },
        groupLabel: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.foregroundMuted,
          marginTop: 4,
        },
        toggleGrid: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        },
        toggleChip: {
          flexBasis: layout.compact ? "46%" : 150,
          flexGrow: 1,
          flexShrink: 1,
          maxWidth: "100%",
          minHeight: layout.compact ? 40 : undefined,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          gap: 2,
        },
        toggleChipActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.surface2,
        },
        toggleChipTop: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 4,
        },
        toggleChipTitle: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.foreground,
          flexShrink: 1,
        },
        toggleChipSub: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        roTag: {
          paddingHorizontal: 4,
          paddingVertical: 1,
          borderRadius: 3,
          backgroundColor: theme.colors.surface0,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.statusWarning,
        },
        roTagText: {
          fontSize: 10,
          fontWeight: "700",
          color: theme.colors.statusWarning,
        },
        roleCard: {
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 12,
          gap: 8,
        },
        roleCardHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        },
        roleCardTitle: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        footerBar: {
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 12,
          flexDirection: layout.compact ? "column" : "row",
          justifyContent: "space-between",
          alignItems: layout.compact ? "stretch" : "center",
          gap: 8,
        },
        footerPrimaryGroup: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        },
        footerSecondaryGroup: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        },
        btnPrimary: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          minHeight: layout.compact ? 40 : undefined,
          borderRadius: 6,
          backgroundColor: theme.colors.accent,
        },
        btnPrimaryText: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.accentForeground,
        },
        btnSecondary: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          minHeight: layout.compact ? 40 : undefined,
          borderRadius: 6,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        btnSecondaryText: {
          fontSize: 13,
          fontWeight: "500",
          color: theme.colors.foreground,
        },
        btnQuiet: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 8,
          minHeight: layout.compact ? 40 : undefined,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
        },
        btnQuietText: {
          fontSize: 12,
          fontWeight: "500",
          color: theme.colors.foregroundMuted,
        },
        btnDanger: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          minHeight: layout.compact ? 40 : undefined,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.statusDanger,
          backgroundColor: theme.colors.surface0,
        },
        btnDangerSolid: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          minHeight: layout.compact ? 40 : undefined,
          borderRadius: 6,
          backgroundColor: theme.colors.statusDanger,
        },
        btnDangerText: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.statusDanger,
        },
        btnDisabled: {
          opacity: 0.5,
        },
        outputBlock: {
          backgroundColor: theme.colors.surface0,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          padding: 10,
        },
        outputText: {
          fontSize: 11,
          color: theme.colors.foreground,
          fontFamily: layout.platform === "web" ? "monospace" : undefined,
        },
        modalActions: {
          flexDirection: "row",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        },
      }),
    [layout.compact, layout.platform, theme],
  );

  const handleDetectAndInitialize = useCallback(async () => {
    if (isDetecting) return;
    const targetWorkspaceId = workspaceId;
    setIsDetecting(true);
    setSaveError(null);
    try {
      const res = await detectRpc({ workspaceId: targetWorkspaceId });
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      setDraftManifest(res.manifest);
      setDetectNotes(res.notes ?? []);
      setAutoAddedNote(`Initialized ${res.recommendedPreset} draft in this workspace.`);
      setResetSeq((prev) => prev + 1);
      toastRef.current.show(`Detected ${res.recommendedPreset} team preset`, { variant: "info" });
    } catch (err) {
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      toastRef.current.error(`Detection failed: ${msg}`);
    } finally {
      if (isMountedRef.current && activeWorkspaceIdRef.current === targetWorkspaceId) {
        setIsDetecting(false);
      }
    }
  }, [detectRpc, isDetecting, workspaceId]);

  const handleInitializeWithPreset = useCallback(
    (presetId: string) => {
      if (!inspectData) return;
      const preset = inspectData.presets[presetId];
      if (!preset) return;
      const baseSlug = inspectData.workspaceName || "project";
      const created = createManifestFromPreset(presetId, preset, baseSlug);
      setDraftManifest(created);
      setDetectNotes([`Initialized from preset ${preset.title}.`]);
      setResetSeq((prev) => prev + 1);
    },
    [inspectData],
  );

  const handlePresetChange = useCallback(
    (nextPresetId: string) => {
      if (!draftManifest || !inspectData) return;
      if (nextPresetId === "custom") {
        setDraftManifest({ ...draftManifest, preset: "custom" });
        return;
      }
      const presetObj = inspectData.presets[nextPresetId];
      if (!presetObj) return;
      const next = createManifestFromPreset(nextPresetId, presetObj, draftManifest.project_slug, {
        targets: draftManifest.targets,
        tracker: draftManifest.tracker,
        gitMode: draftManifest.git_mode,
        existingBindings: draftManifest.bindings,
      });
      setDraftManifest(next);
      setAutoAddedNote(null);
      setResetSeq((prev) => prev + 1);
    },
    [draftManifest, inspectData],
  );

  const handleToggleTarget = useCallback(
    (targetId: AgentTeamTargetId) => {
      if (!draftManifest) return;
      const res = toggleTargetItem(draftManifest, targetId);
      if (res.blockedLastTarget) {
        toastRef.current.show("At least one native target must remain enabled", {
          variant: "warning",
        });
        return;
      }
      setDraftManifest(res.manifest);
    },
    [draftManifest],
  );

  const handleToggleRole = useCallback(
    (roleId: string) => {
      if (!draftManifest || !inspectData) return;
      const res = toggleRoleWithAutoDeps(draftManifest, roleId, inspectData.catalog);
      setDraftManifest(res.manifest);
      setAutoAddedNote(
        res.autoAdded.length > 0
          ? `Auto-selected recommended dependencies: ${res.autoAdded.join(", ")}`
          : null,
      );
    },
    [draftManifest, inspectData],
  );

  const handleToggleCapability = useCallback(
    (capId: string) => {
      if (!draftManifest || !inspectData) return;
      const res = toggleCapabilityWithAutoDeps(draftManifest, capId, inspectData.catalog);
      setDraftManifest(res.manifest);
      setAutoAddedNote(
        res.autoAdded.length > 0
          ? `Auto-selected recommended dependencies: ${res.autoAdded.join(", ")}`
          : null,
      );
    },
    [draftManifest, inspectData],
  );

  const handleToggleMcp = useCallback(
    (mcpId: string) => {
      if (!draftManifest || !inspectData) return;
      const res = toggleMcpWithAutoDeps(draftManifest, mcpId, inspectData.catalog);
      setDraftManifest(res.manifest);
      setAutoAddedNote(
        res.autoAdded.length > 0
          ? `Auto-selected recommended dependencies: ${res.autoAdded.join(", ")}`
          : null,
      );
    },
    [draftManifest, inspectData],
  );

  const handleToggleGuard = useCallback(
    (guardId: string) => {
      if (!draftManifest) return;
      setDraftManifest(toggleGuardItem(draftManifest, guardId));
      setAutoAddedNote(null);
    },
    [draftManifest],
  );

  const handleUpdateBinding = useCallback(
    (roleId: string, patch: Partial<AgentTeamRoleBinding>) => {
      if (!draftManifest) return;
      const prev = draftManifest.bindings[roleId] ?? {};
      const nextRoleBinding: AgentTeamRoleBinding = { ...prev, ...patch };
      const cleanedBindings: Record<string, AgentTeamRoleBinding> = {
        ...draftManifest.bindings,
        [roleId]: nextRoleBinding,
      };
      setDraftManifest({
        ...draftManifest,
        bindings: cleanedBindings,
      });
    },
    [draftManifest],
  );

  const handleApplyRecommendedDeps = useCallback(() => {
    if (!draftManifest || !inspectData) return;
    const missing = computeMissingRecommendedDeps(draftManifest, inspectData.catalog);
    setDraftManifest({
      ...draftManifest,
      mcp_sources: Array.from(new Set([...draftManifest.mcp_sources, ...missing.missingMcp])),
      guards: Array.from(new Set([...draftManifest.guards, ...missing.missingGuards])),
    });
    setAutoAddedNote("Re-applied recommended MCP and guard dependencies.");
  }, [draftManifest, inspectData]);

  const handleSaveAndCompile = useCallback(async () => {
    if (!draftManifest || isSaving) return;
    const targetWorkspaceId = workspaceId;
    setIsSaving(true);
    setSaveError(null);
    try {
      const normalized = normalizeEditableManifest(
        draftManifest,
        inspectData?.workspaceName || "project",
      );
      const res = await saveRpc({
        workspaceId: targetWorkspaceId,
        manifest: normalized,
      });
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      if (!res.success) {
        const errText = res.error || res.message;
        setSaveError(errText);
        toastRef.current.error(errText);
        return;
      }

      setSavedManifest(res.manifest);
      setDraftManifest(res.manifest);
      setCompileWarnings(res.warnings ?? []);
      setSaveError(null);
      setAutoAddedNote(null);
      setDetectNotes([]);
      setExternalUpdatePending(false);
      setResetSeq((prev) => prev + 1);
      setInspectData((prev) =>
        prev
          ? {
              ...prev,
              manifestState: "present",
              manifestPath: res.manifestPath,
              manifest: res.manifest,
              manifestError: null,
              localFederatedTargets: res.localFederatedTargets,
            }
          : prev,
      );
      toastRef.current.show(res.message, { variant: res.compiled ? "success" : "warning" });
      suppressNextExternalReloadRef.current = true;
      notifyWorkspaceTeamUpdated(targetWorkspaceId);
    } catch (err) {
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      toastRef.current.error(`Save failed: ${msg}`);
    } finally {
      if (isMountedRef.current && activeWorkspaceIdRef.current === targetWorkspaceId) {
        setIsSaving(false);
      }
    }
  }, [draftManifest, inspectData?.workspaceName, isSaving, saveRpc, workspaceId]);

  const handleRunDoctor = useCallback(async () => {
    if (isRunningDoctor) return;
    const targetWorkspaceId = workspaceId;
    setIsRunningDoctor(true);
    try {
      const res = await doctorRpc({ workspaceId: targetWorkspaceId });
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      setDoctorResult(res);
      toastRef.current.show(
        res.passed
          ? `Doctor passed (${res.passCount} passed, ${res.warnCount} warnings)`
          : `Doctor reported ${res.failCount} failure(s)`,
        { variant: res.passed ? "success" : "error" },
      );
    } catch (err) {
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      toastRef.current.error(`Doctor failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (isMountedRef.current && activeWorkspaceIdRef.current === targetWorkspaceId) {
        setIsRunningDoctor(false);
      }
    }
  }, [doctorRpc, isRunningDoctor, workspaceId]);

  const handleDiscard = useCallback(() => {
    if (externalUpdatePending) {
      void loadWorkspaceInspect();
      return;
    }
    setDraftManifest(savedManifest);
    setSaveError(null);
    setAutoAddedNote(null);
    setDetectNotes([]);
    setResetSeq((prev) => prev + 1);
  }, [externalUpdatePending, loadWorkspaceInspect, savedManifest]);

  const handleConfirmClean = useCallback(async () => {
    if (isCleaning) return;
    const targetWorkspaceId = workspaceId;
    setIsCleaning(true);
    try {
      const res = await cleanRpc({
        workspaceId: targetWorkspaceId,
        deleteManifest: cleanDeleteManifest,
      });
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      if (!res.success) {
        toastRef.current.error(res.error || res.message);
        return;
      }
      setCleanModalOpen(false);
      setCleanDeleteManifest(false);
      setDoctorResult(null);
      toastRef.current.show(res.message, { variant: "success" });
      suppressNextExternalReloadRef.current = true;
      notifyWorkspaceTeamUpdated(targetWorkspaceId);
      await loadWorkspaceInspect();
    } catch (err) {
      if (!isMountedRef.current || activeWorkspaceIdRef.current !== targetWorkspaceId) return;
      toastRef.current.error(`Clean failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (isMountedRef.current && activeWorkspaceIdRef.current === targetWorkspaceId) {
        setIsCleaning(false);
      }
    }
  }, [cleanDeleteManifest, cleanRpc, isCleaning, loadWorkspaceInspect, workspaceId]);

  const missingDeps = useMemo(() => {
    if (!draftManifest || !inspectData) return { missingMcp: [], missingGuards: [] };
    return computeMissingRecommendedDeps(draftManifest, inspectData.catalog);
  }, [draftManifest, inspectData]);

  const providerOptions = useMemo(() => {
    const known = new Set<string>(TEAM_BINDING_PROVIDERS);
    for (const entry of inspectData?.availableProviders ?? []) {
      if (entry.provider) known.add(entry.provider);
    }
    return [
      { label: "Inherit global default", value: "" },
      ...Array.from(known).map((p) => ({ label: p, value: p })),
    ];
  }, [inspectData?.availableProviders]);

  const sliceOptions = useMemo(() => {
    const slices = inspectData?.lazyToolSlices ?? [];
    return [{ label: "Default slice", value: "" }, ...slices.map((s) => ({ label: s, value: s }))];
  }, [inspectData?.lazyToolSlices]);

  const presetOptions = useMemo(() => {
    const entries = Object.values(inspectData?.presets ?? {});
    return [
      ...entries.map((p) => ({ label: `${p.id} — ${p.title}`, value: p.id })),
      { label: "custom — Custom configuration", value: "custom" },
    ];
  }, [inspectData?.presets]);

  const rolesByTeam = useMemo(() => {
    const map: Record<"fe" | "be" | "ops", AgentTeamCatalogRole[]> = {
      fe: [],
      be: [],
      ops: [],
    };
    for (const role of inspectData?.catalog.roles ?? []) {
      map[role.team]?.push(role);
    }
    return map;
  }, [inspectData?.catalog.roles]);

  if (isLoading && !inspectData) {
    return (
      <View style={styles.root}>
        <Loading />
      </View>
    );
  }

  if (loadError && !inspectData) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.bannerBase, styles.bannerError]}>
          <Text style={styles.bannerTitle}>Unable to inspect workspace agent team</Text>
          <Text style={styles.bannerErrorText}>{loadError}</Text>
          <View style={styles.footerPrimaryGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry workspace inspection"
              onPress={() => void loadWorkspaceInspect()}
              style={styles.btnSecondary}
            >
              <Text style={styles.btnSecondaryText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  const isInherited = inspectData?.manifestState === "inherited_from_main";
  const expectedWorkspaceManifestPath = inspectData?.checkoutRoot
    ? `${normalizeDisplayPath(inspectData.checkoutRoot)}/.agents/agent-team.json`
    : null;
  const isDifferentFileTarget = Boolean(
    rawFilePath &&
    expectedWorkspaceManifestPath &&
    normalizeDisplayPath(rawFilePath) !== expectedWorkspaceManifestPath,
  );
  const saveButtonLabel = resolveSaveButtonLabel(isSaving, isInherited);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
        {/* Workspace Header */}
        <View style={styles.headerBar}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerTitleRow}>
              <Icon name="Users" size={16} color={theme.colors.accent} />
              <Text style={styles.headerTitle}>
                Agent team{inspectData ? ` — ${inspectData.workspaceName}` : ""}
              </Text>
              {isDirty ? (
                <View style={styles.badgeWarning}>
                  <Text style={styles.badgeWarningText}>Unsaved changes</Text>
                </View>
              ) : null}
            </View>
            <View
              style={inspectData?.compilerAvailable ? styles.badgeSuccess : styles.badgeWarning}
            >
              <Text
                style={
                  inspectData?.compilerAvailable ? styles.badgeSuccessText : styles.badgeWarningText
                }
              >
                {inspectData?.compilerAvailable ? "Compiler ready" : "Compiler unavailable"}
              </Text>
            </View>
          </View>
          {inspectData ? (
            <Text style={styles.metaText}>
              Workspace path: {inspectData.checkoutRoot}
              {inspectData.isWorktree ? ` (worktree of ${inspectData.mainRepoRoot})` : ""}
            </Text>
          ) : null}
          {!inspectData?.compilerAvailable && inspectData?.compilerMessage ? (
            <Text style={styles.metaText}>{inspectData.compilerMessage}</Text>
          ) : null}
        </View>

        {loadError ? (
          <View style={[styles.bannerBase, styles.bannerError]}>
            <Text style={styles.bannerTitle}>Unable to refresh workspace agent team</Text>
            <Text style={styles.bannerErrorText}>{loadError}</Text>
          </View>
        ) : null}

        {inspectData?.manifestError ? (
          <View style={[styles.bannerBase, styles.bannerError]}>
            <Text style={styles.bannerTitle}>Existing manifest JSON is invalid</Text>
            <Text style={styles.bannerErrorText}>{inspectData.manifestError}</Text>
          </View>
        ) : null}

        {rawFileError ? (
          <View style={[styles.bannerBase, styles.bannerError]}>
            <Text style={styles.bannerTitle}>Unable to read opened manifest file</Text>
            <Text style={styles.bannerErrorText}>{rawFileError}</Text>
          </View>
        ) : null}

        {isDifferentFileTarget ? (
          <View style={[styles.bannerBase, styles.bannerWarn]}>
            <Text style={styles.bannerTitle}>Viewing external manifest file path</Text>
            <Text style={styles.bannerBody}>
              Opened file ({rawFilePath}) differs from active workspace target (
              {expectedWorkspaceManifestPath}). Saving updates the active workspace manifest.
            </Text>
          </View>
        ) : null}

        {externalUpdatePending ? (
          <View style={[styles.bannerBase, styles.bannerWarn]}>
            <Text style={styles.bannerTitle}>Workspace agent team changed outside this draft</Text>
            <Text style={styles.bannerBody}>
              Another panel or tool saved updated configuration while you had unsaved changes.
            </Text>
            <View style={styles.footerPrimaryGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reload from disk"
                onPress={() => void loadWorkspaceInspect()}
                style={styles.btnQuiet}
              >
                <Text style={styles.btnQuietText}>Reload from disk</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Worktree Inherited Banner */}
        {isInherited && draftManifest ? (
          <View style={[styles.bannerBase, styles.bannerWarn]}>
            <Text style={styles.bannerTitle}>Inherited from main project</Text>
            <Text style={styles.bannerBody}>
              Loaded manifest from {inspectData?.manifestPath}. Main project stays untouched. Saving
              writes and compiles into {inspectData?.checkoutRoot}.
            </Text>
          </View>
        ) : null}

        {/* Save / Compile Error Banner (preserves draft) */}
        {saveError ? (
          <View style={[styles.bannerBase, styles.bannerError]}>
            <Text style={styles.bannerTitle}>Action failed</Text>
            <Text style={styles.bannerErrorText}>{saveError}</Text>
          </View>
        ) : null}

        {/* Compiler Warnings */}
        {compileWarnings.length > 0 ? (
          <View style={[styles.bannerBase, styles.bannerWarn]}>
            <Text style={styles.bannerTitle}>Compiler notes</Text>
            <Text style={styles.bannerBody}>{compileWarnings.join("\n")}</Text>
          </View>
        ) : null}

        {/* Auto-Deps Feedback */}
        {autoAddedNote ? (
          <View style={[styles.bannerBase, styles.bannerInfo]}>
            <Text style={styles.bannerBody}>{autoAddedNote}</Text>
          </View>
        ) : null}

        {/* Detect Notes */}
        {detectNotes.length > 0 ? (
          <View style={[styles.bannerBase, styles.bannerInfo]}>
            <Text style={styles.bannerTitle}>Detection notes</Text>
            <Text style={styles.bannerBody}>{detectNotes.join(" ")}</Text>
          </View>
        ) : null}

        {/* Missing Recommended Deps Advisory */}
        {(missingDeps.missingMcp.length > 0 || missingDeps.missingGuards.length > 0) &&
        draftManifest ? (
          <View style={[styles.bannerBase, styles.bannerWarn]}>
            <Text style={styles.bannerTitle}>Missing recommended dependencies</Text>
            <Text style={styles.bannerBody}>
              {[
                missingDeps.missingMcp.length > 0
                  ? `MCP: ${missingDeps.missingMcp.join(", ")}`
                  : null,
                missingDeps.missingGuards.length > 0
                  ? `Guards: ${missingDeps.missingGuards.join(", ")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" | ")}
            </Text>
            <View style={styles.footerPrimaryGroup}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Re-apply recommended dependencies"
                onPress={handleApplyRecommendedDeps}
                style={styles.btnQuiet}
              >
                <Text style={styles.btnQuietText}>Re-apply recommended</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Empty Repo Initialization State */}
        {!draftManifest ? (
          <SettingsSection title="Initialize workspace team">
            <SettingsCard>
              <View style={styles.sectionBlock}>
                <Text style={styles.headerTitle}>No agent team manifest found</Text>
                <Text style={styles.metaText}>
                  Detect project stack dependencies automatically or start from a team preset in{" "}
                  {inspectData?.checkoutRoot}.
                </Text>
                <View style={styles.footerPrimaryGroup}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Detect and initialize"
                    disabled={isDetecting}
                    onPress={() => void handleDetectAndInitialize()}
                    style={[styles.btnPrimary, isDetecting && styles.btnDisabled]}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {isDetecting ? "Detecting..." : "Detect & initialize"}
                    </Text>
                  </Pressable>
                </View>
                <Text style={styles.groupLabel}>Or start from preset</Text>
                <View style={styles.toggleGrid}>
                  {Object.values(inspectData?.presets ?? {}).map((preset) => (
                    <Pressable
                      key={preset.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Initialize preset ${preset.id}`}
                      onPress={() => handleInitializeWithPreset(preset.id)}
                      style={styles.toggleChip}
                    >
                      <Text style={styles.toggleChipTitle}>{preset.id}</Text>
                      <Text style={styles.toggleChipSub}>{preset.title}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </SettingsCard>
          </SettingsSection>
        ) : (
          /* Two-Zone Responsive Editor */
          <View style={styles.columns}>
            {/* Zone 1: Team Topology & Native Targets */}
            <View style={styles.zoneLeft}>
              <SettingsSection title="Team topology & native targets">
                <SettingsCard>
                  <SettingsSelect
                    label="Preset"
                    hint="Applies preset roles, capabilities, MCPs, guards, and flow"
                    value={
                      presetOptions.some((o) => o.value === draftManifest.preset)
                        ? draftManifest.preset
                        : "custom"
                    }
                    options={presetOptions}
                    onValueChange={handlePresetChange}
                  />
                  <SettingsInput
                    key={`slug-${resetSeq}`}
                    label="Project slug"
                    hint="Identifier for team plugin and generated namespaces"
                    initialValue={draftManifest.project_slug}
                    placeholder="project-slug"
                    onChangeText={(text) =>
                      setDraftManifest((prev) => (prev ? { ...prev, project_slug: text } : prev))
                    }
                  />
                  <SettingsSelect
                    label="Tracker"
                    value={draftManifest.tracker}
                    options={TEAM_TRACKER_OPTIONS}
                    onValueChange={(val) =>
                      setDraftManifest((prev) => (prev ? { ...prev, tracker: val } : prev))
                    }
                  />
                  <SettingsSelect
                    label="Git mode"
                    value={draftManifest.git_mode}
                    options={TEAM_GIT_MODE_OPTIONS}
                    onValueChange={(val) =>
                      setDraftManifest((prev) => (prev ? { ...prev, git_mode: val } : prev))
                    }
                  />
                </SettingsCard>

                {/* Native Targets */}
                <SettingsCard>
                  <View style={styles.sectionBlock}>
                    <Text style={styles.groupLabel}>Native targets</Text>
                    <View style={styles.toggleGrid}>
                      {TEAM_TARGET_OPTIONS.map((opt) => {
                        const active = draftManifest.targets.includes(opt.id);
                        const compiled = (inspectData?.localFederatedTargets ?? []).includes(
                          opt.id,
                        );
                        return (
                          <Pressable
                            key={opt.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Target ${opt.label}`}
                            onPress={() => handleToggleTarget(opt.id)}
                            style={[styles.toggleChip, active && styles.toggleChipActive]}
                          >
                            <View style={styles.toggleChipTop}>
                              <Text style={styles.toggleChipTitle}>{opt.label}</Text>
                              <Text style={styles.toggleChipSub}>
                                {targetChipStatus(active, compiled)}
                              </Text>
                            </View>
                            <Text style={styles.toggleChipSub}>{opt.hint}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </SettingsCard>

                {/* Roles */}
                <SettingsCard>
                  <View style={styles.sectionBlock}>
                    <Text style={styles.groupLabel}>Roles (FE / BE / Ops)</Text>
                    {TEAM_GROUP_ORDER.map((group) => {
                      const items = rolesByTeam[group.id] ?? [];
                      if (items.length === 0) return null;
                      return (
                        <View key={group.id} style={styles.roleGroup}>
                          <Text style={styles.metaText}>{group.label}</Text>
                          <View style={styles.toggleGrid}>
                            {items.map((role) => {
                              const active = draftManifest.roles.includes(role.id);
                              return (
                                <Pressable
                                  key={role.id}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Toggle role ${role.id}`}
                                  onPress={() => handleToggleRole(role.id)}
                                  style={[styles.toggleChip, active && styles.toggleChipActive]}
                                >
                                  <View style={styles.toggleChipTop}>
                                    <Text style={styles.toggleChipTitle}>{role.id}</Text>
                                    {role.readonly ? (
                                      <View style={styles.roTag}>
                                        <Text style={styles.roTagText}>RO</Text>
                                      </View>
                                    ) : null}
                                  </View>
                                  <Text style={styles.toggleChipSub}>{role.title}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </SettingsCard>

                {/* Capabilities, MCP Sources & Guards */}
                <SettingsCard>
                  <View style={styles.sectionBlock}>
                    <Text style={styles.groupLabel}>Capabilities</Text>
                    <View style={styles.toggleGrid}>
                      {(inspectData?.catalog.capabilities ?? []).map((cap) => {
                        const active = draftManifest.capabilities.includes(cap.id);
                        return (
                          <Pressable
                            key={cap.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Toggle capability ${cap.id}`}
                            onPress={() => handleToggleCapability(cap.id)}
                            style={[styles.toggleChip, active && styles.toggleChipActive]}
                          >
                            <Text style={styles.toggleChipTitle}>{cap.id}</Text>
                            <Text style={styles.toggleChipSub}>{cap.title}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={styles.groupLabel}>MCP sources</Text>
                    <View style={styles.toggleGrid}>
                      {(inspectData?.catalog.mcp_sources ?? []).map((mcp) => {
                        const active = draftManifest.mcp_sources.includes(mcp.id);
                        return (
                          <Pressable
                            key={mcp.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Toggle MCP ${mcp.id}`}
                            onPress={() => handleToggleMcp(mcp.id)}
                            style={[styles.toggleChip, active && styles.toggleChipActive]}
                          >
                            <Text style={styles.toggleChipTitle}>{mcp.id}</Text>
                            <Text style={styles.toggleChipSub}>{mcp.description}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={styles.groupLabel}>Safety guards</Text>
                    <View style={styles.toggleGrid}>
                      {(inspectData?.catalog.guards ?? []).map((guard) => {
                        const active = draftManifest.guards.includes(guard.id);
                        return (
                          <Pressable
                            key={guard.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Toggle guard ${guard.id}`}
                            onPress={() => handleToggleGuard(guard.id)}
                            style={[styles.toggleChip, active && styles.toggleChipActive]}
                          >
                            <Text style={styles.toggleChipTitle}>{guard.id}</Text>
                            <Text style={styles.toggleChipSub}>{guard.description}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </SettingsCard>

                {/* Flow */}
                <SettingsCard>
                  <SettingsSwitch
                    label="OpenSpec"
                    hint="Enable OpenSpec change tracking in team workflows"
                    value={draftManifest.flow.openspec}
                    onValueChange={(val) =>
                      setDraftManifest((prev) =>
                        prev ? { ...prev, flow: { ...prev.flow, openspec: val } } : prev,
                      )
                    }
                  />
                  <SettingsSwitch
                    label="Contracts"
                    hint="Generate schema-first interface contracts"
                    value={draftManifest.flow.contracts}
                    onValueChange={(val) =>
                      setDraftManifest((prev) =>
                        prev ? { ...prev, flow: { ...prev.flow, contracts: val } } : prev,
                      )
                    }
                  />
                  <SettingsSwitch
                    label="Workflows"
                    hint="Include CI workflow automation gates"
                    value={draftManifest.flow.workflows}
                    onValueChange={(val) =>
                      setDraftManifest((prev) =>
                        prev ? { ...prev, flow: { ...prev.flow, workflows: val } } : prev,
                      )
                    }
                  />
                  <SettingsSwitch
                    label="Scaffold docs"
                    hint="Maintain architecture and role docs in workspace"
                    value={draftManifest.flow.scaffold_docs}
                    onValueChange={(val) =>
                      setDraftManifest((prev) =>
                        prev ? { ...prev, flow: { ...prev.flow, scaffold_docs: val } } : prev,
                      )
                    }
                  />
                </SettingsCard>
              </SettingsSection>
            </View>

            {/* Zone 2: Role Bindings */}
            <View style={styles.zoneRight}>
              <SettingsSection title="Role bindings">
                {draftManifest.roles.length === 0 ? (
                  <SettingsCard>
                    <SettingsRow
                      label="No roles selected"
                      hint="Enable at least one role in Zone 1 to configure bindings"
                    />
                  </SettingsCard>
                ) : (
                  draftManifest.roles.map((roleId) => {
                    const roleMeta = inspectData?.catalog.roles.find((r) => r.id === roleId);
                    const binding = draftManifest.bindings[roleId] ?? {};
                    return (
                      <View key={roleId} style={styles.roleCard}>
                        <View style={styles.roleCardHeader}>
                          <Text style={styles.roleCardTitle}>
                            {roleId}
                            {roleMeta ? ` — ${roleMeta.title}` : ""}
                          </Text>
                          {roleMeta?.readonly ? (
                            <View style={styles.roTag}>
                              <Text style={styles.roTagText}>RO</Text>
                            </View>
                          ) : null}
                        </View>
                        <SettingsSelect
                          label={`${roleId} provider`}
                          value={binding.provider ?? ""}
                          options={providerOptions}
                          onValueChange={(val) =>
                            handleUpdateBinding(roleId, { provider: val || undefined })
                          }
                        />
                        <SettingsSelect
                          label={`${roleId} tier`}
                          value={binding.tier ?? ""}
                          options={[{ label: "Auto from role", value: "" }, ...TEAM_TIER_OPTIONS]}
                          onValueChange={(val) =>
                            handleUpdateBinding(roleId, { tier: val || undefined })
                          }
                        />
                        <SettingsInput
                          key={`model-${roleId}-${resetSeq}`}
                          label={`${roleId} model override`}
                          initialValue={binding.model ?? ""}
                          placeholder="Optional model identifier"
                          onChangeText={(text) =>
                            handleUpdateBinding(roleId, { model: text || undefined })
                          }
                        />
                        <SettingsSelect
                          label={`${roleId} lazy-tool slice`}
                          value={binding.lazyToolSlice ?? ""}
                          options={sliceOptions}
                          onValueChange={(val) =>
                            handleUpdateBinding(roleId, { lazyToolSlice: val || undefined })
                          }
                        />
                      </View>
                    );
                  })
                )}
              </SettingsSection>
            </View>
          </View>
        )}

        {/* Doctor Results */}
        {doctorResult ? (
          <SettingsSection title="Doctor verification">
            <SettingsCard>
              <View style={styles.sectionBlock}>
                <View style={styles.headerTitleRow}>
                  <Text style={styles.headerTitle}>
                    {doctorResult.passed ? "Doctor passed" : "Doctor reported failures"}
                  </Text>
                  <View style={styles.badgeNeutral}>
                    <Text style={styles.badgeNeutralText}>
                      PASS {doctorResult.passCount} · WARN {doctorResult.warnCount} · FAIL{" "}
                      {doctorResult.failCount}
                    </Text>
                  </View>
                </View>
                <View style={styles.outputBlock}>
                  <Text style={styles.outputText}>{doctorResult.output}</Text>
                </View>
              </View>
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {/* Optional Raw JSON Preview for File Panel */}
        {typeof rawFileText === "string" ? (
          <SettingsSection title="Raw manifest file">
            <SettingsCard>
              <View style={styles.sectionBlock}>
                <View style={styles.headerTopRow}>
                  <Text style={styles.metaText}>{rawFilePath ?? ".agents/agent-team.json"}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showRawJson ? "Hide raw JSON" : "Show raw JSON"}
                    onPress={() => setShowRawJson((v) => !v)}
                    style={styles.btnQuiet}
                  >
                    <Text style={styles.btnQuietText}>
                      {showRawJson ? "Hide raw JSON" : "Show raw JSON"}
                    </Text>
                  </Pressable>
                </View>
                {showRawJson ? (
                  <View style={styles.outputBlock}>
                    <Text style={styles.outputText}>{rawFileText}</Text>
                  </View>
                ) : null}
              </View>
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {/* Action Bar (1 Primary + 1 Secondary + Quiet Discard / Clean) */}
        <View style={styles.footerBar}>
          <View style={styles.footerPrimaryGroup}>
            {draftManifest ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={saveButtonLabel}
                disabled={isSaving || draftManifest.roles.length === 0}
                onPress={() => void handleSaveAndCompile()}
                style={[
                  styles.btnPrimary,
                  (isSaving || draftManifest.roles.length === 0) && styles.btnDisabled,
                ]}
              >
                <Text style={styles.btnPrimaryText}>{saveButtonLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run doctor"
              disabled={isRunningDoctor}
              onPress={() => void handleRunDoctor()}
              style={[styles.btnSecondary, isRunningDoctor && styles.btnDisabled]}
            >
              <Text style={styles.btnSecondaryText}>
                {isRunningDoctor ? "Running doctor..." : "Run doctor"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.footerSecondaryGroup}>
            {isDirty ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discard"
                disabled={isSaving}
                onPress={handleDiscard}
                style={styles.btnQuiet}
              >
                <Text style={styles.btnQuietText}>Discard</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clean artifacts"
              disabled={isCleaning}
              onPress={() => {
                setCleanDeleteManifest(false);
                setCleanModalOpen(true);
              }}
              style={styles.btnDanger}
            >
              <Text style={styles.btnDangerText}>Clean artifacts...</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Clean Artifacts Confirmation Modal */}
      <Modal
        open={cleanModalOpen}
        onOpenChange={(open) => {
          setCleanModalOpen(open);
          if (!open) {
            setCleanDeleteManifest(false);
          }
        }}
        title="Clean generated team artifacts"
      >
        <Modal.Content>
          <Text style={styles.metaText}>
            Removes generated `.agents/plugins`, `.claude/agents`, `.opencode/agents`, and
            `.codex/agents` outputs under {inspectData?.checkoutRoot ?? "this workspace"}.
          </Text>
          <SettingsSwitch
            label="Also delete .agents/agent-team.json"
            hint="Permanently removes the team manifest file in this workspace"
            value={cleanDeleteManifest}
            onValueChange={setCleanDeleteManifest}
          />
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel clean"
              disabled={isCleaning}
              onPress={() => {
                setCleanModalOpen(false);
                setCleanDeleteManifest(false);
              }}
              style={styles.btnQuiet}
            >
              <Text style={styles.btnQuietText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm clean"
              disabled={isCleaning}
              onPress={() => void handleConfirmClean()}
              style={[styles.btnDangerSolid, isCleaning && styles.btnDisabled]}
            >
              <Text style={styles.btnPrimaryText}>
                {isCleaning ? "Cleaning..." : "Confirm clean"}
              </Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

export function WorkspaceTeamPanelHost({
  workspaceId,
  theme,
  layout,
  tab,
}: PluginWorkspacePanelProps) {
  return <WorkspaceTeamEditor workspaceId={workspaceId} theme={theme} layout={layout} tab={tab} />;
}

export function AgentTeamFilePanelHost({
  workspaceId,
  file,
  theme,
  layout,
  tab,
}: PluginFilePanelProps) {
  const fileState = useFileText(file);
  const rawFileText = fileState.status === "ready" ? fileState.text : null;
  const rawFileError = fileState.status === "error" ? fileState.error.message : null;

  return (
    <WorkspaceTeamEditor
      workspaceId={workspaceId}
      theme={theme}
      layout={layout}
      tab={tab}
      rawFileText={rawFileText}
      rawFilePath={file.path}
      rawFileError={rawFileError}
    />
  );
}
