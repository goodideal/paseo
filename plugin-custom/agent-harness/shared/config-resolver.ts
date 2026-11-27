import {
  BUILTIN_BYPASS_MODELS,
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_PROVIDER_THINKING_MAPPINGS,
  LEGACY_V4_PROVIDER_MAPPINGS,
} from "./presets.js";
import type { AgentHarnessSettings } from "./settings.js";
import type {
  AgentTeamSummary,
  EffectiveHarnessConfig,
  HarnessPhase,
  HarnessSpecialistConfig,
  HostProviderModelInfo,
  HostProviderRuntimeInfo,
  MatrixTier,
  McpServerConfigEntry,
  RepoHarnessOverride,
} from "./types.js";

export interface WorkspaceAgentTeamContext {
  summary: AgentTeamSummary;
  specialists: HarnessSpecialistConfig[];
}

const regexCache = new Map<string, RegExp | null>();

/**
 * Safely compiles a regex string with memoization.
 * Returns null if the pattern is empty or syntactically invalid.
 */
export function compileSafeRegex(pattern: string, flags = "i"): RegExp | null {
  if (!pattern || !pattern.trim()) {
    return null;
  }
  const key = `${flags}:::${pattern}`;
  const cached = regexCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const compiled = new RegExp(pattern, flags);
    regexCache.set(key, compiled);
    return compiled;
  } catch {
    regexCache.set(key, null);
    return null;
  }
}

/**
 * Normalizes provider name for consistent dictionary lookups.
 */
export function normalizeProviderName(provider?: string | null): string {
  return provider?.trim().toLowerCase() ?? "";
}

export const FEDERATED_AGENT_PROBE_SPECS = [
  { target: "claude", relDirParts: [".claude", "agents"], suffix: ".md" },
  { target: "opencode", relDirParts: [".opencode", "agents"], suffix: ".md" },
  { target: "codex", relDirParts: [".codex", "agents"], suffix: ".toml" },
] as const;

export const VALID_FEDERATED_TARGET_IDS: ReadonlySet<string> = new Set([
  "antigravity",
  ...FEDERATED_AGENT_PROBE_SPECS.map((spec) => spec.target),
]);

/**
 * Canonicalizes provider identifiers across aliases (e.g. `claude-code` -> `claude`).
 */
export function canonicalizeProviderName(provider?: string | null): string {
  const norm = normalizeProviderName(provider);
  return norm === "claude-code" ? "claude" : norm;
}

/**
 * Normalizes posix path joining without duplicate slashes.
 */
export function joinPosixPath(base: string, ...segments: string[]): string {
  let result = base ? base.replace(/\/+$/, "") : "";
  for (const segment of segments) {
    const clean = segment.replace(/^\/+|\/+$/g, "");
    if (clean) {
      result = result ? `${result}/${clean}` : clean;
    }
  }
  return result;
}

/**
 * Resolves ~ or relative home directory.
 */
export function expandHomeDir(filepath: string, homeDir?: string): string {
  if (!filepath) return "";
  const resolvedHome =
    homeDir?.trim() ||
    (typeof process !== "undefined" ? process.env?.HOME || process.env?.USERPROFILE || "" : "");
  if (filepath.startsWith("~/") || filepath === "~") {
    return resolvedHome ? filepath.replace(/^~(?=$|\/)/, resolvedHome) : filepath;
  }
  return filepath;
}

const MATTPOCOCK_SKILLS_PREFIX = "mattpocock-skills:";

const LEGACY_PM_SKILL_MAP: Readonly<Record<string, string>> = {
  "pm-prd": "deliver-prd",
  "pm-user-stories": "deliver-user-stories",
  "pm-edge-cases": "deliver-edge-cases",
  "pm-problem": "define-problem-statement",
};

/**
 * Normalizes specialist `primarySkills` into prefix-free bare skill names across all providers:
 * - maps `"superpowers:dispatching-parallel-agents"` -> `"codebase-design"`
 * - maps `"superpowers:verification-before-completion"` -> `"tdd"`, `"diagnosing-bugs"`
 * - maps legacy `pm-*` names (`pm-prd` -> `deliver-prd`, etc.)
 * - filters out any other `"superpowers:*"` skill
 * - strips leading `"mattpocock-skills:"` prefix
 * - trims and deduplicates while preserving order.
 */
export function normalizePrimarySkills(skills: readonly string[]): string[] {
  if (!Array.isArray(skills)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  const pushUnique = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  };

  for (const raw of skills) {
    if (typeof raw !== "string") {
      continue;
    }
    const s = raw.trim();
    if (!s) {
      continue;
    }
    if (s === "superpowers:dispatching-parallel-agents") {
      pushUnique("codebase-design");
      continue;
    }
    if (s === "superpowers:verification-before-completion") {
      pushUnique("tdd");
      pushUnique("diagnosing-bugs");
      continue;
    }
    if (s.startsWith("superpowers:")) {
      continue;
    }
    const unprefixed = s.startsWith(MATTPOCOCK_SKILLS_PREFIX)
      ? s.slice(MATTPOCOCK_SKILLS_PREFIX.length).trim()
      : s;
    if (!unprefixed) {
      continue;
    }
    const mappedPm = LEGACY_PM_SKILL_MAP[unprefixed];
    pushUnique(mappedPm ?? unprefixed);
  }

  return normalized;
}

/**
 * Merges Host Settings with optional Repo-level overrides and workspace `.agents/agent-team.json`
 * specialists into an EffectiveHarnessConfig.
 */
