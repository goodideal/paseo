import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { AgentToolDefinition, PluginServerContext } from "@getpaseo/plugin/server";
import {
  buildSystemPromptBanner,
  findSpecialist,
  isNativePlanModeSupported,
  normalizeProviderName,
  normalizeTierAlias,
  resolveEffectiveHarnessConfig,
  resolveResumeExecutionMode,
  resolveSessionMcpServers,
  resolveTargetAgentAndModel,
  isFederatedLocalProvider,
  resolveTierTarget,
  stripHarnessBannerFromSystemPrompt,
} from "./shared/config-resolver.js";
import {
  coerceAutoRoutingTier,
  detectIntentDeterministic,
  isDefaultOrUnsetModel,
  isModelBypassed,
  isProviderBypassed,
  resolveHarnessEnv,
} from "./shared/intent-detector.js";
import { resolveSpecialistTargetTier } from "./shared/contracts.js";
import {
  createInitialHarnessMetadata,
  extractSnapshotModel,
  extractTimelineItems,
  HARNESS_BYPASSED_META_KEY,
  HARNESS_LEAF_LABEL_KEY,
  HARNESS_LEAF_META_KEY,
  HARNESS_WORKFLOW_PHASE_LABEL_KEY,
  HARNESS_WORKFLOW_TIER_LABEL_KEY,
  HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY,
  hasExplicitExecTransitionIntent,
  hasShortAffirmativeExecConfirmation,
  inspectTurnTimeline,
  parseHarnessMetadata,
  reconcileRuntimeHarnessMetadata,
  shouldEnforceNativePlanMode,
  tierToPhase,
} from "./shared/lifecycle-state.js";

export { extractSnapshotModel } from "./shared/lifecycle-state.js";
import { isReadOnlyShellCommand } from "./shared/plan-shell-policy.js";
import {
  agentHarnessSettings,
  DEFAULT_AGENT_HARNESS_SETTINGS,
  HarnessSpecialistConfigSchema,
  type AgentHarnessSettings,
} from "./shared/settings.js";
import {
  HARNESS_METADATA_KEY,
  type DomainRole,
  type DomainRoleDecision,
  type EffectiveHarnessConfig,
  type HarnessAgentMetadata,
  type HarnessDowngradeReason,
  type HarnessPhase,
  type HarnessSpecialistConfig,
  type HostProviderRuntimeInfo,
  type JsonValue,
  type MatrixTier,
  type RouterDecision,
} from "./shared/types.js";
import { applyAgentModeOption, applyAgentThinkingOption } from "./server/agent-controls.js";
import { AgentIntentRouter, type CliRunner } from "./server/agent-intent-router.js";
import {
  invalidateWorkspaceAgentTeamCache,
  loadWorkspaceAgentTeam,
} from "./server/agent-team-loader.js";
import { HarnessDebugLogger, resolveAgentHarnessDataDir } from "./server/debug-logger.js";
import {
  consumeSdkEmittedHandoffChild,
  createHarnessHandoffTool,
  isSdkHandoffInFlight,
} from "./server/handoff-tool.js";
import {
  exportSpecialistsToDisk,
  loadRepoHarnessOverride,
  syncDaemonAgentProfiles,
} from "./server/profile-sync.js";
import { registerHarnessRpcHandlers } from "./server/rpc-handlers.js";
import { emitHarnessTimelineTransition } from "./server/timeline-emitter.js";

const PROMPT_CACHE_TTL_MS = 60_000;
const HOST_PROVIDERS_CACHE_TTL_MS = 15_000;
const TITLE_PREVIEW_MAX_CODE_POINTS = 60;

function hasObservatoryPrefix(labels?: Readonly<Record<string, string>>): boolean {
  if (!labels) return false;
  for (const [k, v] of Object.entries(labels)) {
    const lk = k.toLowerCase();
    const lv = v.toLowerCase();
    if (
      lk.startsWith("observatory.") ||
      lk.startsWith("agent-observatory.") ||
      lv.startsWith("observatory.") ||
      lv.startsWith("agent-observatory.")
    ) {
      return true;
    }
  }
  return false;
}

function shouldBypassSystemRequest(params: {
  request: object;
  mergedLabels?: Readonly<Record<string, string>>;
}): boolean {
  const { mergedLabels } = params;
  const request = params.request as Record<string, unknown>;
  const reqConfig =
    request.config && typeof request.config === "object"
      ? (request.config as Record<string, unknown>)
      : undefined;
  const reqEnv =
    request.env && typeof request.env === "object"
      ? (request.env as Record<string, string>)
      : undefined;
  const cfgEnv =
    reqConfig?.env && typeof reqConfig.env === "object"
      ? (reqConfig.env as Record<string, string>)
      : undefined;
  const reqMeta =
    request.metadata && typeof request.metadata === "object"
      ? (request.metadata as Record<string, unknown>)
      : undefined;

  if (
    request.internal === true ||
    reqConfig?.internal === true ||
    mergedLabels?.["paseo.internal"] === "1" ||
    mergedLabels?.["paseo.internal"] === "true" ||
    mergedLabels?.internal === "1" ||
    mergedLabels?.internal === "true"
  ) {
    return true;
  }

  const purpose = typeof request.purpose === "string" ? request.purpose : undefined;
  if (purpose !== undefined && purpose !== "interactive") {
    return true;
  }

  if (
    reqEnv?.PASEO_HARNESS_INTERNAL_ROUTER === "1" ||
    cfgEnv?.PASEO_HARNESS_INTERNAL_ROUTER === "1" ||
    process.env.PASEO_HARNESS_INTERNAL_ROUTER === "1"
  ) {
    return true;
  }

  const hasExplicitRole = Boolean(mergedLabels?.role || mergedLabels?.profile);
  const hasExplicitWorkflow = Boolean(
    mergedLabels?.[HARNESS_WORKFLOW_PHASE_LABEL_KEY] ||
    mergedLabels?.["paseo.workflow"] ||
    mergedLabels?.[HARNESS_WORKFLOW_TIER_LABEL_KEY] ||
    reqMeta?.[HARNESS_WORKFLOW_PHASE_LABEL_KEY],
  );

  if (!hasExplicitRole && !hasExplicitWorkflow) {
    if (hasObservatoryPrefix(mergedLabels)) {
      return true;
    }
    const agentId = typeof request.agentId === "string" ? request.agentId.toLowerCase() : "";
    let title = "";
    if (typeof request.title === "string") {
      title = request.title.toLowerCase();
    } else if (typeof reqConfig?.title === "string") {
      title = reqConfig.title.toLowerCase();
    }
    if (
      agentId.startsWith("observatory.") ||
      agentId.startsWith("agent-observatory.") ||
      title.startsWith("observatory.") ||
      title.startsWith("agent-observatory.")
    ) {
      return true;
    }
    if (request.background === true || reqConfig?.background === true) {
      return true;
    }
  }

  return false;
}

