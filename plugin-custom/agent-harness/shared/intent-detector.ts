import {
  MODEL_THINKING_SUFFIX_PATTERN,
  canonicalizeProviderName,
  compileSafeRegex,
  findSpecialist,
  joinPosixPath,
  normalizeProviderName,
  normalizeTierAlias,
  resolveSpecialistEnvironment,
  resolveSpecialistPaths,
  resolveTierTarget,
} from "./config-resolver.js";
import {
  BUILTIN_BYPASS_MODELS,
  BUILTIN_CONVENTIONAL_PREFIXES,
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_PROVIDER_THINKING_MAPPINGS,
  BUILTIN_SLASH_COMMAND_ROUTES,
  BUILTIN_SPECIALISTS,
  LEGACY_V4_PROVIDER_MAPPINGS,
  LEGACY_V8_PROVIDER_MAPPINGS,
} from "./presets.js";
import type {
  DomainRole,
  DomainRoleDecision,
  EffectiveHarnessConfig,
  HarnessPhase,
  HarnessSpecialistConfig,
  MatrixTier,
  ProviderModelMapping,
  RouterDecision,
} from "./types.js";

const warnedInvalidBypassPatterns = new Set<string>();

/**
 * Checks whether a model ID matches any configured bypass regex pattern (e.g. `^gemini-pro-orchestrator`).
 */