export function resolveEffectiveHarnessConfig(
  hostSettings: AgentHarnessSettings,
  repoOverride?: RepoHarnessOverride | null,
  repoRoot?: string,
  agentTeamContext?: WorkspaceAgentTeamContext | null,
): EffectiveHarnessConfig {
  const isEnabled =
    repoOverride?.enabled !== undefined ? repoOverride.enabled : hostSettings.enabled;

  const hasDynamicTeam = Boolean(agentTeamContext && agentTeamContext.specialists.length > 0);
  const baseSpecialists = hasDynamicTeam ? agentTeamContext!.specialists : hostSettings.specialists;

  const dynamicFallbackRole = hasDynamicTeam
    ? (agentTeamContext!.specialists.find((s) => !s.readonly)?.id ??
      agentTeamContext!.specialists[0].id)
    : hostSettings.defaultFallbackRole;

  const defaultFallbackRole = repoOverride?.defaultFallbackRole?.trim() || dynamicFallbackRole;
  const defaultFallbackTier =
    repoOverride?.defaultFallbackTier?.trim() || hostSettings.defaultFallbackTier;

  // Clone specialists and apply repo overrides if present
  const specialistOverrides = repoOverride?.specialistOverrides ?? {};
  const extraDocs = repoOverride?.extraDocsFocus ?? [];
  const extraGates = repoOverride?.extraQualityGates ?? [];

  const mergedSpecialists: HarnessSpecialistConfig[] = [];
  for (const orig of baseSpecialists) {
    const override = specialistOverrides[orig.id];
    if (!override && extraDocs.length === 0 && extraGates.length === 0) {
      mergedSpecialists.push({
        ...orig,
        primarySkills: normalizePrimarySkills(orig.primarySkills),
      });
      continue;
    }

    const mergedDocs = Array.from(
      new Set([...orig.docsFocus, ...(override?.docsFocus ?? []), ...extraDocs]),
    );

    const mergedGates = Array.from(
      new Set([...orig.qualityGates, ...(override?.qualityGates ?? []), ...extraGates]),
    );

    const mergedSkills = normalizePrimarySkills([
      ...orig.primarySkills,
      ...(override?.primarySkills ?? []),
    ]);

    mergedSpecialists.push({
      ...orig,
      ...override,
      primarySkills: mergedSkills,
      docsFocus: mergedDocs,
      qualityGates: mergedGates,
      // For security, repoOverride cannot override built-in, profileFilename, or weaken readonly
      builtIn: orig.builtIn,
      profileFilename: orig.profileFilename,
      readonly: Boolean(orig.readonly || override?.readonly),
    });
  }

  return {
    ...hostSettings,
    enabled: isEnabled,
    defaultFallbackRole,
    defaultFallbackTier,
    bypassModels: hostSettings.bypassModels ?? BUILTIN_BYPASS_MODELS,
    routerEnabled: hostSettings.routerEnabled ?? true,
    routerProvider: hostSettings.routerProvider ?? "",
    routerModel: hostSettings.routerModel ?? "",
    routerEffort: hostSettings.routerEffort ?? "low",
    routerTimeoutMs: hostSettings.routerTimeoutMs ?? 10000,
    routerConfidenceThreshold: hostSettings.routerConfidenceThreshold ?? 0.85,
    specialists: mergedSpecialists,
    repoOverrideLoaded: Boolean(repoOverride),
    repoRoot,
    agentTeam: agentTeamContext?.summary ?? null,
  };
}

/**
 * Looks up specialist definition by id or alias.
 */
export function findSpecialist(
  config: EffectiveHarnessConfig,
  identifier: string,
): HarnessSpecialistConfig | undefined {
  const norm = identifier.trim().toLowerCase();
  if (!norm) return undefined;

  for (const s of config.specialists) {
    if (s.id.toLowerCase() === norm) {
      return s;
    }
    if (s.aliases.some((a) => a.toLowerCase() === norm)) {
      return s;
    }
  }
  return undefined;
}

/**
 * Normalizes legacy tier names (`flash | lite | deep`) into canonical v9 complexity IDs
 * (`fast | standard | plan | review | max`), preserving custom tier IDs.
 * Disambiguates `"deep"` / `"pro"` / `"opus"` using `phaseHint` (`"review"` -> `"review"`, default `"plan"`).
 */
export function normalizeTierAlias(
  tier?: string | null,
  phaseHint?: HarnessPhase | null,
): MatrixTier {
  const norm = tier?.trim().toLowerCase() ?? "";
  if (!norm) {
    return "standard";
  }
  switch (norm) {
    case "lite":
      return "fast";
    case "flash":
      return "standard";
    case "plan":
      return "plan";
    case "review":
      return "review";
    case "deep":
    case "pro":
    case "opus":
      return phaseHint === "review" ? "review" : "plan";
    default:
      return norm;
  }
}

