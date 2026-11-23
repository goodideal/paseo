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

  const mergedSpecialists = baseSpecialists.map((orig) => {
    const override = specialistOverrides[orig.id];
    if (!override && extraDocs.length === 0 && extraGates.length === 0) {
      return { ...orig };
    }

    const mergedDocs = Array.from(
      new Set([...orig.docsFocus, ...(override?.docsFocus ?? []), ...extraDocs]),
    );

    const mergedGates = Array.from(
      new Set([...orig.qualityGates, ...(override?.qualityGates ?? []), ...extraGates]),
    );

    const mergedSkills = Array.from(
      new Set([...orig.primarySkills, ...(override?.primarySkills ?? [])]),
    );

    return {
      ...orig,
      ...override,
      primarySkills: mergedSkills,
      docsFocus: mergedDocs,
      qualityGates: mergedGates,
      // For security, repoOverride cannot override built-in, profileFilename, or weaken readonly
      builtIn: orig.builtIn,
      profileFilename: orig.profileFilename,
      readonly: Boolean(orig.readonly || override?.readonly),
    };
  });

  return {
    ...hostSettings,
    enabled: isEnabled,
    defaultFallbackRole,
    defaultFallbackTier,
    bypassModels: hostSettings.bypassModels ?? BUILTIN_BYPASS_MODELS,
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
 * Normalizes legacy 3-tier names (`flash | plan | review`) and aliases (`lite`) into
 * canonical 4-tier complexity IDs (`fast | standard | deep | max`), preserving custom tier IDs.
 */
export function normalizeTierAlias(tier?: string | null): MatrixTier {
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
    case "review":
      return "deep";
    default:
      return norm;
  }
}

export interface ResolvedTierTarget {
  canonicalTier: MatrixTier;
  model: string;
  thinkingOptionId: string | null;
}

/**
 * Resolves both target model ID and thinking effort option for a provider + tier,
 * supporting both canonical 4-tier (`fast | standard | deep | max`) and legacy 3-tier
 * (`plan | flash | review`) keys as well as omitted `max` fallback (`deep + xhigh`).
 */
