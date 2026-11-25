import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings, useWorkspaces } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsInput,
  type SettingsInputHandle,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  agentHarnessSettings,
  DEFAULT_AGENT_HARNESS_SETTINGS,
  type AgentHarnessSettings,
} from "../shared/settings.js";
import {
  BUILTIN_BYPASS_MODELS,
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_PROVIDER_THINKING_MAPPINGS,
  BUILTIN_TIERS,
} from "../shared/presets.js";
import { isModelBypassed } from "../shared/intent-detector.js";
import type { HarnessSpecialistConfig } from "../shared/types.js";
import {
  normalizeProviderName,
  resolveTargetModelForTier,
  resolveEffectiveHarnessConfig,
} from "../shared/config-resolver.js";
import {
  harnessDebugClearRpc,
  harnessDebugStatusRpc,
  harnessDebugToggleRpc,
  harnessInspectEnvironmentRpc,
  harnessSyncProfilesRpc,
  type HarnessDebugLogEntry,
  type HarnessDebugStatusOutput,
  type HarnessInspectEnvironmentOutput,
} from "../shared/contracts.js";
import { subscribeWorkspaceTeamUpdated } from "./team-events.js";

type AgentTeamInspectInfo = NonNullable<HarnessInspectEnvironmentOutput["agentTeam"]>;
type InspectWorkspaceEntry = NonNullable<HarnessInspectEnvironmentOutput["workspaces"]>[number];

function formatAgentTeamLabel(agentTeam: AgentTeamInspectInfo): string {
  const parts = [`team-${agentTeam.projectSlug}`, `${agentTeam.rolesCount} roles`];
  // `localFederatedTargets` is populated by the loader checkout probe; skip drift check if absent.
  if (Array.isArray(agentTeam.localFederatedTargets)) {
    const federated = agentTeam.localFederatedTargets;
    if (federated.length === 0) {
      parts.push("no-local-targets");
    } else {
      parts.push(`federated=${federated.join(",")}`);
      const missing = (agentTeam.targets ?? []).filter((t) => !federated.includes(t));
      if (missing.length > 0) {
        parts.push(`missing-local=${missing.join(",")}`);
      }
    }
  }
  return `Active (${parts.join(", ")})`;
}

const KNOWN_PROVIDERS = ["antigravity", "claude", "codex", "opencode", "pi"] as const;

const ANTIGRAVITY_GEMINI4_MODELS = [
  "gemini-4-hydrogen",
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-4-neon",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "gpt-oss-120b-medium",
] as const;

const CUSTOM_MODEL_OPTION_VALUE = "__custom__";

const THINKING_EFFORT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Extra High (xhigh)", value: "xhigh" },
] as const;

const TIER_BUDGET_HINTS: Record<string, string> = {
  fast: "0.2x routing, lookup, and low-risk quick edits",
  standard: "1x default workhorse for daily features and tests",
  deep: "3x planning, review, and complex core edits",
  max: "Manual peak effort (inherits Deep + xhigh when unset)",
};

export const BUILTIN_LAZY_TOOL_SLICES = [
  "general.yaml",
  "ui.yaml",
  "backend.yaml",
  "architect.yaml",
  "pm.yaml",
  "qa.yaml",
  "review.yaml",
  "scout.yaml",
] as const;

const DEBUG_TRACE_FETCH_LIMIT = 20;

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTraceTimestamp(ts: string): string {
  const trimmed = ts.trim();
  const match = /T(\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/.exec(trimmed);
  if (match?.[1]) {
    return match[1];
  }
  return trimmed;
}

function truncateDetailValue(strVal: string): string {
  if (strVal.length > 36) {
    return `${strVal.slice(0, 33)}...`;
  }
  return strVal;
}

function formatTraceEntryMeta(entry: HarnessDebugLogEntry): string {
  const parts: string[] = [];
  if (entry.role) parts.push(`role=${entry.role}`);
  if (entry.phase) parts.push(`phase=${entry.phase}`);
  if (entry.agentId) parts.push(`agent=${entry.agentId}`);
  if (entry.provider && entry.model) {
    parts.push(`${entry.provider}/${entry.model}`);
  } else if (entry.provider) {
    parts.push(entry.provider);
  } else if (entry.model) {
    parts.push(entry.model);
  }
  if (entry.detail && typeof entry.detail === "object") {
    let detailCount = 0;
    for (const [k, v] of Object.entries(entry.detail)) {
      if (v === undefined || v === null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        parts.push(`${k}=${truncateDetailValue(String(v))}`);
        detailCount += 1;
      }
      if (detailCount >= 3) break;
    }
  }
  return parts.join(" · ");
}

function buildTraceEntryKey(entry: HarnessDebugLogEntry, seenCounts: Map<string, number>): string {
  const baseKey = [
    entry.ts,
    entry.level,
    entry.event,
    entry.agentId ?? "",
    entry.role ?? "",
    entry.phase ?? "",
  ].join("|");
  const nextCount = (seenCounts.get(baseKey) ?? 0) + 1;
  seenCounts.set(baseKey, nextCount);
  return `${baseKey}#${nextCount}`;
}

function buildNextDebugStatusOnToggle(
  prev: HarnessDebugStatusOutput | null,
  enabled: boolean,
  logFilePath?: string,
): HarnessDebugStatusOutput | null {
  if (prev) {
    return {
      ...prev,
      enabled,
      logFilePath: logFilePath || prev.logFilePath,
    };
  }
  if (logFilePath) {
    return {
      enabled,
      logFilePath,
      totalLines: 0,
      fileSizeBytes: 0,
      rotatedExists: false,
      entries: [],
    };
  }
  return null;
}

function resolveTraceStatusHint(params: {
  debugStatus: HarnessDebugStatusOutput | null;
  debugStatusError: string | null;
  isLoadingDebugStatus: boolean;
  totalTraceLines: number;
  formattedTraceSize: string;
  debugRotatedExists: boolean;
}): string {
  if (params.debugStatusError && !params.debugStatus) {
    return params.debugStatusError;
  }
  if (params.isLoadingDebugStatus && !params.debugStatus) {
    return "Loading trace status...";
  }
  const rotationLabel = params.debugRotatedExists
    ? "Rotated backup present (debug-trace.1.jsonl)"
    : "No rotated backup";
  return `${params.totalTraceLines} entries · ${params.formattedTraceSize} · ${rotationLabel}`;
}

function resolveRecentEntriesHint(entryCount: number, debugTraceEnabled: boolean): string {
  if (entryCount > 0) {
    const unit = entryCount === 1 ? "entry" : "entries";
    return `Showing latest ${entryCount} ${unit} (newest first)`;
  }
  if (debugTraceEnabled) {
    return "No trace entries recorded yet";
  }
  return "Debug trace is off";
}

function formatAvailableProvidersSummary(availableProviders: unknown): string {
  if (!Array.isArray(availableProviders) || availableProviders.length === 0) {
    return "Not inspected";
  }
  return availableProviders
    .map((p: { provider: string; enabled: boolean; models?: string[] }) => {
      const stateLabel = p.enabled ? "enabled" : "off";
      return `${p.provider} (${stateLabel}, ${p.models?.length ?? 0} models)`;
    })
    .join(", ");
}

function resolveLazySliceHint(lazyToolSlice?: string): string {
  if (lazyToolSlice?.trim() === "codex.yaml") {
    return "Legacy shared slice — choose a role-specific slice to migrate";
  }
  return "MCP capability slice injected via LAZY_TOOL_CONFIG";
}

function formatRepoOverrideLabel(inspectInfo: any): string {
  if (inspectInfo?.hasRepoOverride) {
    return `Active (${inspectInfo.repoOverridePath})`;
  }
  return "None";
}

function formatWorkspaceAgentTeamLabel(inspectInfo: any): string {
  if (inspectInfo?.agentTeam) {
    return formatAgentTeamLabel(inspectInfo.agentTeam);
  }
  return "None";
}

function resolveTraceLevelBadgeStyle<T>(
  level: HarnessDebugLogEntry["level"],
  styles: { traceLevelInfo: T; traceLevelWarn: T; traceLevelError: T },
): T {
  if (level === "error") {
    return styles.traceLevelError;
  }
  if (level === "warn") {
    return styles.traceLevelWarn;
  }
  return styles.traceLevelInfo;
}

function normalizeDebugStatusResponse(
  raw: unknown,
  fallbackEnabled: boolean,
): HarnessDebugStatusOutput | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Partial<HarnessDebugStatusOutput>;
  if (
    typeof obj.logFilePath !== "string" &&
    typeof obj.totalLines !== "number" &&
    typeof obj.fileSizeBytes !== "number" &&
    !Array.isArray(obj.entries)
  ) {
    return null;
  }
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : fallbackEnabled,
    logFilePath: typeof obj.logFilePath === "string" ? obj.logFilePath : "",
    totalLines:
      typeof obj.totalLines === "number" && Number.isFinite(obj.totalLines) ? obj.totalLines : 0,
    fileSizeBytes:
      typeof obj.fileSizeBytes === "number" && Number.isFinite(obj.fileSizeBytes)
        ? obj.fileSizeBytes
        : 0,
    rotatedExists: Boolean(obj.rotatedExists),
    entries: Array.isArray(obj.entries) ? obj.entries : [],
  };
}

