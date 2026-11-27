import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { canonicalizeProviderName, normalizePrimarySkills } from "./config-resolver.js";
import {
  BUILTIN_BYPASS_MODELS,
  BUILTIN_PHASE_RULES,
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_PROVIDER_MODES,
  BUILTIN_PROVIDER_THINKING_MAPPINGS,
  BUILTIN_SPECIALISTS,
  BUILTIN_TIERS,
  LEGACY_ORCHESTRATOR_DISPATCHER_RULE,
  LEGACY_V3_EXEC_PHASE_RULE,
  LEGACY_V3_REVIEW_DESCRIPTION,
  LEGACY_V3_REVIEW_HANDOFF_PROMPT,
  LEGACY_V3_REVIEW_PHASE_RULE,
  LEGACY_V4_DESIGN_PHASE_RULE,
  LEGACY_V4_EXEC_PHASE_RULE,
  LEGACY_V4_ORCHESTRATOR_DISPATCHER_RULE,
  LEGACY_V4_PROVIDER_MAPPINGS,
  LEGACY_V4_REVIEW_PHASE_RULE,
  LEGACY_V5_EXEC_ACTION_PATTERN,
  LEGACY_V5_FULLSTACK_UI_PATTERN,
  LEGACY_V5_GENERAL_ALLOWED_MCP,
  LEGACY_V5_UI_ALLOWED_MCP,
  LEGACY_V5_UI_MATCH_PATTERNS,
  LEGACY_V6_SPECIALIST_PRIMARY_SKILLS,
  LEGACY_V7_BACKEND_MATCH_PATTERNS,
  LEGACY_V7_PM_PRIMARY_SKILLS,
  LEGACY_V7_UI_MATCH_PATTERNS,
  LEGACY_V8_DESIGN_PHASE_RULE,
  LEGACY_V8_EXEC_PHASE_RULE,
  LEGACY_V8_ORCHESTRATOR_DISPATCHER_RULE,
  LEGACY_V8_PROVIDER_MAPPINGS,
  LEGACY_V8_PROVIDER_THINKING_MAPPINGS,
  LEGACY_V8_REVIEW_PHASE_RULE,
  LEGACY_V8_SPECIALIST_PRIMARY_SKILLS,
  LEGACY_V8_SPECIALIST_PROVIDERS,
} from "./presets.js";

const LEGACY_V5_AFFIRMATIVE_CONFIRM_WORDS: readonly string[] = [
  "继续",
  "好",
  "可以",
  "行",
  "没问题",
  "ok",
  "lgtm",
  "go ahead",
  "proceed",
  "yes",
  "sure",
  "start",
  "开始吧",
  "改吧",
  "做吧",
  "搞起",
  "干吧",
];

const DEFAULT_AFFIRMATIVE_CONFIRM_WORDS: readonly string[] = [
  ...LEGACY_V5_AFFIRMATIVE_CONFIRM_WORDS,
  "ok, continue",
  "go",
];

function cloneBuiltinProviderMappings(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(BUILTIN_PROVIDER_MAPPINGS).map(([k, v]) => [k, { ...v }]),
  );
}

function cloneBuiltinProviderThinkingMappings(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(BUILTIN_PROVIDER_THINKING_MAPPINGS).map(([k, v]) => [k, { ...v }]),
  );
}

function cloneBuiltinProviderModes(): Record<string, z.infer<typeof ProviderModeConfigSchema>> {
  return Object.fromEntries(Object.entries(BUILTIN_PROVIDER_MODES).map(([k, v]) => [k, { ...v }]));
}

function isLegacyOrchestratorPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return (
    trimmed === LEGACY_ORCHESTRATOR_DISPATCHER_RULE ||
    trimmed ===
      "Spawn via paseo run --provider claude --mode bypassPermissions --label role=architect"
  );
}

/* Schemas for Granular Elements */

export const HarnessTierConfigSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  icon: z.string().optional().default("Compass"),
  defaultPhase: z.string().optional().default("exec"),
  description: z.string().optional().default(""),
});

export const ProviderModeConfigSchema = z.object({
  supportsNativePlanMode: z.boolean().default(false),
  resumeExecutionModeId: z.string().optional(),
});

export const McpServerConfigEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    alwaysLoad: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("http"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    alwaysLoad: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("sse"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    alwaysLoad: z.boolean().default(false),
  }),
]);

export const HarnessSpecialistConfigSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(
      /^[a-z][a-z0-9_-]*$/,
      "ID must start with a letter and contain only lowercase, numbers, _, -",
    ),
  name: z.string().min(1).max(80),
  shortLabel: z.string().min(1).max(24),
  description: z.string().optional().default(""),
  icon: z.string().optional().default("Bot"),
  color: z.string().optional().default("slate"),
  enabled: z.boolean().default(true),
  builtIn: z.boolean().default(false),
  readonly: z.boolean().optional(),
  preferredProvider: z.string().optional().default(""),
  preferredTier: z.string().optional().default("standard"),
  modelOverride: z.string().optional().default(""),
  defaultModeId: z.string().optional().default(""),
  thinkingOptionId: z.string().optional().default(""),
  lockTierOnLabel: z.boolean().default(false),
  handoffEnabled: z.boolean().default(false),
  handoffPriority: z.number().int().default(50),
  handoffTitlePrefix: z.string().optional().default(""),
  handoffDefaultPrompt: z.string().optional().default(""),
  syncToDaemonProfile: z.boolean().default(true),
  primarySkills: z.array(z.string()).default(() => []),
  mandatorySkillActivation: z.boolean().default(true),
  skillsRoot: z.string().optional().default(""),
  docsFocus: z.array(z.string()).default(() => []),
  qualityGates: z.array(z.string()).default(() => []),
  ssotOutputTarget: z.string().optional().default(""),
  rolePromptTemplate: z.string().optional().default(""),
  lazyToolSlice: z.string().optional().default(""),
  allowedMcpServers: z.array(z.string()).default(() => []),
  excludedMcpServers: z.array(z.string()).default(() => []),
  injectedMcpServers: z.array(z.string()).default(() => []),
  extraEnv: z.record(z.string(), z.string()).default(() => ({})),
  aliases: z.array(z.string()).default(() => []),
  matchPatterns: z.array(z.string()).default(() => []),
  profileFilename: z.string().optional().default(""),
});