export function resolveTierTarget(
  config: Pick<EffectiveHarnessConfig, "providerMappings"> &
    Partial<Pick<EffectiveHarnessConfig, "providerThinkingMappings">>,
  provider: string,
  tier: string,
): ResolvedTierTarget {
  const rawTier = tier?.trim() || "standard";
  const rawLower = rawTier.toLowerCase();
  const canonicalTier = normalizeTierAlias(rawTier);
  const normProvider = normalizeProviderName(provider);
  const canonProvider = canonicalizeProviderName(provider);

  const canonMapping = config.providerMappings?.[canonProvider] ?? {};
  const rawMapping =
    config.providerMappings?.[normProvider] ?? config.providerMappings?.[provider] ?? {};
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

  let model = "";
  if (canonicalTier === "fast") {
    model = mapping.fast?.trim() || mapping.lite?.trim() || mapping.flash?.trim() || "";
  } else if (canonicalTier === "standard") {
    model = mapping.standard?.trim() || mapping.flash?.trim() || "";
  } else if (canonicalTier === "deep") {
    model =
      rawLower === "review" && mapping.review?.trim()
        ? mapping.review.trim()
        : mapping.deep?.trim() || mapping.plan?.trim() || mapping.review?.trim() || "";
  } else if (canonicalTier === "max") {
    model = mapping.max?.trim() || mapping.deep?.trim() || mapping.plan?.trim() || "";
  } else {
    model = mapping[rawTier]?.trim() || mapping[canonicalTier]?.trim() || "";
  }

  if (!model) {
    if (builtinMap?.[canonicalTier]?.trim()) {
      model = builtinMap[canonicalTier].trim();
    } else {
      model = rawLower === canonicalTier ? canonicalTier : rawTier;
    }
  }

  const explicitMaxModelMissing = canonicalTier === "max" && !mapping.max?.trim();
  const configuredThinking = thinkingMap[canonicalTier]?.trim() || thinkingMap[rawTier]?.trim();
  const fallbackThinking = explicitMaxModelMissing
    ? "xhigh"
    : (builtinThinkingMap[canonicalTier]?.trim() ?? "");

  const resolvedThinking =
    configuredThinking || (config.providerThinkingMappings ? "" : fallbackThinking);

  return {
    canonicalTier,
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

const MODEL_THINKING_SUFFIX_PATTERN = /-(?:low|medium|high|xhigh)$/i;

/**
 * Infers the canonical complexity tier from a concrete runtime model ID.
 * Checks configured mappings first, then built-in mappings (exact and without
 * trailing thinking suffix such as `-high`), and finally legacy v4 mappings.
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
      if (t === "deep") return 2;
      return 3;
    };
    nonMaxEntries.sort((a, b) => tierPriority(a[0]) - tierPriority(b[0]));

    for (const [tierKey, val] of nonMaxEntries) {
      if (val === candidate) {
        return {
          tier: tierKey,
          isKnownTierModel: true,
          isRouterManagedNonMax: true,
          isDedicatedMax: false,
        };
      }
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
  if (normProvider === "claude" || normProvider === "claude-code") {
    return "acceptEdits";
  }
  if (normProvider === "opencode") {
    return "build";
  }
  return null;
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
  if (tier === "plan") {
    return "design";
  }
  if (tier === "flash") {
    return "exec";
  }
  if (tier === "review" || specialistId === "review") {
    return "review";
  }
  if (specialistId === "pm" || specialistId === "architect") {
    return "design";
  }
  return "exec";
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
}): string {
  const { config, specialist, tier, targetModel, roleMatchedRule, homeDir, provider } = options;
  if (!config.injectSystemPromptBanner) {
    return "";
  }

  const canonicalProvider = canonicalizeProviderName(provider);
  const isAntigravity = canonicalProvider === "antigravity";

  // Federated root session: yield skills/MCP ownership to local synthesized target plugin/agents
  // and emit only the concise 3-line Federation Bridge.
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
      `- Matrix Tier: ${tier} (model: ${targetModel || "default"}${options.thinkingOptionId ? `, thinking: ${options.thinkingOptionId}` : ""}); ${ownerLabel} owns repo skills & MCP.`,
      ...(availableHandoffs
        ? [
            `- Cross-Client Handoff (\`harness_handoff\`): Available workspace specialists: ${availableHandoffs}.`,
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
  const rawPrimarySkills = specialist.primarySkills.filter(Boolean);
  const primarySkills = isAntigravity
    ? rawPrimarySkills
        .filter((s) => !s.startsWith("superpowers:"))
        .map((s) => (s.startsWith("mattpocock-skills:") ? s.slice("mattpocock-skills:".length) : s))
    : rawPrimarySkills;
  const allowedMcp = specialist.allowedMcpServers.filter(Boolean);
  const excludedMcp = specialist.excludedMcpServers.filter(Boolean);
  const qualityGates = specialist.qualityGates.filter(Boolean);
  const docsFocus = specialist.docsFocus.filter(Boolean);

  const phase = resolveBannerPhase(options.phase, tier, specialist.id);

  const phaseRule =
    specialist.rolePromptTemplate?.trim() ||
    config.phaseRules[specialist.id]?.trim() ||
    config.phaseRules[phase]?.trim() ||
    config.phaseRules[tier]?.trim() ||
    "";

  const lines = [
    "[Capability Harness Active Profile]",
    `- Role: ${specialist.id} (rule: ${roleMatchedRule})${specialist.description ? ` — ${specialist.description}` : ""}`,
    `- Matrix Tier: ${tier} (model: ${targetModel || "default"}${options.thinkingOptionId ? `, thinking: ${options.thinkingOptionId}` : ""})`,
    ...(profilePath ? [`- Profile Spec: ${profilePath}`] : []),
    ...(lazyToolConfigPath ? [`- Lazy-Tool Slice: ${lazyToolConfigPath}`] : []),
    ...(primarySkills.length > 0 ? [`- Primary Skills: ${primarySkills.join(", ")}`] : []),
    ...(specialist.skillsRoot ? [`- Skills Root: ${specialist.skillsRoot}`] : []),
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
    if (isAntigravity) {
      lines.push(
        `- Mandatory Skill Activation: Before authoring domain deliverables or code, you MUST read the \`SKILL.md\` file via \`read_file\` for at least one of your Primary Skills (${primarySkills.map((s) => `\`${s}\``).join(", ")}) from your skills root so its domain rules govern your implementation.`,
      );
    } else {
      lines.push(
        `- Mandatory Skill Activation: Before authoring domain deliverables or code, you MUST invoke the \`Skill\` tool to load at least one of your Primary Skills (${primarySkills.map((s) => `\`${s}\``).join(", ")}) so its domain rules govern your implementation.`,
      );
    }
  }

  if (phaseRule) {
    lines.push(phaseRule);
  }

  if (isAntigravity && !options.isLeaf) {
    lines.push(
      `- Antigravity Specialist Handoff (\`mcp_paseo_create_agent\`): Native \`harness_handoff\` is unavailable on Antigravity (\`supportsNativePaseoTools=false\`). To hand off or spawn a Paseo specialist (e.g. \`role=review\`, \`role=backend\`, \`role=ui\`, \`role=qa\`) instead of in-process \`invoke_subagent\`, call \`mcp_paseo_create_agent\` in this workspace with \`provider: "antigravity/<targetModel>"\` (\`review\`/\`architect\`/\`pm\` -> \`gemini-4-carbon\`, \`ui\`/\`backend\`/\`qa\` -> \`gemini-4-argon\`), \`labels: { "role": "<targetRole>", "paseo.harness-leaf": "1" }\`, and a self-contained \`initialPrompt\`.`,
    );
  }

  return lines.join("\n");
}

/**
 * Resolves session MCP servers in `agent.open.before` by applying allowed/excluded filtering
 * and injecting configured catalog servers.
 */
export function resolveSessionMcpServers(options: {
  config: EffectiveHarnessConfig;
  specialist: HarnessSpecialistConfig;
  existingMcpServers?: Record<string, any>;
}): Record<string, any> {
  const { config, specialist, existingMcpServers = {} } = options;
  if (!config.enforceSessionMcpFiltering) {
    return { ...existingMcpServers };
  }

  const result: Record<string, any> = {};
  const excludedSet = new Set(specialist.excludedMcpServers.map((s) => s.toLowerCase()));
  const allowedSet =
    specialist.allowedMcpServers.length > 0
      ? new Set(specialist.allowedMcpServers.map((s) => s.toLowerCase()))
      : null;

  // Filter existing servers
  for (const [key, val] of Object.entries(existingMcpServers)) {
    const lowerKey = key.toLowerCase();
    if (excludedSet.has(lowerKey)) {
      continue;
    }
    if (allowedSet && !allowedSet.has(lowerKey)) {
      continue;
    }
    result[key] = val;
  }

  // Inject catalog servers requested by specialist
  for (const injectKey of specialist.injectedMcpServers) {
    if (config.mcpServerCatalog[injectKey]) {
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