function formatProviderDisplayLabel(providerId: string): string {
  switch (providerId) {
    case "antigravity":
      return "Antigravity";
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    default:
      return providerId;
  }
}

function isSelectableRoutingModel(
  providerId: string,
  modelId: string,
  bypassModels: readonly string[] = BUILTIN_BYPASS_MODELS,
): boolean {
  if (!modelId.trim()) return false;
  if (normalizeProviderName(providerId) === "antigravity") {
    if (/^gemini-3/i.test(modelId) || isModelBypassed(modelId, bypassModels)) {
      return false;
    }
  }
  return true;
}

const INPUT_SAVE_DEBOUNCE_MS = 300;

function mergeNestedStringMaps(
  prev: Record<string, Record<string, string>> | undefined,
  next: Record<string, Record<string, string>> | undefined,
): Record<string, Record<string, string>> | undefined {
  if (!prev) return next;
  if (!next) return prev;
  const merged = { ...prev };
  for (const [provider, tierMap] of Object.entries(next)) {
    merged[provider] = {
      ...(merged[provider] ?? {}),
      ...tierMap,
    };
  }
  return merged;
}

function mergeSettingsPatches(
  prev: Partial<AgentHarnessSettings>,
  next: Partial<AgentHarnessSettings>,
): Partial<AgentHarnessSettings> {
  const mergedProviderMappings = mergeNestedStringMaps(
    prev.providerMappings,
    next.providerMappings,
  );
  const mergedThinkingMappings = mergeNestedStringMaps(
    prev.providerThinkingMappings,
    next.providerThinkingMappings,
  );
  return {
    ...prev,
    ...next,
    ...(mergedProviderMappings ? { providerMappings: mergedProviderMappings } : {}),
    ...(mergedThinkingMappings ? { providerThinkingMappings: mergedThinkingMappings } : {}),
  };
}

function parseCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface HarnessSettingsScreenProps extends PluginSurfaceProps {
  settingsOverride?: any;
  onOpenWorkspaceTeam?: (workspaceId: string) => void;
}