export const TierPatternsSchema = z.object({
  plan: z.array(z.string()).default(() => []),
  review: z.array(z.string()).default(() => []),
  fastAction: z.array(z.string()).default(() => []),
  execAction: z.array(z.string()).default(() => []),
  conventionalExecPrefix: z.string().default(""),
});

export const RouterEffortSchema = z.enum(["low", "medium", "high"]).default("low");

/* Top-Level Settings Schema (v9) */

export const AgentHarnessSettingsSchema = z.object({
  // Domain 5: Core & Lifecycle Gates
  enabled: z.boolean().default(true),
  overrideIfDefaultOnly: z.boolean().default(true),
  debugLogs: z.boolean().default(false),
  phaseLifecycleEnabled: z.boolean().default(true),
  planTurnSoftLimit: z.number().int().min(1).max(20).default(3),
  autoDowngradePlanOnExec: z.boolean().default(true),
  enforceNativePlanMode: z.boolean().default(true),
  emitTimelineTransitions: z.boolean().default(true),
  docWhitelistPattern: z.string().default("\\.(?:md|mdx|txt)$|^openspec\\/"),
  affirmativeConfirmWords: z
    .array(z.string())
    .default(() => [...DEFAULT_AFFIRMATIVE_CONFIRM_WORDS]),

  // Domain 3: Skills, MCP & Disk Synchronization
  profilesDir: z.string().default("~/.agents/profiles"),
  lazyToolProfilesDir: z.string().default("~/.config/lazy-tool/profiles"),
  defaultSkillsRoot: z.string().default("~/.agents/skills"),
  autoSyncDiskProfiles: z.boolean().default(true),
  autoSyncDaemonAgentProfiles: z.boolean().default(true),
  enforceSessionMcpFiltering: z.boolean().default(false),
  mcpServerCatalog: z.record(z.string(), McpServerConfigEntrySchema).default(() => ({})),

  // Domain 2: Models & Providers Matrix
  tiers: z
    .array(HarnessTierConfigSchema)
    .default(() => BUILTIN_TIERS.map((t) => HarnessTierConfigSchema.parse(t))),
  providerMappings: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default(cloneBuiltinProviderMappings),
  providerThinkingMappings: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default(cloneBuiltinProviderThinkingMappings),
  providerModes: z.record(z.string(), ProviderModeConfigSchema).default(cloneBuiltinProviderModes),
  bypassProviders: z.array(z.string()).default(() => []),
  bypassModels: z.array(z.string()).default(() => [...BUILTIN_BYPASS_MODELS]),
  honorSpecialistPreferredProvider: z.boolean().default(true),

  // Domain 1: Specialists & Roles
  specialists: z
    .array(HarnessSpecialistConfigSchema)
    .default(() => BUILTIN_SPECIALISTS.map((s) => HarnessSpecialistConfigSchema.parse(s))),
  defaultFallbackRole: z.string().default("general"),
  defaultFallbackTier: z.string().default("standard"),

  // Domain 4: Semantic Intent Router
  routerEnabled: z.boolean().default(true),
  routerProvider: z.string().default(""),
  routerModel: z.string().default(""),
  routerEffort: RouterEffortSchema,
  routerTimeoutMs: z.number().int().min(1000).max(30000).default(10000),
  routerConfidenceThreshold: z.number().min(0.5).max(1).default(0.85),

  // Deprecated v8 heuristic & HTTP fallback fields (retained as optional for v8 compatibility)
  enableFullstackOrchestratorCollision: z.boolean().optional(),
  fullstackUiPattern: z.string().optional(),
  fullstackBackendPattern: z.string().optional(),
  tierPatterns: TierPatternsSchema.optional(),
  llmFallbackEnabled: z.boolean().default(false),
  llmFallbackEndpoint: z.string().default(""),
  llmFallbackApiKey: z.string().default(""),
  llmFallbackModel: z.string().default("lite"),
  llmFallbackTimeoutMs: z.number().int().min(100).max(5000).default(450),
  llmFallbackApplyRole: z.boolean().default(true),

  // Global Prompt Templates & Guardrails
  injectSystemPromptBanner: z.boolean().default(true),
  enforceWorkspaceBoundaryGuardrail: z.boolean().default(true),
  workspaceBoundaryNotice: z
    .string()
    .default(
      "You are strictly bound to your current working directory (`process.cwd()`). NEVER search, read, or modify files in other repositories outside your current workspace/repo root without explicit confirmation! If the user's request or screenshot targets code that does not exist in the current repository, STOP immediately, inform the user which project you are currently in (and which project the target likely belongs to), and ask them to confirm or switch projects before touching any external files.",
    ),
  phaseRules: z.record(z.string(), z.string()).default(() => ({ ...BUILTIN_PHASE_RULES })),

  // Repo Overrides
  enableRepoConfigOverride: z.boolean().default(true),
  repoConfigRelativePath: z.string().default(".paseo/agent-harness.json"),
});

export type AgentHarnessSettings = z.infer<typeof AgentHarnessSettingsSchema>;

export const DEFAULT_AGENT_HARNESS_SETTINGS: AgentHarnessSettings =
  AgentHarnessSettingsSchema.parse({});

export const SETTINGS_SCHEMA_VERSION = 9 as const;

function migrateCodexSliceToV8(roleId: string, rawSlice: unknown): string | undefined {
  if (typeof rawSlice !== "string") {
    return undefined;
  }
  const slice = rawSlice.trim();
  if (slice === "codex.yaml") {
    switch (roleId) {
      case "general":
        return "general.yaml";
      case "architect":
        return "architect.yaml";
      case "qa":
        return "qa.yaml";
      case "scout":
        return "scout.yaml";
      case "ui":
        return "ui.yaml";
      case "backend":
        return "backend.yaml";
      case "pm":
        return "pm.yaml";
      case "review":
        return "review.yaml";
      default:
        return "general.yaml";
    }
  }
  if (roleId === "architect" && slice === "backend.yaml") {
    return "architect.yaml";
  }
  if (roleId === "qa" && slice === "ui.yaml") {
    return "qa.yaml";
  }
  if (roleId === "scout" && slice === "pm.yaml") {
    return "scout.yaml";
  }
  return undefined;
}

