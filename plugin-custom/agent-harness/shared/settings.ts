import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import {
  BUILTIN_BYPASS_MODELS,
  BUILTIN_CONVENTIONAL_EXEC_PREFIX,
  BUILTIN_EXEC_ACTION_PATTERNS,
  BUILTIN_FULLSTACK_BACKEND_PATTERN,
  BUILTIN_FULLSTACK_UI_PATTERN,
  BUILTIN_PHASE_RULES,
  BUILTIN_PLAN_PATTERNS,
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_PROVIDER_MODES,
  BUILTIN_REVIEW_PATTERNS,
  BUILTIN_SPECIALISTS,
  BUILTIN_TIERS,
  LEGACY_ORCHESTRATOR_DISPATCHER_RULE,
  LEGACY_V3_EXEC_PHASE_RULE,
  LEGACY_V3_REVIEW_DESCRIPTION,
  LEGACY_V3_REVIEW_HANDOFF_PROMPT,
  LEGACY_V3_REVIEW_MATCH_PATTERN,
  LEGACY_V3_REVIEW_PHASE_RULE,
} from "./presets.js";

const DEFAULT_AFFIRMATIVE_CONFIRM_WORDS: readonly string[] = [
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

function cloneBuiltinProviderMappings(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(BUILTIN_PROVIDER_MAPPINGS).map(([k, v]) => [k, { ...v }]),
  );
}

function cloneBuiltinProviderModes(): Record<string, z.infer<typeof ProviderModeConfigSchema>> {
  return Object.fromEntries(Object.entries(BUILTIN_PROVIDER_MODES).map(([k, v]) => [k, { ...v }]));
}

function createDefaultTierPatterns() {
  return {
    plan: [...BUILTIN_PLAN_PATTERNS],
    review: [...BUILTIN_REVIEW_PATTERNS],
    execAction: [...BUILTIN_EXEC_ACTION_PATTERNS],
    conventionalExecPrefix: BUILTIN_CONVENTIONAL_EXEC_PREFIX,
  };
}

function isLegacyOrchestratorPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return (
    trimmed === LEGACY_ORCHESTRATOR_DISPATCHER_RULE ||
    trimmed ===
      "Spawn via paseo run --provider claude --mode bypassPermissions --label role=architect"
  );
}

// ============================================================================
// Schemas for Granular Elements
// ============================================================================

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
  preferredTier: z.string().optional().default("flash"),
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
  plan: z.array(z.string()).default(() => [...BUILTIN_PLAN_PATTERNS]),
  review: z.array(z.string()).default(() => [...BUILTIN_REVIEW_PATTERNS]),
  execAction: z.array(z.string()).default(() => [...BUILTIN_EXEC_ACTION_PATTERNS]),
  conventionalExecPrefix: z.string().default(BUILTIN_CONVENTIONAL_EXEC_PREFIX),
});

// ============================================================================
// Top-Level Settings Schema (v2)
// ============================================================================

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
  enforceSessionMcpFiltering: z.boolean().default(true),
  mcpServerCatalog: z.record(z.string(), McpServerConfigEntrySchema).default(() => ({})),

  // Domain 2: Models & Providers Matrix
  tiers: z
    .array(HarnessTierConfigSchema)
    .default(() => BUILTIN_TIERS.map((t) => HarnessTierConfigSchema.parse(t))),
  providerMappings: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default(cloneBuiltinProviderMappings),
  providerModes: z.record(z.string(), ProviderModeConfigSchema).default(cloneBuiltinProviderModes),
  bypassProviders: z.array(z.string()).default(() => []),
  bypassModels: z.array(z.string()).default(() => [...BUILTIN_BYPASS_MODELS]),
  honorSpecialistPreferredProvider: z.boolean().default(true),

  // Domain 1: Specialists & Roles
  specialists: z
    .array(HarnessSpecialistConfigSchema)
    .default(() => BUILTIN_SPECIALISTS.map((s) => HarnessSpecialistConfigSchema.parse(s))),
  defaultFallbackRole: z.string().default("general"),
  defaultFallbackTier: z.string().default("flash"),

  // Domain 4: Routing, Heuristics & LLM Fallback
  enableFullstackOrchestratorCollision: z.boolean().default(true),
  fullstackUiPattern: z.string().default(BUILTIN_FULLSTACK_UI_PATTERN),
  fullstackBackendPattern: z.string().default(BUILTIN_FULLSTACK_BACKEND_PATTERN),
  tierPatterns: TierPatternsSchema.default(createDefaultTierPatterns),

  // L2 LLM Fallback Classifier
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

export const SETTINGS_SCHEMA_VERSION = 4 as const;

function migrateLegacyReviewSpecialistToV4(spec: Record<string, unknown>): Record<string, unknown> {
  const builtinReview = BUILTIN_SPECIALISTS.find((s) => s.id === "review");
  if (!builtinReview) {
    return spec;
  }

  const nextSpec = { ...spec };
  const currentProvider =
    typeof nextSpec.preferredProvider === "string" ? nextSpec.preferredProvider.trim() : "";
  const normProvider = currentProvider.toLowerCase();
  if (!normProvider || normProvider === "claude" || normProvider === "claude-code") {
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
    const nextPrimaryMatch = builtinReview.matchPatterns[0];
    nextSpec.matchPatterns = nextSpec.matchPatterns
      .filter((item): item is string => typeof item === "string")
      .map((item) =>
        item === LEGACY_V3_REVIEW_MATCH_PATTERN && nextPrimaryMatch ? nextPrimaryMatch : item,
      );
  }

  return nextSpec;
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
      const existingAg =
        mappings.antigravity &&
        typeof mappings.antigravity === "object" &&
        !Array.isArray(mappings.antigravity)
          ? { ...(mappings.antigravity as Record<string, unknown>) }
          : {};
      for (const [tier, defaultModel] of Object.entries(BUILTIN_PROVIDER_MAPPINGS.antigravity)) {
        const cur = existingAg[tier];
        if (typeof cur !== "string" || !cur.trim() || /^gemini-3/i.test(cur.trim())) {
          existingAg[tier] = defaultModel;
        }
      }
      mappings.antigravity = existingAg;
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
