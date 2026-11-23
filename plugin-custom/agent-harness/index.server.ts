import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  buildSystemPromptBanner,
  findSpecialist,
  isNativePlanModeSupported,
  normalizeProviderName,
  normalizeTierAlias,
  resolveEffectiveHarnessConfig,
  resolveResumeExecutionMode,
  resolveSessionMcpServers,
  resolveSpecialistEnvironment,
  isFederatedLocalProvider,
  resolveTierTarget,
} from "./shared/config-resolver.js";
import {
  classifyIntentWithLlm,
  coerceAutoRoutingTier,
  detectDomainRole,
  detectDomainRoleHybrid,
  isModelBypassed,
  resolveHarnessEnv,
  resolveMatrixModel,
} from "./shared/intent-detector.js";
import { resolveSpecialistTargetTier } from "./shared/contracts.js";
import {
  createInitialHarnessMetadata,
  extractSnapshotModel,
  extractTimelineItems,
  HARNESS_BYPASSED_META_KEY,
  HARNESS_LEAF_LABEL_KEY,
  HARNESS_LEAF_META_KEY,
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
  type HarnessTransitionKind,
  type MatrixTier,
  type RouterDecision,
} from "./shared/types.js";
import { applyAgentModeOption, applyAgentThinkingOption } from "./server/agent-controls.js";
import {
  invalidateWorkspaceAgentTeamCache,
  loadWorkspaceAgentTeam,
} from "./server/agent-team-loader.js";
import { createHarnessHandoffTool } from "./server/handoff-tool.js";
import {
  exportSpecialistsToDisk,
  loadRepoHarnessOverride,
  syncDaemonAgentProfiles,
} from "./server/profile-sync.js";
import { registerHarnessRpcHandlers } from "./server/rpc-handlers.js";
import { emitHarnessTimelineTransition } from "./server/timeline-emitter.js";

const PROMPT_CACHE_TTL_MS = 60_000;
const TITLE_PREVIEW_MAX_CODE_POINTS = 60;

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

interface RoutedAgentConfigResult<T> {
  config: T;
  roleDecision: DomainRoleDecision;
  routerDecision: RouterDecision;
  specialist?: HarnessSpecialistConfig;
  isBypassed: boolean;
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(agentHarnessSettings);
  let cachedSettings: AgentHarnessSettings = { ...DEFAULT_AGENT_HARNESS_SETTINGS };
  let hasSubscriptionUpdate = false;
  let latestPaseo: PaseoApi | null = null;
  let lastSyncedDaemonProfileSignature = "";

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