function stripBareTokenFromRegex(pattern: string, token: string): string {
  let out = pattern;
  out = out.replace(new RegExp(`\\|${token}(?=\\||\\)|$)`, "gi"), "");
  out = out.replace(new RegExp(`(^|\\(\\?:|\\(|\\|)${token}\\|`, "gi"), "$1");
  if (new RegExp(`^(?:\\\\b)?${token}(?:\\\\b)?$`, "i").test(out.trim())) {
    return "";
  }
  if (/^(?:\\b)?\(\?:\)(?:\\b)?$/.test(out.trim())) {
    return "";
  }
  try {
    void new RegExp(out, "i");
    return out;
  } catch {
    return pattern;
  }
}

function upgradeUiMatchPatternsToV8(
  rawPatterns: readonly string[],
  builtinUiPatterns: readonly string[],
): string[] {
  const mapped: string[] = [];
  let replacedLegacyEn = false;
  let replacedLegacyZh = false;

  for (const pat of rawPatterns) {
    if (pat === LEGACY_V7_UI_MATCH_PATTERNS[0] || pat === LEGACY_V5_UI_MATCH_PATTERNS[0]) {
      if (!replacedLegacyEn && builtinUiPatterns[0]) {
        mapped.push(builtinUiPatterns[0]);
        replacedLegacyEn = true;
      }
      continue;
    }
    if (pat === LEGACY_V7_UI_MATCH_PATTERNS[1] || pat === LEGACY_V5_UI_MATCH_PATTERNS[1]) {
      if (!replacedLegacyZh && builtinUiPatterns[1]) {
        mapped.push(builtinUiPatterns[1]);
        replacedLegacyZh = true;
      }
      continue;
    }
    mapped.push(pat);
  }

  if (!replacedLegacyEn && builtinUiPatterns[0] && !mapped.includes(builtinUiPatterns[0])) {
    // Only append missing new UI terms if user had totally custom patterns without legacy defaults
    const combined = mapped.join("\n");
    if (!/\bmodal\b/i.test(combined) || !/颜色/.test(combined)) {
      mapped.push(builtinUiPatterns[0], builtinUiPatterns[1]);
    }
  }

  return Array.from(new Set(mapped.filter(Boolean)));
}

function upgradeBackendMatchPatternsToV8(
  rawPatterns: readonly string[],
  builtinBackendPatterns: readonly string[],
): string[] {
  const result: string[] = [];
  for (const pat of rawPatterns) {
    if (pat === LEGACY_V7_BACKEND_MATCH_PATTERNS[0]) {
      if (builtinBackendPatterns[0]) {
        result.push(builtinBackendPatterns[0]);
      }
      continue;
    }
    let cleaned = stripBareTokenFromRegex(pat, "worktree");
    cleaned = cleaned ? stripBareTokenFromRegex(cleaned, "provider") : "";
    if (cleaned.trim()) {
      result.push(cleaned);
    }
  }
  return Array.from(new Set(result));
}

function areStringArraysEqual(a: unknown, b: readonly string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((val, idx) => val === b[idx]);
}

function migrateLegacyReviewSpecialistToV4(spec: Record<string, unknown>): Record<string, unknown> {
  const builtinReview = BUILTIN_SPECIALISTS.find((s) => s.id === "review");
  if (!builtinReview) {
    return spec;
  }

  const nextSpec = { ...spec };
  const currentProvider =
    typeof nextSpec.preferredProvider === "string" ? nextSpec.preferredProvider.trim() : "";
  if (!currentProvider || canonicalizeProviderName(currentProvider) === "claude") {
    nextSpec.preferredProvider = builtinReview.preferredProvider;
  }

  if (nextSpec.description === LEGACY_V3_REVIEW_DESCRIPTION) {
    nextSpec.description = builtinReview.description;
  }

  if (nextSpec.handoffDefaultPrompt === LEGACY_V3_REVIEW_HANDOFF_PROMPT) {
    nextSpec.handoffDefaultPrompt = builtinReview.handoffDefaultPrompt;
  }

  if (Array.isArray(nextSpec.primarySkills)) {
    const mapped = nextSpec.primarySkills
      .filter((item): item is string => typeof item === "string")
      .map((item) => (item === "security-review" ? "open-code-review-delegate" : item));
    if (!mapped.includes("open-code-review-delegate")) {
      mapped.push("open-code-review-delegate");
    }
    nextSpec.primarySkills = Array.from(new Set(mapped));
  }

  if (Array.isArray(nextSpec.qualityGates)) {
    const mapped = nextSpec.qualityGates
      .filter((item): item is string => typeof item === "string")
      .map((item) =>
        item === "open-code-review-cli-gate" ? "open-code-review-delegate-gate" : item,
      );
    nextSpec.qualityGates = Array.from(new Set(mapped));
  }

  if (Array.isArray(nextSpec.matchPatterns)) {
    nextSpec.matchPatterns = nextSpec.matchPatterns
      .filter((item): item is string => typeof item === "string")
      .map((item) =>
        item === "\\b(?:ocr|code-review|security-review)\\b"
          ? "\\b(?:ocr|open-code-review-delegate|code-review|security-review)\\b"
          : item,
      );
  }

  return nextSpec;
}

function isUntouchedLegacyProviderMap(
  providerId: string,
  rawMap: Record<string, unknown>,
): boolean {
  const keys = Object.keys(rawMap);
  if (keys.some((k) => k === "fast" || k === "standard" || k === "deep" || k === "max")) {
    return false;
  }
  const legacyDefaults = LEGACY_V4_PROVIDER_MAPPINGS[providerId];
  if (!legacyDefaults) {
    return keys.length === 0;
  }
  for (const key of keys) {
    const val = rawMap[key];
    if (typeof val !== "string" || !val.trim()) continue;
    const trimmed = val.trim();
    if (trimmed !== legacyDefaults[key] && !/^gemini-3/i.test(trimmed)) {
      return false;
    }
  }
  return true;
}

function cleanModelValue(val: unknown): string {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  return /^gemini-3/i.test(trimmed) ? "" : trimmed;
}

