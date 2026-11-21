import type { AgentHarnessSettings } from "./settings.js";
import type {
  EffectiveHarnessConfig,
  HarnessSpecialistConfig,
  McpServerConfigEntry,
  RepoHarnessOverride,
} from "./types.js";

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
 * Merges Host Settings with optional Repo-level overrides into an EffectiveHarnessConfig.
 */
export function resolveEffectiveHarnessConfig(
  hostSettings: AgentHarnessSettings,
  repoOverride?: RepoHarnessOverride | null,
  repoRoot?: string,
): EffectiveHarnessConfig {
  const isEnabled =
    repoOverride?.enabled !== undefined ? repoOverride.enabled : hostSettings.enabled;

  const defaultFallbackRole =
    repoOverride?.defaultFallbackRole?.trim() || hostSettings.defaultFallbackRole;
  const defaultFallbackTier =
    repoOverride?.defaultFallbackTier?.trim() || hostSettings.defaultFallbackTier;

  // Clone specialists and apply repo overrides if present
  const specialistOverrides = repoOverride?.specialistOverrides ?? {};
  const extraDocs = repoOverride?.extraDocsFocus ?? [];
  const extraGates = repoOverride?.extraQualityGates ?? [];

  const mergedSpecialists = hostSettings.specialists.map((orig) => {
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
      // For security, repoOverride cannot override built-in or profileFilename
      builtIn: orig.builtIn,
      profileFilename: orig.profileFilename,
    };
  });

  return {
    ...hostSettings,
    enabled: isEnabled,
    defaultFallbackRole,
    defaultFallbackTier,
    specialists: mergedSpecialists,
    repoOverrideLoaded: Boolean(repoOverride),
    repoRoot,
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
 * Resolves the target model ID for a given provider and tier.
 */
export function resolveTargetModelForTier(
  config: EffectiveHarnessConfig,
  provider: string,
  tier: string,
): string {
  const normProvider = normalizeProviderName(provider);
  const mapping = config.providerMappings[normProvider] ?? config.providerMappings[provider];
  if (mapping && mapping[tier]?.trim()) {
    return mapping[tier].trim();
  }
  return tier;
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
export function buildSystemPromptBanner(options: {
  config: EffectiveHarnessConfig;
  specialist: HarnessSpecialistConfig;
  tier: string;
  targetModel: string;
  roleMatchedRule: string;
  tierMatchedRule: string;
  homeDir?: string;
}): string {
  const { config, specialist, tier, targetModel, roleMatchedRule, homeDir } = options;
  if (!config.injectSystemPromptBanner) {
    return "";
  }

  const { profilePath, lazyToolConfigPath } = resolveSpecialistPaths(config, specialist, homeDir);
  const primarySkills = specialist.primarySkills.filter(Boolean);
  const allowedMcp = specialist.allowedMcpServers.filter(Boolean);
  const excludedMcp = specialist.excludedMcpServers.filter(Boolean);
  const qualityGates = specialist.qualityGates.filter(Boolean);
  const docsFocus = specialist.docsFocus.filter(Boolean);

  const phase =
    tier === "plan" ? "design" : tier === "flash" ? "exec" : tier === "review" ? "review" : tier;

  const phaseRule =
    specialist.rolePromptTemplate?.trim() ||
    config.phaseRules[specialist.id]?.trim() ||
    config.phaseRules[phase]?.trim() ||
    config.phaseRules[tier]?.trim() ||
    "";

  const lines = [
    "[Capability Harness Active Profile]",
    `- Role: ${specialist.id} (rule: ${roleMatchedRule})${specialist.description ? ` — ${specialist.description}` : ""}`,
    `- Matrix Tier: ${tier} (model: ${targetModel || "default"})`,
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

  if (specialist.mandatorySkillActivation && primarySkills.length > 0) {
    lines.push(
      `- Mandatory Skill Activation: Before authoring domain deliverables or code, you MUST invoke the \`Skill\` tool to load at least one of your Primary Skills (${primarySkills.map((s) => `\`${s}\``).join(", ")}) so its domain rules govern your implementation.`,
    );
  }

  if (phaseRule) {
    lines.push(phaseRule);
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
 * Resolves environment variables to inject for a specialist session.
 */
export function resolveSpecialistEnvironment(options: {
  config: EffectiveHarnessConfig;
  specialist: HarnessSpecialistConfig;
  existingEnv?: Readonly<Record<string, string>>;
  homeDir?: string;
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

  if (lazyToolConfigPath) {
    if (!baseEnv.LAZY_TOOL_CONFIG || isRoleSwitch) {
      baseEnv.LAZY_TOOL_CONFIG = lazyToolConfigPath;
    }
  } else if (isRoleSwitch) {
    delete baseEnv.LAZY_TOOL_CONFIG;
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