function cleanNonDeprecatedModel(val?: string | null): string {
  const trimmed = val?.trim() ?? "";
  if (!trimmed || /^gemini-3/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export interface ResolvedTierTarget {
  canonicalTier: MatrixTier;
  model: string;
  thinkingOptionId: string | null;
}

const CORE_BUILTIN_AND_LEGACY_TIER_KEYS = new Set([
  "fast",
  "standard",
  "plan",
  "review",
  "deep",
  "max",
  "flash",
  "lite",
]);

/**
 * Resolves both target model ID and thinking effort option for a provider + tier,
 * supporting v9 tiers (`fast | standard | plan | review | max`), legacy aliases
 * (`deep | flash | lite`), deprecated `gemini-3*` exclusion, and omitted `max` fallback.
 */
export function resolveTierTarget(
  config: Pick<EffectiveHarnessConfig, "providerMappings"> &
    Partial<Pick<EffectiveHarnessConfig, "providerThinkingMappings">>,
  provider: string,
  tier: string,
  phaseHint?: HarnessPhase | null,
): ResolvedTierTarget {
  const rawTier = tier?.trim() || "standard";
  const rawLower = rawTier.toLowerCase();
  const inferredPhaseHint = phaseHint ?? (rawLower === "review" ? "review" : undefined);
  const canonicalTier = normalizeTierAlias(rawTier, inferredPhaseHint);
  const normProvider = normalizeProviderName(provider);
  const canonProvider = canonicalizeProviderName(provider);

  const canonMapping = config.providerMappings?.[canonProvider] ?? {};
  const rawMapping =
    config.providerMappings?.[normProvider] ?? config.providerMappings?.[provider] ?? {};
  const hasSeparateRaw = normProvider !== canonProvider && Object.keys(rawMapping).length > 0;
  const mapping = normProvider !== canonProvider ? { ...canonMapping, ...rawMapping } : rawMapping;

  const canonThinkingMap = config.providerThinkingMappings?.[canonProvider] ?? {};
  const rawThinkingMap =
    config.providerThinkingMappings?.[normProvider] ??
    config.providerThinkingMappings?.[provider] ??
    {};
  const thinkingMap =
    normProvider !== canonProvider ? { ...canonThinkingMap, ...rawThinkingMap } : rawThinkingMap;

  const builtinThinkingMap =
    BUILTIN_PROVIDER_THINKING_MAPPINGS[normProvider] ??
    BUILTIN_PROVIDER_THINKING_MAPPINGS[canonProvider] ??
    {};
  const builtinMap =
    BUILTIN_PROVIDER_MAPPINGS[normProvider] ?? BUILTIN_PROVIDER_MAPPINGS[canonProvider];

  const resolveFromSingleMap = (m: Record<string, string>): string => {
    if (!CORE_BUILTIN_AND_LEGACY_TIER_KEYS.has(rawLower)) {
      const exactCustom =
        cleanNonDeprecatedModel(m[rawTier]) || cleanNonDeprecatedModel(m[rawLower]);
      if (exactCustom) return exactCustom;
    }
    if (canonicalTier === "fast") {
      return (
        cleanNonDeprecatedModel(m.fast) ||
        cleanNonDeprecatedModel(m.lite) ||
        cleanNonDeprecatedModel(m.flash) ||
        ""
      );
    }
    if (canonicalTier === "standard") {
      return cleanNonDeprecatedModel(m.standard) || cleanNonDeprecatedModel(m.flash) || "";
    }
    if (canonicalTier === "plan") {
      return (
        cleanNonDeprecatedModel(m.plan) ||
        cleanNonDeprecatedModel(m.deep) ||
        cleanNonDeprecatedModel(m.review) ||
        cleanNonDeprecatedModel(m.standard) ||
        ""
      );
    }
    if (canonicalTier === "review") {
      return (
        cleanNonDeprecatedModel(m.review) ||
        cleanNonDeprecatedModel(m.deep) ||
        cleanNonDeprecatedModel(m.plan) ||
        cleanNonDeprecatedModel(m.standard) ||
        ""
      );
    }
    if (canonicalTier === "max") {
      return (
        cleanNonDeprecatedModel(m.max) ||
        cleanNonDeprecatedModel(m.plan) ||
        cleanNonDeprecatedModel(m.deep) ||
        cleanNonDeprecatedModel(m.standard) ||
        ""
      );
    }
    return cleanNonDeprecatedModel(m[rawTier]) || cleanNonDeprecatedModel(m[canonicalTier]) || "";
  };

  let model = hasSeparateRaw ? resolveFromSingleMap(rawMapping) : "";
  if (!model) {
    model = resolveFromSingleMap(mapping);
  }

  if (!model) {
    if (builtinMap?.[canonicalTier]?.trim()) {
      model = builtinMap[canonicalTier].trim();
    } else if (canonicalTier === "plan" && builtinMap?.deep?.trim()) {
      model = builtinMap.deep.trim();
    } else if (
      canonicalTier === "review" &&
      (builtinMap?.deep?.trim() || builtinMap?.plan?.trim())
    ) {
      model = (builtinMap.deep ?? builtinMap.plan)!.trim();
    } else {
      model = rawLower === canonicalTier ? canonicalTier : rawTier;
    }
  }

  const effectiveMaxExplicit = hasSeparateRaw
    ? cleanNonDeprecatedModel(rawMapping.max) || cleanNonDeprecatedModel(canonMapping.max)
    : cleanNonDeprecatedModel(mapping.max);
  const explicitMaxModelMissing = canonicalTier === "max" && !effectiveMaxExplicit;
  let configuredThinking =
    thinkingMap[rawTier]?.trim() ||
    thinkingMap[rawLower]?.trim() ||
    thinkingMap[canonicalTier]?.trim() ||
    "";
  if (!configuredThinking) {
    if (canonicalTier === "plan") {
      configuredThinking = thinkingMap.deep?.trim() || thinkingMap.review?.trim() || "";
    } else if (canonicalTier === "review") {
      configuredThinking = thinkingMap.deep?.trim() || thinkingMap.plan?.trim() || "";
    }
  }

  const fallbackThinking = explicitMaxModelMissing
    ? "xhigh"
    : builtinThinkingMap[canonicalTier]?.trim() ||
      (canonicalTier === "plan" || canonicalTier === "review"
        ? builtinThinkingMap.deep?.trim()
        : "") ||
      "";

  const resolvedThinking =
    configuredThinking || (config.providerThinkingMappings ? "" : fallbackThinking);

  return {
    canonicalTier:
      !CORE_BUILTIN_AND_LEGACY_TIER_KEYS.has(rawLower) &&
      (cleanNonDeprecatedModel(mapping[rawTier]) || cleanNonDeprecatedModel(mapping[rawLower]))
        ? rawLower
        : canonicalTier,
    model,
    thinkingOptionId: resolvedThinking || (explicitMaxModelMissing ? "xhigh" : null),
  };
}

export interface InferredModelTier {
  tier: MatrixTier;
  isKnownTierModel: boolean;
  isRouterManagedNonMax: boolean;
  isDedicatedMax: boolean;
}

export const MODEL_THINKING_SUFFIX_PATTERN = /-(?:low|medium|high|xhigh)$/i;

/**
 * Infers the canonical complexity tier from a concrete runtime model ID.
 * Checks configured mappings first, then built-in mappings (exact and without
 * trailing thinking suffix such as `-high`), and finally legacy v4 mappings.
 * Respects `fallbackTier` as a tie-breaker when multiple tiers (e.g. `plan` & `review`) share a model ID.
 */
export function inferTierFromModel(
  config: Pick<EffectiveHarnessConfig, "providerMappings"> | null | undefined,
  provider: string,
  modelId: string,
  fallbackTier?: string | null,
): InferredModelTier {
  const trimmed = modelId.trim();
  const fallback = normalizeTierAlias(fallbackTier);
  if (!trimmed) {
    return {
      tier: fallback,
      isKnownTierModel: false,
      isRouterManagedNonMax: false,
      isDedicatedMax: false,
    };
  }

  const normProvider = normalizeProviderName(provider);
  const canonProvider = canonicalizeProviderName(provider);

  const canonConfigMap = config?.providerMappings?.[canonProvider] ?? {};
  const rawConfigMap =
    config?.providerMappings?.[normProvider] ?? config?.providerMappings?.[provider] ?? {};
  const configMap =
    normProvider !== canonProvider ? { ...canonConfigMap, ...rawConfigMap } : rawConfigMap;
  const builtinMap =
    BUILTIN_PROVIDER_MAPPINGS[normProvider] ?? BUILTIN_PROVIDER_MAPPINGS[canonProvider] ?? {};
  const legacyMap =
    LEGACY_V4_PROVIDER_MAPPINGS[normProvider] ?? LEGACY_V4_PROVIDER_MAPPINGS[canonProvider] ?? {};

  const matchMap = (map: Record<string, string>, candidate: string): InferredModelTier | null => {
    const nonMaxEntries: Array<[MatrixTier, string]> = [];
    let maxModel = "";
    for (const [rawKey, rawVal] of Object.entries(map)) {
      const val = typeof rawVal === "string" ? rawVal.trim() : "";
      if (!val) continue;
      if (rawKey.trim().toLowerCase() === "deep" && (map.plan?.trim() || map.review?.trim())) {
        continue;
      }
      const canonicalKey = normalizeTierAlias(rawKey);
      if (canonicalKey === "max") {
        maxModel = val;
      } else {
        nonMaxEntries.push([canonicalKey, val]);
      }
    }

    const tierPriority = (t: MatrixTier): number => {
      if (t === "fast") return 0;
      if (t === "standard") return 1;
      if (t === "plan") return 2;
      if (t === "review") return 3;
      return 4;
    };
    nonMaxEntries.sort((a, b) => tierPriority(a[0]) - tierPriority(b[0]));

    const matchingTiers = nonMaxEntries
      .filter(([, val]) => val === candidate)
      .map(([tierKey]) => tierKey);

    if (matchingTiers.length > 0) {
      const resolved = matchingTiers.includes(fallback) ? fallback : matchingTiers[0]!;
      return {
        tier: resolved,
        isKnownTierModel: true,
        isRouterManagedNonMax: true,
        isDedicatedMax: false,
      };
    }
    if (maxModel && maxModel === candidate) {
      return {
        tier: "max",
        isKnownTierModel: true,
        isRouterManagedNonMax: false,
        isDedicatedMax: true,
      };
    }
    return null;
  };

  const stripped = MODEL_THINKING_SUFFIX_PATTERN.test(trimmed)
    ? trimmed.replace(MODEL_THINKING_SUFFIX_PATTERN, "")
    : "";

  const activeCandidates = [configMap, builtinMap];
  for (const map of activeCandidates) {
    const exact = matchMap(map, trimmed);
    if (exact) return exact;
  }
  if (stripped) {
    for (const map of activeCandidates) {
      const byBase = matchMap(map, stripped);
      if (byBase) return byBase;
    }
  }

  const legacyExact = matchMap(legacyMap, trimmed);
  if (legacyExact) return legacyExact;
  if (stripped) {
    const legacyByBase = matchMap(legacyMap, stripped);
    if (legacyByBase) return legacyByBase;
  }

  return {
    tier: fallback,
    isKnownTierModel: false,
    isRouterManagedNonMax: false,
    isDedicatedMax: false,
  };
}

/**
 * Resolves the target model ID for a given provider and tier.
 */
export function resolveTargetModelForTier(
  config: Pick<EffectiveHarnessConfig, "providerMappings"> &
    Partial<Pick<EffectiveHarnessConfig, "providerThinkingMappings">>,
  provider: string,
  tier: string,
): string {
  return resolveTierTarget(config, provider, tier).model;
}

/**
 * Resolves the execution mode to restore when exiting native "plan" mode.
 */
export function resolveResumeExecutionMode(
  config: EffectiveHarnessConfig,
  provider: string,
  resumeModeId?: string | null,
): string | null {
  if (resumeModeId && resumeModeId.trim() && resumeModeId.trim() !== "plan") {
    return resumeModeId.trim();
  }
  const normProvider = normalizeProviderName(provider);
  const modeCfg = config.providerModes[normProvider] ?? config.providerModes[provider];
  if (modeCfg?.resumeExecutionModeId?.trim()) {
    return modeCfg.resumeExecutionModeId.trim();
  }
  if (normProvider === "antigravity") {
    return "full-access";
  }
  if (normProvider === "claude" || normProvider === "claude-code") {
    return "acceptEdits";
  }
  if (normProvider === "opencode") {
    return "build";
  }
  return null;
}

export interface TargetAgentAndModelInput {
  config: EffectiveHarnessConfig;
  specialist?: HarnessSpecialistConfig | null;
  requestedProvider?: string | null;
  activeSessionProvider?: string | null;
  hostProviders?: readonly HostProviderRuntimeInfo[] | null;
  tier: MatrixTier;
  phase?: HarnessPhase | null;
  currentModel?: string | null;
  requestedModel?: string | null;
  userModelLocked?: boolean;
  allowProviderFallback?: boolean;
  honorPreferredProvider?: boolean;
}

export interface TargetAgentAndModelResult {
  provider: string;
  tier: MatrixTier;
  model: string;
  thinkingOptionId: string | null;
  modeId: string | null;
  modelLockedByUser: boolean;
  fallbackReason: string | null;
}

function findHostProviderEntry(
  hostProviders: readonly HostProviderRuntimeInfo[] | null | undefined,
  providerName: string,
): HostProviderRuntimeInfo | undefined {
  if (!hostProviders?.length || !providerName.trim()) {
    return undefined;
  }
  const norm = normalizeProviderName(providerName);
  const canon = canonicalizeProviderName(providerName);
  return (
    hostProviders.find((entry) => normalizeProviderName(entry.provider) === norm) ??
    hostProviders.find((entry) => canonicalizeProviderName(entry.provider) === canon)
  );
}

const DISALLOWED_OFFLINE_PREFIXES: Record<string, readonly string[]> = {
  antigravity: ["claude-", "gpt-", "o1", "o3", "o4", "custom/", "headroom/"],
  claude: ["gemini-", "headroom/", "gpt-", "o1", "o3", "o4", "custom/"],
  codex: ["gemini-", "claude-", "headroom/", "custom/"],
  pi: ["gemini-", "custom/", "claude-", "gpt-", "o1", "o3", "o4"],
  opencode: ["gemini-", "headroom/"],
};

export function isModelCompatibleWithProvider(
  provider: string,
  modelId: string,
  hostEntry?: HostProviderRuntimeInfo,
): boolean {
  const m = modelId.trim().toLowerCase();
  if (!m || /^gemini-3/i.test(m)) {
    return false;
  }
  if (hostEntry && hostEntry.models.length > 0) {
    return hostEntry.models.some((entry) => entry.id.trim().toLowerCase() === m);
  }
  const disallowed = DISALLOWED_OFFLINE_PREFIXES[canonicalizeProviderName(provider)];
  if (!disallowed) {
    return true;
  }
  return !disallowed.some((prefix) => m.startsWith(prefix));
}

function validateModelAgainstHost(
  provider: string,
  modelId: string,
  hostEntry?: HostProviderRuntimeInfo,
): HostProviderModelInfo | boolean {
  const m = modelId.trim().toLowerCase();
  if (!m || /^gemini-3/i.test(m)) {
    return false;
  }
  if (hostEntry && hostEntry.models.length > 0) {
    return hostEntry.models.find((entry) => entry.id.trim().toLowerCase() === m) ?? false;
  }
  return isModelCompatibleWithProvider(provider, modelId);
}

/**
 * Two-stage Agent -> Model resolution cascade.
 * Stage 1 resolves the target provider respecting `honorSpecialistPreferredProvider`
 * and live `hostProviders` availability (falling back if disabled).
 * Stage 2 resolves the target model, thinking option, and execution mode compatible
 * with Stage 1's resolved provider, validating against live `models`/`thinkingOptions`
 * and rejecting deprecated `gemini-3*` or incompatible cross-provider models.
 */
export function resolveTargetAgentAndModel(
  input: TargetAgentAndModelInput,
): TargetAgentAndModelResult {
  const {
    config,
    specialist,
    requestedProvider,
    activeSessionProvider,
    hostProviders,
    phase,
    currentModel,
    requestedModel,
    allowProviderFallback = true,
  } = input;

  const fallbackReasons: string[] = [];

  // Stage 1: Agent / Provider selection
  const honorPreferred = input.honorPreferredProvider ?? config.honorSpecialistPreferredProvider;
  const preferred = specialist?.preferredProvider?.trim() || "";
  const primaryCandidate =
    honorPreferred && preferred
      ? preferred
      : requestedProvider?.trim() || activeSessionProvider?.trim() || preferred || "antigravity";

  let resolvedProvider = primaryCandidate;
  let hostEntry = findHostProviderEntry(hostProviders, resolvedProvider);

  if (allowProviderFallback && hostProviders && hostProviders.length > 0) {
    const enabledEntries = hostProviders.filter((e) => e.enabled);
    if (!hostEntry || !hostEntry.enabled) {
      const secondaryCandidates = [
        activeSessionProvider?.trim(),
        requestedProvider?.trim(),
        "antigravity",
        ...enabledEntries.map((e) => e.provider),
      ].filter((p): p is string => Boolean(p));

      let replaced: HostProviderRuntimeInfo | undefined;
      for (const cand of secondaryCandidates) {
        const entry = findHostProviderEntry(enabledEntries, cand);
        if (entry) {
          replaced = entry;
          break;
        }
      }
      if (replaced) {
        if (resolvedProvider !== replaced.provider) {
          fallbackReasons.push(`provider_disabled:${resolvedProvider}->${replaced.provider}`);
        }
        resolvedProvider = replaced.provider;
        hostEntry = replaced;
      }
    }
  }

  // Stage 2: Tier -> Model -> Thinking -> Mode
  const canonicalTier = normalizeTierAlias(input.tier, phase);
  const tierTarget = resolveTierTarget(config, resolvedProvider, canonicalTier, phase);
  const canonProvider = canonicalizeProviderName(resolvedProvider);

  let chosenTier: MatrixTier = canonicalTier;
  let chosenModel = "";
  let modelLockedByUser = false;
  let matchedHostModel: HostProviderModelInfo | undefined;

  const tryPickModel = (candidate: string | null | undefined, sourceLabel: string): boolean => {
    const trimmed = candidate?.trim();
    if (!trimmed) return false;
    const validation = validateModelAgainstHost(resolvedProvider, trimmed, hostEntry);
    if (validation === false) {
      fallbackReasons.push(`invalid_${sourceLabel}_model:${trimmed}`);
      return false;
    }
    chosenModel = trimmed;
    if (typeof validation === "object") {
      matchedHostModel = validation;
    }
    return true;
  };

  if (requestedModel?.trim()) {
    if (tryPickModel(requestedModel, "requested") && input.userModelLocked) {
      modelLockedByUser = true;
    }
  }

  if (!chosenModel && currentModel?.trim() && config.overrideIfDefaultOnly) {
    const inferredCurrent = inferTierFromModel(
      config,
      resolvedProvider,
      currentModel,
      canonicalTier,
    );
    const isUserCustom =
      input.userModelLocked ||
      (!inferredCurrent.isRouterManagedNonMax && !/^gemini-3/i.test(currentModel.trim()));
    if (isUserCustom && !inferredCurrent.isRouterManagedNonMax) {
      if (tryPickModel(currentModel, "user")) {
        modelLockedByUser = true;
        if (inferredCurrent.isDedicatedMax) {
          chosenTier = "max";
        }
      }
    }
  }

  const specialistMismatchProvider =
    preferred.length > 0 && canonicalizeProviderName(preferred) !== canonProvider;
  if (!chosenModel && specialist?.modelOverride?.trim()) {
    if (specialistMismatchProvider) {
      fallbackReasons.push(`skipped_cross_provider_override:${specialist.modelOverride.trim()}`);
    } else {
      tryPickModel(specialist.modelOverride, "override");
    }
  }

  if (!chosenModel) {
    if (!tryPickModel(tierTarget.model, "tier")) {
      const hostFallbackModel =
        hostEntry?.defaultModel?.trim() ||
        hostEntry?.models.find((m) => m.isDefault)?.id ||
        hostEntry?.models[0]?.id ||
        tierTarget.model;
      chosenModel = hostFallbackModel;
      matchedHostModel = hostEntry?.models.find((m) => m.id === chosenModel);
      fallbackReasons.push(`tier_model_unavailable:${tierTarget.model}->${chosenModel}`);
    }
  }

  let resolvedThinking: string | null =
    chosenTier === canonicalTier
      ? tierTarget.thinkingOptionId
      : resolveTierTarget(config, resolvedProvider, chosenTier, phase).thinkingOptionId;
  if (matchedHostModel?.thinkingOptions) {
    if (matchedHostModel.thinkingOptions.length === 0) {
      resolvedThinking = null;
    } else if (
      !resolvedThinking ||
      !matchedHostModel.thinkingOptions.some((opt) => opt.id === resolvedThinking)
    ) {
      resolvedThinking =
        matchedHostModel.thinkingOptions.find((opt) => opt.id === "high")?.id ??
        matchedHostModel.thinkingOptions.find((opt) => opt.id === "medium")?.id ??
        matchedHostModel.thinkingOptions[0]?.id ??
        null;
    }
  }

  let modeId: string | null = specialist?.defaultModeId?.trim() || null;
  if (modeId) {
    if (canonProvider === "antigravity" && modeId === "bypassPermissions") {
      modeId = "full-access";
    } else if (canonProvider === "claude" && modeId === "full-access") {
      modeId = "bypassPermissions";
    } else if (modeId === "plan" && !isNativePlanModeSupported(config, resolvedProvider)) {
      modeId = resolveResumeExecutionMode(config, resolvedProvider, null);
    }
  }

  return {
    provider: resolvedProvider,
    tier: chosenTier,
    model: chosenModel,
    thinkingOptionId: resolvedThinking,
    modeId,
    modelLockedByUser,
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join("; ") : null,
  };
}

/**
 * Checks if native plan mode is supported for this provider.
 */
export function isNativePlanModeSupported(
  config: EffectiveHarnessConfig,
  provider: string,
): boolean {
  const normProvider = normalizeProviderName(provider);
  const modeCfg = config.providerModes[normProvider] ?? config.providerModes[provider];
  if (modeCfg !== undefined) {
    return modeCfg.supportsNativePlanMode;
  }
  return normProvider === "claude" || normProvider === "claude-code" || normProvider === "opencode";
}

/**
 * Resolves disk profile path and lazy tool slice path for a specialist.
 */
export function resolveSpecialistPaths(
  config: EffectiveHarnessConfig,
  specialist: HarnessSpecialistConfig,
  homeDir?: string,
): { profilePath: string; lazyToolConfigPath: string } {
  const profileFilename = specialist.profileFilename || `${specialist.id}.json`;
  const expandedProfilesDir = expandHomeDir(config.profilesDir, homeDir);
  const profilePath = expandedProfilesDir
    ? joinPosixPath(expandedProfilesDir, profileFilename)
    : "";

  let lazyToolConfigPath = "";
  if (specialist.lazyToolSlice?.trim()) {
    const slice = specialist.lazyToolSlice.trim();
    if (slice.includes("/") || slice.includes("\\")) {
      lazyToolConfigPath = expandHomeDir(slice, homeDir);
    } else {
      const expandedSliceDir = expandHomeDir(config.lazyToolProfilesDir, homeDir);
      lazyToolConfigPath = expandedSliceDir ? joinPosixPath(expandedSliceDir, slice) : "";
    }
  }

  return { profilePath, lazyToolConfigPath };
}

/**
 * Builds the Capability Harness active profile system prompt banner.
 */
function resolveBannerPhase(
  optionsPhase: HarnessPhase | undefined,
  tier: MatrixTier,
  specialistId: string,
): HarnessPhase {
  if (optionsPhase) {
    return optionsPhase;
  }
  const rawTier = tier?.trim().toLowerCase() ?? "";
  const normId = specialistId?.trim().toLowerCase() ?? "";
  if (
    rawTier === "review" ||
    normId === "review" ||
    normId.endsWith("-reviewer") ||
    normId.endsWith("-auditor")
  ) {
    return "review";
  }
  if (
    rawTier === "plan" ||
    rawTier === "deep" ||
    normId === "pm" ||
    normId.endsWith("-pm") ||
    normId === "architect" ||
    normId.endsWith("-architect")
  ) {
    return "design";
  }
  return "exec";
}

function sanitizeAntigravityPhaseRule(
  rule: string,
  options?: { isLeaf?: boolean; isUnattendedWorkflow?: boolean; includeHandoffToolHint?: boolean },
): string {
  if (!rule) return rule;
  if (options?.isUnattendedWorkflow) {
    return rule
      .replace(/`?harness_handoff`?/gi, "`invoke_subagent`")
      .replace(/paseo-handoff/gi, "`invoke_subagent`");
  }
  const canSpawn = options?.includeHandoffToolHint !== false;
  const invokeReplacement =
    options?.isLeaf || !canSpawn
      ? "use `invoke_subagent` only for read-only local lookups (do not spawn recursive agents)."
      : "delegate in-session via `invoke_subagent` or spawn an independent cross-host specialist via `mcp_paseo_create_agent`.";
  const handoffPairReplacement =
    options?.isLeaf || !canSpawn
      ? "`invoke_subagent`"
      : "`invoke_subagent` (in-session) / `mcp_paseo_create_agent` (cross-host)";
  return rule
    .replace(/`?ExitPlanMode`?/g, "`exit_plan_mode`")
    .replace(/invoke the host tool `?harness_handoff`?[^.]*\./gi, invokeReplacement)
    .replace(
      /`?harness_handoff`?\s*\/\s*(?:paseo-handoff|`?invoke_subagent`?)/gi,
      handoffPairReplacement,
    )
    .replace(/`?(?:harness_handoff|paseo-handoff)`?/gi, "`invoke_subagent`");
}

function stripHandoffHintsFromPhaseRule(rule: string): string {
  if (!rule) return rule;
  return rule
    .replace(
      /\s*or invoke the host tool `?harness_handoff`?[^.]*\./gi,
      " or suggest delegating execution to a specialist once ready.",
    )
    .replace(
      /spawn or hand off via `?harness_handoff`?\s*\/\s*(?:paseo-handoff|`?invoke_subagent`?)\s*to/gi,
      "request delegation to",
    )
    .replace(/via `?harness_handoff`?\s*\(or\s*/gi, "via `paseo` CLI (")
    .replace(/`?harness_handoff`?\s*\/?\s*(?:paseo-handoff)?/gi, "specialist handoff");
}

export function buildSystemPromptBanner(options: {
  config: EffectiveHarnessConfig;
  specialist: HarnessSpecialistConfig;
  tier: string;
  targetModel: string;
  phase?: HarnessPhase;
  thinkingOptionId?: string | null;
  roleMatchedRule: string;
  tierMatchedRule?: string;
  homeDir?: string;
  provider?: string;
  isLeaf?: boolean;
  isSpawnedSpecialist?: boolean;
  isUnattendedWorkflow?: boolean;
  includeHandoffToolHint?: boolean;
}): string {
  const { config, specialist, tier, targetModel, roleMatchedRule, homeDir, provider } = options;
  if (!config.injectSystemPromptBanner) {
    return "";
  }

  const canonicalProvider = canonicalizeProviderName(provider);
  const isAntigravity = canonicalProvider === "antigravity";
  const includeHandoffHint = options.includeHandoffToolHint ?? true;
  const resolvedActiveTarget =
    targetModel && targetModel !== "default"
      ? targetModel
      : resolveTierTarget(config, canonicalProvider || "antigravity", tier, options.phase).model;

  // Federated root session: yield skills/MCP ownership to local synthesized target plugin/agents
  // and emit only the concise Federation Bridge.
  const agentTeam = config.agentTeam;
  if (
    agentTeam &&
    !options.isLeaf &&
    !options.isSpawnedSpecialist &&
    isFederatedLocalProvider(config, provider)
  ) {
    const availableHandoffs = config.specialists
      .filter((s) => s.enabled && s.handoffEnabled)
      .map((s) => {
        const prov = s.preferredProvider?.trim() || "inherit";
        const mod = s.modelOverride?.trim() || s.preferredTier || "standard";
        return `${s.id} (${prov}·${mod}${s.readonly ? "·RO" : ""})`;
      })
      .join(", ");

    const ownerLabel = isAntigravity
      ? `local agent-team plugin (team-${agentTeam.projectSlug})`
      : `local synthesized ${canonicalProvider} agents (team-${agentTeam.projectSlug})`;

    const bridgeLines = [
      "[Agent Harness — Federation Bridge]",
      `- Matrix Tier: ${tier} (model: ${resolvedActiveTarget || "default"}${options.thinkingOptionId ? `, thinking: ${options.thinkingOptionId}` : ""}); ${ownerLabel} owns repo skills & MCP.`,
      ...(availableHandoffs && includeHandoffHint
        ? [
            isAntigravity
              ? `- Delegation & Handoff: Use \`invoke_subagent\` for in-session module/role delegation; call \`mcp_paseo_create_agent\` only when spawning an independent persistent cross-host/Paseo agent. Available workspace specialists: ${availableHandoffs}.`
              : `- Cross-Client Handoff (\`harness_handoff\`): Available workspace specialists: ${availableHandoffs}.`,
          ]
        : []),
    ];

    if (config.enforceWorkspaceBoundaryGuardrail && config.workspaceBoundaryNotice) {
      bridgeLines.push(
        `- Workspace Boundary Guardrail (CRITICAL): ${config.workspaceBoundaryNotice}`,
      );
    }

    return bridgeLines.join("\n");
  }

  const { profilePath, lazyToolConfigPath } = resolveSpecialistPaths(config, specialist, homeDir);
  const primarySkills = normalizePrimarySkills(specialist.primarySkills);
  const allowedMcp = specialist.allowedMcpServers.filter(Boolean);
  const excludedMcp = specialist.excludedMcpServers.filter(Boolean);
  const qualityGates = specialist.qualityGates.filter(Boolean);
  const docsFocus = specialist.docsFocus.filter(Boolean);
  const rawSkillsRoot = specialist.skillsRoot?.trim() ?? "";
  const rawDefaultSkillsRoot = config.defaultSkillsRoot?.trim() ?? "";
  const expandedSkillsRoot = rawSkillsRoot ? expandHomeDir(rawSkillsRoot, homeDir) : "";
  const expandedDefaultSkillsRoot = rawDefaultSkillsRoot
    ? expandHomeDir(rawDefaultSkillsRoot, homeDir)
    : "";
  const hasFallbackSkillsRoot = Boolean(
    rawSkillsRoot && rawDefaultSkillsRoot && expandedSkillsRoot !== expandedDefaultSkillsRoot,
  );
  const skillsRootLabel = hasFallbackSkillsRoot
    ? `${rawSkillsRoot} (fallback: ${rawDefaultSkillsRoot})`
    : rawSkillsRoot;

  const phase = resolveBannerPhase(options.phase, tier, specialist.id);

  const customRolePrompt = specialist.rolePromptTemplate?.trim();
  const rawPhaseRule =
    customRolePrompt ||
    (options.isUnattendedWorkflow && phase === "design"
      ? "- [Phase: Unattended Workflow Design & Spec] Rule: You are running in an automated workflow stage (phase=design). Author concise architectural proposals, design specs, or implementation plans as instructed by the workflow prompt (writing spec/plan Markdown files if requested); DO NOT edit business source files in this design stage, DO NOT invoke interactive ExitPlanMode, and DO NOT spawn subagents."
      : config.phaseRules[specialist.id]?.trim() ||
        config.phaseRules[phase]?.trim() ||
        config.phaseRules[tier]?.trim() ||
        "");
  let phaseRule = rawPhaseRule;
  if (isAntigravity) {
    phaseRule = sanitizeAntigravityPhaseRule(rawPhaseRule, {
      isLeaf: options.isLeaf,
      isUnattendedWorkflow: options.isUnattendedWorkflow,
      includeHandoffToolHint: includeHandoffHint,
    });
  } else if (!includeHandoffHint) {
    phaseRule = stripHandoffHintsFromPhaseRule(rawPhaseRule);
  }

  const lines = [
    "[Capability Harness Active Profile]",
    `- Role: ${specialist.id} (rule: ${roleMatchedRule})${specialist.description ? ` — ${specialist.description}` : ""}`,
    `- Matrix Tier: ${tier} (model: ${resolvedActiveTarget || "default"}${options.thinkingOptionId ? `, thinking: ${options.thinkingOptionId}` : ""})`,
    ...(profilePath ? [`- Profile Spec: ${profilePath}`] : []),
    ...(lazyToolConfigPath ? [`- Lazy-Tool Slice: ${lazyToolConfigPath}`] : []),
    ...(primarySkills.length > 0 ? [`- Primary Skills: ${primarySkills.join(", ")}`] : []),
    ...(skillsRootLabel ? [`- Skills Root: ${skillsRootLabel}`] : []),
    ...(docsFocus.length > 0 ? [`- Focus Documents: ${docsFocus.join(", ")}`] : []),
    ...(allowedMcp.length > 0
      ? [`- Allowed MCP Servers (via lazy-tool): ${allowedMcp.join(", ")}`]
      : []),
    ...(excludedMcp.length > 0 ? [`- Excluded MCP Servers: ${excludedMcp.join(", ")}`] : []),
    ...(qualityGates.length > 0 ? [`- Quality Gates: ${qualityGates.join(", ")}`] : []),
    ...(specialist.ssotOutputTarget
      ? [`- SSOT Output Target: ${specialist.ssotOutputTarget}`]
      : []),
  ];

  if (config.enforceWorkspaceBoundaryGuardrail && config.workspaceBoundaryNotice) {
    lines.push(`- Workspace Boundary Guardrail (CRITICAL): ${config.workspaceBoundaryNotice}`);
  }

  if (specialist.readonly) {
    lines.push(
      `- Read-Only Specialist Enforcement (CRITICAL): Role \`${specialist.id}\` is strictly READ-ONLY. NEVER create, edit, patch, or delete repository files via file tools, mutating Serena tools, or shell commands.`,
    );
  }

  if (options.isLeaf) {
    lines.push(
      `- Leaf Specialist Boundary: You were spawned as a leaf specialist (\`PASEO_HARNESS_LEAF=1\`). Complete your assigned scope directly and DO NOT trigger recursive multi-role orchestration or nested handoffs.`,
    );
  }

  if (specialist.mandatorySkillActivation && primarySkills.length > 0) {
    const rawEffectiveRoot = rawSkillsRoot || rawDefaultSkillsRoot || "~/.agents/skills";
    const normalizedHome = homeDir?.trim().replace(/\/+$/, "");
    const effectiveSkillsRoot =
      normalizedHome && (rawEffectiveRoot.startsWith("~/") || rawEffectiveRoot === "~")
        ? expandHomeDir(rawEffectiveRoot, normalizedHome)
        : rawEffectiveRoot;
    const requiredSkills = primarySkills.slice(0, 2);
    const optionalSkills = primarySkills.slice(2);
    const skillMarkdownPaths = requiredSkills.map(
      (s) => `\`${joinPosixPath(effectiveSkillsRoot, s, "SKILL.md")}\``,
    );
    const optionalNote =
      optionalSkills.length > 0
        ? ` (optional on-demand: ${optionalSkills.map((s) => `\`${s}\``).join(", ")})`
        : "";
    if (isAntigravity) {
      const fallbackNote = hasFallbackSkillsRoot
        ? ` (or fallback \`${rawDefaultSkillsRoot}\`, e.g. \`${joinPosixPath(rawDefaultSkillsRoot, requiredSkills[0], "SKILL.md")}\`)`
        : "";
      lines.push(
        `- Mandatory Skill Activation: Before modifying any files or executing commands, you MUST read the corresponding \`SKILL.md\` via \`read_file\` (${skillMarkdownPaths.join(", ")}${fallbackNote})${optionalNote} so its domain rules govern your implementation.`,
      );
    } else {
      lines.push(
        `- Mandatory Skill Activation: Before modifying any files or executing commands, you MUST invoke the \`Skill\` tool (or read ${skillMarkdownPaths.join(", ")}) to load at least one of your Primary Skills (${requiredSkills.map((s) => `\`${s}\``).join(", ")})${optionalNote} so its domain rules govern your implementation.`,
      );
    }
  }

  if (phaseRule) {
    lines.push(phaseRule);
  }

  if (isAntigravity && !options.isLeaf && !options.isUnattendedWorkflow && includeHandoffHint) {
    const agPlanModel = resolveTierTarget(config, "antigravity", "plan").model;
    const agReviewModel = resolveTierTarget(config, "antigravity", "review").model;
    const agStandardModel = resolveTierTarget(config, "antigravity", "standard").model;
    lines.push(
      `- Antigravity Delegation & Cross-Host Handoff: Use \`invoke_subagent\` for in-session module/role delegation; only call \`mcp_paseo_create_agent\` when spawning an independent persistent cross-host/Paseo agent (with \`provider: "antigravity/${resolvedActiveTarget || agStandardModel}"\`, \`labels: { "role": "<targetRole>", "paseo.harness-leaf": "1" }\`, and a self-contained \`initialPrompt\`; configured tier targets: \`plan\` -> \`${agPlanModel}\`, \`review\` -> \`${agReviewModel}\`, \`standard\` -> \`${agStandardModel}\`).`,
    );
  }

  return lines.join("\n");
}