function mapLegacySpecialistTier(rawTier: string): "fast" | "standard" | "deep" {
  if (rawTier === "lite") {
    return "fast";
  }
  if (rawTier === "flash") {
    return "standard";
  }
  return "deep";
}

function migrateProviderMapToV5(
  providerId: string,
  rawMap: Record<string, unknown>,
): Record<string, string> {
  const builtin = LEGACY_V8_PROVIDER_MAPPINGS[providerId] ?? BUILTIN_PROVIDER_MAPPINGS[providerId];
  if (isUntouchedLegacyProviderMap(providerId, rawMap)) {
    return builtin ? { ...builtin } : {};
  }

  const fastVal =
    cleanModelValue(rawMap.fast) || cleanModelValue(rawMap.lite) || builtin?.fast || "";
  const standardVal =
    cleanModelValue(rawMap.standard) || cleanModelValue(rawMap.flash) || builtin?.standard || "";
  const deepVal =
    cleanModelValue(rawMap.deep) ||
    cleanModelValue(rawMap.plan) ||
    cleanModelValue(rawMap.review) ||
    builtin?.deep ||
    "";
  const explicitMaxVal = cleanModelValue(rawMap.max);
  const legacyPlanVal = cleanModelValue(rawMap.plan);
  const maxVal =
    explicitMaxVal || (legacyPlanVal && legacyPlanVal !== deepVal ? legacyPlanVal : "");

  const out: Record<string, string> = {};
  if (fastVal) out.fast = fastVal;
  if (standardVal) out.standard = standardVal;
  if (deepVal) out.deep = deepVal;
  if (maxVal) out.max = maxVal;
  for (const [k, v] of Object.entries(rawMap)) {
    if (
      k !== "plan" &&
      k !== "review" &&
      k !== "flash" &&
      k !== "lite" &&
      k !== "fast" &&
      k !== "standard" &&
      k !== "deep" &&
      k !== "max" &&
      typeof v === "string" &&
      v.trim()
    ) {
      out[k] = v.trim();
    }
  }
  return out;
}

function migrateProviderMappingsToV9(rawMappings: unknown): Record<string, Record<string, string>> {
  const result = cloneBuiltinProviderMappings();
  if (!rawMappings || typeof rawMappings !== "object" || Array.isArray(rawMappings)) {
    return result;
  }

  for (const [rawProv, rawMap] of Object.entries(rawMappings as Record<string, unknown>)) {
    const prov = rawProv.trim().toLowerCase();
    if (!prov || !rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      continue;
    }
    const builtin = BUILTIN_PROVIDER_MAPPINGS[prov];
    const cleaned: Record<string, string> = {};
    for (const [tierKey, val] of Object.entries(rawMap as Record<string, unknown>)) {
      if (typeof val !== "string") continue;
      const trimmed = val.trim();
      if (!trimmed) continue;
      if (/^gemini-3/i.test(trimmed)) {
        const fallback = builtin?.[tierKey];
        if (fallback) {
          cleaned[tierKey] = fallback;
        }
        continue;
      }
      cleaned[tierKey] = trimmed;
    }

    if (prov === "antigravity") {
      const f = cleaned.fast;
      const s = cleaned.standard;
      const d = cleaned.deep;
      const p = cleaned.plan;
      const r = cleaned.review;
      const m = cleaned.max;
      const isUntouchedV8 =
        (!f || f === "gemini-4-hydrogen") &&
        (!s || s === "gemini-4-argon" || s === "gemini-4-neon") &&
        (!d || d === "gemini-4-carbon" || d === "gemini-4-argon") &&
        (!p || p === "gemini-4-carbon") &&
        (!r || r === "gemini-4-argon") &&
        (!m || m === "gemini-4-neon" || m === "gemini-4-carbon");
      if (isUntouchedV8) {
        result[prov] = { ...BUILTIN_PROVIDER_MAPPINGS.antigravity };
        continue;
      }
    }

    const planModel = cleaned.plan || cleaned.deep || builtin?.plan || "";
    const reviewModel = cleaned.review || cleaned.deep || builtin?.review || "";
    if (planModel) {
      cleaned.plan = planModel;
      cleaned.deep = planModel;
    }
    if (reviewModel) {
      cleaned.review = reviewModel;
    }
    if (builtin) {
      if (!cleaned.fast) cleaned.fast = builtin.fast;
      if (!cleaned.standard) cleaned.standard = builtin.standard;
    }
    result[prov] = cleaned;
  }

  return result;
}

function migrateThinkingMappingsToV9(rawMappings: unknown): Record<string, Record<string, string>> {
  const result = cloneBuiltinProviderThinkingMappings();
  if (!rawMappings || typeof rawMappings !== "object" || Array.isArray(rawMappings)) {
    return result;
  }

  for (const [rawProv, rawMap] of Object.entries(rawMappings as Record<string, unknown>)) {
    const prov = rawProv.trim().toLowerCase();
    if (!prov || !rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
      continue;
    }
    const builtin = BUILTIN_PROVIDER_THINKING_MAPPINGS[prov];
    const cleaned: Record<string, string> = {};
    for (const [tierKey, val] of Object.entries(rawMap as Record<string, unknown>)) {
      if (typeof val === "string" && val.trim()) {
        cleaned[tierKey] = val.trim();
      }
    }

    if (prov === "antigravity") {
      const v8AgThink = LEGACY_V8_PROVIDER_THINKING_MAPPINGS.antigravity;
      const isUntouchedV8 =
        (!cleaned.fast || cleaned.fast === v8AgThink.fast) &&
        (!cleaned.standard || cleaned.standard === v8AgThink.standard) &&
        (!cleaned.deep || cleaned.deep === v8AgThink.deep) &&
        (!cleaned.max || cleaned.max === v8AgThink.max || cleaned.max === "high");
      if (isUntouchedV8) {
        result[prov] = { ...BUILTIN_PROVIDER_THINKING_MAPPINGS.antigravity };
        continue;
      }
    }

    const planThink = cleaned.plan || cleaned.deep || builtin?.plan || "";
    const reviewThink = cleaned.review || cleaned.deep || builtin?.review || "";
    if (planThink) {
      cleaned.plan = planThink;
      cleaned.deep = planThink;
    }
    if (reviewThink) {
      cleaned.review = reviewThink;
    }
    if (builtin) {
      if (!cleaned.fast) cleaned.fast = builtin.fast;
      if (!cleaned.standard) cleaned.standard = builtin.standard;
      if (!cleaned.max && builtin.max) cleaned.max = builtin.max;
    }
    result[prov] = cleaned;
  }

  return result;
}