function readStringLabels(obj: unknown): Record<string, string> | undefined {
  if (typeof obj !== "object" || obj === null || !("labels" in obj)) {
    return undefined;
  }
  const candidate = (obj as { labels?: unknown }).labels;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeLabels(
  primary: Readonly<Record<string, string>> | null | undefined,
  secondary: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> | undefined {
  if (!primary && !secondary) {
    return undefined;
  }
  const merged = { ...secondary, ...primary };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function truncateByCodePoints(text: string, maxCodePoints: number): string {
  return Array.from(text).slice(0, maxCodePoints).join("");
}

type HostProviderSnapshotEntry = Awaited<
  ReturnType<NonNullable<PaseoApi["providers"]>["snapshot"]>
>["entries"][number];

function normalizeHostProviderEntry(entry: HostProviderSnapshotEntry): HostProviderRuntimeInfo {
  const models = (entry.models ?? []).map((m) => ({
    id: m.id,
    label: m.label,
    isDefault: m.isDefault,
    thinkingOptions: m.thinkingOptions?.map((opt) => ({
      id: opt.id,
      label: opt.label,
    })),
  }));
  const defaultModel =
    (entry as { defaultModel?: string }).defaultModel ?? models.find((m) => m.isDefault)?.id;
  return {
    provider: entry.provider,
    enabled: entry.enabled,
    status: entry.status,
    label: entry.label,
    defaultModel,
    models,
  };
}

interface DaemonProfileSyncStatus {
  status: "skipped" | "synced" | "partial" | "idle";
  syncedCount?: number;
  errorCount?: number;
  reason?: string;
}

interface DaemonProfileSyncState extends DaemonProfileSyncStatus {
  lastSyncedSignature: string;
}

function toDaemonProfilesSyncLogDetail(state: DaemonProfileSyncStatus): Record<string, unknown> {
  return {
    status: state.status,
    ...(state.syncedCount !== undefined ? { syncedCount: state.syncedCount } : {}),
    ...(state.errorCount !== undefined ? { errorCount: state.errorCount } : {}),
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
  };
}

interface RoutedAgentConfigResult<T> {
  config: T;
  roleDecision: DomainRoleDecision;
  routerDecision: RouterDecision;
  specialist?: HarnessSpecialistConfig;
  isBypassed: boolean;
}

export interface AgentHarnessContributeOptions {
  dataDir?: string;
  disableAutoDiskSync?: boolean;
  routerCliRunner?: CliRunner;
  intentRouter?: AgentIntentRouter;
}

export { resolveAgentHarnessDataDir };

export default function contribute(
  server: PluginServerContext,
  options?: AgentHarnessContributeOptions,
) {
  const dataDir = resolveAgentHarnessDataDir(options?.dataDir);
  const disableAutoDiskSync = options?.disableAutoDiskSync === true;
  const settings = server.registerSettings(agentHarnessSettings);
  let cachedSettings: AgentHarnessSettings = { ...DEFAULT_AGENT_HARNESS_SETTINGS };
  const debugLogger = new HarnessDebugLogger({
    dataDir,
    enabled: cachedSettings.debugLogs,
  });
  const intentRouter =
    options?.intentRouter ??
    new AgentIntentRouter({
      cliRunner: options?.routerCliRunner,
      onDebugLog: (msg) => {
        if (cachedSettings.debugLogs) {
          console.log(msg);
        }
      },
    });
  let hasHydratedSettings = false;
  let hasSubscriptionUpdate = false;
  let daemonSyncSeq = 0;
  let hasInitializedDebugState = false;
  let lastRecordedDebugState: boolean | null = null;
  let runtimeDebugOverride: boolean | null = null;
  let latestPaseo: PaseoApi | null = null;
  let lastDaemonProfileSyncState: DaemonProfileSyncState = {
    status: "idle",
    lastSyncedSignature: "",
  };
  let hostProvidersCache: { entries: HostProviderRuntimeInfo[]; fetchedAt: number } | null = null;
  let hostProvidersInFlight: Promise<HostProviderRuntimeInfo[]> | null = null;

  async function getHostProvidersSnapshot(
    paseo?: PaseoApi | null,
  ): Promise<HostProviderRuntimeInfo[]> {
    const api = paseo ?? latestPaseo;
    if (
      hostProvidersCache &&
      Date.now() - hostProvidersCache.fetchedAt < HOST_PROVIDERS_CACHE_TTL_MS
    ) {
      return hostProvidersCache.entries;
    }
    if (hostProvidersInFlight) {
      return hostProvidersInFlight;
    }
    if (!api?.providers?.snapshot) {
      return hostProvidersCache?.entries ?? [];
    }
    const fetchPromise = api.providers
      .snapshot()
      .then((snap) => {
        const entries = (snap?.entries ?? []).map(normalizeHostProviderEntry);
        hostProvidersCache = { entries, fetchedAt: Date.now() };
        return entries;
      })
      .catch(() => hostProvidersCache?.entries ?? [])
      .finally(() => {
        hostProvidersInFlight = null;
      });
    hostProvidersInFlight = fetchPromise;
    return fetchPromise;
  }

  function getEffectiveConfig(cwd?: string | null): EffectiveHarnessConfig {
    if (!cwd) {
      return resolveEffectiveHarnessConfig(cachedSettings);
    }
    const repoOverride = cachedSettings.enableRepoConfigOverride
      ? loadRepoHarnessOverride(cwd, cachedSettings.repoConfigRelativePath)
      : null;
    const agentTeamContext = loadWorkspaceAgentTeam(cwd, os.homedir());
    return resolveEffectiveHarnessConfig(cachedSettings, repoOverride, cwd, agentTeamContext);
  }

  async function syncDaemonProfilesIfNeeded(
    settingsValues: AgentHarnessSettings,
    expectedSeq?: number,
  ): Promise<DaemonProfileSyncStatus> {
    const seq = expectedSeq ?? ++daemonSyncSeq;
    const commitSyncState = (
      status: DaemonProfileSyncStatus,
      nextSig?: string,
    ): DaemonProfileSyncStatus => {
      if (seq !== daemonSyncSeq) {
        return { status: "skipped", reason: "superseded" };
      }
      lastDaemonProfileSyncState = {
        ...status,
        lastSyncedSignature: nextSig ?? lastDaemonProfileSyncState.lastSyncedSignature,
      };
      return status;
    };

    if (disableAutoDiskSync) {
      return commitSyncState({ status: "skipped", reason: "disableAutoDiskSync" });
    }
    if (!hasHydratedSettings && !hasSubscriptionUpdate) {
      return commitSyncState({ status: "skipped", reason: "awaiting_settings_hydration" });
    }
    if (!settingsValues.autoSyncDaemonAgentProfiles) {
      return commitSyncState({
        status: "skipped",
        reason: "autoSyncDaemonAgentProfiles_disabled",
      });
    }
    if (!latestPaseo) {
      return commitSyncState({ status: "skipped", reason: "paseo_unavailable" });
    }
    const effective = resolveEffectiveHarnessConfig(settingsValues);
    const hostProviders = await getHostProvidersSnapshot(latestPaseo);
    if (seq !== daemonSyncSeq) {
      return { status: "skipped", reason: "superseded" };
    }
    const fallbackProvider =
      hostProviders.find((p) => p.enabled && normalizeProviderName(p.provider) === "antigravity")
        ?.provider ??
      hostProviders.find((p) => p.enabled)?.provider ??
      "antigravity";
    const signature = JSON.stringify(
      settingsValues.specialists
        .filter((s) => s.enabled && s.syncToDaemonProfile)
        .map((s) => {
          const provider = normalizeProviderName(s.preferredProvider || fallbackProvider);
          return [
            s.id,
            s.name,
            s.description,
            s.preferredProvider,
            s.preferredTier,
            s.modelOverride,
            s.defaultModeId,
            s.thinkingOptionId,
            s.icon,
            s.color,
            provider,
            effective.providerMappings[provider],
            effective.providerThinkingMappings?.[provider],
          ];
        }),
    );
    if (signature === lastDaemonProfileSyncState.lastSyncedSignature) {
      return commitSyncState({ status: "idle", reason: "signature_unchanged" });
    }
    const syncResult = await syncDaemonAgentProfiles(
      latestPaseo,
      settingsValues.specialists,
      effective,
      hostProviders,
    );
    if (seq !== daemonSyncSeq) {
      return { status: "skipped", reason: "superseded" };
    }
    if (syncResult.errors.length === 0) {
      return commitSyncState(
        {
          status: "synced",
          syncedCount: syncResult.syncedCount,
          errorCount: 0,
        },
        signature,
      );
    }
    return commitSyncState({
      status: "partial",
      syncedCount: syncResult.syncedCount,
      errorCount: syncResult.errors.length,
      reason: syncResult.errors[0],
    });
  }

  function capturePaseoApi(paseo?: PaseoApi | null): void {
    if (!paseo) {
      return;
    }
    latestPaseo = paseo;
    if (!hasHydratedSettings && !hasSubscriptionUpdate) {
      const syncStatus = resolveImmediateDaemonSyncStatus(cachedSettings);
      lastDaemonProfileSyncState = {
        ...syncStatus,
        lastSyncedSignature: lastDaemonProfileSyncState.lastSyncedSignature,
      };
      recordPluginSettingsLog(syncStatus);
      return;
    }
    if (
      lastDaemonProfileSyncState.lastSyncedSignature === "" &&
      !disableAutoDiskSync &&
      cachedSettings.autoSyncDaemonAgentProfiles
    ) {
      const seq = ++daemonSyncSeq;
      const snapshotSettings = cachedSettings;
      void (async () => {
        const syncStatus = await syncDaemonProfilesIfNeeded(snapshotSettings, seq);
        if (seq === daemonSyncSeq && syncStatus.reason !== "superseded") {
          recordPluginSettingsLog(syncStatus);
        }
      })();
    }
  }

  function recordPluginSettingsLog(syncStatus: DaemonProfileSyncStatus): void {
    debugLogger.record({
      event: "plugin.settings",
      level: "info",
      detail: {
        enabled: cachedSettings.enabled,
        debugLogs: cachedSettings.debugLogs,
        disableAutoDiskSync,
        daemonProfilesSync: toDaemonProfilesSyncLogDetail(syncStatus),
      },
    });
  }

  function resolveImmediateDaemonSyncStatus(
    settingsValues: AgentHarnessSettings,
  ): DaemonProfileSyncStatus {
    if (disableAutoDiskSync) {
      return { status: "skipped", reason: "disableAutoDiskSync" };
    }
    if (!hasHydratedSettings && !hasSubscriptionUpdate) {
      return { status: "skipped", reason: "awaiting_settings_hydration" };
    }
    if (!settingsValues.autoSyncDaemonAgentProfiles) {
      return { status: "skipped", reason: "autoSyncDaemonAgentProfiles_disabled" };
    }
    if (!latestPaseo) {
      return { status: "skipped", reason: "paseo_unavailable" };
    }
    return {
      status: lastDaemonProfileSyncState.status,
      ...(lastDaemonProfileSyncState.syncedCount !== undefined
        ? { syncedCount: lastDaemonProfileSyncState.syncedCount }
        : {}),
      ...(lastDaemonProfileSyncState.errorCount !== undefined
        ? { errorCount: lastDaemonProfileSyncState.errorCount }
        : {}),
      ...(lastDaemonProfileSyncState.reason !== undefined
        ? { reason: lastDaemonProfileSyncState.reason }
        : {}),
    };
  }

  function applySettings(state: Awaited<ReturnType<typeof settings.read>>) {
    if (state.status !== "ready") {
      if (!hasHydratedSettings && !hasSubscriptionUpdate) {
        const syncStatus = resolveImmediateDaemonSyncStatus(cachedSettings);
        lastDaemonProfileSyncState = {
          ...syncStatus,
          lastSyncedSignature: lastDaemonProfileSyncState.lastSyncedSignature,
        };
        recordPluginSettingsLog(syncStatus);
      }
      return;
    }
    hasHydratedSettings = true;
    cachedSettings = { ...cachedSettings, ...state.values };
    intentRouter.clearCache();
    debugLogger.setEnabled(cachedSettings.debugLogs);
    if (!hasInitializedDebugState) {
      hasInitializedDebugState = true;
      lastRecordedDebugState = cachedSettings.debugLogs;
    } else if (lastRecordedDebugState !== cachedSettings.debugLogs) {
      debugLogger.record(
        {
          event: "debug.toggled",
          level: "info",
          detail: { enabled: cachedSettings.debugLogs, source: "settings" },
        },
        { force: true },
      );
      lastRecordedDebugState = cachedSettings.debugLogs;
    }

    if (
      !disableAutoDiskSync &&
      cachedSettings.autoSyncDiskProfiles &&
      cachedSettings.specialists?.length > 0
    ) {
      exportSpecialistsToDisk(cachedSettings.specialists, cachedSettings.profilesDir);
    }

    const shouldSyncAsync =
      !disableAutoDiskSync &&
      (hasHydratedSettings || hasSubscriptionUpdate) &&
      cachedSettings.autoSyncDaemonAgentProfiles &&
      latestPaseo !== null;
    if (shouldSyncAsync) {
      const seq = ++daemonSyncSeq;
      const snapshotSettings = cachedSettings;
      void (async () => {
        const syncStatus = await syncDaemonProfilesIfNeeded(snapshotSettings, seq);
        if (seq === daemonSyncSeq && syncStatus.reason !== "superseded") {
          recordPluginSettingsLog(syncStatus);
        }
      })();
      return;
    }

    ++daemonSyncSeq;
    const syncStatus = resolveImmediateDaemonSyncStatus(cachedSettings);
    lastDaemonProfileSyncState = {
      ...syncStatus,
      lastSyncedSignature: lastDaemonProfileSyncState.lastSyncedSignature,
    };
    recordPluginSettingsLog(syncStatus);
  }

  const unsubscribeSettings = settings.subscribe((state) => {
    if (state.status === "ready") {
      hasSubscriptionUpdate = true;
      runtimeDebugOverride = null;
    }
    applySettings(state);
  });

  async function hydrateInitialSettings() {
    try {
      const state = await settings.read();
      if (!hasSubscriptionUpdate) {
        const nextState =
          state.status === "ready" && runtimeDebugOverride !== null
            ? {
                ...state,
                values: {
                  ...state.values,
                  debugLogs: runtimeDebugOverride,
                },
              }
            : state;
        applySettings(nextState);
      }
    } catch (error) {
      debugLogger.record({
        event: "plugin.settings.error",
        level: "error",
        detail: { error: error instanceof Error ? error.message : String(error) },
      });
      console.error("[AgentHarness] Failed to read settings", error);
    }
  }
  void hydrateInitialSettings();

  // In-memory shadow metadata cache: agentId -> HarnessAgentMetadata
  const latestMetadataByAgent = new Map<string, HarnessAgentMetadata>();
  const bypassedAgentIds = new Set<string>();

  // In-flight plan permission requests: requestId -> { agentId, createdAt }
  const pendingPlanPermissions = new Map<string, { agentId: string; createdAt: number }>();

  function readLatestMetadata(agent: {
    id: string;
    metadata?: unknown;
  }): HarnessAgentMetadata | null {
    const cached = latestMetadataByAgent.get(agent.id);
    if (cached) {
      return cached;
    }
    const parsed = parseHarnessMetadata(agent.metadata);
    if (parsed) {
      latestMetadataByAgent.set(agent.id, parsed);
    }
    return parsed;
  }

  async function updateAgentMetadata(
    agentId: string,
    meta: HarnessAgentMetadata,
    handle: { setMetadata: (patch: Record<string, JsonValue>) => Promise<void> },
  ): Promise<void> {
    latestMetadataByAgent.set(agentId, meta);
    try {
      await handle.setMetadata({ [HARNESS_METADATA_KEY]: meta });
    } catch (error) {
      if (cachedSettings.debugLogs) {
        console.error(`[AgentHarness] Failed to update metadata for ${agentId}`, error);
      }
    }
  }

  interface WorkspaceContextEntry {
    prompt: string;
    labels?: Record<string, string>;
    bypassed?: boolean;
    routedModel?: string;
    timestamp: number;
  }

  interface AgentCreationContextEntry {
    prompt: string;
    labels?: Record<string, string>;
    bypassed: boolean;
    isLeaf: boolean;
    role?: DomainRole;
    title?: string;
    resolvedRole?: DomainRole;
    resolvedRoleRule?: string;
    resolvedTier?: MatrixTier;
    resolvedPhase?: HarnessPhase;
    resolvedTierRule?: string;
    timestamp: number;
  }

  // Separate workspace-level and agent-level creation contexts so sibling agent spawns never bleed labels or leaf/bypass flags.
  const pendingWorkspaceContext = new Map<string, WorkspaceContextEntry>();
  let lastWorkspaceCreationContext: WorkspaceContextEntry | null = null;
  const recentAgentContextQueue = new Map<string, AgentCreationContextEntry[]>();

  function cleanupOldPrompts() {
    const now = Date.now();
    for (const [key, val] of pendingWorkspaceContext.entries()) {
      if (now - val.timestamp > PROMPT_CACHE_TTL_MS) {
        pendingWorkspaceContext.delete(key);
      }
    }
    for (const [key, queue] of recentAgentContextQueue.entries()) {
      const fresh = queue.filter((entry) => now - entry.timestamp <= PROMPT_CACHE_TTL_MS);
      if (fresh.length === 0) {
        recentAgentContextQueue.delete(key);
      } else if (fresh.length !== queue.length) {
        recentAgentContextQueue.set(key, fresh);
      }
    }
    if (
      lastWorkspaceCreationContext &&
      now - lastWorkspaceCreationContext.timestamp > PROMPT_CACHE_TTL_MS
    ) {
      lastWorkspaceCreationContext = null;
    }
    for (const [reqId, info] of pendingPlanPermissions.entries()) {
      if (now - info.createdAt > 300_000) {
        pendingPlanPermissions.delete(reqId);
      }
    }
  }

  function rememberWorkspaceContext(
    cwd: string | undefined,
    prompt: string,
    labels?: Readonly<Record<string, string>>,
    bypassed?: boolean,
    routedModel?: string,
  ) {
    if (!cwd || (!prompt && !labels && bypassed === undefined && !routedModel)) {
      return;
    }
    const key = path.resolve(cwd);
    const existing = pendingWorkspaceContext.get(key);
    pendingWorkspaceContext.set(key, {
      prompt: prompt || existing?.prompt || "",
      labels: mergeLabels(labels, existing?.labels),
      bypassed: Boolean(bypassed),
      routedModel: routedModel ?? existing?.routedModel,
      timestamp: Date.now(),
    });
  }

  function enqueueAgentCreationContext(
    cwd: string | undefined,
    entry: Omit<AgentCreationContextEntry, "timestamp">,
  ) {
    if (!cwd) {
      return;
    }
    const key = path.resolve(cwd);
    const queue = recentAgentContextQueue.get(key) ?? [];
    queue.push({
      ...entry,
      labels: entry.labels ? { ...entry.labels } : undefined,
      timestamp: Date.now(),
    });
    recentAgentContextQueue.set(key, queue);
  }

  function consumePendingWorkspaceContext(
    cwd: string | undefined,
  ): WorkspaceContextEntry | undefined {
    if (!cwd) {
      return undefined;
    }
    const key = path.resolve(cwd);
    const entry = pendingWorkspaceContext.get(key);
    if (entry) {
      pendingWorkspaceContext.delete(key);
    }
    return entry;
  }

  function pickTextContext(title: string | null | undefined, cachedPrompt: string): string {
    const trimmedTitle = title?.trim() ?? "";
    if (cachedPrompt && (!trimmedTitle || cachedPrompt.startsWith(trimmedTitle))) {
      return cachedPrompt;
    }
    return trimmedTitle || cachedPrompt;
  }

  function consumeAgentCreationContext(contextParams: {
    cwd: string | undefined;
    labels: Readonly<Record<string, string>> | null | undefined;
    title?: string | null;
    metadata?: Record<string, unknown>;
    env?: Record<string, string>;
  }): {
    prompt: string;
    labels?: Record<string, string>;
    bypassed: boolean;
    isLeaf: boolean;
    resolvedRole?: DomainRole;
    resolvedRoleRule?: string;
    resolvedTier?: MatrixTier;
    resolvedPhase?: HarnessPhase;
    resolvedTierRule?: string;
  } {
    const normalizedRequestLabels =
      contextParams.labels && Object.keys(contextParams.labels).length > 0
        ? { ...contextParams.labels }
        : undefined;
    if (!contextParams.cwd) {
      return { prompt: "", labels: normalizedRequestLabels, bypassed: false, isLeaf: false };
    }
    const key = path.resolve(contextParams.cwd);
    const queue = recentAgentContextQueue.get(key);
    const metaObj = contextParams.metadata;
    const hasMetaKey = (k: string): boolean =>
      Boolean(metaObj && Object.prototype.hasOwnProperty.call(metaObj, k));
    const hasExplicitLeafFlag =
      hasMetaKey(HARNESS_LEAF_META_KEY) ||
      hasMetaKey(HARNESS_METADATA_KEY) ||
      hasMetaKey(HARNESS_BYPASSED_META_KEY) ||
      contextParams.labels?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      contextParams.env?.PASEO_HARNESS_LEAF === "1";
    const wantLeaf =
      Boolean(metaObj?.[HARNESS_LEAF_META_KEY]) ||
      contextParams.labels?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      contextParams.env?.PASEO_HARNESS_LEAF === "1";
    const hasExplicitBypassFlag =
      hasMetaKey(HARNESS_BYPASSED_META_KEY) || hasMetaKey(HARNESS_METADATA_KEY);
    const wantBypass = Boolean(metaObj?.[HARNESS_BYPASSED_META_KEY]);
    const wantRole = contextParams.labels?.role?.trim() || parseHarnessMetadata(metaObj)?.role;
    const wantTitle = contextParams.title?.trim();

    if (queue && queue.length > 0) {
      let bestIndex = -1;
      let bestScore = -1;
      for (let i = 0; i < queue.length; i += 1) {
        const candidate = queue[i];
        if (hasExplicitLeafFlag && candidate.isLeaf !== wantLeaf) {
          continue;
        }
        if (hasExplicitBypassFlag && candidate.bypassed !== wantBypass) {
          continue;
        }
        if (wantRole && candidate.role !== wantRole && candidate.labels?.role !== wantRole) {
          continue;
        }
        let score = 0;
        if (wantRole && (candidate.role === wantRole || candidate.labels?.role === wantRole)) {
          score += 8;
        }
        if (
          hasMetaKey(HARNESS_METADATA_KEY) &&
          candidate.isLeaf === Boolean(metaObj?.[HARNESS_LEAF_META_KEY])
        ) {
          score += 4;
        }
        if (wantTitle && candidate.title && candidate.title === wantTitle) {
          score += 2;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0) {
        const [matched] = queue.splice(bestIndex, 1);
        if (queue.length === 0) {
          recentAgentContextQueue.delete(key);
        }
        return {
          prompt: matched.prompt,
          labels: mergeLabels(normalizedRequestLabels, matched.labels),
          bypassed: Boolean(matched.bypassed),
          isLeaf: Boolean(matched.isLeaf),
          resolvedRole: matched.resolvedRole,
          resolvedRoleRule: matched.resolvedRoleRule,
          resolvedTier: matched.resolvedTier,
          resolvedPhase: matched.resolvedPhase,
          resolvedTierRule: matched.resolvedTierRule,
        };
      }
    }

    // Fallback: direct workspace.create -> agent.open without intermediate agent.create hook
    const wsCached = consumePendingWorkspaceContext(contextParams.cwd);
    if (wsCached) {
      return {
        prompt: wsCached.prompt,
        labels: mergeLabels(normalizedRequestLabels, wsCached.labels),
        bypassed: Boolean(wsCached.bypassed),
        isLeaf: false,
      };
    }

    return { prompt: "", labels: normalizedRequestLabels, bypassed: false, isLeaf: false };
  }

  function resolveSpecialistWithFallback(
    effectiveConfig: EffectiveHarnessConfig,
    role: DomainRole,
    preferred?: HarnessSpecialistConfig,
  ): HarnessSpecialistConfig | undefined {
    return (
      preferred ??
      findSpecialist(effectiveConfig, role) ??
      findSpecialist(effectiveConfig, effectiveConfig.defaultFallbackRole) ??
      effectiveConfig.specialists.find((s) => !s.readonly) ??
      effectiveConfig.specialists[0]
    );
  }

  function isAgentBypassed(
    agent: { id: string; provider?: string; metadata?: unknown },
    effectiveConfig: EffectiveHarnessConfig,
  ): boolean {
    if (isProviderBypassed(agent.provider, effectiveConfig)) {
      return true;
    }
    if (bypassedAgentIds.has(agent.id)) {
      return true;
    }
    const metaObj = agent.metadata as Record<string, unknown> | undefined;
    return Boolean(metaObj?.[HARNESS_BYPASSED_META_KEY]);
  }

  async function detectAndRecordSnapshotBypass(
    agent: { id: string; provider?: string; metadata?: unknown },
    effectiveConfig: EffectiveHarnessConfig,
    paseoApi?: PaseoApi | null,
  ): Promise<boolean> {
    if (isAgentBypassed(agent, effectiveConfig)) {
      return true;
    }

    // Check direct model field on agent snapshot (including mid-session switches)
    const directModel = extractSnapshotModel(agent);
    if (directModel && isModelBypassed(directModel, effectiveConfig.bypassModels)) {
      bypassedAgentIds.add(agent.id);
      if (paseoApi?.agents?.ref) {
        const handle = paseoApi.agents.ref(agent.id);
        if (typeof handle?.setMetadata === "function") {
          void handle.setMetadata({ [HARNESS_BYPASSED_META_KEY]: true }).catch(() => {});
        }
      }
      return true;
    }

    if (!paseoApi?.agents?.ref) {
      return false;
    }

    const meta = readLatestMetadata(agent);
    try {
      const handle = paseoApi.agents.ref(agent.id);
      let snap = handle?.current?.();
      if (!meta && !extractSnapshotModel(snap) && typeof handle?.refresh === "function") {
        const refreshed = await handle.refresh().catch(() => undefined);
        snap = refreshed?.agent ?? snap;
      }
      const snapModel = extractSnapshotModel(snap);
      const snapBypassed =
        Boolean(
          (snap?.metadata as Record<string, unknown> | undefined)?.[HARNESS_BYPASSED_META_KEY],
        ) || isModelBypassed(snapModel, effectiveConfig.bypassModels);
      if (snapBypassed) {
        bypassedAgentIds.add(agent.id);
        if (typeof handle?.setMetadata === "function") {
          void handle.setMetadata({ [HARNESS_BYPASSED_META_KEY]: true }).catch(() => {});
        }
        return true;
      }
    } catch {
      // Ignore snapshot inspection error
    }
    return false;
  }

  async function applyStandardStepDown(stepDownParams: {
    paseo: PaseoApi;
    agentId: string;
    provider: string;
    meta: HarnessAgentMetadata;
    effectiveConfig: EffectiveHarnessConfig;
    handle: ReturnType<PaseoApi["agents"]["ref"]>;
    transitionKind: "plan_approved" | "auto_downgrade";
    reasonText: string;
    turnNumber: number;
  }): Promise<{ targetModel: string; targetThinking: string | null }> {
    const normalizedProvider = normalizeProviderName(stepDownParams.provider);
    const resolvedStandard = resolveTierTarget(
      stepDownParams.effectiveConfig,
      normalizedProvider,
      "standard",
    );
    await stepDownParams.handle.setModel(resolvedStandard.model);
    await applyAgentThinkingOption(
      stepDownParams.paseo,
      stepDownParams.agentId,
      resolvedStandard.thinkingOptionId,
    );
    const recommendedModeId = resolveResumeExecutionMode(
      stepDownParams.effectiveConfig,
      stepDownParams.provider,
      stepDownParams.meta.resumeModeId,
    );
    await applyAgentModeOption(stepDownParams.paseo, stepDownParams.agentId, recommendedModeId);

    if (stepDownParams.effectiveConfig.emitTimelineTransitions) {
      await emitHarnessTimelineTransition(stepDownParams.handle, {
        transitionKind: stepDownParams.transitionKind,
        role: stepDownParams.meta.role,
        fromTier: stepDownParams.meta.currentTier,
        toTier: "standard",
        fromModel: stepDownParams.meta.currentModel,
        toModel: resolvedStandard.model,
        phase: "exec",
        reason: stepDownParams.reasonText,
        turnNumber: stepDownParams.turnNumber,
      });
    }

    return {
      targetModel: resolvedStandard.model,
      targetThinking: resolvedStandard.thinkingOptionId,
    };
  }

  async function routeAgentConfig<
    T extends {
      provider: string;
      model?: string | null;
      thinkingOptionId?: string | null;
      title?: string | null;
      systemPrompt?: string;
      modeId?: string;
      cwd?: string;
    },
  >(
    config: T,
    text: string,
    hookStage: string,
    mergedLabels?: Readonly<Record<string, string>>,
    parentAgentCheck?: boolean,
    routeOptions?: {
      isLeaf?: boolean;
      isExplicitRoleSpawn?: boolean;
      isUnattendedWorkflow?: boolean;
      treatConfigModelAsDefault?: boolean;
    },
  ): Promise<RoutedAgentConfigResult<T>> {
    const effectiveConfig = getEffectiveConfig(config.cwd);
    const isBypassed =
      isProviderBypassed(config.provider, effectiveConfig) ||
      isModelBypassed(config.model, effectiveConfig.bypassModels);

    const l0 = detectIntentDeterministic({
      text,
      labels: mergedLabels,
      modeId: config.modeId,
      homeDir: os.homedir(),
      config: effectiveConfig,
    });

    let roleDecision = l0.roleDecision;
    let specialist = resolveSpecialistWithFallback(
      effectiveConfig,
      roleDecision.role,
      roleDecision.specialistConfig,
    );

    if (isBypassed) {
      const bypassDecision: RouterDecision = {
        tier: l0.tier,
        targetProvider: config.provider,
        targetModel: config.model ?? "",
        targetThinking: null,
        phase: l0.phase,
        reason: "Session bypassed via bypassProviders or bypassModels",
        matchedRule: isProviderBypassed(config.provider, effectiveConfig)
          ? "bypass_safety_net"
          : "bypass_orchestrator_model",
        previousModel: config.model ?? undefined,
      };
      debugLogger.record({
        event: "harness.route",
        level: "info",
        role: roleDecision.role,
        phase: bypassDecision.phase,
        provider: config.provider,
        model: config.model ?? undefined,
        detail: {
          hookStage,
          bypassed: true,
          roleMatchedRule: roleDecision.matchedRule,
          tierMatchedRule: bypassDecision.matchedRule,
        },
      });
      return {
        config,
        roleDecision,
        routerDecision: bypassDecision,
        specialist,
        isBypassed: true,
      };
    }

    const treatAsDefault = Boolean(routeOptions?.treatConfigModelAsDefault);
    const isUserCustomModelLocked =
      !treatAsDefault &&
      effectiveConfig.overrideIfDefaultOnly &&
      Boolean(config.model?.trim()) &&
      !isDefaultOrUnsetModel(config.provider, config.model, undefined, effectiveConfig);

    let selectedTier = l0.tier;
    let selectedPhase = l0.phase;
    let tierMatchedRule = l0.tierMatchedRule;
    let routerMatchedSemantic = false;

    const hostProviders = await getHostProvidersSnapshot(latestPaseo);

    if (
      !l0.deterministic &&
      l0.needsSemanticRouter &&
      text.trim() &&
      effectiveConfig.routerEnabled
    ) {
      const semanticDecision = await intentRouter.route({
        prompt: text,
        cwd: config.cwd,
        config: effectiveConfig,
        hostProviders,
        activeSessionProvider: config.provider,
        lockedRole: l0.roleLocked ? l0.role : null,
      });

      if (semanticDecision) {
        routerMatchedSemantic = true;
        if (!l0.roleLocked && semanticDecision.role !== roleDecision.role) {
          const semSpec = findSpecialist(effectiveConfig, semanticDecision.role);
          if (semSpec && semSpec.id !== "orchestrator") {
            specialist = semSpec;
            roleDecision = {
              ...roleDecision,
              role: semSpec.id,
              matchedRule: semanticDecision.matchedRule,
              specialistConfig: semSpec,
            };
          }
        }
        if (!(l0.roleLocked && specialist?.lockTierOnLabel)) {
          selectedTier = semanticDecision.tier;
          selectedPhase = semanticDecision.phase;
          tierMatchedRule = semanticDecision.matchedRule;
        }
      }
    }

    const rawWorkflowPhase = mergedLabels?.[HARNESS_WORKFLOW_PHASE_LABEL_KEY]?.trim().toLowerCase();
    const explicitWorkflowPhase: HarnessPhase | undefined =
      rawWorkflowPhase === "design" || rawWorkflowPhase === "exec" || rawWorkflowPhase === "review"
        ? rawWorkflowPhase
        : undefined;
    const normRoleId = roleDecision.role?.trim().toLowerCase() ?? "";
    const isDesignRole =
      normRoleId === "pm" ||
      normRoleId.endsWith("-pm") ||
      normRoleId === "architect" ||
      normRoleId.endsWith("-architect");
    let fallbackSpecialistPhase: HarnessPhase | undefined = explicitWorkflowPhase;
    if (!fallbackSpecialistPhase) {
      if (isDesignRole) {
        fallbackSpecialistPhase = "design";
      } else if (specialist?.readonly) {
        fallbackSpecialistPhase = "review";
      }
    }

    const hasExplicitWorkflowTier = Boolean(
      routeOptions?.isUnattendedWorkflow && mergedLabels?.[HARNESS_WORKFLOW_TIER_LABEL_KEY]?.trim(),
    );
    const shouldEnforceSpecialistTier =
      !isUserCustomModelLocked &&
      (hasExplicitWorkflowTier ||
        ((l0.roleLocked || roleDecision.role === "orchestrator") &&
          (specialist?.lockTierOnLabel || (!l0.deterministic && !routerMatchedSemantic))));

    if (shouldEnforceSpecialistTier) {
      const explicitWorkflowTier = hasExplicitWorkflowTier
        ? coerceAutoRoutingTier(
            mergedLabels![HARNESS_WORKFLOW_TIER_LABEL_KEY],
            explicitWorkflowPhase,
          )
        : undefined;
      const preferredTier = normalizeTierAlias(
        explicitWorkflowTier ??
          specialist?.preferredTier ??
          resolveSpecialistTargetTier(roleDecision.role),
        fallbackSpecialistPhase,
      );
      const shouldKeepTextTier = selectedPhase === "review" && roleDecision.role === "qa";

      if (preferredTier && !shouldKeepTextTier) {
        selectedTier = preferredTier;
        selectedPhase = tierToPhase(
          preferredTier,
          roleDecision.role,
          effectiveConfig,
          fallbackSpecialistPhase,
        );
        if (tierMatchedRule !== "default_empty") {
          tierMatchedRule = `role_tier:${roleDecision.role}`;
        }
      }
    }

    const resolvedPhase = tierToPhase(
      selectedTier,
      roleDecision.role,
      effectiveConfig,
      fallbackSpecialistPhase ??
        (tierMatchedRule.startsWith("role_tier:") ? undefined : selectedPhase),
    );

    const canSwitchSessionProvider = Boolean(
      effectiveConfig.honorSpecialistPreferredProvider &&
      (routeOptions?.isExplicitRoleSpawn || l0.roleLocked) &&
      !isUserCustomModelLocked,
    );
    const isCallerModelDefault =
      treatAsDefault ||
      isDefaultOrUnsetModel(config.provider, config.model, undefined, effectiveConfig);

    const target = resolveTargetAgentAndModel({
      config: effectiveConfig,
      specialist,
      requestedProvider: config.provider,
      activeSessionProvider: config.provider,
      hostProviders,
      tier: selectedTier,
      phase: resolvedPhase,
      currentModel: isCallerModelDefault ? undefined : config.model,
      userModelLocked: isUserCustomModelLocked,
      allowProviderFallback: canSwitchSessionProvider,
      honorPreferredProvider: canSwitchSessionProvider,
    });
    const nextProvider =
      canSwitchSessionProvider && target.provider ? target.provider : config.provider;
    const providerChanged = nextProvider !== config.provider;

    const roleLockedByLabel =
      roleDecision.matchedRule.startsWith("label:") || Boolean(mergedLabels?.role);
    const explicitSpecialistThinking =
      roleLockedByLabel && specialist?.thinkingOptionId?.trim()
        ? specialist.thinkingOptionId.trim()
        : null;
    const resolvedThinking = explicitSpecialistThinking ?? target.thinkingOptionId;

    const matchedRule = target.modelLockedByUser
      ? `preserve_user_choice (${tierMatchedRule})`
      : tierMatchedRule;

    const decision: RouterDecision = {
      tier: target.tier,
      targetProvider: nextProvider,
      targetModel: target.model,
      targetThinking: resolvedThinking,
      phase: resolvedPhase,
      reason: target.modelLockedByUser
        ? `Preserving user-selected model '${target.model}' (phase: ${resolvedPhase})`
        : `Routed to ${target.tier} model '${target.model}' (phase: ${resolvedPhase})`,
      matchedRule,
      previousModel: config.model ?? undefined,
      fallbackReason: target.fallbackReason,
    };

    const hasTitle = Boolean(config.title?.trim());
    let nextTitle = config.title;
    if (!hasTitle && text) {
      nextTitle = truncateByCodePoints(text, TITLE_PREVIEW_MAX_CODE_POINTS);
    }
    const nextModel =
      decision.targetModel && decision.targetModel !== config.model
        ? decision.targetModel
        : config.model;

    const userModelLocked = target.modelLockedByUser;
    const hasParentAgent = Boolean(parentAgentCheck);

    const existingThinking =
      typeof config.thinkingOptionId === "string" && config.thinkingOptionId.trim()
        ? config.thinkingOptionId.trim()
        : undefined;
    const modelChangedByRouter = Boolean(
      decision.targetModel && decision.targetModel !== config.model && !userModelLocked,
    );
    const nextThinkingOptionId =
      decision.targetThinking &&
      (modelChangedByRouter ||
        Boolean(explicitSpecialistThinking) ||
        (!existingThinking && (!userModelLocked || decision.tier === "max")))
        ? decision.targetThinking
        : config.thinkingOptionId;

    // Enforce native plan mode if applicable (driven orthogonally by phase === "design" or readonly role)
    let nextModeId = config.modeId;
    const skipPlanModeForUnattended = Boolean(
      routeOptions?.isUnattendedWorkflow && resolvedPhase !== "review",
    );
    const mustEnforcePlanMode =
      !skipPlanModeForUnattended &&
      shouldEnforceNativePlanMode({
        phaseLifecycleEnabled: effectiveConfig.phaseLifecycleEnabled,
        enforceNativePlanMode: effectiveConfig.enforceNativePlanMode,
        tier: decision.tier,
        phase: resolvedPhase,
        role: roleDecision.role,
        userModelLocked,
        roleLockedByLabel,
        hasParentAgent,
        provider: nextProvider,
        config: effectiveConfig,
      });

    if (mustEnforcePlanMode && hookStage !== "workspace.create") {
      nextModeId = "plan";
    } else if (
      !skipPlanModeForUnattended &&
      specialist?.readonly &&
      hookStage !== "workspace.create" &&
      isNativePlanModeSupported(effectiveConfig, nextProvider)
    ) {
      nextModeId = "plan";
    } else if (providerChanged) {
      nextModeId =
        target.modeId ??
        resolveResumeExecutionMode(effectiveConfig, nextProvider, null) ??
        undefined;
    }

    // P1.2: Strip any persisted legacy harness banner cleanly and NEVER write banners into persisted config.systemPrompt.
    // Transient banners are injected via `appendSystemPrompt` in `agent.open.before`.
    const cleanedSystemPrompt = stripHarnessBannerFromSystemPrompt(config.systemPrompt);
    const systemPromptChanged = cleanedSystemPrompt !== config.systemPrompt;

    let modePatch: { modeId?: string } = {};
    if (nextModeId !== undefined) {
      modePatch = { modeId: nextModeId };
    } else if (providerChanged && config.modeId !== undefined) {
      modePatch = { modeId: undefined };
    }

    const nextConfig =
      providerChanged ||
      nextModel !== config.model ||
      nextThinkingOptionId !== config.thinkingOptionId ||
      nextTitle !== config.title ||
      nextModeId !== config.modeId ||
      systemPromptChanged
        ? {
            ...config,
            ...(providerChanged ? { provider: nextProvider } : {}),
            model: nextModel,
            ...(nextThinkingOptionId !== undefined
              ? { thinkingOptionId: nextThinkingOptionId }
              : {}),
            title: nextTitle,
            ...modePatch,
            systemPrompt: cleanedSystemPrompt,
          }
        : config;

    debugLogger.record({
      event: "harness.route",
      level: "info",
      role: roleDecision.role,
      phase: resolvedPhase,
      provider: nextProvider,
      model: nextModel ?? undefined,
      detail: {
        hookStage,
        bypassed: false,
        fromProvider: config.provider,
        toProvider: nextProvider,
        fromModel: config.model ?? null,
        toModel: nextModel ?? null,
        tier: decision.tier,
        roleMatchedRule: roleDecision.matchedRule,
        tierMatchedRule: decision.matchedRule,
        fallbackReason: decision.fallbackReason ?? null,
      },
    });

    if (cachedSettings.debugLogs && (providerChanged || nextModel !== config.model)) {
      console.log(
        `[AgentHarness] (${hookStage}) Routed agent (${nextProvider}, len=${text.length}): ` +
          `'${config.model ?? "(default)"}' -> '${nextModel}' [tier: ${decision.tier}, phase: ${resolvedPhase}, rule: ${decision.matchedRule}]`,
      );
    }

    return {
      config: nextConfig,
      roleDecision,
      routerDecision: decision,
      specialist,
      isBypassed: false,
    };
  }

  // Hook 1: workspace.create.before
  const removeWorkspaceHook = server.addHook(
    "workspace.create.before",
    async (payload, context) => {
      capturePaseoApi(context?.paseo);
      if (!cachedSettings.enabled) {
        return undefined;
      }

      cleanupOldPrompts();

      const request = payload?.request ?? payload;
      if (!request || typeof request !== "object") {
        return undefined;
      }

      const mergedLabels = mergeLabels(
        readStringLabels(request.agent?.config),
        readStringLabels(request),
      );

      if (shouldBypassSystemRequest({ request, mergedLabels })) {
        return undefined;
      }

      const prompt =
        request.firstAgentContext?.prompt?.trim() ||
        request.agent?.initialPrompt?.trim() ||
        request.title?.trim() ||
        "";

      if (!prompt && !mergedLabels) {
        return undefined;
      }

      const sourcePath =
        request.source?.kind === "directory"
          ? request.source.path
          : (request.source as { cwd?: string })?.cwd || request.agent?.config?.cwd;

      const workspaceAgent = request.agent;
      const workspaceAgentConfig = workspaceAgent?.config;
      const explicitWorkspaceBypass = Boolean(
        (workspaceAgent?.metadata as Record<string, unknown> | undefined)?.[
          HARNESS_BYPASSED_META_KEY
        ] || (request.metadata as Record<string, unknown> | undefined)?.[HARNESS_BYPASSED_META_KEY],
      );
      let workspaceBypassed = explicitWorkspaceBypass;
      let routedAgentConfig = workspaceAgentConfig;
      let routedModel: string | undefined;
      if (workspaceAgentConfig && !explicitWorkspaceBypass) {
        const parentAgentCheck = Boolean(
          (request as { parentAgentId?: string; callerAgentId?: string }).parentAgentId ||
          (request as { callerAgentId?: string }).callerAgentId ||
          mergedLabels?.["paseo.parent-agent-id"],
        );
        const result = await routeAgentConfig(
          workspaceAgentConfig,
          prompt,
          "workspace.create",
          mergedLabels,
          parentAgentCheck,
        );
        workspaceBypassed = result.isBypassed;
        routedAgentConfig = result.config;
        if (!result.isBypassed && result.config?.model) {
          routedModel = result.config.model;
        }
      }

      if (sourcePath) {
        rememberWorkspaceContext(sourcePath, prompt, mergedLabels, workspaceBypassed, routedModel);
      }
      lastWorkspaceCreationContext = {
        prompt,
        labels: mergedLabels,
        bypassed: workspaceBypassed,
        routedModel,
        timestamp: Date.now(),
      };

      if (workspaceAgent && routedAgentConfig && routedAgentConfig !== workspaceAgentConfig) {
        return {
          ...request,
          agent: {
            ...workspaceAgent,
            config: routedAgentConfig,
          },
        };
      }

      return undefined;
    },
  );

  // Hook 1b: worktree.create.before
  const removeWorktreeHook = server.addHook("worktree.create.before", async (payload) => {
    if (!cachedSettings.enabled) {
      return undefined;
    }
    cleanupOldPrompts();
    const request = payload?.request ?? payload;
    if (!request || typeof request !== "object") {
      return undefined;
    }
    const repoContext = pendingWorkspaceContext.get(path.resolve(request.repoRoot));
    const sourceContext = pendingWorkspaceContext.get(path.resolve(request.sourceCheckout));
    const pending = repoContext ?? sourceContext ?? lastWorkspaceCreationContext;
    if (pending && request.path) {
      rememberWorkspaceContext(
        request.path,
        pending.prompt,
        pending.labels,
        pending.bypassed,
        pending.routedModel,
      );
      lastWorkspaceCreationContext = null;
    }
    return undefined;
  });

  // Hook 2: agent.create.before
  const removeAgentHook = server.addHook("agent.create.before", async (payload, context) => {
    capturePaseoApi(context?.paseo);
    if (!cachedSettings.enabled) {
      return undefined;
    }

    cleanupOldPrompts();

    const request = payload?.request ?? payload;
    if (!request || typeof request !== "object" || !request.config) {
      return undefined;
    }

    const config = request.config;
    const preMergedLabels = mergeLabels(
      readStringLabels(config),
      mergeLabels(readStringLabels(request), request.labels),
    );

    // P0.1: System/internal/background non-user requests bypass BEFORE consuming workspace context
    if (
      shouldBypassSystemRequest({
        request,
        mergedLabels: preMergedLabels,
      })
    ) {
      return {
        ...request,
        metadata: {
          ...request.metadata,
          [HARNESS_BYPASSED_META_KEY]: true,
        },
      };
    }

    const effectiveConfig = getEffectiveConfig(config.cwd);

    const initialPrompt = request.initialPrompt?.trim() ?? "";
    const explicitTitle = config.title?.trim() ?? "";
    const workspaceContext = consumePendingWorkspaceContext(config.cwd);
    const promptOrTitle =
      initialPrompt || pickTextContext(config.title, workspaceContext?.prompt ?? "");
    const mergedLabels = mergeLabels(preMergedLabels, workspaceContext?.labels);

    const hasParentAgent = Boolean(
      (request as { parentAgentId?: string; parent?: string }).parentAgentId ||
      (request as { parent?: string }).parent ||
      mergedLabels?.["paseo.parent-agent-id"],
    );
    const isLeaf = mergedLabels?.[HARNESS_LEAF_LABEL_KEY] === "1";
    const isExplicitRoleSpawn = Boolean(mergedLabels?.role || mergedLabels?.profile);
    const isUnattendedWorkflow = mergedLabels?.[HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY] === "1";
    const explicitRequestBypass = Boolean(
      (request.metadata as Record<string, unknown> | undefined)?.[HARNESS_BYPASSED_META_KEY] ||
      workspaceContext?.bypassed,
    );

    if (explicitRequestBypass) {
      if (config.cwd) {
        enqueueAgentCreationContext(config.cwd, {
          prompt: promptOrTitle || explicitTitle,
          labels: mergedLabels,
          bypassed: true,
          isLeaf,
          title: explicitTitle || undefined,
        });
      }
      return {
        ...request,
        metadata: {
          ...request.metadata,
          [HARNESS_BYPASSED_META_KEY]: true,
          ...(isLeaf ? { [HARNESS_LEAF_META_KEY]: true } : {}),
        },
      };
    }

    const treatConfigModelAsDefault = Boolean(
      workspaceContext?.routedModel && config.model === workspaceContext.routedModel,
    );

    const {
      config: nextConfig,
      roleDecision,
      routerDecision,
      isBypassed,
    } = await routeAgentConfig(
      config,
      promptOrTitle,
      "agent.create",
      mergedLabels,
      hasParentAgent,
      {
        isLeaf,
        isExplicitRoleSpawn,
        isUnattendedWorkflow,
        treatConfigModelAsDefault,
      },
    );

    if (config.cwd) {
      enqueueAgentCreationContext(config.cwd, {
        prompt: promptOrTitle || explicitTitle,
        labels: mergedLabels,
        bypassed: isBypassed,
        isLeaf,
        role: roleDecision.role,
        title: explicitTitle || undefined,
        resolvedRole: roleDecision.role,
        resolvedRoleRule: roleDecision.matchedRule,
        resolvedTier: routerDecision.tier,
        resolvedPhase: routerDecision.phase,
        resolvedTierRule: routerDecision.matchedRule,
      });
    }

    if (isBypassed) {
      return {
        ...request,
        config: nextConfig,
        metadata: {
          ...request.metadata,
          [HARNESS_BYPASSED_META_KEY]: true,
          ...(isLeaf ? { [HARNESS_LEAF_META_KEY]: true } : {}),
        },
      };
    }

    if (cachedSettings.phaseLifecycleEnabled) {
      const userModelLocked = routerDecision.matchedRule.startsWith("preserve_user_choice");
      const roleLockedByLabel =
        roleDecision.matchedRule.startsWith("label:") ||
        Boolean(mergedLabels?.role) ||
        isUnattendedWorkflow;

      const modeSource =
        nextConfig.provider !== config.provider ? nextConfig.modeId : config.modeId;
      const resumeModeId = modeSource && modeSource !== "plan" ? modeSource : null;

      const initialMetadata = createInitialHarnessMetadata({
        role: roleDecision.role,
        tier: routerDecision.tier,
        phase: routerDecision.phase,
        model: nextConfig.model ?? config.model ?? null,
        thinkingOptionId: nextConfig.thinkingOptionId ?? routerDecision.targetThinking ?? null,
        roleMatchedRule: roleDecision.matchedRule,
        tierMatchedRule: routerDecision.matchedRule,
        userModelLocked,
        roleLockedByLabel,
        resumeModeId,
        config: effectiveConfig,
      });

      return {
        ...request,
        config: nextConfig,
        metadata: {
          ...request.metadata,
          [HARNESS_METADATA_KEY]: initialMetadata,
          ...(isLeaf ? { [HARNESS_LEAF_META_KEY]: true } : {}),
        },
      };
    }

    if (nextConfig !== config || isLeaf) {
      return {
        ...request,
        config: nextConfig,
        ...(isLeaf
          ? {
              metadata: {
                ...request.metadata,
                [HARNESS_LEAF_META_KEY]: true,
              },
            }
          : {}),
      };
    }

    return request;
  });

  // Hook 2b: agent.create.after — Emits initial_route timeline transition event
  const removeAgentCreateAfterHook = server.addHook(
    "agent.create.after",
    async (payload, context) => {
      capturePaseoApi(context?.paseo);
      if (
        !cachedSettings.enabled ||
        !cachedSettings.phaseLifecycleEnabled ||
        !cachedSettings.emitTimelineTransitions
      ) {
        return;
      }
      const agent = payload?.agent ?? payload;
      if (!agent) return;
      if ((agent.metadata as Record<string, unknown> | undefined)?.[HARNESS_BYPASSED_META_KEY]) {
        bypassedAgentIds.add(agent.id);
        return;
      }

      const meta = parseHarnessMetadata(agent.metadata);
      if (!meta) {
        return;
      }
      latestMetadataByAgent.set(agent.id, meta);

      debugLogger.record({
        event: "agent.create.after",
        level: "info",
        agentId: agent.id,
        role: meta.role,
        phase: meta.phase,
        provider: agent.provider,
        model: meta.currentModel ?? undefined,
        detail: {
          tier: meta.currentTier,
          roleMatchedRule: meta.roleMatchedRule,
          tierMatchedRule: meta.tierMatchedRule,
          isLeaf: Boolean(
            (agent.metadata as Record<string, unknown> | undefined)?.[HARNESS_LEAF_META_KEY],
          ),
        },
      });

      if (context?.paseo?.agents) {
        if (meta.currentTier !== "standard" || meta.currentModel) {
          try {
            const handle = context.paseo.agents.ref(agent.id);
            await emitHarnessTimelineTransition(handle, {
              transitionKind: "initial_route",
              role: meta.role,
              fromTier: null,
              toTier: meta.currentTier,
              fromModel: null,
              toModel: meta.currentModel,
              phase: meta.phase,
              reason: `Initial route to ${meta.currentTier} (rule: ${meta.tierMatchedRule})`,
              turnNumber: 0,
            });
          } catch {
            // Ignore timeline append failures on creation
          }
        }

        const parentAgentId =
          (typeof (agent as { parentAgentId?: unknown }).parentAgentId === "string" &&
            (agent as { parentAgentId: string }).parentAgentId.trim()) ||
          readStringLabels(agent)?.["paseo.parent-agent-id"]?.trim() ||
          "";
        const isLeafChild = Boolean(
          (agent.metadata as Record<string, unknown> | undefined)?.[HARNESS_LEAF_META_KEY],
        );

        if (
          parentAgentId &&
          (isLeafChild || meta.roleLockedByLabel) &&
          !isSdkHandoffInFlight(parentAgentId) &&
          !consumeSdkEmittedHandoffChild(agent.id)
        ) {
          try {
            const parentHandle = context.paseo.agents.ref(parentAgentId);
            const parentMeta =
              readLatestMetadata({ id: parentAgentId }) ??
              parseHarnessMetadata(parentHandle?.current?.()?.metadata);
            await emitHarnessTimelineTransition(parentHandle, {
              transitionKind: "specialist_handoff",
              role: meta.role,
              fromTier: parentMeta?.currentTier ?? null,
              toTier: meta.currentTier,
              fromModel: parentMeta?.currentModel ?? null,
              toModel: meta.currentModel,
              phase: meta.phase,
              reason: "specialist_handoff",
              turnNumber: parentMeta?.turnCount ?? 0,
              childAgentId: agent.id,
              childAgentTitle: agent.title ?? null,
            });
            debugLogger.record({
              event: "handoff.spawn",
              level: "info",
              agentId: parentAgentId,
              role: meta.role,
              phase: meta.phase,
              provider: agent.provider,
              model: meta.currentModel ?? undefined,
              detail: {
                source: "agent.create.after",
                childAgentId: agent.id,
                toTier: meta.currentTier,
                childAgentTitle: agent.title ?? null,
              },
            });
          } catch {
            // Ignore parent timeline append failures on creation
          }
        }
      }
    },
  );

  const lastOpenInjectSignatureByAgent = new Map<string, string>();

  // Hook 3: agent.open.before
  const removeOpenHook = server.addHook("agent.open.before", async (payload, context) => {
    capturePaseoApi(context?.paseo);
    if (!cachedSettings.enabled) {
      return undefined;
    }

    cleanupOldPrompts();
    const request = payload?.request ?? payload;
    if (!request || typeof request !== "object") {
      return undefined;
    }

    // P0.1: Non-interactive (history replay) and internal/background non-user sessions bypass BEFORE consuming contexts
    if (request.purpose !== undefined && request.purpose !== "interactive") {
      return request;
    }
    const preOpenLabels = mergeLabels(readStringLabels(request), readStringLabels(request.env));
    if (
      shouldBypassSystemRequest({
        request,
        mergedLabels: preOpenLabels,
      })
    ) {
      bypassedAgentIds.add(request.agentId);
      return request;
    }

    const normalizedProvider = normalizeProviderName(request.provider);
    const effectiveConfig = getEffectiveConfig(request.cwd);

    const existingMeta =
      latestMetadataByAgent.get(request.agentId) ?? parseHarnessMetadata(request.metadata);
    if (existingMeta) {
      latestMetadataByAgent.set(request.agentId, existingMeta);
    }

    const metaObj = request.metadata as Record<string, unknown> | undefined;
    const hasOwnHarnessMeta = Boolean(metaObj?.[HARNESS_METADATA_KEY]);
    const hasOwnLeafMeta = Boolean(metaObj?.[HARNESS_LEAF_META_KEY]);
    const hasBypassMeta = Boolean(metaObj?.[HARNESS_BYPASSED_META_KEY]);

    if (
      isProviderBypassed(request.provider, effectiveConfig) ||
      hasBypassMeta ||
      bypassedAgentIds.has(request.agentId)
    ) {
      bypassedAgentIds.add(request.agentId);
      return request;
    }

    const paseoApi = context?.paseo ?? latestPaseo;
    const isExistingSession = Boolean(request.reason && request.reason !== "create");

    // Check live model bypass EVEN when existingMeta is present (P0.2 mid-session switch)
    let snapModel: string | null = existingMeta?.currentModel ?? null;
    if (paseoApi?.agents?.ref) {
      try {
        const handle = paseoApi.agents.ref(request.agentId);
        let snap = handle?.current?.();
        if (!existingMeta && !extractSnapshotModel(snap) && typeof handle?.refresh === "function") {
          const refreshed = await handle.refresh().catch(() => undefined);
          snap = refreshed?.agent ?? snap;
        }
        const liveModel = extractSnapshotModel(snap);
        if (liveModel) {
          snapModel = liveModel;
        }
        const snapBypassed =
          Boolean(
            (snap?.metadata as Record<string, unknown> | undefined)?.[HARNESS_BYPASSED_META_KEY],
          ) || isModelBypassed(snapModel, effectiveConfig.bypassModels);
        if (snapBypassed) {
          bypassedAgentIds.add(request.agentId);
          if (typeof handle?.setMetadata === "function") {
            void handle.setMetadata({ [HARNESS_BYPASSED_META_KEY]: true }).catch(() => {});
          }
          return request;
        }
      } catch {
        // Ignore snapshot lookup failures
      }
    }

    const consumedContext = isExistingSession
      ? {
          prompt: "",
          labels:
            request.labels && Object.keys(request.labels).length > 0
              ? { ...request.labels }
              : undefined,
          bypassed: false,
          isLeaf: false,
          resolvedRole: undefined,
          resolvedRoleRule: undefined,
          resolvedTier: undefined,
          resolvedPhase: undefined,
          resolvedTierRule: undefined,
        }
      : consumeAgentCreationContext({
          cwd: request.cwd,
          labels: request.labels,
          title: request.title,
          metadata: metaObj,
          env: request.env,
        });
    const textContext = pickTextContext(request.title, consumedContext.prompt);
    const labelsContext = consumedContext.labels;
    const isLeaf =
      hasOwnLeafMeta ||
      labelsContext?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      request.labels?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      request.env?.PASEO_HARNESS_LEAF === "1" ||
      (!hasOwnHarnessMeta && consumedContext.isLeaf);
    const isUnattendedWorkflow =
      labelsContext?.[HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY] === "1" ||
      request.labels?.[HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY] === "1";

    if (!hasOwnHarnessMeta && consumedContext.bypassed) {
      bypassedAgentIds.add(request.agentId);
      return request;
    }

    if (
      !existingMeta &&
      isExistingSession &&
      normalizedProvider === "antigravity" &&
      !labelsContext?.role &&
      !request.labels?.role &&
      !snapModel
    ) {
      bypassedAgentIds.add(request.agentId);
      return request;
    }

    const hostProviders = await getHostProvidersSnapshot(paseoApi);

    let roleDecision: DomainRoleDecision;
    let activeTier: MatrixTier = existingMeta?.currentTier ?? "standard";
    let activePhase: HarnessPhase | undefined = existingMeta?.phase;
    let activeTierRule: string | undefined = existingMeta?.tierMatchedRule;
    let activeModel: string = existingMeta?.currentModel ?? snapModel ?? "";
    let activeThinking: string | null = existingMeta?.currentThinking ?? null;

    if (existingMeta) {
      roleDecision = {
        role: existingMeta.role,
        matchedRule: existingMeta.roleMatchedRule,
        profilePath: "",
        lazyToolConfigPath: "",
        specialistConfig: findSpecialist(effectiveConfig, existingMeta.role),
      };
    } else if (consumedContext.resolvedRole) {
      roleDecision = {
        role: consumedContext.resolvedRole,
        matchedRule:
          consumedContext.resolvedRoleRule ?? `create_context:${consumedContext.resolvedRole}`,
        profilePath: "",
        lazyToolConfigPath: "",
        specialistConfig: findSpecialist(effectiveConfig, consumedContext.resolvedRole),
      };
      activeTier = consumedContext.resolvedTier ?? activeTier;
      activePhase = consumedContext.resolvedPhase ?? activePhase;
      activeTierRule = consumedContext.resolvedTierRule ?? activeTierRule;
    } else {
      const l0 = detectIntentDeterministic({
        text: textContext,
        labels: labelsContext,
        homeDir: os.homedir(),
        config: effectiveConfig,
      });
      roleDecision = l0.roleDecision;
      activeTier = l0.tier;
      activePhase = l0.phase;
      activeTierRule = l0.tierMatchedRule;

      if (
        !l0.deterministic &&
        l0.needsSemanticRouter &&
        textContext.trim() &&
        effectiveConfig.routerEnabled
      ) {
        const sem = await intentRouter.route({
          prompt: textContext,
          cwd: request.cwd,
          config: effectiveConfig,
          hostProviders,
          activeSessionProvider: request.provider,
          lockedRole: l0.roleLocked ? l0.role : null,
        });
        if (sem) {
          if (!l0.roleLocked && sem.role !== roleDecision.role) {
            const semSpec = findSpecialist(effectiveConfig, sem.role);
            if (semSpec && semSpec.id !== "orchestrator") {
              roleDecision = {
                ...roleDecision,
                role: semSpec.id,
                matchedRule: sem.matchedRule,
                specialistConfig: semSpec,
              };
            }
          }
          if (!(l0.roleLocked && roleDecision.specialistConfig?.lockTierOnLabel)) {
            activeTier = sem.tier;
            activePhase = sem.phase;
            activeTierRule = sem.matchedRule;
          }
        }
      }
    }

    const specialist = resolveSpecialistWithFallback(
      effectiveConfig,
      roleDecision.role,
      roleDecision.specialistConfig,
    );

    if (!activeModel) {
      const resolvedTarget = resolveTargetAgentAndModel({
        config: effectiveConfig,
        specialist,
        requestedProvider: request.provider,
        activeSessionProvider: request.provider,
        hostProviders,
        tier: activeTier,
        phase: activePhase,
        allowProviderFallback: false,
        honorPreferredProvider: false,
      });
      activeModel = resolvedTarget.model;
      activeThinking = resolvedTarget.thinkingOptionId;
    }

    const isFederatedLocalSession = isFederatedLocalProvider(effectiveConfig, request.provider);

    const nextEnv = resolveHarnessEnv({
      role: roleDecision.role,
      existingEnv: request.env ?? {},
      homeDir: os.homedir(),
      config: effectiveConfig,
      provider: request.provider,
      isLeaf,
    });

    // Non-destructive additive MCP catalog resolution only
    let nextMcpServers = request.mcpServers;
    if (specialist && !isFederatedLocalSession && specialist.injectedMcpServers.length > 0) {
      nextMcpServers = resolveSessionMcpServers({
        config: effectiveConfig,
        specialist,
        existingMcpServers: request.mcpServers,
      });
    }

    let nextTools: AgentToolDefinition[] = request.tools;
    let injectedHandoffTool = false;
    if (isLeaf || normalizedProvider === "antigravity") {
      if (Array.isArray(request.tools)) {
        nextTools = request.tools.filter((t) => t?.name !== "harness_handoff");
      }
    } else if (request.purpose === "interactive") {
      const hasTool = request.tools?.some((t) => t.name === "harness_handoff");
      if (!hasTool) {
        const handoffTool = createHarnessHandoffTool({
          cwd: request.cwd,
          getConfig: (cwd) => getEffectiveConfig(cwd ?? request.cwd),
          getHostProviders: (p) => getHostProvidersSnapshot(p),
          getLatestMetadata: (id) => latestMetadataByAgent.get(id) ?? null,
          shouldEmitTimeline: () => effectiveConfig.emitTimelineTransitions,
          onHandoffLog: (entry) => debugLogger.record(entry),
        });
        nextTools = [...(request.tools ?? []), handoffTool];
        injectedHandoffTool = true;
      }
    }

    const hasHandoffToolHint =
      !isLeaf &&
      (injectedHandoffTool ||
        normalizedProvider === "antigravity" ||
        Boolean(nextTools?.some((t) => t?.name === "harness_handoff")));

    // P1.2: Inject concise transient capability banner into `appendSystemPrompt` (never persisted config.systemPrompt)
    let nextAppendSystemPrompt = request.appendSystemPrompt;
    if (specialist && effectiveConfig.injectSystemPromptBanner) {
      const existingAppend = Array.isArray(request.appendSystemPrompt)
        ? request.appendSystemPrompt
        : [];
      const alreadyHasBanner = existingAppend.some(
        (item) =>
          typeof item === "string" &&
          (item.includes("[Capability Harness Active Profile]") ||
            item.includes("[Agent Harness — Federation Bridge]")),
      );
      if (!alreadyHasBanner) {
        const harnessBanner = buildSystemPromptBanner({
          config: effectiveConfig,
          specialist,
          tier: activeTier,
          targetModel: activeModel || "default",
          phase: activePhase,
          thinkingOptionId: activeThinking,
          roleMatchedRule: roleDecision.matchedRule,
          tierMatchedRule: activeTierRule,
          homeDir: os.homedir(),
          provider: request.provider,
          isLeaf,
          isSpawnedSpecialist: Boolean(
            isLeaf ||
            labelsContext?.role ||
            labelsContext?.profile ||
            request.labels?.role ||
            request.labels?.profile,
          ),
          isUnattendedWorkflow,
          includeHandoffToolHint: hasHandoffToolHint,
        });
        if (harnessBanner) {
          nextAppendSystemPrompt = [...existingAppend, harnessBanner];
        }
      }
    }

    const inputMcpKeys =
      request.mcpServers &&
      typeof request.mcpServers === "object" &&
      !Array.isArray(request.mcpServers)
        ? Object.keys(request.mcpServers)
        : [];
    const outputMcpKeys =
      nextMcpServers && typeof nextMcpServers === "object" && !Array.isArray(nextMcpServers)
        ? Object.keys(nextMcpServers)
        : [];
    const hasLazyToolConfig = Boolean(nextEnv.LAZY_TOOL_CONFIG);
    const relyingOnLazyToolIsolation =
      inputMcpKeys.length === 0 && outputMcpKeys.length === 0 && hasLazyToolConfig;
    let isolationMode = "lazy_tool_config_and_existing_mcp";
    if (inputMcpKeys.length === 0) {
      isolationMode = hasLazyToolConfig ? "lazy_tool_config_only" : "none";
    } else if (isFederatedLocalSession) {
      isolationMode = "federated_local_passthrough";
    }

    const injectSignature = JSON.stringify([
      roleDecision.role,
      activeTier,
      activeModel,
      nextEnv.LAZY_TOOL_CONFIG ?? null,
      injectedHandoffTool,
      hasHandoffToolHint,
      outputMcpKeys,
    ]);
    const prevSignature = lastOpenInjectSignatureByAgent.get(request.agentId);
    const shouldEmitInjectLog =
      !isExistingSession || prevSignature === undefined || prevSignature !== injectSignature;
    lastOpenInjectSignatureByAgent.set(request.agentId, injectSignature);

    if (shouldEmitInjectLog) {
      debugLogger.record({
        event: "env.inject",
        level: "info",
        agentId: request.agentId,
        role: roleDecision.role,
        phase: activePhase,
        provider: request.provider,
        model: activeModel || undefined,
        detail: {
          reason: request.reason,
          purpose: request.purpose,
          roleMatchedRule: roleDecision.matchedRule,
          lazyToolConfig: nextEnv.LAZY_TOOL_CONFIG ?? null,
          inputMcpCount: inputMcpKeys.length,
          outputMcpCount: outputMcpKeys.length,
          relyingOnLazyToolIsolation,
          isolationMode,
          injectedHandoffTool,
          bannerViaAppendSystemPrompt: Boolean(nextAppendSystemPrompt?.length),
        },
      });
    }

    if (effectiveConfig.debugLogs) {
      console.log(
        `[AgentHarness] (agent.open) Mounted Capability Harness for ${request.agentId} (${request.provider}): ` +
          `role='${roleDecision.role}' [rule: ${roleDecision.matchedRule}]`,
      );
    }

    return {
      ...request,
      env: nextEnv,
      tools: nextTools,
      mcpServers: nextMcpServers,
      ...(nextAppendSystemPrompt !== undefined
        ? { appendSystemPrompt: nextAppendSystemPrompt }
        : {}),
    };
  });

  // Hook 3b: agent.permission.before & agent.permission.after
  const removePermissionBeforeHook = server.addHook(
    "agent.permission.before",
    async (payload, context) => {
      capturePaseoApi(context?.paseo);
      if (!cachedSettings.enabled || !cachedSettings.phaseLifecycleEnabled) {
        return;
      }
      const agent = payload?.agent ?? payload;
      const request = payload?.request ?? payload;
      if (!agent || !request) return;
      if (
        await detectAndRecordSnapshotBypass(
          agent,
          getEffectiveConfig(agent.cwd),
          context?.paseo ?? latestPaseo,
        )
      ) {
        return;
      }

      if (request.kind === "plan" || request.name === "ExitPlanMode") {
        pendingPlanPermissions.set(request.id, {
          agentId: agent.id,
          createdAt: Date.now(),
        });
      }

      const meta = readLatestMetadata(agent);
      const isPlanOrDesign =
        meta?.phase === "design" ||
        meta?.phase === "review" ||
        meta?.currentTier === "plan" ||
        meta?.currentTier === "review";
      if (isPlanOrDesign) {
        let rawCommand: string | null = null;
        if (typeof request.input?.command === "string") {
          rawCommand = request.input.command;
        } else if (typeof request.input?.cmd === "string") {
          rawCommand = request.input.cmd;
        }

        if (rawCommand && isReadOnlyShellCommand(rawCommand) && context?.paseo?.agents) {
          try {
            const handle = context.paseo.agents.ref(agent.id);
            await handle.respondToPermission({
              requestId: request.id,
              response: { behavior: "allow" },
            });
            debugLogger.record({
              event: "permission.allow",
              level: "info",
              agentId: agent.id,
              role: meta?.role,
              phase: meta?.phase,
              provider: agent.provider,
              detail: {
                requestId: request.id,
                kind: request.kind,
                toolName: request.name,
                command: rawCommand,
                reason: "readonly_shell_in_plan_mode",
              },
            });
            if (cachedSettings.debugLogs) {
              console.log(
                `[AgentHarness] (permission.before) Auto-approved read-only shell in plan mode: "${rawCommand}" for agent ${agent.id}`,
              );
            }
          } catch (error) {
            debugLogger.record({
              event: "permission.block",
              level: "error",
              agentId: agent.id,
              role: meta?.role,
              phase: meta?.phase,
              provider: agent.provider,
              detail: {
                requestId: request.id,
                kind: request.kind,
                toolName: request.name,
                command: rawCommand,
                reason: "auto_approve_failed",
                error: error instanceof Error ? error.message : String(error),
              },
            });
            if (cachedSettings.debugLogs) {
              console.error(
                `[AgentHarness] (permission.before) Failed to auto-approve read-only shell: "${rawCommand}"`,
                error,
              );
            }
          }
        } else {
          debugLogger.record({
            event: "permission.block",
            level: "warn",
            agentId: agent.id,
            role: meta?.role,
            phase: meta?.phase,
            provider: agent.provider,
            detail: {
              requestId: request.id,
              kind: request.kind,
              toolName: request.name,
              command: rawCommand ?? undefined,
              reason: rawCommand
                ? "non_readonly_command_requires_approval"
                : "permission_requires_user_approval",
            },
          });
        }
      }
    },
  );

  const removePermissionAfterHook = server.addHook(
    "agent.permission.after",
    async (payload, context) => {
      capturePaseoApi(context?.paseo);
      if (!cachedSettings.enabled || !cachedSettings.phaseLifecycleEnabled) {
        return;
      }
      const agent = payload?.agent ?? payload;
      const requestId = payload?.requestId;
      const resolution = payload?.resolution;
      if (!agent || !requestId || !resolution) return;
      if (
        await detectAndRecordSnapshotBypass(
          agent,
          getEffectiveConfig(agent.cwd),
          context?.paseo ?? latestPaseo,
        )
      ) {
        return;
      }

      const pending = pendingPlanPermissions.get(requestId);
      if (!pending) {
        return;
      }
      pendingPlanPermissions.delete(requestId);

      if (resolution.behavior === "allow") {
        const meta = readLatestMetadata(agent);
        const effectiveConfig = meta ? getEffectiveConfig(agent.cwd) : undefined;
        const specialist =
          meta && effectiveConfig ? findSpecialist(effectiveConfig, meta.role) : undefined;
        if (
          meta &&
          effectiveConfig &&
          (meta.phase === "design" || meta.currentTier === "plan") &&
          !meta.userModelLocked &&
          !specialist?.readonly &&
          context.paseo?.agents
        ) {
          const handle = context.paseo.agents.ref(agent.id);

          try {
            const { targetModel: standardModel, targetThinking: standardThinking } =
              await applyStandardStepDown({
                paseo: context.paseo,
                agentId: agent.id,
                provider: agent.provider,
                meta,
                effectiveConfig,
                handle,
                transitionKind: "plan_approved",
                reasonText:
                  "Plan mode approved by user (ExitPlanMode) -> stepped down to standard tier",
                turnNumber: meta.turnCount,
              });

            const nextMeta: HarnessAgentMetadata = {
              ...meta,
              lastBilledTier: meta.lastBilledTier ?? meta.currentTier,
              lastBilledModel: meta.lastBilledModel ?? meta.currentModel,
              lastBilledThinking: meta.lastBilledThinking ?? meta.currentThinking ?? null,
              currentTier: "standard",
              currentModel: standardModel,
              currentThinking: standardThinking,
              phase: "exec",
              autoDowngradedAtTurn: Math.max(1, meta.turnCount),
              downgradeReason: "plan_approved",
            };

            await updateAgentMetadata(agent.id, nextMeta, handle);
          } catch (error) {
            if (cachedSettings.debugLogs) {
              console.error(
                "[AgentHarness] (permission.after) Failed to switch model on plan approval",
                error,
              );
            }
          }
        }
      }
    },
  );

  const switchedFirstTurnAgents = new Set<string>();

  async function resolveRuntimeSnapshot(
    agent: { id: string },
    handle: ReturnType<PaseoApi["agents"]["ref"]> | undefined,
  ): Promise<unknown> {
    if (extractSnapshotModel(agent)) {
      return agent;
    }
    let snap = handle?.current?.();
    if (!extractSnapshotModel(snap) && typeof handle?.refresh === "function") {
      const refreshed = await handle.refresh().catch(() => undefined);
      snap = refreshed?.agent ?? snap;
    }
    return snap ?? agent;
  }

  // Hook 4: agent.turn.before
  const removeTurnHook = server.addHook("agent.turn.before", async (payload, context) => {
    capturePaseoApi(context?.paseo);
    const agent = payload?.agent ?? payload;
    if (!agent) return;

    const effectiveConfig = getEffectiveConfig(agent.cwd);

    if (
      !effectiveConfig.enabled ||
      !context.paseo?.agents ||
      (await detectAndRecordSnapshotBypass(agent, effectiveConfig, context.paseo))
    ) {
      return;
    }

    let meta = readLatestMetadata(agent);
    let runtimeModelFromSnap: string | null = extractSnapshotModel(agent);
    if (meta) {
      const handle = context.paseo.agents.ref(agent.id);
      const runtimeSnap = await resolveRuntimeSnapshot(agent, handle);
      runtimeModelFromSnap = extractSnapshotModel(runtimeSnap) ?? runtimeModelFromSnap;
      const reconciled = reconcileRuntimeHarnessMetadata({
        meta,
        snapshot: runtimeSnap,
        provider: agent.provider,
        config: effectiveConfig,
      });
      if (reconciled.bypassed) {
        bypassedAgentIds.add(agent.id);
        if (typeof handle?.setMetadata === "function") {
          void handle.setMetadata({ [HARNESS_BYPASSED_META_KEY]: true }).catch(() => {});
        }
        return;
      }
      if (reconciled.changed) {
        meta = reconciled.meta;
        if (meta.tierMatchedRule === "runtime_sync:external_model_change") {
          switchedFirstTurnAgents.add(agent.id);
        }
        await updateAgentMetadata(agent.id, meta, handle);
        debugLogger.record({
          event: "turn.transition",
          level: "info",
          agentId: agent.id,
          role: meta.role,
          phase: meta.phase,
          provider: agent.provider,
          model: meta.currentModel ?? undefined,
          detail: {
            hook: "agent.turn.before",
            kind: "runtime_reconcile",
            toTier: meta.currentTier,
            matchedRule: meta.tierMatchedRule,
            turnCount: meta.turnCount,
          },
        });
      }
    }
    const specialist = meta ? findSpecialist(effectiveConfig, meta.role) : undefined;
    const isRoleLocked = Boolean(
      specialist?.readonly ||
      (specialist?.lockTierOnLabel ?? (meta?.role === "pm" || meta?.role === "architect")),
    );

    // Pre-turn proactive step-down on short affirmative confirmation while in design phase
    if (
      meta &&
      meta.phase === "design" &&
      meta.planTurnCount >= 1 &&
      effectiveConfig.autoDowngradePlanOnExec &&
      meta.autoDowngradedAtTurn === null &&
      !specialist?.readonly &&
      !meta.userModelLocked &&
      !(meta.roleLockedByLabel && isRoleLocked)
    ) {
      const handle = context.paseo.agents.ref(agent.id);
      try {
        const rawTimeline = await handle.timeline.refetch({ direction: "tail", limit: 8 });
        const timelineItems = extractTimelineItems(rawTimeline);
        const { latestUserText, handoffInvoked } = inspectTurnTimeline(
          timelineItems,
          effectiveConfig.docWhitelistPattern,
        );

        const hasAffirmative =
          !handoffInvoked &&
          (hasExplicitExecTransitionIntent(latestUserText) ||
            hasShortAffirmativeExecConfirmation(
              latestUserText,
              meta.planTurnCount,
              effectiveConfig.affirmativeConfirmWords,
            ));

        if (hasAffirmative) {
          const { targetModel: standardModel, targetThinking: standardThinking } =
            await applyStandardStepDown({
              paseo: context.paseo,
              agentId: agent.id,
              provider: agent.provider,
              meta,
              effectiveConfig,
              handle,
              transitionKind: "auto_downgrade",
              reasonText: `Pre-turn step-down on affirmative execution confirmation: '${latestUserText}'`,
              turnNumber: meta.turnCount,
            });

          const nextMeta: HarnessAgentMetadata = {
            ...meta,
            lastBilledTier: meta.currentTier,
            lastBilledModel: meta.currentModel,
            lastBilledThinking: meta.currentThinking ?? null,
            currentTier: "standard",
            currentModel: standardModel,
            currentThinking: standardThinking,
            phase: "exec",
            autoDowngradedAtTurn: meta.turnCount + 1,
            downgradeReason: "explicit_exec_intent",
          };

          await updateAgentMetadata(agent.id, nextMeta, handle);
          debugLogger.record({
            event: "turn.transition",
            level: "info",
            agentId: agent.id,
            role: nextMeta.role,
            phase: nextMeta.phase,
            provider: agent.provider,
            model: standardModel,
            detail: {
              hook: "agent.turn.before",
              kind: "pre_turn_step_down",
              fromTier: meta.currentTier,
              toTier: "standard",
              fromModel: meta.currentModel,
              toModel: standardModel,
              downgradeReason: nextMeta.downgradeReason,
              turnCount: nextMeta.turnCount,
            },
          });
          return;
        }
      } catch {
        // Ignore pre-turn timeline inspection failures
      }
    }

    // P1.1: Dynamic first-turn model routing ONLY when session started empty (`default_empty`),
    // on Turn 0, unlocked, and non-orchestrator.
    if (!switchedFirstTurnAgents.has(agent.id)) {
      switchedFirstTurnAgents.add(agent.id);
      if (
        !meta ||
        meta.turnCount > 0 ||
        meta.tierMatchedRule !== "default_empty" ||
        specialist?.lockTierOnLabel ||
        meta.role === "orchestrator" ||
        meta.userModelLocked ||
        meta.roleLockedByLabel ||
        !agent.title?.trim()
      ) {
        return;
      }

      const l0 = detectIntentDeterministic({
        text: agent.title,
        labels: readStringLabels(agent),
        homeDir: os.homedir(),
        config: effectiveConfig,
      });

      let targetRole = meta.role;
      let roleMatchedRule = meta.roleMatchedRule;
      let targetTier = l0.tier;
      let targetPhase = l0.phase;
      let tierMatchedRule = l0.tierMatchedRule;
      let targetSpecialist = specialist;

      const hostProviders = await getHostProvidersSnapshot(context.paseo);

      if (!l0.deterministic && l0.needsSemanticRouter && effectiveConfig.routerEnabled) {
        const sem = await intentRouter.route({
          prompt: agent.title,
          cwd: agent.cwd,
          config: effectiveConfig,
          hostProviders,
          activeSessionProvider: agent.provider,
          lockedRole: meta.role !== effectiveConfig.defaultFallbackRole ? meta.role : null,
        });
        if (sem) {
          if (meta.role === effectiveConfig.defaultFallbackRole && sem.role !== meta.role) {
            const semSpec = findSpecialist(effectiveConfig, sem.role);
            if (semSpec && semSpec.id !== "orchestrator") {
              targetRole = semSpec.id;
              roleMatchedRule = sem.matchedRule;
              targetSpecialist = semSpec;
            }
          }
          if (!(meta.roleLockedByLabel && targetSpecialist?.lockTierOnLabel)) {
            targetTier = sem.tier;
            targetPhase = sem.phase;
            tierMatchedRule = sem.matchedRule;
          }
        }
      }

      const resolvedTarget = resolveTargetAgentAndModel({
        config: effectiveConfig,
        specialist: targetSpecialist,
        requestedProvider: agent.provider,
        activeSessionProvider: agent.provider,
        hostProviders,
        tier: targetTier,
        phase: targetPhase,
        allowProviderFallback: false,
        honorPreferredProvider: false,
      });

      const resolvedPhase = tierToPhase(
        targetRole === meta.role ? resolvedTarget.tier : targetTier,
        targetRole,
        effectiveConfig,
        targetPhase,
      );
      const currentActiveModel = meta.currentModel ?? runtimeModelFromSnap;
      const shouldUpdateModel = Boolean(
        resolvedTarget.model && resolvedTarget.model !== currentActiveModel,
      );
      const shouldUpdateMeta =
        shouldUpdateModel ||
        resolvedTarget.tier !== meta.currentTier ||
        targetRole !== meta.role ||
        resolvedPhase !== meta.phase;

      if (shouldUpdateMeta && resolvedTarget.model) {
        try {
          const handle = context.paseo.agents.ref(agent.id);
          if (shouldUpdateModel) {
            await handle.setModel(resolvedTarget.model);
          }
          await applyAgentThinkingOption(context.paseo, agent.id, resolvedTarget.thinkingOptionId);
          if (effectiveConfig.debugLogs) {
            console.log(
              `[AgentHarness] (agent.turn.before) Routed first-turn model for ${agent.id} (${agent.provider}) -> '${resolvedTarget.model}' [tier: ${resolvedTarget.tier}, rule: ${tierMatchedRule}]`,
            );
          }
          if (effectiveConfig.phaseLifecycleEnabled) {
            const updatedMeta: HarnessAgentMetadata = {
              ...meta,
              role: targetRole,
              roleMatchedRule,
              currentTier: resolvedTarget.tier,
              currentModel: resolvedTarget.model,
              currentThinking: resolvedTarget.thinkingOptionId ?? null,
              phase: resolvedPhase,
              tierMatchedRule,
            };
            await updateAgentMetadata(agent.id, updatedMeta, handle);
          }
          debugLogger.record({
            event: "turn.transition",
            level: "info",
            agentId: agent.id,
            role: targetRole,
            phase: resolvedPhase,
            provider: agent.provider,
            model: resolvedTarget.model,
            detail: {
              hook: "agent.turn.before",
              kind: "first_turn_route",
              toTier: resolvedTarget.tier,
              toModel: resolvedTarget.model,
              matchedRule: tierMatchedRule,
            },
          });
        } catch {
          // Ignore mid-turn switch rejection
        }
      }
    }
  });

  // Hook 5: agent.turn.after
  const removeTurnAfterHook = server.addHook("agent.turn.after", async (payload, context) => {
    capturePaseoApi(context?.paseo);
    const agent = payload?.agent ?? payload;
    const turnId = payload?.turnId ?? null;
    const outcome = payload?.outcome ?? { kind: "completed" };
    if (!agent) return;

    const effectiveConfig = getEffectiveConfig(agent.cwd);

    if (
      !effectiveConfig.enabled ||
      !effectiveConfig.phaseLifecycleEnabled ||
      outcome.kind !== "completed" ||
      !context.paseo?.agents ||
      (await detectAndRecordSnapshotBypass(agent, effectiveConfig, context.paseo))
    ) {
      return;
    }

    let meta = readLatestMetadata(agent);
    if (!meta || (turnId !== null && meta.lastProcessedTurnId === turnId)) {
      return;
    }

    const handle = context.paseo.agents.ref(agent.id);
    const runtimeSnap = await resolveRuntimeSnapshot(agent, handle);
    const reconciled = reconcileRuntimeHarnessMetadata({
      meta,
      snapshot: runtimeSnap,
      provider: agent.provider,
      config: effectiveConfig,
    });
    if (reconciled.bypassed) {
      bypassedAgentIds.add(agent.id);
      if (typeof handle?.setMetadata === "function") {
        void handle.setMetadata({ [HARNESS_BYPASSED_META_KEY]: true }).catch(() => {});
      }
      return;
    }
    if (reconciled.changed) {
      meta = reconciled.meta;
    }
    const isPlanDesign = meta.phase === "design";
    const nextTurnCount = meta.turnCount + 1;
    const nextPlanTurnCount = isPlanDesign ? meta.planTurnCount + 1 : meta.planTurnCount;

    if (!isPlanDesign || meta.autoDowngradedAtTurn !== null) {
      const nextMeta: HarnessAgentMetadata = {
        ...meta,
        turnCount: nextTurnCount,
        planTurnCount: nextPlanTurnCount,
        lastProcessedTurnId: turnId,
        lastBilledTier: meta.currentTier,
        lastBilledModel: meta.currentModel,
        lastBilledThinking: meta.currentThinking ?? null,
      };
      await updateAgentMetadata(agent.id, nextMeta, handle);
      return;
    }

    let rawTimeline: unknown = null;
    try {
      rawTimeline = await handle.timeline.refetch({ direction: "tail", limit: 20 });
    } catch (error) {
      if (effectiveConfig.debugLogs) {
        console.error("[AgentHarness] (agent.turn.after) Failed to refetch timeline", error);
      }
    }

    const timelineItems = extractTimelineItems(rawTimeline);
    const timelineInspection = inspectTurnTimeline(
      timelineItems,
      effectiveConfig.docWhitelistPattern,
    );

    let handoffSuggestedAtTurn = meta.handoffSuggestedAtTurn;
    if (nextPlanTurnCount >= effectiveConfig.planTurnSoftLimit && handoffSuggestedAtTurn === null) {
      handoffSuggestedAtTurn = nextTurnCount;
    }

    const specialist = findSpecialist(effectiveConfig, meta.role);
    const isRoleProtected = Boolean(
      specialist?.readonly ||
      (specialist?.lockTierOnLabel ?? (meta.role === "pm" || meta.role === "architect")),
    );

    const canAutoDowngrade =
      effectiveConfig.autoDowngradePlanOnExec &&
      meta.autoDowngradedAtTurn === null &&
      !specialist?.readonly &&
      !meta.userModelLocked &&
      !(meta.roleLockedByLabel && isRoleProtected);

    const hasExecIntent =
      nextTurnCount >= 2 &&
      !timelineInspection.handoffInvoked &&
      (hasExplicitExecTransitionIntent(timelineInspection.latestUserText) ||
        hasShortAffirmativeExecConfirmation(
          timelineInspection.latestUserText,
          meta.planTurnCount,
          effectiveConfig.affirmativeConfirmWords,
        ));

    const shouldDowngrade =
      canAutoDowngrade &&
      (timelineInspection.detectedCodeWrite ||
        timelineInspection.planExitInvoked ||
        timelineInspection.writableSubagentInvoked ||
        hasExecIntent);

    const billedTier = meta.currentTier;
    const billedModel = meta.currentModel;
    const billedThinking = meta.currentThinking ?? null;
    let currentTier: MatrixTier = meta.currentTier;
    let currentModel: string | null = meta.currentModel;
    let currentThinking: string | null = meta.currentThinking ?? null;
    let phase: HarnessPhase = meta.phase;
    let autoDowngradedAtTurn: number | null = meta.autoDowngradedAtTurn;
    let downgradeReason: HarnessDowngradeReason | null = meta.downgradeReason;

    if (shouldDowngrade) {
      let reason: HarnessDowngradeReason = "explicit_exec_intent";
      if (timelineInspection.detectedCodeWrite || timelineInspection.writableSubagentInvoked) {
        reason = "write_tool_in_plan";
      } else if (timelineInspection.planExitInvoked) {
        reason = "plan_approved";
      }

      try {
        const { targetModel: standardModel, targetThinking: standardThinking } =
          await applyStandardStepDown({
            paseo: context.paseo,
            agentId: agent.id,
            provider: agent.provider,
            meta,
            effectiveConfig,
            handle,
            transitionKind: reason === "plan_approved" ? "plan_approved" : "auto_downgrade",
            reasonText: `Auto stepped down ${meta.currentTier} -> standard (reason: ${reason})`,
            turnNumber: nextTurnCount,
          });
        currentTier = "standard";
        currentModel = standardModel;
        currentThinking = standardThinking;
        phase = "exec";
        autoDowngradedAtTurn = nextTurnCount;
        downgradeReason = reason;

        if (effectiveConfig.debugLogs) {
          console.log(
            `[AgentHarness] (agent.turn.after) Stepped down ${agent.id} from ${meta.currentTier} -> standard (${standardModel}) [reason: ${reason}]`,
          );
        }
      } catch (error) {
        if (effectiveConfig.debugLogs) {
          console.error(
            `[AgentHarness] (agent.turn.after) Failed to setModel for auto-downgrade`,
            error,
          );
        }
      }
    }

    const nextMeta: HarnessAgentMetadata = {
      ...meta,
      turnCount: nextTurnCount,
      planTurnCount: nextPlanTurnCount,
      writeToolDetectedInPlan: meta.writeToolDetectedInPlan || timelineInspection.detectedCodeWrite,
      handoffSuggestedAtTurn,
      currentTier,
      currentModel,
      currentThinking,
      phase,
      autoDowngradedAtTurn,
      downgradeReason,
      lastProcessedTurnId: turnId,
      lastBilledTier: billedTier,
      lastBilledModel: billedModel,
      lastBilledThinking: billedThinking,
    };

    await updateAgentMetadata(agent.id, nextMeta, handle);
    if (shouldDowngrade) {
      debugLogger.record({
        event: "turn.transition",
        level: "info",
        agentId: agent.id,
        role: nextMeta.role,
        phase: nextMeta.phase,
        provider: agent.provider,
        model: nextMeta.currentModel ?? undefined,
        detail: {
          hook: "agent.turn.after",
          kind: "auto_downgrade",
          fromTier: meta.currentTier,
          toTier: nextMeta.currentTier,
          fromModel: meta.currentModel,
          toModel: nextMeta.currentModel,
          downgradeReason: nextMeta.downgradeReason,
          turnCount: nextMeta.turnCount,
        },
      });
    }
  });

  // Hook 6: Cleanup on agent close / archive
  const removeCloseHook = server.addHook("agent.close.after", async (payload) => {
    const agent = payload?.agent ?? payload;
    if (!agent) return;
    latestMetadataByAgent.delete(agent.id);
    switchedFirstTurnAgents.delete(agent.id);
    bypassedAgentIds.delete(agent.id);
    lastOpenInjectSignatureByAgent.delete(agent.id);
  });

  const removeArchiveHook = server.addHook("agent.archive.after", async (payload) => {
    const agent = payload?.agent ?? payload;
    if (!agent) return;
    latestMetadataByAgent.delete(agent.id);
    switchedFirstTurnAgents.delete(agent.id);
    bypassedAgentIds.delete(agent.id);
    lastOpenInjectSignatureByAgent.delete(agent.id);
  });

  async function saveSettings(
    nextSettings: AgentHarnessSettings,
    syncOptions?: { syncProfiles?: boolean },
  ): Promise<void> {
    cachedSettings = nextSettings;
    intentRouter.clearCache();
    debugLogger.setEnabled(nextSettings.debugLogs);
    if (!disableAutoDiskSync && syncOptions?.syncProfiles) {
      if (nextSettings.autoSyncDiskProfiles && nextSettings.specialists?.length > 0) {
        exportSpecialistsToDisk(nextSettings.specialists, nextSettings.profilesDir);
      }
      if (nextSettings.autoSyncDaemonAgentProfiles) {
        await syncDaemonProfilesIfNeeded(nextSettings);
      }
    }
  }

  // Register Client RPC handlers
  registerHarnessRpcHandlers(server, {
    readLatestMetadata: async (id) => latestMetadataByAgent.get(id) ?? null,
    setLatestMetadata: async (id, meta, handle) => {
      await updateAgentMetadata(id, meta, handle);
    },
    getConfig: (_wId, cwd) => getEffectiveConfig(cwd),
    getHostProviders: (paseo) => getHostProvidersSnapshot(paseo),
    saveSpecialists: async (newSpecialists) => {
      const normalizedSpecialists = newSpecialists.map((s) =>
        HarnessSpecialistConfigSchema.parse(s),
      );
      const nextSettings: AgentHarnessSettings = {
        ...cachedSettings,
        specialists: normalizedSpecialists,
      };
      await saveSettings(nextSettings, { syncProfiles: true });
    },
    emitTimelineTransitionsEnabled: () => cachedSettings.emitTimelineTransitions,
    onPaseoAvailable: (paseo) => capturePaseoApi(paseo),
    onTeamUpdated: async (checkoutRoot) => {
      invalidateWorkspaceAgentTeamCache(checkoutRoot);
      intentRouter.clearCache();
      lastDaemonProfileSyncState = {
        ...lastDaemonProfileSyncState,
        lastSyncedSignature: "",
      };
      await syncDaemonProfilesIfNeeded(cachedSettings);
    },
    debugLogger,
    toggleDebugLogs: async (enabled) => {
      runtimeDebugOverride = enabled;
      const nextSettings: AgentHarnessSettings = {
        ...cachedSettings,
        debugLogs: enabled,
      };
      await saveSettings(nextSettings, { syncProfiles: false });
      if (lastRecordedDebugState !== enabled) {
        debugLogger.record(
          {
            event: "debug.toggled",
            level: "info",
            detail: { enabled, source: "rpc" },
          },
          { force: true },
        );
        lastRecordedDebugState = enabled;
      }
      return {
        enabled: debugLogger.isEnabled(),
        logFilePath: debugLogger.logFilePath,
      };
    },
  });

  return () => {
    debugLogger.record({
      event: "plugin.cleanup",
      level: "info",
    });
    unsubscribeSettings();
    removeWorkspaceHook();
    removeWorktreeHook();
    removeAgentHook();
    removeAgentCreateAfterHook();
    removeOpenHook();
    removePermissionBeforeHook();
    removePermissionAfterHook();
    removeTurnHook();
    removeTurnAfterHook();
    removeCloseHook();
    removeArchiveHook();
    pendingWorkspaceContext.clear();
    recentAgentContextQueue.clear();
    lastWorkspaceCreationContext = null;
    switchedFirstTurnAgents.clear();
    latestMetadataByAgent.clear();
    bypassedAgentIds.clear();
    pendingPlanPermissions.clear();
    lastOpenInjectSignatureByAgent.clear();
    intentRouter.dispose();
    hostProvidersCache = null;
    hostProvidersInFlight = null;
  };
}