const BANNER_HEADER_MARKERS = new Set([
  "[Capability Harness Active Profile]",
  "[Agent Harness — Federation Bridge]",
]);

/**
 * Removes persisted `[Capability Harness Active Profile]` or `[Agent Harness — Federation Bridge]`
 * blocks from `agent.config.systemPrompt` so legacy sessions no longer suffer prompt bloat or stale headers.
 */
export function stripHarnessBannerFromSystemPrompt(
  prompt: string | null | undefined,
): string | undefined {
  if (!prompt || !prompt.trim()) {
    return undefined;
  }
  const lines = prompt.split(/\r?\n/);
  const kept: string[] = [];
  let skippingBanner = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (BANNER_HEADER_MARKERS.has(trimmed)) {
      skippingBanner = true;
      continue;
    }
    if (skippingBanner) {
      if (trimmed.startsWith("- ")) {
        continue;
      }
      if (trimmed === "") {
        skippingBanner = false;
        // Skip extra blank separator lines immediately following a stripped banner
        if (kept.length > 0 && kept[kept.length - 1] === "") {
          continue;
        }
        kept.push("");
        continue;
      }
      skippingBanner = false;
    }
    kept.push(line);
  }

  // Collapse leading/trailing blank lines left behind when banner was at start or end
  while (kept.length > 0 && kept[0].trim() === "") {
    kept.shift();
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }
  const collapsed: string[] = [];
  for (const line of kept) {
    if (
      line.trim() === "" &&
      collapsed.length > 0 &&
      collapsed[collapsed.length - 1].trim() === ""
    ) {
      continue;
    }
    collapsed.push(line);
  }

  const joined = collapsed.join("\n").trim();
  return joined ? joined : undefined;
}