export function isModelBypassed(
  model: string | null | undefined,
  bypassModels: readonly string[] = BUILTIN_BYPASS_MODELS,
): boolean {
  const trimmed = model?.trim();
  if (!trimmed) {
    return false;
  }
  for (const pattern of bypassModels) {
    if (!pattern || !pattern.trim()) {
      continue;
    }
    const regex = compileSafeRegex(pattern);
    if (!regex) {
      if (!warnedInvalidBypassPatterns.has(pattern)) {
        warnedInvalidBypassPatterns.add(pattern);
        console.warn(`[AgentHarness] Invalid bypassModels regex pattern skipped: "${pattern}"`);
      }
      continue;
    }
    if (regex.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a provider ID is configured in `bypassProviders`.
 */
export function isProviderBypassed(
  provider: string | null | undefined,
  config?: Pick<EffectiveHarnessConfig, "bypassProviders"> | null,
): boolean {
  const normalized = normalizeProviderName(provider);
  const canonical = canonicalizeProviderName(provider);
  if (!normalized || !config?.bypassProviders?.length) {
    return false;
  }
  return config.bypassProviders.some((p) => {
    const candidate = normalizeProviderName(p);
    return candidate === normalized || canonicalizeProviderName(p) === canonical;
  });
}

/**
 * Flags deprecated model IDs (e.g. legacy `gemini-3*` series) that must never block v9 routing.
 */
export function isDeprecatedModel(model: string | null | undefined): boolean {
  const trimmed = model?.trim();
  if (!trimmed) {
    return false;
  }
  return /^gemini-3/i.test(trimmed);
}

export function normalizeProvider(provider?: string | null): string {
  return normalizeProviderName(provider);
}

const IDENTITY_MAPPING: ProviderModelMapping = {
  fast: "lite",
  standard: "flash",
  plan: "pro",
  review: "pro",
  deep: "pro",
  max: "plan",
};

export const DEFAULT_PROVIDER_MAPPINGS: Record<string, ProviderModelMapping> = {
  ...BUILTIN_PROVIDER_MAPPINGS,
};

const FAST_CONVENTIONAL_PREFIX_SET = new Set(
  BUILTIN_CONVENTIONAL_PREFIXES.fast.map((p) => p.toLowerCase()),
);
const STANDARD_CONVENTIONAL_PREFIX_SET = new Set(
  BUILTIN_CONVENTIONAL_PREFIXES.standard.map((p) => p.toLowerCase()),
);

const ALL_CONVENTIONAL_EXEC_WORDS = [
  ...BUILTIN_CONVENTIONAL_PREFIXES.fast,
  ...BUILTIN_CONVENTIONAL_PREFIXES.standard,
].join("|");

/**
 * Anchored Conventional Commit or explicit execution slash command prefix.
 * Constructed with `new RegExp` directly to avoid module-init circular calls into config-resolver.
 */
export const CONVENTIONAL_EXEC_PREFIX: RegExp = new RegExp(
  `^\\s*(?:(?:${ALL_CONVENTIONAL_EXEC_WORDS})(?:\\([^)\\n]{1,40}\\))?!?:|\\/(?:gitea\\s+(?:dev|ship|release)|install-local|implement|tdd|fix)(?:\\s|$))`,
  "i",
);

/**
 * Sanitizes raw user prompt before L0 / semantic routing and cache key hashing.
 * Strips `<system-reminder>` blocks and fenced code blocks, then collapses whitespace.
 */
export function sanitizePromptForRouting(
  text: string | null | undefined,
  maxLength = 1200,
): string {
  if (!text) {
    return "";
  }
  const stripped = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) {
    return "";
  }
  return stripped.length > maxLength ? stripped.slice(0, maxLength).trim() : stripped;
}

/** Ensures auto-routing tiers never select manual-only `"max"`. */
export function coerceAutoRoutingTier(
  tier?: string | null,
  phaseHint?: HarnessPhase | null,
): MatrixTier {
  const normalized = normalizeTierAlias(tier, phaseHint);
  if (normalized === "max") {
    return phaseHint === "review" ? "review" : "plan";
  }
  return normalized;
}

function defaultPhaseForTier(
  tier: MatrixTier,
  config?: EffectiveHarnessConfig | null,
): HarnessPhase {
  const norm = normalizeTierAlias(tier);
  if (norm === "plan") return "design";
  if (norm === "review") return "review";
  if (config) {
    const matched = config.tiers.find((t) => normalizeTierAlias(t.id) === norm);
    if (matched) return matched.defaultPhase;
  }
  return "exec";
}

function collectNonMaxAndLegacyModels(params: {
  provider: string;
  config?: Pick<EffectiveHarnessConfig, "providerMappings"> | null;
  customMappings?: Record<string, Partial<ProviderModelMapping>>;
}): {
  routerManagedModels: Set<string>;
  maxOnlyModel: string | undefined;
} {
  const { provider, config, customMappings } = params;
  const normalizedProvider = normalizeProviderName(provider);
  const canonicalProvider = canonicalizeProviderName(provider);

  const configuredMap = config
    ? (config.providerMappings?.[normalizedProvider] ??
      config.providerMappings?.[canonicalProvider])
    : undefined;

  const customOverride =
    customMappings &&
    (Object.hasOwn(customMappings, normalizedProvider) ||
      Object.hasOwn(customMappings, canonicalProvider) ||
      Object.hasOwn(customMappings, provider))
      ? (customMappings[normalizedProvider] ??
        customMappings[canonicalProvider] ??
        customMappings[provider])
      : undefined;

  const defaultMap =
    DEFAULT_PROVIDER_MAPPINGS[normalizedProvider] ?? DEFAULT_PROVIDER_MAPPINGS[canonicalProvider];

  const customMaxModel = configuredMap?.max?.trim() ?? customOverride?.max?.trim() ?? undefined;

  const nonMaxConfiguredModels = configuredMap
    ? Object.entries(configuredMap)
        .filter(([k]) => k !== "max")
        .map(([, v]) => v)
    : [];

  const nonMaxCustomModels = customOverride
    ? Object.entries(customOverride)
        .filter(([k]) => k !== "max")
        .map(([, v]) => v)
    : [];

  const autoBuiltinModels = Object.entries(defaultMap ?? {})
    .filter(([k]) => k !== "max")
    .map(([, v]) => v);

  const nonMaxSet = new Set(
    [...nonMaxConfiguredModels, ...nonMaxCustomModels, ...autoBuiltinModels]
      .map((m) => m?.trim())
      .filter((m): m is string => Boolean(m)),
  );

  // maxOnlyModel only counts when `max` uses a model NOT shared with any auto-routable tier.
  const rawMaxCandidate = customMaxModel ?? defaultMap?.max?.trim();
  const maxOnlyModel =
    rawMaxCandidate && !nonMaxSet.has(rawMaxCandidate) ? rawMaxCandidate : undefined;

  const legacyV4 =
    LEGACY_V4_PROVIDER_MAPPINGS[normalizedProvider] ??
    LEGACY_V4_PROVIDER_MAPPINGS[canonicalProvider];
  const legacyV8 =
    LEGACY_V8_PROVIDER_MAPPINGS[normalizedProvider] ??
    LEGACY_V8_PROVIDER_MAPPINGS[canonicalProvider];

  const legacyModels = [...Object.values(legacyV4 ?? {}), ...Object.values(legacyV8 ?? {})].filter(
    (m) => m && m !== maxOnlyModel,
  );

  const tierLabels = ["fast", "standard", "deep", "review", "flash", "lite", "pro"];
  if (maxOnlyModel !== "plan") {
    tierLabels.push("plan");
  }

  const routerManagedModels = new Set<string>(
    [...tierLabels, ...nonMaxSet, ...legacyModels].filter((m): m is string => Boolean(m?.trim())),
  );

  return { routerManagedModels, maxOnlyModel };
}

/**
 * Checks whether a session's active model should be treated as unset / router-managed default
 * (as opposed to an intentional custom user model override).
 * Includes Paseo's default Antigravity model (`gemini-4-neon`) and deprecated `gemini-3*` models.
 */
export function isDefaultOrUnsetModel(
  provider: string,
  model: string | null | undefined,
  customMappings?: Record<string, Partial<ProviderModelMapping>>,
  config?: Pick<EffectiveHarnessConfig, "providerMappings"> | null,
): boolean {
  const trimmed = model?.trim();
  if (!trimmed) {
    return true;
  }
  if (isDeprecatedModel(trimmed)) {
    return true;
  }
  const { routerManagedModels, maxOnlyModel } = collectNonMaxAndLegacyModels({
    provider,
    config,
    customMappings,
  });
  if (routerManagedModels.has(trimmed)) {
    return true;
  }
  const baseModel = trimmed.replace(MODEL_THINKING_SUFFIX_PATTERN, "").trim();
  return (
    baseModel.length > 0 &&
    baseModel !== trimmed &&
    baseModel !== maxOnlyModel &&
    routerManagedModels.has(baseModel)
  );
}

function resolveHomeDir(homeDir?: string): string {
  if (homeDir?.trim()) return homeDir.trim();
  if (typeof process !== "undefined" && process?.env) {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    if (envHome?.trim()) return envHome.trim();
  }
  return "";
}

function lookupSpecialist(
  roleOrAlias: string,
  config?: EffectiveHarnessConfig | null,
): HarnessSpecialistConfig | undefined {
  if (config) {
    return findSpecialist(config, roleOrAlias);
  }
  const norm = roleOrAlias.trim().toLowerCase();
  if (!norm) return undefined;
  return BUILTIN_SPECIALISTS.find(
    (s) =>
      s.enabled &&
      (s.id.toLowerCase() === norm || s.aliases.some((alias) => alias.toLowerCase() === norm)),
  );
}

function buildRoleDecision(
  role: DomainRole,
  matchedRule: string,
  homeDir?: string,
  config?: EffectiveHarnessConfig | null,
): DomainRoleDecision {
  const resolvedHome = resolveHomeDir(homeDir);
  const specialistConfig = lookupSpecialist(role, config);

  let profilePath = "";
  let lazyToolConfigPath = "";

  if (config && specialistConfig) {
    const paths = resolveSpecialistPaths(config, specialistConfig, resolvedHome);
    profilePath = paths.profilePath;
    lazyToolConfigPath = paths.lazyToolConfigPath;
  } else if (specialistConfig) {
    const filename = specialistConfig.profileFilename || `${specialistConfig.id}.json`;
    profilePath = resolvedHome ? joinPosixPath(resolvedHome, ".agents", "profiles", filename) : "";
    if (specialistConfig.lazyToolSlice) {
      lazyToolConfigPath = resolvedHome
        ? joinPosixPath(
            resolvedHome,
            ".config",
            "lazy-tool",
            "profiles",
            specialistConfig.lazyToolSlice,
          )
        : "";
    }
  }

  return {
    role,
    matchedRule,
    profilePath,
    lazyToolConfigPath,
    specialistConfig,
  };
}

export interface DeterministicRouteInput {
  text?: string | null;
  labels?: Readonly<Record<string, string>> | null;
  modeId?: string | null;
  workflowPhase?: string | null;
  workflowTier?: string | null;
  homeDir?: string;
  config?: EffectiveHarnessConfig | null;
}

export interface DeterministicRouteResult {
  role: DomainRole;
  tier: MatrixTier;
  phase: HarnessPhase;
  roleMatchedRule: string;
  tierMatchedRule: string;
  roleLocked: boolean;
  deterministic: boolean;
  needsSemanticRouter: boolean;
  roleDecision: DomainRoleDecision;
}

/**
 * L0 Deterministic Router:
 * Resolves explicit role/profile labels, workflow labels, native `plan` mode,
 * exact anchored slash commands, and exact anchored conventional commit prefixes.
 * Leaves unstructured natural language to the semantic router (`needsSemanticRouter: true`).
 */
export function detectIntentDeterministic(
  input: DeterministicRouteInput,
): DeterministicRouteResult {
  const { text, labels, modeId, workflowPhase, workflowTier, homeDir, config } = input;
  const fallbackRole = config?.defaultFallbackRole ?? "general";
  const fallbackTier = coerceAutoRoutingTier(config?.defaultFallbackTier ?? "standard");

  // 1. Explicit labels.role or labels.profile
  let matchedSpecialist: HarnessSpecialistConfig | undefined;
  let role: DomainRole = fallbackRole;
  let roleMatchedRule = "default_general";
  let roleLocked = false;

  for (const labelKey of ["role", "profile"] as const) {
    const rawLabel = labels?.[labelKey]?.trim().toLowerCase();
    if (!rawLabel) continue;
    const found = lookupSpecialist(rawLabel, config);
    if (found) {
      matchedSpecialist = found;
      role = found.id;
      roleMatchedRule = `label:${labelKey}`;
      roleLocked = true;
      break;
    }
  }

  // Strip leading `<system-reminder>` blocks before anchored matching
  const matchText = (text ?? "")
    .replace(/^(?:\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*)+/gi, "")
    .trim();

  // 2. Explicit Paseo workflow labels
  const rawWorkflowPhase = (workflowPhase ?? labels?.["paseo.workflow.phase"] ?? "")
    .trim()
    .toLowerCase();
  const rawWorkflowTier = (workflowTier ?? labels?.["paseo.workflow.tier"] ?? "").trim();

  if (
    rawWorkflowPhase === "design" ||
    rawWorkflowPhase === "review" ||
    rawWorkflowPhase === "exec"
  ) {
    const phase: HarnessPhase = rawWorkflowPhase;
    let tier: MatrixTier;
    if (rawWorkflowTier) {
      tier = coerceAutoRoutingTier(rawWorkflowTier, phase);
    } else if (phase === "design") {
      tier = "plan";
    } else if (phase === "review") {
      tier = "review";
    } else {
      tier = fallbackTier;
    }
    const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);
    return {
      role,
      tier,
      phase,
      roleMatchedRule,
      tierMatchedRule: `workflow:phase_${phase}`,
      roleLocked,
      deterministic: true,
      needsSemanticRouter: false,
      roleDecision,
    };
  }

  // 3. Native Paseo plan mode
  if (modeId?.trim().toLowerCase() === "plan") {
    const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);
    return {
      role,
      tier: "plan",
      phase: "design",
      roleMatchedRule,
      tierMatchedRule: "mode:plan",
      roleLocked,
      deterministic: true,
      needsSemanticRouter: false,
      roleDecision,
    };
  }

  // 4. Empty text without workflow/plan mode
  if (!matchText) {
    const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);
    if (matchedSpecialist?.lockTierOnLabel) {
      const tier = coerceAutoRoutingTier(matchedSpecialist.preferredTier || fallbackTier);
      const phase = defaultPhaseForTier(tier, config);
      return {
        role,
        tier,
        phase,
        roleMatchedRule,
        tierMatchedRule: "label:role_tier",
        roleLocked,
        deterministic: true,
        needsSemanticRouter: false,
        roleDecision,
      };
    }

    const tier = matchedSpecialist?.preferredTier
      ? coerceAutoRoutingTier(matchedSpecialist.preferredTier)
      : fallbackTier;
    const phase = defaultPhaseForTier(tier, config);
    return {
      role,
      tier,
      phase,
      roleMatchedRule,
      tierMatchedRule: "default_empty",
      roleLocked,
      deterministic: true,
      needsSemanticRouter: false,
      roleDecision,
    };
  }

  // 5. Exact anchored slash command routing table
  if (matchText.startsWith("/")) {
    const tokens = matchText.split(/\s+/);
    const cmd = tokens[0]?.toLowerCase() ?? "";
    const sub = tokens[1]?.toLowerCase() ?? "";

    for (const entry of BUILTIN_SLASH_COMMAND_ROUTES) {
      if (cmd !== entry.command.toLowerCase()) {
        continue;
      }
      if (entry.subcommands && (!sub || !entry.subcommands.includes(sub))) {
        continue;
      }

      if (!roleLocked && entry.role) {
        const slashSpec = lookupSpecialist(entry.role, config);
        if (slashSpec) {
          matchedSpecialist = slashSpec;
          role = slashSpec.id;
          roleMatchedRule = `slash:${entry.command}`;
        }
      }

      const tier: MatrixTier = matchedSpecialist?.lockTierOnLabel
        ? coerceAutoRoutingTier(matchedSpecialist.preferredTier || entry.tier, entry.phase)
        : entry.tier;
      const phase: HarnessPhase = matchedSpecialist?.lockTierOnLabel
        ? defaultPhaseForTier(tier, config)
        : entry.phase;

      const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);
      return {
        role,
        tier,
        phase,
        roleMatchedRule,
        tierMatchedRule: `slash:${entry.command}`,
        roleLocked,
        deterministic: true,
        needsSemanticRouter: false,
        roleDecision,
      };
    }
  }

  // 6. Exact anchored Conventional Commit prefixes
  const convMatch = /^([a-z]+)(?:\([^)\n]{1,40}\))?!?\s*[:：]/i.exec(matchText);
  if (convMatch?.[1]) {
    const prefix = convMatch[1].toLowerCase();
    const matchedFast = FAST_CONVENTIONAL_PREFIX_SET.has(prefix);
    const matchedStandard = STANDARD_CONVENTIONAL_PREFIX_SET.has(prefix);
    if (matchedFast || matchedStandard) {
      const convTier: MatrixTier = matchedFast ? "fast" : "standard";
      const tier: MatrixTier = matchedSpecialist?.lockTierOnLabel
        ? coerceAutoRoutingTier(matchedSpecialist.preferredTier || convTier)
        : convTier;
      const phase = matchedSpecialist?.lockTierOnLabel ? defaultPhaseForTier(tier, config) : "exec";
      const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);
      return {
        role,
        tier,
        phase,
        roleMatchedRule,
        tierMatchedRule: `conventional:${prefix}`,
        roleLocked,
        deterministic: true,
        needsSemanticRouter: false,
        roleDecision,
      };
    }
  }

  // 7. User-configured custom specialist matchPatterns (built-ins ship with empty `matchPatterns`)
  if (!roleLocked && config?.specialists) {
    for (const specialist of config.specialists) {
      if (
        !specialist.enabled ||
        specialist.id === "orchestrator" ||
        !specialist.matchPatterns.length
      ) {
        continue;
      }
      for (const patternStr of specialist.matchPatterns) {
        const regex = compileSafeRegex(patternStr);
        if (regex?.test(matchText)) {
          role = specialist.id;
          roleMatchedRule = `custom_pattern:${specialist.id}`;
          matchedSpecialist = specialist;
          break;
        }
      }
      if (matchedSpecialist) break;
    }
  }

  // 8. Fallback for unstructured natural language
  if (roleLocked && matchedSpecialist?.lockTierOnLabel) {
    const tier = coerceAutoRoutingTier(matchedSpecialist.preferredTier || fallbackTier);
    const phase = defaultPhaseForTier(tier, config);
    const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);
    return {
      role,
      tier,
      phase,
      roleMatchedRule,
      tierMatchedRule: "label:role_tier",
      roleLocked,
      deterministic: true,
      needsSemanticRouter: false,
      roleDecision,
    };
  }

  const tier = matchedSpecialist?.preferredTier
    ? coerceAutoRoutingTier(matchedSpecialist.preferredTier)
    : fallbackTier;
  const phase = defaultPhaseForTier(tier, config);
  const roleDecision = buildRoleDecision(role, roleMatchedRule, homeDir, config);

  return {
    role,
    tier,
    phase,
    roleMatchedRule,
    tierMatchedRule: "default_fallback",
    roleLocked,
    deterministic: false,
    needsSemanticRouter: true,
    roleDecision,
  };
}

