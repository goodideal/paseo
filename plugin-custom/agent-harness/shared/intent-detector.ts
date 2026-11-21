import {
  compileSafeRegex,
  expandHomeDir,
  findSpecialist,
  joinPosixPath,
  normalizeProviderName,
  resolveSpecialistEnvironment,
  resolveSpecialistPaths,
  resolveTargetModelForTier,
} from "./config-resolver.js";
import {
  BUILTIN_CONVENTIONAL_EXEC_PREFIX,
  BUILTIN_EXEC_ACTION_PATTERNS,
  BUILTIN_FULLSTACK_BACKEND_PATTERN,
  BUILTIN_FULLSTACK_UI_PATTERN,
  BUILTIN_PLAN_PATTERNS,
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_REVIEW_PATTERNS,
  BUILTIN_SPECIALISTS,
} from "./presets.js";
import type {
  DomainRole,
  DomainRoleDecision,
  EffectiveHarnessConfig,
  HarnessSpecialistConfig,
  MatrixTier,
  ProviderModelMapping,
  RouterDecision,
} from "./types.js";

// Antigravity is isolated as an offline safety-net fallback and excluded from orchestration routing
export const SAFETY_NET_PROVIDER = "antigravity";

export function normalizeProvider(provider?: string | null): string {
  return normalizeProviderName(provider);
}

const IDENTITY_MAPPING: ProviderModelMapping = {
  plan: "plan",
  review: "review",
  flash: "flash",
};

export const DEFAULT_PROVIDER_MAPPINGS: Record<string, ProviderModelMapping> = {
  ...BUILTIN_PROVIDER_MAPPINGS,
  codex: IDENTITY_MAPPING,
  claude: IDENTITY_MAPPING,
};

// Anchored Conventional Commit or explicit execution slash command prefixes
export const CONVENTIONAL_EXEC_PREFIX: RegExp = compileSafeRegex(BUILTIN_CONVENTIONAL_EXEC_PREFIX)!;

function resolveHomeDir(homeDir?: string): string {
  if (homeDir?.trim()) return homeDir.trim();
  if (typeof process !== "undefined" && process?.env) {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    if (envHome?.trim()) return envHome.trim();
  }
  return "";
}