/**
 * Resolves session MCP servers non-destructively in `agent.open.before`.
 * Preserves all existing session MCP servers and additively injects configured catalog servers
 * requested by the specialist.
 */
export function resolveSessionMcpServers(options: {
  config: EffectiveHarnessConfig;
  specialist: HarnessSpecialistConfig;
  existingMcpServers?: Record<string, McpServerConfigEntry>;
}): Record<string, McpServerConfigEntry> {
  const { config, specialist, existingMcpServers = {} } = options;
  const result: Record<string, McpServerConfigEntry> = { ...existingMcpServers };

  // Additive catalog injection only (never destructively removes incoming MCP servers)
  for (const injectKey of specialist.injectedMcpServers) {
    if (config.mcpServerCatalog[injectKey] && !result[injectKey]) {
      result[injectKey] = config.mcpServerCatalog[injectKey];
    }
  }

  return result;
}

/**
 * Returns true when the active workspace checkout physically contains synthesized local
 * agent-team artifacts for the caller's provider (Antigravity plugin or Claude/OpenCode/Codex targets).
 */
export function isFederatedLocalProvider(
  config: EffectiveHarnessConfig,
  provider?: string,
): boolean {
  if (!config.agentTeam) {
    return false;
  }
  const canonical = canonicalizeProviderName(provider);
  if (!canonical) {
    return false;
  }
  const detected = config.agentTeam.localFederatedTargets;
  if (Array.isArray(detected)) {
    return detected.includes(canonical);
  }
  return canonical === "antigravity" && Boolean(config.agentTeam.hasLocalAntigravityPlugin);
}