/**
 * Legacy sync wrapper delegating to L0 `detectIntentDeterministic`.
 * Never uses natural-language regexes.
 */
export function detectIntentRoute(
  text: string | null | undefined,
  config?: EffectiveHarnessConfig | null,
): {
  tier: MatrixTier;
  phase: HarnessPhase;
  matchedRule: string;
} {
  const result = detectIntentDeterministic({ text, config });
  return {
    tier: result.tier,
    phase: result.phase,
    matchedRule: result.tierMatchedRule,
  };
}

export function detectMatrixTier(
  text: string | null | undefined,
  config?: EffectiveHarnessConfig | null,
): {
  tier: MatrixTier;
  phase: HarnessPhase;
  matchedRule: string;
} {
  return detectIntentRoute(text, config);
}

/**
 * Legacy sync role resolution delegating to L0 `detectIntentDeterministic`.
 */
export function detectDomainRole(options: {
  text?: string | null;
  labels?: Readonly<Record<string, string>> | null;
  homeDir?: string;
  config?: EffectiveHarnessConfig | null;
}): DomainRoleDecision {
  return detectIntentDeterministic({
    text: options.text,
    labels: options.labels,
    homeDir: options.homeDir,
    config: options.config,
  }).roleDecision;
}

export function resolveMatrixModel(options: {
  provider: string;
  currentModel?: string | null;
  text?: string | null;
  customMappings?: Record<string, Partial<ProviderModelMapping>>;
  overrideIfDefaultOnly?: boolean;
  config?: EffectiveHarnessConfig | null;
}): RouterDecision {
  const {
    provider,
    currentModel,
    text,
    customMappings,
    overrideIfDefaultOnly = true,
    config,
  } = options;
  const normalizedProvider = normalizeProviderName(provider);
  const canonicalProvider = canonicalizeProviderName(provider);

  if (isProviderBypassed(provider, config)) {
    return {
      tier: "standard",
      targetModel: currentModel ?? "",
      targetThinking: null,
      phase: "exec",
      reason: `${provider} is excluded from orchestration routing`,
      matchedRule: "bypass_safety_net",
      previousModel: currentModel ?? undefined,
    };
  }

  const effectiveBypassModels = config?.bypassModels ?? BUILTIN_BYPASS_MODELS;
  if (isModelBypassed(currentModel, effectiveBypassModels)) {
    return {
      tier: "standard",
      targetModel: currentModel ?? "",
      targetThinking: null,
      phase: "exec",
      reason: `Model '${currentModel}' is excluded from harness routing`,
      matchedRule: "bypass_orchestrator_model",
      previousModel: currentModel ?? undefined,
    };
  }

  const { tier, phase, matchedRule } = detectIntentRoute(text, config);

  let resolvedTarget;
  let resolvedProviderMapping: ProviderModelMapping | undefined;

  if (config) {
    resolvedTarget = resolveTierTarget(config, normalizedProvider, tier, phase);
  } else {
    let defaultMapping = IDENTITY_MAPPING;
    if (Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, normalizedProvider)) {
      defaultMapping = DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]!;
    } else if (Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, canonicalProvider)) {
      defaultMapping = DEFAULT_PROVIDER_MAPPINGS[canonicalProvider]!;
    }
    const customOverride =
      customMappings &&
      (Object.hasOwn(customMappings, normalizedProvider) ||
        Object.hasOwn(customMappings, canonicalProvider) ||
        Object.hasOwn(customMappings, provider))
        ? (customMappings[normalizedProvider] ??
          customMappings[canonicalProvider] ??
          customMappings[provider])
        : undefined;

    const providerMapping: ProviderModelMapping = { ...defaultMapping };
    if (customOverride) {
      for (const [k, v] of Object.entries(customOverride)) {
        if (typeof v === "string" && v.trim()) {
          providerMapping[k] = v.trim();
        }
      }
      if (customOverride.flash?.trim() && !customOverride.standard?.trim()) {
        providerMapping.standard = customOverride.flash.trim();
      }
      if (customOverride.deep?.trim()) {
        if (!customOverride.plan?.trim()) providerMapping.plan = customOverride.deep.trim();
        if (!customOverride.review?.trim()) providerMapping.review = customOverride.deep.trim();
      }
      if (customOverride.plan?.trim() && !customOverride.deep?.trim()) {
        providerMapping.deep = customOverride.plan.trim();
      }
    }
    resolvedProviderMapping = providerMapping;
    resolvedTarget = resolveTierTarget(
      {
        providerMappings: { [normalizedProvider]: providerMapping },
        providerThinkingMappings: BUILTIN_PROVIDER_THINKING_MAPPINGS,
      },
      normalizedProvider,
      tier,
      phase,
    );
  }

  const targetModel = resolvedTarget.model;
  const targetThinking = resolvedTarget.thinkingOptionId;

  const isDefaultModel = isDefaultOrUnsetModel(provider, currentModel, customMappings, config);
  const { maxOnlyModel } = collectNonMaxAndLegacyModels({
    provider,
    config,
    customMappings,
  });

  const shouldOverride = config ? config.overrideIfDefaultOnly : overrideIfDefaultOnly;

  if (shouldOverride && !isDefaultModel && currentModel) {
    const isDedicatedMaxModel = Boolean(maxOnlyModel && currentModel === maxOnlyModel);
    if (isDedicatedMaxModel) {
      const defaultMap =
        DEFAULT_PROVIDER_MAPPINGS[normalizedProvider] ??
        DEFAULT_PROVIDER_MAPPINGS[canonicalProvider];
      const maxTarget = config
        ? resolveTierTarget(config, normalizedProvider, "max")
        : resolveTierTarget(
            {
              providerMappings: {
                [normalizedProvider]: resolvedProviderMapping ?? defaultMap ?? IDENTITY_MAPPING,
              },
              providerThinkingMappings: BUILTIN_PROVIDER_THINKING_MAPPINGS,
            },
            normalizedProvider,
            "max",
          );
      return {
        tier: "max",
        targetModel: currentModel,
        targetThinking: maxTarget.thinkingOptionId,
        phase,
        reason: `Preserving user-selected dedicated max model '${currentModel}' (phase: ${phase})`,
        matchedRule: `preserve_user_choice (${matchedRule})`,
        previousModel: currentModel,
      };
    }

    return {
      tier,
      targetModel: currentModel,
      targetThinking: null,
      phase,
      reason: `Preserving user-selected model '${currentModel}' (detected tier: ${tier}, phase: ${phase})`,
      matchedRule: `preserve_user_choice (${matchedRule})`,
      previousModel: currentModel,
    };
  }

  return {
    tier,
    targetModel: targetModel || currentModel || "",
    targetThinking,
    phase,
    reason: `Routed to ${tier} model '${targetModel}' (phase: ${phase}) based on intent`,
    matchedRule,
    previousModel: currentModel ?? undefined,
  };
}