  async function syncDaemonProfilesIfNeeded(settingsValues: AgentHarnessSettings): Promise<void> {
    if (!settingsValues.autoSyncDaemonAgentProfiles || !latestPaseo) {
      return;
    }
    const effective = resolveEffectiveHarnessConfig(settingsValues);
    const signature = JSON.stringify(
      settingsValues.specialists
        .filter((s) => s.enabled && s.syncToDaemonProfile)
        .map((s) => {
          const provider = normalizeProviderName(s.preferredProvider || "claude");
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
            effective.providerMappings[provider],
            effective.providerThinkingMappings?.[provider],
          ];
        }),
    );
    if (signature === lastSyncedDaemonProfileSignature) {
      return;
    }
    const syncResult = await syncDaemonAgentProfiles(
      latestPaseo,
      settingsValues.specialists,
      effective,
    );
    if (syncResult.errors.length === 0) {
      lastSyncedDaemonProfileSignature = signature;
    }
  }

  function capturePaseoApi(paseo?: PaseoApi | null): void {
    if (!paseo) {
      return;
    }
    const isFirstCapture = latestPaseo === null;
    latestPaseo = paseo;
    if (isFirstCapture && cachedSettings.autoSyncDaemonAgentProfiles) {
      void syncDaemonProfilesIfNeeded(cachedSettings);
    }
  }

  function applySettings(state: Awaited<ReturnType<typeof settings.read>>) {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
      if (cachedSettings.autoSyncDiskProfiles && cachedSettings.specialists?.length > 0) {
        exportSpecialistsToDisk(cachedSettings.specialists, cachedSettings.profilesDir);
      }
      if (hasSubscriptionUpdate && cachedSettings.autoSyncDaemonAgentProfiles) {
        void syncDaemonProfilesIfNeeded(cachedSettings);
      }
    }
  }

  const unsubscribeSettings = settings.subscribe((state) => {
    if (state.status === "ready") {
      hasSubscriptionUpdate = true;
    }
    applySettings(state);
  });

  settings
    .read()
    .then((state) => {
      if (!hasSubscriptionUpdate) {
        applySettings(state);
      }
    })
    .catch((error) => {
      console.error("[AgentHarness] Failed to read settings", error);
    });

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
    handle: { setMetadata: (patch: Record<string, any>) => Promise<void> },
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
  ) {
    if (!cwd || (!prompt && !labels && bypassed === undefined)) {
      return;
    }
    const key = path.resolve(cwd);
    const existing = pendingWorkspaceContext.get(key);
    pendingWorkspaceContext.set(key, {
      prompt: prompt || existing?.prompt || "",
      labels: mergeLabels(labels, existing?.labels),
      bypassed: Boolean(bypassed),
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

  function consumeAgentCreationContext(options: {
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
  } {
    const normalizedRequestLabels =
      options.labels && Object.keys(options.labels).length > 0 ? { ...options.labels } : undefined;
    if (!options.cwd) {
      return { prompt: "", labels: normalizedRequestLabels, bypassed: false, isLeaf: false };
    }
    const key = path.resolve(options.cwd);
    const queue = recentAgentContextQueue.get(key);
    const metaObj = options.metadata;
    const hasMetaKey = (k: string): boolean =>
      Boolean(metaObj && Object.prototype.hasOwnProperty.call(metaObj, k));
    const hasExplicitLeafFlag =
      hasMetaKey(HARNESS_LEAF_META_KEY) ||
      hasMetaKey(HARNESS_METADATA_KEY) ||
      hasMetaKey(HARNESS_BYPASSED_META_KEY) ||
      options.labels?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      options.env?.PASEO_HARNESS_LEAF === "1";
    const wantLeaf =
      Boolean(metaObj?.[HARNESS_LEAF_META_KEY]) ||
      options.labels?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      options.env?.PASEO_HARNESS_LEAF === "1";
    const hasExplicitBypassFlag =
      hasMetaKey(HARNESS_BYPASSED_META_KEY) || hasMetaKey(HARNESS_METADATA_KEY);
    const wantBypass = Boolean(metaObj?.[HARNESS_BYPASSED_META_KEY]);
    const wantRole = options.labels?.role?.trim() || parseHarnessMetadata(metaObj)?.role;
    const wantTitle = options.title?.trim();

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
        };
      }
    }

    // Fallback: direct workspace.create -> agent.open without intermediate agent.create hook
    const wsCached = consumePendingWorkspaceContext(options.cwd);
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
    const normalizedProvider = normalizeProviderName(agent.provider);
    if (effectiveConfig.bypassProviders.some((p) => p.toLowerCase() === normalizedProvider)) {
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
    const meta = readLatestMetadata(agent);
    if (meta || !paseoApi?.agents?.ref) {
      return false;
    }
    try {
      const handle = paseoApi.agents.ref(agent.id);
      let snap = handle?.current?.();
      if (!extractSnapshotModel(snap) && typeof handle?.refresh === "function") {
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

  async function applyStandardStepDown(options: {
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
    const normalizedProvider = normalizeProviderName(options.provider);
    const resolvedStandard = resolveTierTarget(
      options.effectiveConfig,
      normalizedProvider,
      "standard",
    );
    await options.handle.setModel(resolvedStandard.model);
    await applyAgentThinkingOption(
      options.paseo,
      options.agentId,
      resolvedStandard.thinkingOptionId,
    );
    const recommendedModeId = resolveResumeExecutionMode(
      options.effectiveConfig,
      options.provider,
      options.meta.resumeModeId,
    );
    await applyAgentModeOption(options.paseo, options.agentId, recommendedModeId);

    if (options.effectiveConfig.emitTimelineTransitions) {
      await emitHarnessTimelineTransition(options.handle, {
        transitionKind: options.transitionKind,
        role: options.meta.role,
        fromTier: options.meta.currentTier,
        toTier: "standard",
        fromModel: options.meta.currentModel,
        toModel: resolvedStandard.model,
        phase: "exec",
        reason: options.reasonText,
        turnNumber: options.turnNumber,
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
    options?: { isLeaf?: boolean; isExplicitRoleSpawn?: boolean },
  ): Promise<RoutedAgentConfigResult<T>> {
    const effectiveConfig = getEffectiveConfig(config.cwd);

    let roleDecision = detectDomainRole({
      text,
      labels: mergedLabels,
      homeDir: os.homedir(),
      config: effectiveConfig,
    });

    let specialist = resolveSpecialistWithFallback(
      effectiveConfig,
      roleDecision.role,
      roleDecision.specialistConfig,
    );

    let decision = resolveMatrixModel({
      provider: config.provider,
      currentModel: config.model,
      text,
      overrideIfDefaultOnly: effectiveConfig.overrideIfDefaultOnly,
      config: effectiveConfig,
    });

    const normalizedProvider = normalizeProviderName(config.provider);
    const isBypassed =
      effectiveConfig.bypassProviders.some((p) => p.toLowerCase() === normalizedProvider) ||
      isModelBypassed(config.model, effectiveConfig.bypassModels);

    if (isBypassed) {
      return {
        config,
        roleDecision,
        routerDecision: decision,
        specialist,
        isBypassed: true,
      };
    }

    const llmEndpoint =
      effectiveConfig.llmFallbackEndpoint?.trim() ||
      (typeof process !== "undefined" ? process.env?.HARNESS_LLM_ENDPOINT?.trim() : "");

    if (
      text.trim() &&
      effectiveConfig.llmFallbackEnabled &&
      Boolean(llmEndpoint) &&
      roleDecision.matchedRule === "default_general" &&
      decision.matchedRule === "default_fallback" &&
      !decision.matchedRule.startsWith("preserve_user_choice")
    ) {
      const llmResult = await classifyIntentWithLlm({
        text,
        endpoint: effectiveConfig.llmFallbackEndpoint,
        apiKey: effectiveConfig.llmFallbackApiKey,
        model: effectiveConfig.llmFallbackModel,
        timeoutMs: effectiveConfig.llmFallbackTimeoutMs,
      });

      if (llmResult) {
        if (
          effectiveConfig.llmFallbackApplyRole &&
          llmResult.role &&
          llmResult.role !== "general"
        ) {
          const llmSpecialist = findSpecialist(effectiveConfig, llmResult.role);
          if (llmSpecialist) {
            specialist = llmSpecialist;
            roleDecision = {
              ...roleDecision,
              role: llmSpecialist.id,
              matchedRule: `llm_fallback:${llmSpecialist.id}`,
              specialistConfig: llmSpecialist,
            };
          }
        }
        const llmTier = coerceAutoRoutingTier(llmResult.tier);
        if (llmTier !== "standard") {
          const resolvedLlm = resolveTierTarget(effectiveConfig, normalizedProvider, llmTier);
          const llmPhase = tierToPhase(
            llmTier,
            roleDecision.role,
            effectiveConfig,
            llmTier === "deep" ? "design" : "exec",
          );
          decision = {
            tier: resolvedLlm.canonicalTier,
            targetModel: resolvedLlm.model,
            targetThinking: resolvedLlm.thinkingOptionId,
            phase: llmPhase,
            reason: `Routed to ${resolvedLlm.canonicalTier} model '${resolvedLlm.model}' via L2 LLM fallback`,
            matchedRule: `llm_fallback:${resolvedLlm.canonicalTier}`,
            previousModel: config.model ?? undefined,
          };
        }
      }
    }

    // Role tier enforcement if specified by label or if specialist has a preferredTier / modelOverride
    if (
      (roleDecision.matchedRule.startsWith("label:") || roleDecision.role === "orchestrator") &&
      !isBypassed &&
      !decision.matchedRule.startsWith("preserve_user_choice")
    ) {
      const preferredTier = normalizeTierAlias(
        specialist?.preferredTier ?? resolveSpecialistTargetTier(roleDecision.role),
      );
      const tierResolved = resolveTierTarget(effectiveConfig, normalizedProvider, preferredTier);
      const targetModel = specialist?.modelOverride?.trim() || tierResolved.model;
      const targetThinking = specialist?.thinkingOptionId?.trim() || tierResolved.thinkingOptionId;

      const shouldKeepTextTier = decision.phase === "review" && roleDecision.role === "qa";

      if (preferredTier && targetModel && !shouldKeepTextTier) {
        decision = {
          tier: preferredTier,
          targetModel,
          targetThinking,
          phase: tierToPhase(preferredTier, roleDecision.role, effectiveConfig),
          reason: `Routed to ${preferredTier} model '${targetModel}' by role '${roleDecision.role}'`,
          matchedRule: `role_tier:${roleDecision.role}`,
          previousModel: config.model ?? undefined,
        };
      }
    }

    const resolvedPhase = tierToPhase(
      decision.tier,
      roleDecision.role,
      effectiveConfig,
      decision.matchedRule.startsWith("role_tier:") ? undefined : decision.phase,
    );
    if (decision.phase !== resolvedPhase) {
      decision = { ...decision, phase: resolvedPhase };
    }

    const hasTitle = Boolean(config.title?.trim());
    let nextTitle = config.title;
    if (!hasTitle && text) {
      nextTitle = truncateByCodePoints(text, TITLE_PREVIEW_MAX_CODE_POINTS);
    }
    const nextModel =
      decision.targetModel && decision.targetModel !== config.model
        ? decision.targetModel
        : config.model;

    const userModelLocked = decision.matchedRule.startsWith("preserve_user_choice");
    const roleLockedByLabel =
      roleDecision.matchedRule.startsWith("label:") || Boolean(mergedLabels?.role);
    const hasParentAgent = Boolean(parentAgentCheck);

    const existingThinking =
      typeof config.thinkingOptionId === "string" && config.thinkingOptionId.trim()
        ? config.thinkingOptionId.trim()
        : undefined;
    const nextThinkingOptionId =
      !existingThinking && (!userModelLocked || decision.tier === "max") && decision.targetThinking
        ? decision.targetThinking
        : config.thinkingOptionId;

    // Enforce native plan mode if applicable (driven orthogonally by phase === "design" or readonly role)
    let nextModeId = config.modeId;
    const mustEnforcePlanMode = shouldEnforceNativePlanMode({
      phaseLifecycleEnabled: effectiveConfig.phaseLifecycleEnabled,
      enforceNativePlanMode: effectiveConfig.enforceNativePlanMode,
      tier: decision.tier,
      phase: resolvedPhase,
      role: roleDecision.role,
      userModelLocked,
      roleLockedByLabel,
      hasParentAgent,
      provider: config.provider,
      config: effectiveConfig,
    });

    if (mustEnforcePlanMode) {
      if (hookStage !== "workspace.create") {
        nextModeId = "plan";
      }
    } else if (
      specialist?.readonly &&
      hookStage !== "workspace.create" &&
      isNativePlanModeSupported(effectiveConfig, config.provider)
    ) {
      nextModeId = "plan";
    }

    let nextSystemPrompt = config.systemPrompt;
    if (
      !isBypassed &&
      text.trim() &&
      specialist &&
      !config.systemPrompt?.includes("[Capability Harness Active Profile]") &&
      !config.systemPrompt?.includes("[Agent Harness — Federation Bridge]")
    ) {
      const harnessBanner = buildSystemPromptBanner({
        config: effectiveConfig,
        specialist,
        tier: decision.tier,
        targetModel: nextModel ?? "default",
        phase: resolvedPhase,
        thinkingOptionId: nextThinkingOptionId ?? decision.targetThinking ?? null,
        roleMatchedRule: roleDecision.matchedRule,
        tierMatchedRule: decision.matchedRule,
        homeDir: os.homedir(),
        provider: config.provider,
        isLeaf: options?.isLeaf,
        isSpawnedSpecialist: Boolean(
          options?.isLeaf ||
          options?.isExplicitRoleSpawn ||
          mergedLabels?.role ||
          mergedLabels?.profile,
        ),
      });

      if (harnessBanner) {
        nextSystemPrompt = config.systemPrompt
          ? `${config.systemPrompt}\n\n${harnessBanner}`
          : harnessBanner;
      }
    }

    const nextConfig =
      nextModel !== config.model ||
      nextThinkingOptionId !== config.thinkingOptionId ||
      nextTitle !== config.title ||
      nextModeId !== config.modeId ||
      nextSystemPrompt !== config.systemPrompt
        ? {
            ...config,
            model: nextModel,
            ...(nextThinkingOptionId !== undefined
              ? { thinkingOptionId: nextThinkingOptionId }
              : {}),
            title: nextTitle,
            ...(nextModeId !== undefined ? { modeId: nextModeId } : {}),
            ...(nextSystemPrompt !== undefined ? { systemPrompt: nextSystemPrompt } : {}),
          }
        : config;

    if (cachedSettings.debugLogs && nextModel !== config.model) {
      console.log(
        `[AgentHarness] (${hookStage}) Routed agent (${config.provider}, len=${text.length}): ` +
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
  const removeWorkspaceHook = server.addHook("workspace.create.before", async (payload) => {
    if (!cachedSettings.enabled) {
      return undefined;
    }

    cleanupOldPrompts();

    const request = payload?.request ?? payload;
    if (!request || typeof request !== "object") {
      return undefined;
    }

    const prompt =
      request.firstAgentContext?.prompt?.trim() ||
      request.agent?.initialPrompt?.trim() ||
      request.title?.trim() ||
      "";

    const mergedLabels = mergeLabels(
      readStringLabels(request.agent?.config),
      readStringLabels(request),
    );

    if (!prompt && !mergedLabels) {
      return undefined;
    }

    const sourcePath =
      request.source?.kind === "directory"
        ? request.source.path
        : (request.source as { cwd?: string })?.cwd || request.agent?.config?.cwd;

    const workspaceAgent = request.agent;
    const workspaceAgentConfig = workspaceAgent?.config;
    let workspaceBypassed = false;
    let routedAgentConfig = workspaceAgentConfig;
    if (workspaceAgentConfig) {
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
    }

    if (sourcePath) {
      rememberWorkspaceContext(sourcePath, prompt, mergedLabels, workspaceBypassed);
    }
    lastWorkspaceCreationContext = {
      prompt,
      labels: mergedLabels,
      bypassed: workspaceBypassed,
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
  });

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
      rememberWorkspaceContext(request.path, pending.prompt, pending.labels, pending.bypassed);
      lastWorkspaceCreationContext = null;
    }
    return undefined;
  });

  // Hook 2: agent.create.before
  const removeAgentHook = server.addHook("agent.create.before", async (payload) => {
    if (!cachedSettings.enabled) {
      return undefined;
    }

    cleanupOldPrompts();

    const request = payload?.request ?? payload;
    if (!request || typeof request !== "object" || !request.config) {
      return undefined;
    }

    const config = request.config;
    const effectiveConfig = getEffectiveConfig(config.cwd);

    const initialPrompt = request.initialPrompt?.trim() ?? "";
    const explicitTitle = config.title?.trim() ?? "";
    const workspaceContext = consumePendingWorkspaceContext(config.cwd);
    const promptOrTitle =
      initialPrompt || pickTextContext(config.title, workspaceContext?.prompt ?? "");
    const mergedLabels = mergeLabels(
      mergeLabels(readStringLabels(config), mergeLabels(readStringLabels(request), request.labels)),
      workspaceContext?.labels,
    );

    const hasParentAgent = Boolean(
      (request as { parentAgentId?: string; parent?: string }).parentAgentId ||
      (request as { parent?: string }).parent ||
      mergedLabels?.["paseo.parent-agent-id"],
    );
    const isLeaf = mergedLabels?.[HARNESS_LEAF_LABEL_KEY] === "1";
    const isExplicitRoleSpawn = Boolean(mergedLabels?.role || mergedLabels?.profile);

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
        resolvedRole: roleDecision.matchedRule.startsWith("llm_fallback:")
          ? roleDecision.role
          : undefined,
        resolvedRoleRule: roleDecision.matchedRule.startsWith("llm_fallback:")
          ? roleDecision.matchedRule
          : undefined,
      });
    }

    if (isBypassed) {
      return {
        ...request,
        config: nextConfig,
        metadata: {
          ...(request.metadata ?? {}),
          [HARNESS_BYPASSED_META_KEY]: true,
          ...(isLeaf ? { [HARNESS_LEAF_META_KEY]: true } : {}),
        },
      };
    }

    if (cachedSettings.phaseLifecycleEnabled) {
      const userModelLocked = routerDecision.matchedRule.startsWith("preserve_user_choice");
      const roleLockedByLabel =
        roleDecision.matchedRule.startsWith("label:") || Boolean(mergedLabels?.role);

      const resumeModeId = config.modeId && config.modeId !== "plan" ? config.modeId : null;

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
          ...(request.metadata ?? {}),
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
                ...(request.metadata ?? {}),
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

      if (meta.currentTier !== "standard" || meta.currentModel) {
        if (context?.paseo?.agents) {
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
      }
    },
  );

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

    const normalizedProvider = normalizeProviderName(request.provider);
    const effectiveConfig = getEffectiveConfig(request.cwd);

    const existingMeta =
      latestMetadataByAgent.get(request.agentId) ?? parseHarnessMetadata(request.metadata);
    if (existingMeta) {
      latestMetadataByAgent.set(request.agentId, existingMeta);
    }

    const metaObj = request.metadata as Record<string, unknown> | undefined;
    const isExistingSession = Boolean(request.reason && request.reason !== "create");
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
    const hasOwnHarnessMeta = Boolean(metaObj?.[HARNESS_METADATA_KEY]);
    const hasOwnLeafMeta = Boolean(metaObj?.[HARNESS_LEAF_META_KEY]);
    const hasBypassMeta = Boolean(metaObj?.[HARNESS_BYPASSED_META_KEY]);
    const isLeaf =
      hasOwnLeafMeta ||
      labelsContext?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      request.labels?.[HARNESS_LEAF_LABEL_KEY] === "1" ||
      request.env?.PASEO_HARNESS_LEAF === "1" ||
      (!hasOwnHarnessMeta && consumedContext.isLeaf);

    if (
      effectiveConfig.bypassProviders.some((p) => p.toLowerCase() === normalizedProvider) ||
      hasBypassMeta ||
      bypassedAgentIds.has(request.agentId) ||
      (!hasOwnHarnessMeta && consumedContext.bypassed)
    ) {
      bypassedAgentIds.add(request.agentId);
      return request;
    }

    if (!existingMeta) {
      const paseoApi = context?.paseo ?? latestPaseo;
      let snapModel: string | null = null;
      let snapBypassed = false;
      let handleForMeta: ReturnType<NonNullable<PaseoApi["agents"]>["ref"]> | undefined;
      if (paseoApi?.agents?.ref) {
        try {
          const handle = paseoApi.agents.ref(request.agentId);
          handleForMeta = handle;
          let snap = handle?.current?.();
          if (!extractSnapshotModel(snap) && typeof handle?.refresh === "function") {
            const refreshed = await handle.refresh().catch(() => undefined);
            snap = refreshed?.agent ?? snap;
          }
          snapModel = extractSnapshotModel(snap);
          snapBypassed =
            Boolean(
              (snap?.metadata as Record<string, unknown> | undefined)?.[HARNESS_BYPASSED_META_KEY],
            ) || isModelBypassed(snapModel, effectiveConfig.bypassModels);
        } catch {
          // Ignore snapshot lookup failures
        }
      }
      const isUntrackedResumedAntigravity =
        request.reason !== "create" &&
        normalizedProvider === "antigravity" &&
        !labelsContext?.role &&
        !request.labels?.role &&
        !snapModel;
      if (snapBypassed || isUntrackedResumedAntigravity) {
        bypassedAgentIds.add(request.agentId);
        if (snapBypassed && typeof handleForMeta?.setMetadata === "function") {
          void handleForMeta.setMetadata({ [HARNESS_BYPASSED_META_KEY]: true }).catch(() => {});
        }
        return request;
      }
    }

    const llmEndpoint =
      effectiveConfig.llmFallbackEndpoint?.trim() ||
      (typeof process !== "undefined" ? process.env?.HARNESS_LLM_ENDPOINT?.trim() : "");

    let roleDecision;
    if (existingMeta) {
      roleDecision = {
        role: existingMeta.role,
        matchedRule: existingMeta.roleMatchedRule,
        profilePath: "",
        lazyToolConfigPath: "",
        specialistConfig: findSpecialist(effectiveConfig, existingMeta.role),
      };
    } else if (consumedContext.resolvedRole && effectiveConfig.llmFallbackApplyRole) {
      roleDecision = {
        role: consumedContext.resolvedRole,
        matchedRule:
          consumedContext.resolvedRoleRule ?? `llm_fallback:${consumedContext.resolvedRole}`,
        profilePath: "",
        lazyToolConfigPath: "",
        specialistConfig: findSpecialist(effectiveConfig, consumedContext.resolvedRole),
      };
    } else {
      roleDecision = await detectDomainRoleHybrid({
        text: textContext,
        labels: labelsContext,
        homeDir: os.homedir(),
        config: effectiveConfig,
        llmFallback: {
          enabled: effectiveConfig.llmFallbackEnabled && Boolean(llmEndpoint),
          endpoint: effectiveConfig.llmFallbackEndpoint,
          apiKey: effectiveConfig.llmFallbackApiKey,
          model: effectiveConfig.llmFallbackModel,
          timeoutMs: effectiveConfig.llmFallbackTimeoutMs,
        },
      });
    }

    const specialist = resolveSpecialistWithFallback(
      effectiveConfig,
      roleDecision.role,
      roleDecision.specialistConfig,
    );

    const isFederatedLocalSession = isFederatedLocalProvider(effectiveConfig, request.provider);

    const nextEnv = resolveHarnessEnv({
      role: roleDecision.role,
      existingEnv: request.env ?? {},
      homeDir: os.homedir(),
      config: effectiveConfig,
      provider: request.provider,
      isLeaf,
    });

    let nextMcpServers = request.mcpServers;
    if (specialist && effectiveConfig.enforceSessionMcpFiltering && !isFederatedLocalSession) {
      nextMcpServers = resolveSessionMcpServers({
        config: effectiveConfig,
        specialist,
        existingMcpServers: request.mcpServers,
      });
    }

    let nextTools = request.tools;
    if (isLeaf) {
      if (Array.isArray(request.tools)) {
        nextTools = request.tools.filter((t: any) => t?.name !== "harness_handoff");
      }
    } else if (request.purpose === "interactive") {
      const hasTool = request.tools?.some((t: any) => t.name === "harness_handoff");
      if (!hasTool) {
        const handoffTool = createHarnessHandoffTool({
          getConfig: (cwd) => getEffectiveConfig(cwd ?? request.cwd),
          getLatestMetadata: (id) => latestMetadataByAgent.get(id) ?? null,
          shouldEmitTimeline: () => effectiveConfig.emitTimelineTransitions,
        });
        nextTools = [...(request.tools ?? []), handoffTool];
      }
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

      if (context?.paseo?.agents) {
        const meta = readLatestMetadata(agent);
        const isPlanOrDesign = meta?.phase === "design" || meta?.currentTier === "plan";
        if (isPlanOrDesign) {
          let rawCommand: string | null = null;
          if (typeof request.input?.command === "string") {
            rawCommand = request.input.command;
          } else if (typeof request.input?.cmd === "string") {
            rawCommand = request.input.cmd;
          }

          if (rawCommand && isReadOnlyShellCommand(rawCommand)) {
            try {
              const handle = context.paseo.agents.ref(agent.id);
              await handle.respondToPermission({
                requestId: request.id,
                response: { behavior: "allow" },
              });
              if (cachedSettings.debugLogs) {
                console.log(
                  `[AgentHarness] (permission.before) Auto-approved read-only shell in plan mode: "${rawCommand}" for agent ${agent.id}`,
                );
              }
            } catch (error) {
              if (cachedSettings.debugLogs) {
                console.error(
                  `[AgentHarness] (permission.before) Failed to auto-approve read-only shell: "${rawCommand}"`,
                  error,
                );
              }
            }
          }
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
    const normalizedProvider = normalizeProviderName(agent.provider);

    if (
      !effectiveConfig.enabled ||
      !context.paseo?.agents ||
      (await detectAndRecordSnapshotBypass(agent, effectiveConfig, context.paseo))
    ) {
      return;
    }

    let meta = readLatestMetadata(agent);
    if (meta) {
      const handle = context.paseo.agents.ref(agent.id);
      const runtimeSnap = await resolveRuntimeSnapshot(agent, handle);
      const reconciled = reconcileRuntimeHarnessMetadata({
        meta,
        snapshot: runtimeSnap,
        provider: agent.provider,
        config: effectiveConfig,
      });
      if (reconciled.changed) {
        meta = reconciled.meta;
        if (meta.tierMatchedRule === "runtime_sync:external_model_change") {
          switchedFirstTurnAgents.add(agent.id);
        }
        await updateAgentMetadata(agent.id, meta, handle);
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
          return;
        }
      } catch {
        // Ignore pre-turn timeline inspection failures
      }
    }

    // Dynamic first-turn model routing when agent was created with empty prompt
    if (!switchedFirstTurnAgents.has(agent.id)) {
      switchedFirstTurnAgents.add(agent.id);
      if (!meta && normalizedProvider === "antigravity") {
        return;
      }
      if (
        (meta?.turnCount ?? 0) > 0 ||
        meta?.userModelLocked ||
        meta?.roleLockedByLabel ||
        !agent.title
      ) {
        return;
      }

      const decision = resolveMatrixModel({
        provider: agent.provider,
        text: agent.title,
        overrideIfDefaultOnly: effectiveConfig.overrideIfDefaultOnly,
        config: effectiveConfig,
      });

      if (decision.tier !== "standard" && decision.targetModel) {
        try {
          const handle = context.paseo.agents.ref(agent.id);
          await handle.setModel(decision.targetModel);
          await applyAgentThinkingOption(context.paseo, agent.id, decision.targetThinking);
          if (effectiveConfig.debugLogs) {
            console.log(
              `[AgentHarness] (agent.turn.before) Routed first-turn model for ${agent.id} (${agent.provider}) -> '${decision.targetModel}' [tier: ${decision.tier}, rule: ${decision.matchedRule}]`,
            );
          }
          if (effectiveConfig.phaseLifecycleEnabled && meta) {
            const updatedMeta: HarnessAgentMetadata = {
              ...meta,
              currentTier: decision.tier,
              currentModel: decision.targetModel,
              currentThinking: decision.targetThinking ?? null,
              phase: tierToPhase(decision.tier, meta.role, effectiveConfig, decision.phase),
              tierMatchedRule: decision.matchedRule,
            };
            await updateAgentMetadata(agent.id, updatedMeta, handle);
          }
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
      canAutoDowngrade && (timelineInspection.detectedCodeWrite || hasExecIntent);

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
      const reason: HarnessDowngradeReason = timelineInspection.detectedCodeWrite
        ? "write_tool_in_plan"
        : "explicit_exec_intent";

      try {
        const { targetModel: standardModel, targetThinking: standardThinking } =
          await applyStandardStepDown({
            paseo: context.paseo,
            agentId: agent.id,
            provider: agent.provider,
            meta,
            effectiveConfig,
            handle,
            transitionKind: "auto_downgrade",
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
  });

  // Hook 6: Cleanup on agent close / archive
  const removeCloseHook = server.addHook("agent.close.after", async (payload) => {
    const agent = payload?.agent ?? payload;
    if (!agent) return;
    latestMetadataByAgent.delete(agent.id);
    switchedFirstTurnAgents.delete(agent.id);
    bypassedAgentIds.delete(agent.id);
  });

  const removeArchiveHook = server.addHook("agent.archive.after", async (payload) => {
    const agent = payload?.agent ?? payload;
    if (!agent) return;
    latestMetadataByAgent.delete(agent.id);
    switchedFirstTurnAgents.delete(agent.id);
    bypassedAgentIds.delete(agent.id);
  });

  // Register Client RPC handlers
  registerHarnessRpcHandlers(server, {
    readLatestMetadata: async (id) => latestMetadataByAgent.get(id) ?? null,
    setLatestMetadata: async (id, meta, handle) => {
      await updateAgentMetadata(id, meta, handle);
    },
    getConfig: (_wId, cwd) => getEffectiveConfig(cwd),
    saveSpecialists: async (newSpecialists) => {
      const normalizedSpecialists = newSpecialists.map((s) =>
        HarnessSpecialistConfigSchema.parse(s),
      );
      const nextSettings: AgentHarnessSettings = {
        ...cachedSettings,
        specialists: normalizedSpecialists,
      };
      cachedSettings = nextSettings;
      const settingsWithOptionalSave = settings as unknown as {
        save?: (values: AgentHarnessSettings) => Promise<void>;
      };
      if (typeof settingsWithOptionalSave.save === "function") {
        await settingsWithOptionalSave.save(nextSettings);
      }
      if (cachedSettings.autoSyncDaemonAgentProfiles) {
        await syncDaemonProfilesIfNeeded(nextSettings);
      }
    },
    emitTimelineTransitionsEnabled: () => cachedSettings.emitTimelineTransitions,
    onPaseoAvailable: (paseo) => capturePaseoApi(paseo),
    onTeamUpdated: async (checkoutRoot) => {
      invalidateWorkspaceAgentTeamCache(checkoutRoot);
      lastSyncedDaemonProfileSignature = "";
      await syncDaemonProfilesIfNeeded(cachedSettings);
    },
  });

  return () => {
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
  };
}