function migrateTiersToV9(rawTiers: unknown): Array<Record<string, unknown>> {
  const builtinTierIds = new Set(["fast", "standard", "deep", "plan", "review", "max"]);
  const untouchedOldNames = new Set(["Fast", "Standard", "Deep", "Plan", "Review", "Max"]);
  const existingById = new Map<string, Record<string, unknown>>();
  const customTiers: Array<Record<string, unknown>> = [];

  if (Array.isArray(rawTiers)) {
    for (const entry of rawTiers) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      if (!id) continue;
      if (builtinTierIds.has(id)) {
        existingById.set(id, obj);
      } else {
        customTiers.push({ ...obj });
      }
    }
  }

  const upgradedBuiltins = BUILTIN_TIERS.map((bt) => {
    const existing = existingById.get(bt.id);
    if (!existing) {
      return { ...bt };
    }
    const existingName = typeof existing.name === "string" ? existing.name.trim() : "";
    const customName =
      existingName && !untouchedOldNames.has(existingName) ? existingName : bt.name;
    return {
      ...bt,
      name: customName,
    };
  });

  return [...upgradedBuiltins, ...customTiers];
}

function migrateLegacySettings(rawInput: Record<string, unknown>, fromVersion: number) {
  const next: Record<string, unknown> = { ...rawInput };

  if (fromVersion < 3) {
    if (Array.isArray(next.bypassProviders)) {
      next.bypassProviders = next.bypassProviders.filter(
        (item) => typeof item === "string" && item.trim().toLowerCase() !== "antigravity",
      );
    }

    if (next.bypassModels === undefined) {
      next.bypassModels = [...BUILTIN_BYPASS_MODELS];
    }

    if (
      next.providerMappings &&
      typeof next.providerMappings === "object" &&
      !Array.isArray(next.providerMappings)
    ) {
      const mappings = { ...(next.providerMappings as Record<string, unknown>) };
      if (
        mappings.antigravity &&
        typeof mappings.antigravity === "object" &&
        !Array.isArray(mappings.antigravity)
      ) {
        const existingAg = { ...(mappings.antigravity as Record<string, unknown>) };
        for (const [tierKey, cur] of Object.entries(existingAg)) {
          if (typeof cur !== "string" || !cur.trim() || /^gemini-3/i.test(cur.trim())) {
            delete existingAg[tierKey];
          }
        }
        mappings.antigravity = existingAg;
      }
      next.providerMappings = mappings;
    }

    if (
      next.providerModes &&
      typeof next.providerModes === "object" &&
      !Array.isArray(next.providerModes)
    ) {
      const modes = { ...(next.providerModes as Record<string, unknown>) };
      if (!modes.antigravity) {
        modes.antigravity = { ...BUILTIN_PROVIDER_MODES.antigravity };
      }
      next.providerModes = modes;
    }

    const builtinOrchestrator = BUILTIN_SPECIALISTS.find((s) => s.id === "orchestrator");
    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = { ...(entry as Record<string, unknown>) };
        if (spec.id === "general" && spec.profileFilename === "architect.json") {
          spec.profileFilename = "general.json";
          spec.mandatorySkillActivation = false;
          spec.ssotOutputTarget = "";
        }
        if (
          (spec.id === "pm" || spec.id === "architect") &&
          spec.builtIn !== false &&
          spec.defaultModeId === "plan"
        ) {
          spec.defaultModeId = "";
        }
        if (
          typeof spec.modelOverride === "string" &&
          /^gemini-3/i.test(spec.modelOverride.trim())
        ) {
          spec.modelOverride = "";
        }
        if (
          spec.id === "orchestrator" &&
          typeof spec.rolePromptTemplate === "string" &&
          isLegacyOrchestratorPrompt(spec.rolePromptTemplate) &&
          builtinOrchestrator
        ) {
          spec.rolePromptTemplate = builtinOrchestrator.rolePromptTemplate;
        }
        return spec;
      });
    }

    if (next.phaseRules && typeof next.phaseRules === "object" && !Array.isArray(next.phaseRules)) {
      const rules = { ...(next.phaseRules as Record<string, unknown>) };
      if (
        typeof rules.orchestrator === "string" &&
        isLegacyOrchestratorPrompt(rules.orchestrator)
      ) {
        rules.orchestrator = BUILTIN_PHASE_RULES.orchestrator;
      }
      next.phaseRules = rules;
    }

    const endpoint =
      typeof next.llmFallbackEndpoint === "string" ? next.llmFallbackEndpoint.trim() : "";
    if (next.llmFallbackEnabled === true && !endpoint) {
      next.llmFallbackEnabled = false;
    }
  }

  if (fromVersion < 4) {
    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = entry as Record<string, unknown>;
        if (spec.id === "review" && spec.builtIn !== false) {
          return migrateLegacyReviewSpecialistToV4(spec);
        }
        return spec;
      });
    }

    if (next.phaseRules && typeof next.phaseRules === "object" && !Array.isArray(next.phaseRules)) {
      const rules = { ...(next.phaseRules as Record<string, unknown>) };
      if (rules.review === LEGACY_V3_REVIEW_PHASE_RULE) {
        rules.review = BUILTIN_PHASE_RULES.review;
      }
      if (rules.exec === LEGACY_V3_EXEC_PHASE_RULE) {
        rules.exec = BUILTIN_PHASE_RULES.exec;
      }
      next.phaseRules = rules;
    }
  }

  if (fromVersion < 5) {
    // 1. Upgrade built-in tier list while preserving custom user tiers
    if (Array.isArray(next.tiers)) {
      const v5BuiltinIds = new Set(["fast", "standard", "deep", "max"]);
      const legacyTierIds = new Set(["plan", "flash", "review"]);
      const hasNewBuiltin = next.tiers.some(
        (t) =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as Record<string, unknown>).id === "string" &&
          v5BuiltinIds.has((t as Record<string, unknown>).id as string),
      );
      if (!hasNewBuiltin) {
        const customTiers = next.tiers.filter(
          (t) =>
            typeof t === "object" &&
            t !== null &&
            typeof (t as Record<string, unknown>).id === "string" &&
            !legacyTierIds.has((t as Record<string, unknown>).id as string) &&
            !v5BuiltinIds.has((t as Record<string, unknown>).id as string),
        );
        const upgradedBuiltins: Array<Record<string, unknown>> = [];
        for (const tier of BUILTIN_TIERS) {
          upgradedBuiltins.push({ ...tier });
        }
        next.tiers = [...upgradedBuiltins, ...customTiers];
      }
    }

    // 2. Migrate defaultFallbackTier alias
    if (typeof next.defaultFallbackTier === "string") {
      const ft = next.defaultFallbackTier.trim().toLowerCase();
      if (ft === "flash") next.defaultFallbackTier = "standard";
      else if (ft === "plan" || ft === "review") next.defaultFallbackTier = "deep";
      else if (ft === "lite") next.defaultFallbackTier = "fast";
    }

    // 3. Migrate providerMappings while preserving user customizations
    if (
      next.providerMappings &&
      typeof next.providerMappings === "object" &&
      !Array.isArray(next.providerMappings)
    ) {
      const incomingMappings = next.providerMappings as Record<string, unknown>;
      const migratedMappings: Record<string, Record<string, string>> = {};
      for (const [provKey, rawMap] of Object.entries(incomingMappings)) {
        const normProv = provKey.trim().toLowerCase();
        if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
          migratedMappings[normProv] = migrateProviderMapToV5(
            normProv,
            rawMap as Record<string, unknown>,
          );
        }
      }
      for (const [provKey, builtinMap] of Object.entries(BUILTIN_PROVIDER_MAPPINGS)) {
        if (!migratedMappings[provKey]) {
          migratedMappings[provKey] = { ...builtinMap };
        }
      }
      next.providerMappings = migratedMappings;
    }

    // 4. Populate providerThinkingMappings defaults
    const baseThinking = cloneBuiltinProviderThinkingMappings();
    if (
      next.providerThinkingMappings &&
      typeof next.providerThinkingMappings === "object" &&
      !Array.isArray(next.providerThinkingMappings)
    ) {
      const existingThinking = next.providerThinkingMappings as Record<string, unknown>;
      for (const [prov, mapVal] of Object.entries(existingThinking)) {
        if (mapVal && typeof mapVal === "object" && !Array.isArray(mapVal)) {
          const normProv = prov.trim().toLowerCase();
          baseThinking[normProv] = {
            ...baseThinking[normProv],
            ...Object.fromEntries(
              Object.entries(mapVal as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            ),
          };
        }
      }
    }
    next.providerThinkingMappings = baseThinking;

    // 5. Migrate built-in specialists preferredTier and v4 orchestrator template
    const builtinSpecById = new Map(BUILTIN_SPECIALISTS.map((s) => [s.id, s]));
    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = { ...(entry as Record<string, unknown>) };
        const id = typeof spec.id === "string" ? spec.id : "";
        const builtin = builtinSpecById.get(id);
        const rawTier =
          typeof spec.preferredTier === "string" ? spec.preferredTier.trim().toLowerCase() : "";

        if (
          rawTier === "flash" ||
          rawTier === "plan" ||
          rawTier === "review" ||
          rawTier === "lite"
        ) {
          if (builtin && spec.builtIn !== false) {
            spec.preferredTier = builtin.preferredTier ?? "standard";
          } else {
            spec.preferredTier = mapLegacySpecialistTier(rawTier);
          }
        }

        if (
          id === "orchestrator" &&
          typeof spec.rolePromptTemplate === "string" &&
          (spec.rolePromptTemplate.trim() === LEGACY_V4_ORCHESTRATOR_DISPATCHER_RULE ||
            isLegacyOrchestratorPrompt(spec.rolePromptTemplate)) &&
          builtin
        ) {
          spec.rolePromptTemplate = builtin.rolePromptTemplate;
        }
        return spec;
      });
    }

    // 6. Upgrade untouched v4 phaseRules
    if (next.phaseRules && typeof next.phaseRules === "object" && !Array.isArray(next.phaseRules)) {
      const rules = { ...(next.phaseRules as Record<string, unknown>) };
      if (
        typeof rules.orchestrator === "string" &&
        (rules.orchestrator.trim() === LEGACY_V4_ORCHESTRATOR_DISPATCHER_RULE ||
          isLegacyOrchestratorPrompt(rules.orchestrator))
      ) {
        rules.orchestrator = BUILTIN_PHASE_RULES.orchestrator;
      }
      if (rules.design === LEGACY_V4_DESIGN_PHASE_RULE) {
        rules.design = BUILTIN_PHASE_RULES.design;
      }
      if (rules.exec === LEGACY_V4_EXEC_PHASE_RULE) {
        rules.exec = BUILTIN_PHASE_RULES.exec;
      }
      if (rules.review === LEGACY_V4_REVIEW_PHASE_RULE) {
        rules.review = BUILTIN_PHASE_RULES.review;
      }
      next.phaseRules = rules;
    }

    // 7. Ensure tierPatterns.fastAction exists
    if (
      next.tierPatterns &&
      typeof next.tierPatterns === "object" &&
      !Array.isArray(next.tierPatterns)
    ) {
      const tp = { ...(next.tierPatterns as Record<string, unknown>) };
      if (!Array.isArray(tp.fastAction)) {
        tp.fastAction = [];
      }
      next.tierPatterns = tp;
    }
  }

  if (fromVersion < 6) {
    const builtinUi = BUILTIN_SPECIALISTS.find((s) => s.id === "ui");
    const builtinGeneral = BUILTIN_SPECIALISTS.find((s) => s.id === "general");

    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = { ...(entry as Record<string, unknown>) };
        if (spec.id === "ui" && spec.builtIn !== false && builtinUi) {
          if (areStringArraysEqual(spec.matchPatterns, LEGACY_V5_UI_MATCH_PATTERNS)) {
            spec.matchPatterns = [...builtinUi.matchPatterns];
          }
          if (areStringArraysEqual(spec.allowedMcpServers, LEGACY_V5_UI_ALLOWED_MCP)) {
            spec.allowedMcpServers = [...builtinUi.allowedMcpServers];
          }
        }
        if (spec.id === "general" && spec.builtIn !== false && builtinGeneral) {
          if (areStringArraysEqual(spec.allowedMcpServers, LEGACY_V5_GENERAL_ALLOWED_MCP)) {
            spec.allowedMcpServers = [...builtinGeneral.allowedMcpServers];
          }
        }
        return spec;
      });
    }

    if (next.fullstackUiPattern === LEGACY_V5_FULLSTACK_UI_PATTERN) {
      delete next.fullstackUiPattern;
    }

    if (
      next.tierPatterns &&
      typeof next.tierPatterns === "object" &&
      !Array.isArray(next.tierPatterns)
    ) {
      const tp = { ...(next.tierPatterns as Record<string, unknown>) };
      if (Array.isArray(tp.execAction)) {
        tp.execAction = tp.execAction.filter((item) => item !== LEGACY_V5_EXEC_ACTION_PATTERN);
      }
      next.tierPatterns = tp;
    }

    if (areStringArraysEqual(next.affirmativeConfirmWords, LEGACY_V5_AFFIRMATIVE_CONFIRM_WORDS)) {
      next.affirmativeConfirmWords = [...DEFAULT_AFFIRMATIVE_CONFIRM_WORDS];
    }
  }

  if (fromVersion < 7) {
    const builtinSpecById = new Map(BUILTIN_SPECIALISTS.map((s) => [s.id, s]));
    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = { ...(entry as Record<string, unknown>) };
        const id = typeof spec.id === "string" ? spec.id : "";
        const builtin = builtinSpecById.get(id);
        const rawSkills = Array.isArray(spec.primarySkills)
          ? spec.primarySkills.filter((item): item is string => typeof item === "string")
          : null;

        if (builtin && spec.builtIn !== false) {
          const legacyV6Skills = LEGACY_V6_SPECIALIST_PRIMARY_SKILLS[id];
          const isUntouchedLegacy =
            rawSkills !== null &&
            legacyV6Skills !== undefined &&
            (areStringArraysEqual(rawSkills, legacyV6Skills) ||
              areStringArraysEqual(rawSkills, normalizePrimarySkills(legacyV6Skills)));
          if (isUntouchedLegacy) {
            spec.primarySkills = [...builtin.primarySkills];
          } else if (rawSkills !== null) {
            spec.primarySkills = normalizePrimarySkills(rawSkills);
          }
        } else if (rawSkills !== null) {
          spec.primarySkills = normalizePrimarySkills(rawSkills);
        }
        return spec;
      });
    }
  }

  if (fromVersion < 8) {
    const builtinSpecById = new Map(BUILTIN_SPECIALISTS.map((s) => [s.id, s]));
    const builtinUi = builtinSpecById.get("ui");
    const builtinBackend = builtinSpecById.get("backend");
    const builtinPm = builtinSpecById.get("pm");

    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = { ...(entry as Record<string, unknown>) };
        const id = typeof spec.id === "string" ? spec.id : "";
        const isBuiltin = spec.builtIn !== false && builtinSpecById.has(id);

        // 1. Split codex.yaml & migrate builtin slices (general/architect/qa/scout)
        const nextSlice =
          typeof spec.lazyToolSlice === "string" &&
          (spec.lazyToolSlice.trim() === "codex.yaml" || isBuiltin)
            ? migrateCodexSliceToV8(id, spec.lazyToolSlice)
            : undefined;
        if (nextSlice !== undefined) {
          spec.lazyToolSlice = nextSlice;
        }

        // 2. Populate scout.allowedMcpServers if empty
        if (
          id === "scout" &&
          spec.builtIn !== false &&
          (!Array.isArray(spec.allowedMcpServers) || spec.allowedMcpServers.length === 0)
        ) {
          spec.allowedMcpServers = ["claude-mem"];
        }

        // 3. Unify ui & pm skillsRoot from vendor paths to ~/.agents/skills
        if (
          id === "ui" &&
          typeof spec.skillsRoot === "string" &&
          spec.skillsRoot.trim() ===
            "/Users/jerry/.agents/vendor/ui-ux-pro-max-skill/.claude/skills"
        ) {
          spec.skillsRoot = "/Users/jerry/.agents/skills";
        }
        if (
          id === "pm" &&
          typeof spec.skillsRoot === "string" &&
          spec.skillsRoot.trim() === "/Users/jerry/.agents/vendor/pm-skills/skills"
        ) {
          spec.skillsRoot = "/Users/jerry/.agents/skills";
        }

        // 4. Normalize pm-* primarySkills (and upgrade untouched v7 pm skill list order)
        const rawSkills = Array.isArray(spec.primarySkills)
          ? spec.primarySkills.filter((item): item is string => typeof item === "string")
          : null;
        if (rawSkills !== null) {
          if (
            id === "pm" &&
            spec.builtIn !== false &&
            builtinPm &&
            areStringArraysEqual(rawSkills, LEGACY_V7_PM_PRIMARY_SKILLS)
          ) {
            spec.primarySkills = [...builtinPm.primarySkills];
          } else {
            spec.primarySkills = normalizePrimarySkills(rawSkills);
          }
        }

        // 5. Upgrade ui / backend matchPatterns while preserving user custom regexes
        if (
          id === "ui" &&
          spec.builtIn !== false &&
          builtinUi &&
          Array.isArray(spec.matchPatterns)
        ) {
          const patterns = spec.matchPatterns.filter(
            (item): item is string => typeof item === "string",
          );
          spec.matchPatterns = upgradeUiMatchPatternsToV8(patterns, builtinUi.matchPatterns);
        }
        if (
          id === "backend" &&
          spec.builtIn !== false &&
          builtinBackend &&
          Array.isArray(spec.matchPatterns)
        ) {
          const patterns = spec.matchPatterns.filter(
            (item): item is string => typeof item === "string",
          );
          spec.matchPatterns = upgradeBackendMatchPatternsToV8(
            patterns,
            builtinBackend.matchPatterns,
          );
        }

        return spec;
      });
    }
  }

  if (fromVersion < 9) {
    next.routerEnabled = typeof next.routerEnabled === "boolean" ? next.routerEnabled : true;
    next.routerProvider = typeof next.routerProvider === "string" ? next.routerProvider : "";
    next.routerModel = typeof next.routerModel === "string" ? next.routerModel : "";
    next.routerEffort =
      next.routerEffort === "low" || next.routerEffort === "medium" || next.routerEffort === "high"
        ? next.routerEffort
        : "low";
    next.routerTimeoutMs =
      typeof next.routerTimeoutMs === "number" &&
      next.routerTimeoutMs >= 1000 &&
      next.routerTimeoutMs <= 30000
        ? Math.trunc(next.routerTimeoutMs)
        : 10000;
    next.routerConfidenceThreshold =
      typeof next.routerConfidenceThreshold === "number" &&
      next.routerConfidenceThreshold >= 0.5 &&
      next.routerConfidenceThreshold <= 1
        ? next.routerConfidenceThreshold
        : 0.85;

    next.enforceSessionMcpFiltering = false;
    delete next.tierPatterns;
    delete next.fullstackUiPattern;
    delete next.fullstackBackendPattern;
    delete next.enableFullstackOrchestratorCollision;

    if (typeof next.defaultFallbackTier === "string") {
      const ft = next.defaultFallbackTier.trim().toLowerCase();
      if (ft === "flash") next.defaultFallbackTier = "standard";
      else if (ft === "deep") next.defaultFallbackTier = "plan";
      else if (ft === "lite") next.defaultFallbackTier = "fast";
    }

    next.tiers = migrateTiersToV9(next.tiers);
    next.providerMappings = migrateProviderMappingsToV9(next.providerMappings);
    next.providerThinkingMappings = migrateThinkingMappingsToV9(next.providerThinkingMappings);

    const builtinSpecById = new Map(BUILTIN_SPECIALISTS.map((s) => [s.id, s]));
    if (Array.isArray(next.specialists)) {
      next.specialists = next.specialists.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const spec = { ...(entry as Record<string, unknown>) };
        const id = typeof spec.id === "string" ? spec.id : "";
        const builtin = builtinSpecById.get(id);
        const isBuiltin = Boolean(builtin && spec.builtIn !== false);

        if (
          typeof spec.modelOverride === "string" &&
          /^gemini-3/i.test(spec.modelOverride.trim())
        ) {
          spec.modelOverride = "";
        }

        if (isBuiltin && builtin) {
          const rawTier =
            typeof spec.preferredTier === "string" ? spec.preferredTier.trim().toLowerCase() : "";
          if ((id === "pm" || id === "architect") && rawTier === "deep") {
            spec.preferredTier = "plan";
          } else if (id === "review" && rawTier === "deep") {
            spec.preferredTier = "review";
          }

          const hasModelOverride =
            typeof spec.modelOverride === "string" && spec.modelOverride.trim().length > 0;
          const legacyProvider = LEGACY_V8_SPECIALIST_PROVIDERS[id];
          const currentProvider =
            typeof spec.preferredProvider === "string"
              ? canonicalizeProviderName(spec.preferredProvider)
              : "";
          if (
            !hasModelOverride &&
            legacyProvider !== undefined &&
            currentProvider === legacyProvider
          ) {
            spec.preferredProvider = "";
          }

          if (id === "orchestrator" && spec.defaultModeId === "bypassPermissions") {
            spec.defaultModeId = "full-access";
          }
          if (
            id === "orchestrator" &&
            typeof spec.rolePromptTemplate === "string" &&
            spec.rolePromptTemplate.trim() === LEGACY_V8_ORCHESTRATOR_DISPATCHER_RULE
          ) {
            spec.rolePromptTemplate = builtin.rolePromptTemplate;
          }

          spec.matchPatterns = [];

          const rawSkills = Array.isArray(spec.primarySkills)
            ? spec.primarySkills.filter((item): item is string => typeof item === "string")
            : null;
          const v8Skills = LEGACY_V8_SPECIALIST_PRIMARY_SKILLS[id];
          if (
            rawSkills !== null &&
            v8Skills !== undefined &&
            (areStringArraysEqual(rawSkills, v8Skills) ||
              areStringArraysEqual(rawSkills, normalizePrimarySkills(v8Skills)))
          ) {
            spec.primarySkills = [...builtin.primarySkills];
          }
        }

        return spec;
      });
    }

    if (next.phaseRules && typeof next.phaseRules === "object" && !Array.isArray(next.phaseRules)) {
      const rules = { ...(next.phaseRules as Record<string, unknown>) };
      if (
        typeof rules.orchestrator === "string" &&
        rules.orchestrator.trim() === LEGACY_V8_ORCHESTRATOR_DISPATCHER_RULE
      ) {
        rules.orchestrator = BUILTIN_PHASE_RULES.orchestrator;
      }
      if (rules.design === LEGACY_V8_DESIGN_PHASE_RULE) {
        rules.design = BUILTIN_PHASE_RULES.design;
      }
      if (rules.exec === LEGACY_V8_EXEC_PHASE_RULE) {
        rules.exec = BUILTIN_PHASE_RULES.exec;
      }
      if (rules.review === LEGACY_V8_REVIEW_PHASE_RULE) {
        rules.review = BUILTIN_PHASE_RULES.review;
      }
      next.phaseRules = rules;
    }
  }

  return AgentHarnessSettingsSchema.parse(next);
}

export const agentHarnessSettings = defineSettings({
  id: "agent-harness-settings",
  scope: "host",
  version: SETTINGS_SCHEMA_VERSION,
  schema: AgentHarnessSettingsSchema,
  migrate: (values: unknown, fromVersion: number) => {
    if (fromVersion < SETTINGS_SCHEMA_VERSION && typeof values === "object" && values !== null) {
      try {
        return migrateLegacySettings(values as Record<string, unknown>, fromVersion);
      } catch (err) {
        console.error("[AgentHarness] Failed to migrate settings", err);
        return DEFAULT_AGENT_HARNESS_SETTINGS;
      }
    }
    return values;
  },
});