export function resolveHarnessEnv(options: {
  role: DomainRole;
  existingEnv?: Readonly<Record<string, string>>;
  homeDir?: string;
  config?: EffectiveHarnessConfig | null;
  provider?: string;
  isLeaf?: boolean;
}): Record<string, string> {
  const { role, existingEnv, homeDir, config, provider, isLeaf } = options;
  if (config) {
    const specialist = findSpecialist(config, role) ?? {
      id: role,
      name: role,
      shortLabel: role,
      description: "",
      icon: "Bot",
      enabled: true,
      builtIn: false,
      handoffEnabled: false,
      handoffPriority: 50,
      handoffTitlePrefix: "",
      handoffDefaultPrompt: "",
      syncToDaemonProfile: false,
      primarySkills: [],
      mandatorySkillActivation: false,
      docsFocus: [],
      qualityGates: [],
      allowedMcpServers: [],
      excludedMcpServers: [],
      injectedMcpServers: [],
      extraEnv: {},
      aliases: [],
      matchPatterns: [],
      profileFilename: `${role}.json`,
      lazyToolSlice: `${role}.yaml`,
    };
    return resolveSpecialistEnvironment({
      config,
      specialist,
      existingEnv,
      homeDir,
      provider,
      isLeaf,
    });
  }

  const decision = buildRoleDecision(role, "env_resolve", homeDir);
  const baseEnv: Record<string, string> = { ...existingEnv };

  const isRoleSwitch = Boolean(baseEnv.PASEO_HARNESS_ROLE && baseEnv.PASEO_HARNESS_ROLE !== role);
  baseEnv.PASEO_HARNESS_ROLE = role;
  if (decision.profilePath) {
    baseEnv.PASEO_HARNESS_PROFILE = decision.profilePath;
  } else if (isRoleSwitch) {
    delete baseEnv.PASEO_HARNESS_PROFILE;
  }

  if (isLeaf) {
    baseEnv.PASEO_HARNESS_LEAF = "1";
  }

  if (!baseEnv.LAZY_TOOL_CONFIG || isRoleSwitch) {
    if (decision.lazyToolConfigPath) {
      baseEnv.LAZY_TOOL_CONFIG = decision.lazyToolConfigPath;
    } else if (isRoleSwitch) {
      delete baseEnv.LAZY_TOOL_CONFIG;
    }
  }

  return baseEnv;
}