function buildRoleDecision(
  role: DomainRole,
  matchedRule: string,
  homeDir?: string,
  config?: EffectiveHarnessConfig | null,
): DomainRoleDecision {
  const resolvedHome = resolveHomeDir(homeDir);
  let specialistConfig: HarnessSpecialistConfig | undefined;

  if (config) {
    specialistConfig = findSpecialist(config, role);
  } else {
    specialistConfig = BUILTIN_SPECIALISTS.find((s) => s.id === role || s.aliases.includes(role));
  }

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

export function detectMatrixTier(
  text: string | null | undefined,
  config?: EffectiveHarnessConfig | null,
): {
  tier: MatrixTier;
  matchedRule: string;
} {
  const fallbackTier = config?.defaultFallbackTier ?? "flash";
  if (!text || !text.trim()) {
    return { tier: fallbackTier, matchedRule: "default_empty" };
  }

  const trimmed = text.trim();

  // 1. Anchored conventional commit or execution command prefix always stays on flash execution track
  const conventionalPatternStr =
    config?.tierPatterns.conventionalExecPrefix ?? BUILTIN_CONVENTIONAL_EXEC_PREFIX;
  const conventionalRegex = compileSafeRegex(conventionalPatternStr);
  if (conventionalRegex?.test(trimmed)) {
    return { tier: "flash", matchedRule: `exec_override:${conventionalPatternStr}` };
  }

  // 2. Explicit Code Review & Quality Gate Check
  const reviewPatterns = config?.tierPatterns.review ?? BUILTIN_REVIEW_PATTERNS;
  for (const patternStr of reviewPatterns) {
    const regex = compileSafeRegex(patternStr);
    if (regex?.test(trimmed)) {
      return { tier: "review", matchedRule: `review:${patternStr}` };
    }
  }

  // 3. Concrete execution actions take precedence over broad plan keywords
  const execPatterns = config?.tierPatterns.execAction ?? BUILTIN_EXEC_ACTION_PATTERNS;
  for (const patternStr of execPatterns) {
    const regex = compileSafeRegex(patternStr);
    if (regex?.test(trimmed)) {
      return { tier: "flash", matchedRule: `exec_action:${patternStr}` };
    }
  }

  // 4. Plan & Architecture Exploration when strategic keywords are present
  const planPatterns = config?.tierPatterns.plan ?? BUILTIN_PLAN_PATTERNS;
  for (const patternStr of planPatterns) {
    const regex = compileSafeRegex(patternStr);
    if (regex?.test(trimmed)) {
      return { tier: "plan", matchedRule: `plan:${patternStr}` };
    }
  }

  return { tier: fallbackTier, matchedRule: "default_fallback" };
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
  const normalizedProvider = normalizeProvider(provider);

  // Bypass safety-net or configured bypass providers
  const isBypassed = config
    ? config.bypassProviders.some((p) => p.toLowerCase() === normalizedProvider)
    : normalizedProvider === SAFETY_NET_PROVIDER;

  if (isBypassed) {
    return {
      tier: "flash",
      targetModel: currentModel ?? "",
      reason: `${provider} is excluded from orchestration routing`,
      matchedRule: "bypass_safety_net",
      previousModel: currentModel ?? undefined,
    };
  }

  const { tier, matchedRule } = detectMatrixTier(text, config);

  let targetModel = "";
  if (config) {
    targetModel = resolveTargetModelForTier(config, normalizedProvider, tier);
  } else {
    const defaultMapping = Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, normalizedProvider)
      ? DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]
      : IDENTITY_MAPPING;
    const customOverride =
      customMappings &&
      (Object.hasOwn(customMappings, normalizedProvider) || Object.hasOwn(customMappings, provider))
        ? (customMappings[normalizedProvider] ?? customMappings[provider])
        : undefined;

    const providerMapping: ProviderModelMapping = { ...defaultMapping };
    if (customOverride) {
      for (const [k, v] of Object.entries(customOverride)) {
        if (typeof v === "string" && v.trim()) {
          providerMapping[k] = v.trim();
        }
      }
    }
    targetModel = providerMapping[tier] || defaultMapping[tier] || currentModel || "";
  }

  // Treat unset or router-managed tier models as routable defaults; preserve custom user models
  const routerManagedModels = new Set<string>(
    [
      "plan",
      "review",
      "flash",
      ...(config ? Object.values(config.providerMappings[normalizedProvider] ?? {}) : []),
      DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]?.plan,
      DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]?.review,
      DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]?.flash,
    ].filter((m): m is string => Boolean(m?.trim())),
  );
  const isDefaultModel = !currentModel || routerManagedModels.has(currentModel);

  const shouldOverride =
    config !== undefined ? config.overrideIfDefaultOnly : overrideIfDefaultOnly;

  if (shouldOverride && !isDefaultModel) {
    return {
      tier,
      targetModel: currentModel,
      reason: `Preserving user-selected model '${currentModel}' (detected tier: ${tier})`,
      matchedRule: `preserve_user_choice (${matchedRule})`,
      previousModel: currentModel,
    };
  }

  return {
    tier,
    targetModel: targetModel || currentModel || "",
    reason: `Routed to ${tier} model '${targetModel}' based on intent`,
    matchedRule,
    previousModel: currentModel ?? undefined,
  };
}

export function detectDomainRole(options: {
  text?: string | null;
  labels?: Readonly<Record<string, string>> | null;
  homeDir?: string;
  config?: EffectiveHarnessConfig | null;
}): DomainRoleDecision {
  const { text, labels, homeDir, config } = options;

  // 1. Label check
  for (const labelKey of ["role", "profile"] as const) {
    const rawLabel = labels?.[labelKey];
    const normalized = rawLabel?.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    const matchedSpecialist = config
      ? findSpecialist(config, normalized)
      : BUILTIN_SPECIALISTS.find((s) => s.id === normalized || s.aliases.includes(normalized));

    if (matchedSpecialist) {
      return buildRoleDecision(matchedSpecialist.id, `label:${labelKey}`, homeDir, config);
    }
  }

  const trimmed = text?.trim() ?? "";
  if (trimmed) {
    // 2. Composite Full-Stack / Multi-Domain Collision Check:
    const enableFullstack = config?.enableFullstackOrchestratorCollision ?? true;
    if (enableFullstack) {
      const uiPatternStr = config?.fullstackUiPattern ?? BUILTIN_FULLSTACK_UI_PATTERN;
      const backendPatternStr =
        config?.fullstackBackendPattern ?? BUILTIN_FULLSTACK_BACKEND_PATTERN;
      const uiRegex = compileSafeRegex(uiPatternStr);
      const backendRegex = compileSafeRegex(backendPatternStr);

      if (uiRegex?.test(trimmed) && backendRegex?.test(trimmed)) {
        return buildRoleDecision(
          "orchestrator",
          "heuristic:fullstack_orchestrator",
          homeDir,
          config,
        );
      }
    }

    // 3. Specialist match patterns
    const specialists = config?.specialists ?? BUILTIN_SPECIALISTS;
    for (const specialist of specialists) {
      if (!specialist.enabled) continue;
      for (const patternStr of specialist.matchPatterns) {
        const regex = compileSafeRegex(patternStr);
        if (regex?.test(trimmed)) {
          return buildRoleDecision(specialist.id, `heuristic:${specialist.id}`, homeDir, config);
        }
      }
    }
  }

  const fallbackRole = config?.defaultFallbackRole ?? "general";
  return buildRoleDecision(fallbackRole, "default_general", homeDir, config);
}