export function HarnessSettingsScreen({
  theme,
  layout,
  settingsOverride,
  onOpenWorkspaceTeam,
}: HarnessSettingsScreenProps) {
  const defaultSettings = useSettings(agentHarnessSettings);
  const settings = settingsOverride ?? defaultSettings;
  const toast = useToast();
  const inspectRpc = useRpc(harnessInspectEnvironmentRpc);
  const syncProfilesRpc = useRpc(harnessSyncProfilesRpc);
  const debugStatusRpc = useRpc(harnessDebugStatusRpc);
  const debugToggleRpc = useRpc(harnessDebugToggleRpc);
  const debugClearRpc = useRpc(harnessDebugClearRpc);
  const workspaceRefs = useWorkspaces();
  const paseo = usePaseo();

  const [inspectInfo, setInspectInfo] = useState<any>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("antigravity");
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string>("ui");
  const [customModelOpenByTier, setCustomModelOpenByTier] = useState<Record<string, boolean>>({});
  const [debugStatus, setDebugStatus] = useState<HarnessDebugStatusOutput | null>(null);
  const [debugStatusError, setDebugStatusError] = useState<string | null>(null);
  const [isLoadingDebugStatus, setIsLoadingDebugStatus] = useState(false);
  const [isDebugToggling, setIsDebugToggling] = useState(false);
  const [isClearingDebugLogs, setIsClearingDebugLogs] = useState(false);

  const latestSettingsRef = useRef(settings);
  const toastRef = useRef(toast);
  const pendingPatchRef = useRef<Partial<AgentHarnessSettings>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<Record<string, SettingsInputHandle | null>>({});
  const inspectRpcRef = useRef(inspectRpc);
  const debugStatusRpcRef = useRef(debugStatusRpc);
  const debugToggleRpcRef = useRef(debugToggleRpc);
  const debugClearRpcRef = useRef(debugClearRpc);
  const debugToggleLockRef = useRef(false);
  const debugClearLockRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    latestSettingsRef.current = settings;
    toastRef.current = toast;
    inspectRpcRef.current = inspectRpc;
    debugStatusRpcRef.current = debugStatusRpc;
    debugToggleRpcRef.current = debugToggleRpc;
    debugClearRpcRef.current = debugClearRpc;
  }, [debugClearRpc, debugStatusRpc, debugToggleRpc, inspectRpc, settings, toast]);
  const inspectSeqRef = useRef(0);
  const debugStatusSeqRef = useRef(0);

  const refreshDebugStatus = useCallback(async (options?: { showErrorToast?: boolean }) => {
    const seq = ++debugStatusSeqRef.current;
    if (isMountedRef.current) {
      setIsLoadingDebugStatus(true);
      setDebugStatusError(null);
    }
    try {
      const raw = await debugStatusRpcRef.current({ limit: DEBUG_TRACE_FETCH_LIMIT });
      if (!isMountedRef.current || seq !== debugStatusSeqRef.current) {
        return null;
      }
      const fallbackEnabled = Boolean(latestSettingsRef.current?.values?.debugLogs);
      const normalized = normalizeDebugStatusResponse(raw, fallbackEnabled);
      if (normalized) {
        setDebugStatus(normalized);
        return normalized;
      }
      const invalidMsg = "Invalid debug trace status response";
      setDebugStatusError(invalidMsg);
      if (options?.showErrorToast) {
        toastRef.current.error(invalidMsg);
      }
      return null;
    } catch (err) {
      if (!isMountedRef.current || seq !== debugStatusSeqRef.current) {
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setDebugStatusError(`Unable to load debug trace: ${msg}`);
      if (options?.showErrorToast) {
        toastRef.current.error(`Failed to load debug trace: ${msg}`);
      }
      return null;
    } finally {
      if (isMountedRef.current && seq === debugStatusSeqRef.current) {
        setIsLoadingDebugStatus(false);
      }
    }
  }, []);

  const runInspect = useCallback(
    (params: { workspaceId?: string; cwd?: string }, options?: { throwOnError?: boolean }) => {
      const seq = ++inspectSeqRef.current;
      return inspectRpcRef
        .current(params)
        .then((res) => {
          if (seq === inspectSeqRef.current) {
            setInspectInfo(res);
          }
          return res;
        })
        .catch((err) => {
          if (options?.throwOnError) {
            throw err;
          }
          if (seq === inspectSeqRef.current) {
            toastRef.current.error(
              `Environment inspect failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return null;
        });
    },
    [],
  );

  const setInputRef = useCallback(
    (id: string) => (handle: SettingsInputHandle | null) => {
      inputRefs.current[id] = handle;
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    void runInspect({});
  }, [runInspect]);

  const settingsReady = settings.status === "ready";
  const settingsDebugLogs = settingsReady ? Boolean(settings.values?.debugLogs) : false;
  const prevSettingsDebugLogsRef = useRef(settingsDebugLogs);

  useEffect(() => {
    if (settingsReady) {
      void refreshDebugStatus();
    }
  }, [refreshDebugStatus, settingsReady]);

  useEffect(() => {
    if (settingsReady && prevSettingsDebugLogsRef.current !== settingsDebugLogs) {
      prevSettingsDebugLogsRef.current = settingsDebugLogs;
      void refreshDebugStatus();
    }
  }, [refreshDebugStatus, settingsDebugLogs, settingsReady]);

  const workspaceOptions = useMemo(() => {
    const byId = new Map<string, { label: string; value: string; cwd?: string }>();
    const serverWorkspaces = Array.isArray(inspectInfo?.workspaces)
      ? (inspectInfo.workspaces as InspectWorkspaceEntry[])
      : [];
    for (const ws of serverWorkspaces) {
      if (!ws?.id) continue;
      const display = ws.title?.trim() || ws.name?.trim() || ws.id;
      byId.set(ws.id, {
        value: ws.id,
        label: ws.cwd ? `${display} (${ws.cwd})` : display,
        cwd: ws.cwd,
      });
    }
    for (const ref of workspaceRefs ?? []) {
      if (!ref?.id || byId.has(ref.id)) continue;
      const snap = paseo?.workspaces?.ref?.(ref)?.current?.();
      const display = snap?.title?.trim() || snap?.name?.trim() || ref.id;
      const cwd = snap?.workspaceDirectory;
      byId.set(ref.id, {
        value: ref.id,
        label: cwd ? `${display} (${cwd})` : display,
        cwd,
      });
    }
    return Array.from(byId.values());
  }, [inspectInfo?.workspaces, paseo?.workspaces, workspaceRefs]);

  const workspaceOptionsRef = useRef(workspaceOptions);
  useEffect(() => {
    workspaceOptionsRef.current = workspaceOptions;
  }, [workspaceOptions]);

  const inspectSelectedWorkspace = useCallback(
    (options?: { throwOnError?: boolean }) => {
      if (!selectedWorkspaceId) {
        return runInspect({}, options);
      }
      const match = workspaceOptionsRef.current.find((o) => o.value === selectedWorkspaceId);
      return runInspect(
        { workspaceId: selectedWorkspaceId, ...(match?.cwd ? { cwd: match.cwd } : {}) },
        options,
      );
    },
    [runInspect, selectedWorkspaceId],
  );

  useEffect(() => {
    if (!selectedWorkspaceId && workspaceOptions.length > 0) {
      setSelectedWorkspaceId(workspaceOptions[0].value);
    }
  }, [selectedWorkspaceId, workspaceOptions]);

  const inspectedWorkspaceRef = useRef<string>("");
  useEffect(() => {
    if (!selectedWorkspaceId || inspectedWorkspaceRef.current === selectedWorkspaceId) {
      return;
    }
    inspectedWorkspaceRef.current = selectedWorkspaceId;
    void inspectSelectedWorkspace();
  }, [inspectSelectedWorkspace, selectedWorkspaceId]);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    return subscribeWorkspaceTeamUpdated(selectedWorkspaceId, () => {
      void inspectSelectedWorkspace();
    });
  }, [inspectSelectedWorkspace, selectedWorkspaceId]);

  const flushPatch = useCallback(async (patchToSave: Partial<AgentHarnessSettings>) => {
    const cur = latestSettingsRef.current;
    if (cur?.status !== "ready" || typeof cur.save !== "function") {
      return;
    }
    const baseValues: AgentHarnessSettings = cur.values ?? DEFAULT_AGENT_HARNESS_SETTINGS;
    const nextValues = {
      ...baseValues,
      ...patchToSave,
      ...(patchToSave.providerMappings
        ? {
            providerMappings: mergeNestedStringMaps(
              baseValues.providerMappings,
              patchToSave.providerMappings,
            ),
          }
        : {}),
      ...(patchToSave.providerThinkingMappings
        ? {
            providerThinkingMappings: mergeNestedStringMaps(
              baseValues.providerThinkingMappings,
              patchToSave.providerThinkingMappings,
            ),
          }
        : {}),
    };
    try {
      const ok = await cur.save(nextValues, cur.revision);
      if (ok === false) {
        toastRef.current.error("Failed to save Agent Harness settings.");
      }
    } catch (err) {
      toastRef.current.error(
        `Failed to save Agent Harness settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const handleSync = useCallback(
    async (action: "import_from_disk" | "export_to_disk" | "sync_daemon_profiles") => {
      if (isSyncing) return;
      setIsSyncing(true);
      try {
        const res = await syncProfilesRpc({ action });
        if (action === "import_from_disk" && res.success && Array.isArray(res.specialists)) {
          await flushPatch({ specialists: res.specialists });
        }
        await inspectSelectedWorkspace({ throwOnError: true });
        toast.show(res.message, { variant: res.success ? "success" : "error" });
      } catch (err) {
        toast.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSyncing(false);
      }
    },
    [flushPatch, inspectSelectedWorkspace, isSyncing, syncProfilesRpc, toast],
  );

  const handleToggleDebugTrace = useCallback(
    async (nextEnabled: boolean) => {
      if (debugToggleLockRef.current || isDebugToggling) return;
      const cur = latestSettingsRef.current;
      if (cur?.status !== "ready") {
        toastRef.current.error("Agent Harness settings are not ready");
        return;
      }
      if (cur.saving) return;

      debugToggleLockRef.current = true;
      setIsDebugToggling(true);
      try {
        const baseValues: AgentHarnessSettings = cur.values ?? DEFAULT_AGENT_HARNESS_SETTINGS;
        if (typeof cur.save === "function") {
          const ok = await cur.save({ ...baseValues, debugLogs: nextEnabled }, cur.revision);
          if (ok === false) {
            toastRef.current.error(cur.saveError || "Failed to save debug trace setting");
            return;
          }
        }
        prevSettingsDebugLogsRef.current = nextEnabled;
        const res = await debugToggleRpcRef.current({ enabled: nextEnabled });
        const confirmedEnabled = typeof res?.enabled === "boolean" ? res.enabled : nextEnabled;
        if (isMountedRef.current) {
          setDebugStatusError(null);
          setDebugStatus((prev) =>
            buildNextDebugStatusOnToggle(prev, confirmedEnabled, res?.logFilePath),
          );
        }
        await refreshDebugStatus();
        toastRef.current.show(confirmedEnabled ? "Debug trace enabled" : "Debug trace disabled", {
          variant: "success",
        });
      } catch (err) {
        toastRef.current.error(
          `Failed to toggle debug trace: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        debugToggleLockRef.current = false;
        if (isMountedRef.current) {
          setIsDebugToggling(false);
        }
      }
    },
    [isDebugToggling, refreshDebugStatus],
  );

  const handleClearDebugTrace = useCallback(async () => {
    if (debugClearLockRef.current || isClearingDebugLogs) return;
    debugClearLockRef.current = true;
    setIsClearingDebugLogs(true);
    try {
      const res = await debugClearRpcRef.current({});
      await refreshDebugStatus();
      if (res?.cleared === false) {
        toastRef.current.error("Failed to remove all debug trace files");
      } else {
        const removedLabel = formatByteSize(
          typeof res?.removedBytes === "number" ? res.removedBytes : 0,
        );
        toastRef.current.show(`Cleared debug trace (${removedLabel} removed)`, {
          variant: "success",
        });
      }
    } catch (err) {
      toastRef.current.error(
        `Failed to clear debug trace: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      debugClearLockRef.current = false;
      if (isMountedRef.current) {
        setIsClearingDebugLogs(false);
      }
    }
  }, [isClearingDebugLogs, refreshDebugStatus]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: {
          gap: 16,
        },
        loadingContainer: {
          padding: 24,
          alignItems: "center",
          justifyContent: "center",
        },
        loadingText: {
          fontSize: 13,
          color: theme.colors.foregroundMuted,
        },
        infoText: {
          fontSize: 12,
          color: theme.colors.foreground,
          lineHeight: 18,
        },
        traceStatusBadge: {
          fontSize: 12,
          fontWeight: "500",
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          overflow: "hidden",
        },
        traceStatusActive: {
          color: theme.colors.accent ?? theme.colors.foreground,
          borderColor: theme.colors.accent ?? theme.colors.border,
        },
        traceStatusIdle: {
          color: theme.colors.foregroundMuted,
        },
        traceEntryRow: {
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 4,
        },
        traceEntryHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        },
        traceEntryEventGroup: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
        },
        traceLevelBadge: {
          fontSize: 11,
          fontWeight: "500",
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          flexShrink: 0,
        },
        traceLevelInfo: {
          color: theme.colors.foregroundMuted,
        },
        traceLevelWarn: {
          color: theme.colors.statusWarning ?? theme.colors.foreground,
        },
        traceLevelError: {
          color: theme.colors.statusDanger ?? theme.colors.foreground,
        },
        traceEventText: {
          fontSize: 13,
          fontWeight: "500",
          color: theme.colors.foreground,
          flexShrink: 1,
          minWidth: 0,
        },
        traceTimestamp: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
          fontFamily: layout?.platform === "ios" ? "Menlo" : "monospace",
          fontVariant: ["tabular-nums"],
          flexShrink: 0,
        },
        traceMetaText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
          lineHeight: 16,
          fontFamily: layout?.platform === "ios" ? "Menlo" : "monospace",
        },
      }),
    [layout?.platform, theme],
  );

  const commitPatch = useCallback(
    (patch: Partial<AgentHarnessSettings>) => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const combined = mergeSettingsPatches(pendingPatchRef.current, patch);
      pendingPatchRef.current = {};
      void flushPatch(combined);
    },
    [flushPatch],
  );

  const scheduleDebouncedSave = useCallback(
    (patch: Partial<AgentHarnessSettings>) => {
      pendingPatchRef.current = mergeSettingsPatches(pendingPatchRef.current, patch);
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const buffered = pendingPatchRef.current;
        pendingPatchRef.current = {};
        void flushPatch(buffered);
      }, INPUT_SAVE_DEBOUNCE_MS);
    },
    [flushPatch],
  );

  const handleToggle = useCallback(
    (key: keyof AgentHarnessSettings) => (value: boolean) => {
      commitPatch({ [key]: value } as Partial<AgentHarnessSettings>);
    },
    [commitPatch],
  );

  const handleSelect = useCallback(
    (key: keyof AgentHarnessSettings) => (value: any) => {
      commitPatch({ [key]: value } as Partial<AgentHarnessSettings>);
    },
    [commitPatch],
  );

  const handleRetry = useCallback(() => {
    if (typeof settings.reload === "function") {
      void settings.reload();
    }
  }, [settings]);

  const handleReset = useCallback(async () => {
    if (typeof settings.reset === "function") {
      const ok = await settings.reset();
      if (ok) return;
    }
    if (typeof settings.save === "function") {
      const revision = settings.revision ?? "";
      await settings.save(DEFAULT_AGENT_HARNESS_SETTINGS, revision);
    }
  }, [settings]);

  const values: AgentHarnessSettings =
    settings.status === "ready" ? settings.values : DEFAULT_AGENT_HARNESS_SETTINGS;

  const inspectedProviderMap = useMemo(() => {
    const map = new Map<string, { enabled: boolean; models: string[] }>();
    const list = Array.isArray(inspectInfo?.availableProviders)
      ? inspectInfo.availableProviders
      : [];
    for (const item of list) {
      if (item && typeof item.provider === "string") {
        map.set(normalizeProviderName(item.provider), {
          enabled: Boolean(item.enabled),
          models: Array.isArray(item.models) ? item.models : [],
        });
      }
    }
    return map;
  }, [inspectInfo]);

  const providerIds = useMemo(() => {
    const ids = new Set<string>(KNOWN_PROVIDERS);
    for (const key of Object.keys(values.providerMappings ?? {})) {
      ids.add(normalizeProviderName(key));
    }
    for (const key of inspectedProviderMap.keys()) {
      ids.add(key);
    }
    return Array.from(ids).filter(Boolean);
  }, [values.providerMappings, inspectedProviderMap]);

  const getModelsForProvider = useCallback(
    (providerId: string): string[] => {
      const norm = normalizeProviderName(providerId);
      const set = new Set<string>();
      if (norm === "antigravity") {
        for (const m of ANTIGRAVITY_GEMINI4_MODELS) {
          set.add(m);
        }
      }
      const inspected = inspectedProviderMap.get(norm);
      if (inspected) {
        for (const m of inspected.models) {
          if (isSelectableRoutingModel(norm, m, values.bypassModels)) {
            set.add(m);
          }
        }
      }
      const mapped = values.providerMappings?.[norm] ?? BUILTIN_PROVIDER_MAPPINGS[norm] ?? {};
      for (const m of Object.values(mapped)) {
        if (typeof m === "string" && isSelectableRoutingModel(norm, m, values.bypassModels)) {
          set.add(m);
        }
      }
      return Array.from(set);
    },
    [inspectedProviderMap, values.bypassModels, values.providerMappings],
  );

  const specialistsList =
    values.specialists?.length > 0
      ? values.specialists
      : DEFAULT_AGENT_HARNESS_SETTINGS.specialists;
  const activeSpecialist =
    specialistsList.find((s) => s.id === selectedSpecialistId) ?? specialistsList[0] ?? null;

  useEffect(() => {
    const map = values.providerMappings?.[selectedProvider] ?? {};
    const tierIds = (values.tiers?.length ? values.tiers : BUILTIN_TIERS).map((t) => t.id);
    for (const tierId of tierIds) {
      inputRefs.current[`tier-input-${tierId}`]?.replaceText(map[tierId] ?? "");
    }
    setCustomModelOpenByTier({});
    // Sync displayed tier input values only when selectedProvider changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider]);

  useEffect(() => {
    inputRefs.current["spec-model-override"]?.replaceText(activeSpecialist?.modelOverride ?? "");
    // Sync displayed specialist override input only when selectedSpecialistId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpecialistId]);

  const updateActiveSpecialist = useCallback(
    (patch: Partial<HarnessSpecialistConfig>, debounce = false) => {
      const currentSpecialists: AgentHarnessSettings["specialists"] =
        pendingPatchRef.current.specialists ??
        latestSettingsRef.current?.values?.specialists ??
        specialistsList;
      const target =
        currentSpecialists.find((s) => s.id === (activeSpecialist?.id ?? selectedSpecialistId)) ??
        activeSpecialist;
      if (!target) return;
      const nextSpecialists: AgentHarnessSettings["specialists"] = currentSpecialists.map((s) =>
        s.id === target.id ? { ...s, ...patch } : s,
      );
      if (debounce) {
        scheduleDebouncedSave({ specialists: nextSpecialists });
      } else {
        commitPatch({ specialists: nextSpecialists });
      }
    },
    [activeSpecialist, commitPatch, scheduleDebouncedSave, selectedSpecialistId, specialistsList],
  );

  const updateProviderTierModel = useCallback(
    (providerId: string, tierId: string, modelId: string, debounce = false) => {
      const norm = normalizeProviderName(providerId);
      const baseMappings =
        latestSettingsRef.current?.values?.providerMappings ?? values.providerMappings ?? {};
      const pendingProviderMap = pendingPatchRef.current.providerMappings?.[norm];
      const nextProviderMap = {
        ...(baseMappings[norm] ?? {}),
        ...(pendingProviderMap ?? {}),
        [tierId]: modelId.trim(),
      };
      const patch: Partial<AgentHarnessSettings> = {
        providerMappings: {
          [norm]: nextProviderMap,
        },
      };
      if (debounce) {
        scheduleDebouncedSave(patch);
      } else {
        commitPatch(patch);
      }
    },
    [commitPatch, scheduleDebouncedSave, values.providerMappings],
  );

  const updateProviderTierThinking = useCallback(
    (providerId: string, tierId: string, thinkingOptionId: string) => {
      const norm = normalizeProviderName(providerId);
      const baseThinking =
        latestSettingsRef.current?.values?.providerThinkingMappings ??
        values.providerThinkingMappings ??
        {};
      const pendingProviderMap = pendingPatchRef.current.providerThinkingMappings?.[norm];
      const nextProviderMap = {
        ...(baseThinking[norm] ?? {}),
        ...(pendingProviderMap ?? {}),
        [tierId]: thinkingOptionId.trim(),
      };
      commitPatch({
        providerThinkingMappings: {
          [norm]: nextProviderMap,
        },
      });
    },
    [commitPatch, values.providerThinkingMappings],
  );

  const resetSelectedProviderMappings = useCallback(() => {
    const norm = normalizeProviderName(selectedProvider);
    const defaultModels = BUILTIN_PROVIDER_MAPPINGS[norm] ?? {
      fast: "lite",
      standard: "flash",
      deep: "pro",
      max: "plan",
    };
    const defaultThinking = BUILTIN_PROVIDER_THINKING_MAPPINGS[norm] ?? {
      fast: "low",
      standard: "medium",
      deep: "high",
      max: "xhigh",
    };
    setCustomModelOpenByTier({});
    commitPatch({
      providerMappings: {
        [norm]: { ...defaultModels },
      },
      providerThinkingMappings: {
        [norm]: { ...defaultThinking },
      },
    });
    toastRef.current.show(
      `Restored recommended 4-tier defaults for ${formatProviderDisplayLabel(selectedProvider)}`,
      { variant: "success" },
    );
  }, [commitPatch, selectedProvider]);

  if (settings.status === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading Agent Harness settings…</Text>
      </View>
    );
  }

  if (settings.status !== "ready") {
    const isInvalid = settings.status === "invalid";
    const errorMessage =
      settings.error ??
      (isInvalid ? "Settings configuration is invalid." : "Failed to load settings.");

    return (
      <View style={styles.content}>
        <SettingsSection
          title="Configuration Status"
          info={isInvalid ? "Invalid Configuration" : "Load Error"}
        >
          <SettingsCard>
            <SettingsAction
              label={isInvalid ? "Invalid Settings Schema" : "Error Loading Settings"}
              hint={errorMessage}
              actionLabel="Retry"
              disabled={settings.saving}
              onPress={handleRetry}
            />
            <SettingsAction
              label="Reset to Defaults"
              hint="Restore default Agent Harness configuration"
              actionLabel="Reset"
              disabled={settings.saving}
              onPress={handleReset}
            />
          </SettingsCard>
        </SettingsSection>
      </View>
    );
  }

  const isSaving = settings.saving;
  const tiers = values.tiers?.length ? values.tiers : BUILTIN_TIERS;
  const effectiveConfig = resolveEffectiveHarnessConfig(values);

  const fallbackModelOptions = [
    { label: "Lite (lite)", value: "lite" },
    { label: "Standard (flash)", value: "flash" },
    { label: "Deep (pro)", value: "pro" },
    { label: "Max (plan)", value: "plan" },
  ];

  function formatProviderStatusSuffix(status: { enabled?: boolean } | undefined): string {
    if (!status) {
      return "";
    }
    return status.enabled ? " · Active" : " · Disabled";
  }

  const targetProviderOptions = providerIds.map((pid) => {
    const status = inspectedProviderMap.get(pid);
    const suffix = formatProviderStatusSuffix(status);
    return {
      label: `${formatProviderDisplayLabel(pid)}${suffix}`,
      value: pid,
    };
  });

  const activeProviderModels = getModelsForProvider(selectedProvider);

  const specialistSelectOptions = specialistsList.map((s) => ({
    label: `${s.name} (${s.preferredProvider || "inherit"} · ${s.modelOverride || s.preferredTier || "standard"})`,
    value: s.id,
  }));

  const specialistProviderOptions = [
    { label: "Inherit (Caller Default)", value: "" },
    ...providerIds.map((pid) => ({
      label: formatProviderDisplayLabel(pid),
      value: pid,
    })),
  ];

  const tierSelectOptions = tiers.map((t) => ({
    label: `${t.name} (${t.id})`,
    value: t.id,
  }));

  const activeSpecialistProvider = activeSpecialist?.preferredProvider?.trim() || "claude";
  const resolvedTierModel = activeSpecialist
    ? resolveTargetModelForTier(
        effectiveConfig,
        activeSpecialistProvider,
        activeSpecialist.preferredTier || "standard",
      )
    : "flash";
  const activeSpecialistModels = activeSpecialist
    ? getModelsForProvider(activeSpecialistProvider)
    : [];
  const modelOverrideOptions = [
    { label: `Use Tier Mapping (${resolvedTierModel})`, value: "" },
    ...activeSpecialistModels.map((m) => ({ label: m, value: m })),
    ...(activeSpecialist?.modelOverride &&
    !activeSpecialistModels.includes(activeSpecialist.modelOverride)
      ? [{ label: activeSpecialist.modelOverride, value: activeSpecialist.modelOverride }]
      : []),
  ];

  const lazySliceSet = new Set<string>(BUILTIN_LAZY_TOOL_SLICES);
  if (Array.isArray(inspectInfo?.lazyToolSlices)) {
    for (const s of inspectInfo.lazyToolSlices) {
      if (typeof s === "string" && s.trim()) {
        lazySliceSet.add(s.trim());
      }
    }
  }
  if (activeSpecialist?.lazyToolSlice?.trim()) {
    lazySliceSet.add(activeSpecialist.lazyToolSlice.trim());
  }
  const lazySliceOptions = [
    { label: "Default (None)", value: "" },
    ...Array.from(lazySliceSet)
      .sort()
      .map((s) => ({
        label: s === "codex.yaml" ? "codex.yaml (legacy)" : s,
        value: s,
      })),
  ];

  const debugTraceEnabled = debugStatus ? debugStatus.enabled : Boolean(values.debugLogs);
  const resolvedLogPath = debugStatus?.logFilePath || "Resolving daemon log path...";
  const totalTraceLines = debugStatus?.totalLines ?? 0;
  const formattedTraceSize = formatByteSize(debugStatus?.fileSizeBytes ?? 0);
  const debugRotatedExists = Boolean(debugStatus?.rotatedExists);
  const debugEntries = debugStatus?.entries ?? [];
  const traceStatusHint = resolveTraceStatusHint({
    debugStatus,
    debugStatusError,
    isLoadingDebugStatus,
    totalTraceLines,
    formattedTraceSize,
    debugRotatedExists,
  });
  const recentEntriesHint = resolveRecentEntriesHint(debugEntries.length, debugTraceEnabled);
  const seenTraceKeys = new Map<string, number>();
  const hasTraceData = Boolean(
    debugStatus &&
    (debugStatus.totalLines > 0 ||
      debugStatus.fileSizeBytes > 0 ||
      debugStatus.rotatedExists ||
      debugStatus.entries.length > 0),
  );

  const availableProvidersSummary = formatAvailableProvidersSummary(
    inspectInfo?.availableProviders,
  );
  const lazySliceHint = resolveLazySliceHint(activeSpecialist?.lazyToolSlice);
  const repoOverrideLabel = formatRepoOverrideLabel(inspectInfo);
  const workspaceAgentTeamLabel = formatWorkspaceAgentTeamLabel(inspectInfo);

  return (
    <View style={styles.content}>
      <SettingsSection title="Core Orchestration">
        <SettingsCard>
          <SettingsSwitch
            label="Enable Agent Harness"
            hint="Dynamic domain role routing and tier lifecycle management"
            value={values.enabled}
            disabled={isSaving}
            onValueChange={handleToggle("enabled")}
          />
          <SettingsSwitch
            label="Override Default Model Only"
            hint="Only optimize model tiers when the user has not locked a specific model"
            value={values.overrideIfDefaultOnly}
            disabled={isSaving}
            onValueChange={handleToggle("overrideIfDefaultOnly")}
          />
          <SettingsSwitch
            label="Honor Specialist Provider"
            hint="Use each specialist's configured Preferred Provider during handoff"
            value={values.honorSpecialistPreferredProvider}
            disabled={isSaving}
            onValueChange={handleToggle("honorSpecialistPreferredProvider")}
          />
          <SettingsSwitch
            label="Enable Repo-level Overrides"
            hint="Allow loading .paseo/agent-harness.json from workspace root"
            value={values.enableRepoConfigOverride}
            disabled={isSaving}
            onValueChange={handleToggle("enableRepoConfigOverride")}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Provider Tier Mappings & Bypass">
        <SettingsCard>
          <SettingsSelect
            label="Target Provider"
            hint="Select a provider to configure Fast, Standard, Deep, and Max models"
            value={selectedProvider}
            options={targetProviderOptions}
            disabled={isSaving}
            onValueChange={(pid) => setSelectedProvider(pid)}
          />
          {tiers.map((tier) => {
            const currentValue = values.providerMappings?.[selectedProvider]?.[tier.id] ?? "";
            const currentThinking =
              values.providerThinkingMappings?.[selectedProvider]?.[tier.id] ?? "";
            const tierKey = `${selectedProvider}:${tier.id}`;
            const isKnownModel = !currentValue || activeProviderModels.includes(currentValue);
            const isCustomOpen = Boolean(customModelOpenByTier[tierKey]) || !isKnownModel;
            const selectValue = isCustomOpen ? CUSTOM_MODEL_OPTION_VALUE : currentValue;
            const presetOptions = [
              {
                label: tier.id === "max" ? "Inherit Deep (Fallback)" : "Unset / Default",
                value: "",
              },
              ...activeProviderModels.map((m) => ({ label: m, value: m })),
              { label: "Custom Model ID...", value: CUSTOM_MODEL_OPTION_VALUE },
            ];

            return (
              <React.Fragment key={tierKey}>
                <SettingsSelect
                  label={`${tier.name} Model`}
                  hint={TIER_BUDGET_HINTS[tier.id] ?? tier.description ?? `Tier: ${tier.id}`}
                  value={selectValue}
                  options={presetOptions}
                  disabled={isSaving}
                  onValueChange={(nextModel) => {
                    if (nextModel === CUSTOM_MODEL_OPTION_VALUE) {
                      setCustomModelOpenByTier((prev) => ({ ...prev, [tierKey]: true }));
                      return;
                    }
                    setCustomModelOpenByTier((prev) => ({ ...prev, [tierKey]: false }));
                    inputRefs.current[`tier-input-${tier.id}`]?.replaceText(nextModel);
                    updateProviderTierModel(selectedProvider, tier.id, nextModel, false);
                  }}
                />
                {isCustomOpen ? (
                  <SettingsInput
                    ref={setInputRef(`tier-input-${tier.id}`)}
                    key={`tier-input-${tier.id}`}
                    label={`${tier.name} Custom Model ID`}
                    hint={`Custom model identifier for ${selectedProvider} (${tier.id})`}
                    initialValue={currentValue}
                    placeholder={tier.id}
                    onChangeText={(text) =>
                      updateProviderTierModel(selectedProvider, tier.id, text, true)
                    }
                  />
                ) : null}
                <SettingsSelect
                  label={`${tier.name} Thinking`}
                  hint={`Reasoning effort for ${tier.name} tier`}
                  value={currentThinking}
                  options={THINKING_EFFORT_OPTIONS}
                  disabled={isSaving}
                  onValueChange={(nextThinking) =>
                    updateProviderTierThinking(selectedProvider, tier.id, nextThinking)
                  }
                />
              </React.Fragment>
            );
          })}
          <SettingsAction
            label="Reset Provider Mappings"
            hint={`Restore recommended 4-tier defaults for ${formatProviderDisplayLabel(selectedProvider)}`}
            actionLabel="Reset defaults"
            disabled={isSaving}
            onPress={resetSelectedProviderMappings}
          />
          <SettingsInput
            ref={setInputRef("bypass-models-input")}
            key="bypass-models-input"
            label="Bypass Model Patterns"
            hint="Comma-separated model regexes excluded from Harness (e.g. ^gemini-pro-orchestrator)"
            initialValue={(values.bypassModels ?? []).join(", ")}
            placeholder="^gemini-pro-orchestrator"
            onChangeText={(text) => scheduleDebouncedSave({ bypassModels: parseCommaList(text) })}
          />
          <SettingsInput
            ref={setInputRef("bypass-providers-input")}
            key="bypass-providers-input"
            label="Bypass Providers"
            hint="Comma-separated provider IDs excluded entirely from Harness routing"
            initialValue={(values.bypassProviders ?? []).join(", ")}
            placeholder="Optional provider IDs"
            onChangeText={(text) =>
              scheduleDebouncedSave({ bypassProviders: parseCommaList(text) })
            }
          />
        </SettingsCard>
      </SettingsSection>

      {activeSpecialist ? (
        <SettingsSection title="Specialist Roles Matrix">
          <SettingsCard>
            <SettingsSelect
              label="Active Specialist"
              hint="Choose a specialist role to customize its Agent, tier, model, and tool slice"
              value={activeSpecialist.id}
              options={specialistSelectOptions}
              disabled={isSaving}
              onValueChange={(id) => setSelectedSpecialistId(id)}
            />
            <SettingsSwitch
              label="Enable Specialist"
              hint={activeSpecialist.description || `Enable routing for ${activeSpecialist.id}`}
              value={activeSpecialist.enabled}
              disabled={isSaving}
              onValueChange={(enabled) => updateActiveSpecialist({ enabled })}
            />
            <SettingsSelect
              label="Preferred Provider"
              hint="Target coding agent when spawning or handing off to this specialist"
              value={activeSpecialist.preferredProvider ?? ""}
              options={specialistProviderOptions}
              disabled={isSaving}
              onValueChange={(preferredProvider) => updateActiveSpecialist({ preferredProvider })}
            />
            <SettingsSelect
              label="Preferred Tier"
              hint="Default capability tier mapped to the target provider's model"
              value={activeSpecialist.preferredTier ?? "standard"}
              options={tierSelectOptions}
              disabled={isSaving}
              onValueChange={(preferredTier) => updateActiveSpecialist({ preferredTier })}
            />
            <SettingsSelect
              label="Model Override Preset"
              hint="Pin a specific model ID or use the provider's tier mapping"
              value={activeSpecialist.modelOverride ?? ""}
              options={modelOverrideOptions}
              disabled={isSaving}
              onValueChange={(modelOverride) => {
                inputRefs.current["spec-model-override"]?.replaceText(modelOverride);
                updateActiveSpecialist({ modelOverride }, false);
              }}
            />
            <SettingsInput
              ref={setInputRef("spec-model-override")}
              key="spec-model-override"
              label="Model Override ID"
              hint="Leave empty to follow Preferred Tier mapping"
              initialValue={activeSpecialist.modelOverride ?? ""}
              placeholder={resolvedTierModel}
              onChangeText={(modelOverride) =>
                updateActiveSpecialist({ modelOverride: modelOverride.trim() }, true)
              }
            />
            <SettingsSwitch
              label="Lock Tier on Role Label"
              hint="Keep assigned tier locked across turns when invoked via role label"
              value={Boolean(activeSpecialist.lockTierOnLabel)}
              disabled={isSaving}
              onValueChange={(lockTierOnLabel) => updateActiveSpecialist({ lockTierOnLabel })}
            />
            <SettingsSwitch
              label="Show in Handoff Popover"
              hint="Display this specialist in the Composer Harness handoff menu"
              value={activeSpecialist.handoffEnabled}
              disabled={isSaving}
              onValueChange={(handoffEnabled) => updateActiveSpecialist({ handoffEnabled })}
            />
            <SettingsSelect
              label="Lazy-Tool Slice"
              hint={lazySliceHint}
              value={activeSpecialist.lazyToolSlice ?? ""}
              options={lazySliceOptions}
              disabled={isSaving}
              onValueChange={(lazyToolSlice) => updateActiveSpecialist({ lazyToolSlice })}
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Phase Lifecycle & Gates">
        <SettingsCard>
          <SettingsSwitch
            label="Phase Lifecycle State Machine"
            hint="Track turns and detect transitions between design, execution, and review"
            value={values.phaseLifecycleEnabled}
            disabled={isSaving}
            onValueChange={handleToggle("phaseLifecycleEnabled")}
          />
          <SettingsSwitch
            label="Enforce Native Plan Mode"
            hint="Lock provider plan mode during design phase for Claude and OpenCode"
            value={values.enforceNativePlanMode}
            disabled={isSaving}
            onValueChange={handleToggle("enforceNativePlanMode")}
          />
          <SettingsSwitch
            label="Auto Step Down Plan to Standard"
            hint="Automatically step down from Deep Plan to Standard when modification tools or execution intents occur"
            value={values.autoDowngradePlanOnExec}
            disabled={isSaving}
            onValueChange={handleToggle("autoDowngradePlanOnExec")}
          />
          <SettingsSwitch
            label="Emit Timeline Transitions"
            hint="Render transition milestone cards in the agent chat timeline"
            value={values.emitTimelineTransitions}
            disabled={isSaving}
            onValueChange={handleToggle("emitTimelineTransitions")}
          />
          <SettingsSelect
            label="Plan Turn Soft Limit"
            hint="Turn count before suggesting handoff to execution specialist"
            value={String(values.planTurnSoftLimit)}
            options={[
              { label: "2 Turns", value: "2" },
              { label: "3 Turns (Default)", value: "3" },
              { label: "5 Turns", value: "5" },
              { label: "10 Turns", value: "10" },
            ]}
            disabled={isSaving}
            onValueChange={(v) => handleSelect("planTurnSoftLimit")(Number(v))}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="L2 LLM Fallback Intent Classifier">
        <SettingsCard>
          <SettingsSwitch
            label="Enable LLM Fallback Classifier"
            hint="Use configured OpenAI-compatible endpoint when regex heuristics miss"
            value={values.llmFallbackEnabled}
            disabled={isSaving}
            onValueChange={handleToggle("llmFallbackEnabled")}
          />
          <SettingsSwitch
            label="Apply Role from Classifier"
            hint="Update specialist domain role when L2 classifier returns a specific role"
            value={values.llmFallbackApplyRole}
            disabled={isSaving}
            onValueChange={handleToggle("llmFallbackApplyRole")}
          />
          <SettingsSelect
            label="LLM Fallback Model"
            value={values.llmFallbackModel}
            options={fallbackModelOptions}
            disabled={isSaving}
            onValueChange={handleSelect("llmFallbackModel")}
          />
          <SettingsInput
            ref={setInputRef("llm-fallback-endpoint")}
            key="llm-fallback-endpoint"
            label="Classifier Endpoint URL"
            hint="OpenAI-compatible /v1/chat/completions endpoint; required for L2 fallback"
            initialValue={values.llmFallbackEndpoint ?? ""}
            placeholder="https://your-llm.example.com/v1/chat/completions"
            onChangeText={(text) => scheduleDebouncedSave({ llmFallbackEndpoint: text.trim() })}
          />
          <SettingsInput
            ref={setInputRef("llm-fallback-apikey")}
            key="llm-fallback-apikey"
            label="Classifier API Key"
            hint={
              values.llmFallbackApiKey
                ? "Bearer token stored securely; enter a new key to replace or clear below"
                : "Bearer token sent to the classifier endpoint"
            }
            initialValue=""
            placeholder={
              values.llmFallbackApiKey ? "Configured (enter new key to replace)" : "sk-..."
            }
            secureTextEntry
            onChangeText={(text) => {
              const trimmed = text.trim();
              if (trimmed.length > 0) {
                scheduleDebouncedSave({ llmFallbackApiKey: trimmed });
              }
            }}
          />
          {values.llmFallbackApiKey ? (
            <SettingsAction
              label="Clear Classifier API Key"
              hint="Remove the stored bearer token"
              actionLabel="Clear API Key"
              disabled={isSaving}
              onPress={() => {
                inputRefs.current["llm-fallback-apikey"]?.replaceText("");
                commitPatch({ llmFallbackApiKey: "" });
              }}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Profile Synchronization & Environment">
        <SettingsCard>
          <SettingsSwitch
            label="Auto-Sync Disk Profiles"
            hint="Automatically write specialist profiles to ~/.agents/profiles/*.json on save"
            value={values.autoSyncDiskProfiles}
            disabled={isSaving}
            onValueChange={handleToggle("autoSyncDiskProfiles")}
          />
          <SettingsSwitch
            label="Auto-Sync Paseo Agent Profiles"
            hint="Synchronize enabled specialists to Paseo native agentProfiles selector"
            value={values.autoSyncDaemonAgentProfiles}
            disabled={isSaving}
            onValueChange={handleToggle("autoSyncDaemonAgentProfiles")}
          />
          <SettingsSwitch
            label="Enforce Session MCP Filtering"
            hint="Filter allowed/excluded MCP servers per specialist role in agent.open.before"
            value={values.enforceSessionMcpFiltering}
            disabled={isSaving}
            onValueChange={handleToggle("enforceSessionMcpFiltering")}
          />
          <SettingsAction
            label="Import Profiles from Disk"
            hint={`Scan ${values.profilesDir} and merge custom profiles`}
            actionLabel="Import"
            disabled={isSyncing}
            onPress={() => handleSync("import_from_disk")}
          />
          <SettingsAction
            label="Export Profiles to Disk"
            hint={`Write all specialists to ${values.profilesDir}`}
            actionLabel="Export"
            disabled={isSyncing}
            onPress={() => handleSync("export_to_disk")}
          />
          <SettingsAction
            label="Sync Daemon Agent Profiles"
            hint="Update Paseo native agentProfiles from active specialists"
            actionLabel="Sync Profiles"
            disabled={isSyncing}
            onPress={() => handleSync("sync_daemon_profiles")}
          />
        </SettingsCard>
        <SettingsCard>
          <SettingsSelect
            label="Workspace"
            hint={
              workspaceOptions.length > 0
                ? "Select a workspace to inspect status and edit its agent team"
                : "No registered workspaces available on this host"
            }
            value={selectedWorkspaceId}
            options={
              workspaceOptions.length > 0
                ? workspaceOptions.map(({ label, value }) => ({ label, value }))
                : [{ label: "No workspace selected", value: "" }]
            }
            disabled={workspaceOptions.length === 0}
            onValueChange={(nextId) => setSelectedWorkspaceId(nextId)}
          />
          <SettingsAction
            label="Workspace Agent Team"
            hint="Edit roles, native targets, safety guards, and role bindings for this workspace"
            actionLabel="Open workspace team editor"
            disabled={!selectedWorkspaceId || !onOpenWorkspaceTeam}
            onPress={() => {
              if (selectedWorkspaceId && onOpenWorkspaceTeam) {
                try {
                  onOpenWorkspaceTeam(selectedWorkspaceId);
                } catch (err) {
                  toast.error(
                    `Unable to open workspace team editor: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              }
            }}
          />
        </SettingsCard>
        {inspectInfo ? (
          <SettingsCard>
            <Text style={styles.infoText}>
              Host Environment Status:{"\n"}• Available Providers: {availableProvidersSummary}
              {"\n"}• Disk Profiles Found: {inspectInfo.diskProfiles?.length ?? 0}
              {"\n"}• Lazy-Tool Slices Found: {inspectInfo.lazyToolSlices?.length ?? 0}
              {"\n"}• Workspace Repo Override: {repoOverrideLabel}
              {"\n"}• Workspace Agent Team: {workspaceAgentTeamLabel}
            </Text>
          </SettingsCard>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Debug Trace & Diagnostics">
        <SettingsCard>
          <SettingsSwitch
            label="Enable Debug Trace"
            hint="Record redacted routing, permission, and turn events to debug-trace.jsonl"
            value={debugTraceEnabled}
            disabled={isDebugToggling || isSaving || !settingsReady}
            onValueChange={(next) => void handleToggleDebugTrace(next)}
          />
          <SettingsRow label="Log File Path" hint={resolvedLogPath} />
          <SettingsRow label="Trace Status" hint={traceStatusHint}>
            <Text
              style={[
                styles.traceStatusBadge,
                debugTraceEnabled ? styles.traceStatusActive : styles.traceStatusIdle,
              ]}
              numberOfLines={1}
            >
              {debugTraceEnabled ? "Active" : "Off"}
            </Text>
          </SettingsRow>
          <SettingsAction
            label="Refresh Logs"
            hint="Reload debug trace status and recent entries"
            actionLabel={isLoadingDebugStatus ? "Refreshing..." : "Refresh Logs"}
            disabled={isLoadingDebugStatus || isClearingDebugLogs}
            onPress={() => void refreshDebugStatus({ showErrorToast: true })}
          />
          <SettingsAction
            label="Clear Trace"
            hint={
              hasTraceData
                ? "Delete active and rotated debug trace files"
                : "No debug trace files to clear"
            }
            actionLabel={isClearingDebugLogs ? "Clearing..." : "Clear Trace"}
            disabled={isClearingDebugLogs || isLoadingDebugStatus || !hasTraceData}
            onPress={() => void handleClearDebugTrace()}
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow label="Recent Trace Entries" hint={recentEntriesHint} />
          {debugEntries.map((entry) => {
            const entryKey = buildTraceEntryKey(entry, seenTraceKeys);
            const metaSummary = formatTraceEntryMeta(entry);
            const levelStyle = resolveTraceLevelBadgeStyle(entry.level, styles);
            return (
              <View key={entryKey} style={styles.traceEntryRow}>
                <View style={styles.traceEntryHeader}>
                  <View style={styles.traceEntryEventGroup}>
                    <Text style={[styles.traceLevelBadge, levelStyle]} numberOfLines={1}>
                      {entry.level}
                    </Text>
                    <Text style={styles.traceEventText} numberOfLines={1}>
                      {entry.event}
                    </Text>
                  </View>
                  <Text style={styles.traceTimestamp} numberOfLines={1}>
                    {formatTraceTimestamp(entry.ts)}
                  </Text>
                </View>
                {metaSummary ? (
                  <Text style={styles.traceMetaText} numberOfLines={2}>
                    {metaSummary}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