/**
 * Resolves environment variables to inject for a specialist session.
 */
export function resolveSpecialistEnvironment(options: {
  config: EffectiveHarnessConfig;
  specialist: HarnessSpecialistConfig;
  existingEnv?: Readonly<Record<string, string>>;
  homeDir?: string;
  provider?: string;
  isLeaf?: boolean;
}): Record<string, string> {
  const { config, specialist, existingEnv, homeDir } = options;
  const baseEnv: Record<string, string> = { ...existingEnv };
  const { profilePath, lazyToolConfigPath } = resolveSpecialistPaths(config, specialist, homeDir);

  const isRoleSwitch = Boolean(
    baseEnv.PASEO_HARNESS_ROLE && baseEnv.PASEO_HARNESS_ROLE !== specialist.id,
  );

  baseEnv.PASEO_HARNESS_ROLE = specialist.id;

  if (profilePath) {
    baseEnv.PASEO_HARNESS_PROFILE = profilePath;
  } else if (isRoleSwitch) {
    delete baseEnv.PASEO_HARNESS_PROFILE;
  }

  const skipLazyToolForFederatedLocal = isFederatedLocalProvider(config, options.provider);

  if (!skipLazyToolForFederatedLocal) {
    if (lazyToolConfigPath) {
      if (!baseEnv.LAZY_TOOL_CONFIG || isRoleSwitch) {
        baseEnv.LAZY_TOOL_CONFIG = lazyToolConfigPath;
      }
    } else if (isRoleSwitch) {
      delete baseEnv.LAZY_TOOL_CONFIG;
    }
  }

  if (options.isLeaf) {
    baseEnv.PASEO_HARNESS_LEAF = "1";
  }

  if (specialist.skillsRoot?.trim()) {
    baseEnv.PASEO_HARNESS_SKILLS_ROOT = expandHomeDir(specialist.skillsRoot.trim(), homeDir);
  }

  // Merge extraEnv declared on specialist
  if (specialist.extraEnv) {
    for (const [k, v] of Object.entries(specialist.extraEnv)) {
      if (typeof v === "string") {
        baseEnv[k] = v;
      }
    }
  }

  return baseEnv;
}