export function resolveHarnessEnv(options: {
  role: DomainRole;
  existingEnv?: Readonly<Record<string, string>>;
  homeDir?: string;
  config?: EffectiveHarnessConfig | null;
}): Record<string, string> {
  const { role, existingEnv, homeDir, config } = options;
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

  if (!baseEnv.LAZY_TOOL_CONFIG || isRoleSwitch) {
    if (decision.lazyToolConfigPath) {
      baseEnv.LAZY_TOOL_CONFIG = decision.lazyToolConfigPath;
    } else if (isRoleSwitch) {
      delete baseEnv.LAZY_TOOL_CONFIG;
    }
  }

  return baseEnv;
}

export interface LlmIntentClassifierOptions {
  text: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function classifyIntentWithLlm(
  options: LlmIntentClassifierOptions,
): Promise<{ role: DomainRole; tier: MatrixTier } | null> {
  const trimmed = options.text?.trim();
  if (!trimmed) {
    return null;
  }

  const fetchFn = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchFn) {
    return null;
  }

  let endpoint =
    options.endpoint?.trim() ||
    (typeof process !== "undefined" ? process.env?.HARNESS_LLM_ENDPOINT?.trim() : "");
  let apiKey =
    options.apiKey?.trim() ||
    (typeof process !== "undefined" ? process.env?.HARNESS_LLM_API_KEY?.trim() : "") ||
    "";

  if (!endpoint && options.fetchImpl) {
    endpoint = "https://llm.invalid/v1/chat/completions";
    apiKey = apiKey || "test-placeholder-key";
  }

  if (!endpoint) {
    return null;
  }

  const model = options.model || "lite";
  const timeoutMs = options.timeoutMs ?? 450;

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 45,
        messages: [
          {
            role: "system",
            content:
              'Classify coding task into JSON {"role":"ui"|"backend"|"pm"|"architect"|"qa"|"review"|"scout"|"general","tier":"flash"|"plan"|"review"}. Output raw JSON only.',
          },
          {
            role: "user",
            content: trimmed.slice(0, 500),
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      return null;
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as { role?: unknown; tier?: unknown };
    const role =
      typeof parsed.role === "string" && parsed.role.trim() ? parsed.role.trim() : "general";
    const tier =
      typeof parsed.tier === "string" && parsed.tier.trim() ? parsed.tier.trim() : "flash";

    return { role, tier };
  } catch {
    return null;
  }
}

export async function detectDomainRoleHybrid(options: {
  text?: string | null;
  labels?: Readonly<Record<string, string>> | null;
  homeDir?: string;
  config?: EffectiveHarnessConfig | null;
  llmFallback?: Omit<LlmIntentClassifierOptions, "text"> & { enabled?: boolean };
}): Promise<DomainRoleDecision> {
  const fastDecision = detectDomainRole(options);
  if (fastDecision.matchedRule !== "default_general") {
    return fastDecision;
  }

  const trimmed = options.text?.trim() ?? "";
  if (!trimmed || options.llmFallback?.enabled === false) {
    return fastDecision;
  }

  const llmResult = await classifyIntentWithLlm({
    ...options.llmFallback,
    text: trimmed,
  });

  if (llmResult && llmResult.role !== "general") {
    return buildRoleDecision(
      llmResult.role,
      `llm_fallback:${llmResult.role}`,
      options.homeDir,
      options.config,
    );
  }

  return fastDecision;
}
