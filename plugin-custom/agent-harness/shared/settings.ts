import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import {
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
} from "./presets.js";

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
  primarySkills: z.array(z.string()).default([]),
  mandatorySkillActivation: z.boolean().default(true),
  skillsRoot: z.string().optional().default(""),
  docsFocus: z.array(z.string()).default([]),
  qualityGates: z.array(z.string()).default([]),
  ssotOutputTarget: z.string().optional().default(""),
  rolePromptTemplate: z.string().optional().default(""),
  lazyToolSlice: z.string().optional().default(""),
  allowedMcpServers: z.array(z.string()).default([]),
  excludedMcpServers: z.array(z.string()).default([]),
  injectedMcpServers: z.array(z.string()).default([]),
  extraEnv: z.record(z.string(), z.string()).default({}),
  aliases: z.array(z.string()).default([]),
  matchPatterns: z.array(z.string()).default([]),
  profileFilename: z.string().optional().default(""),
});

export const TierPatternsSchema = z.object({
  plan: z.array(z.string()).default(BUILTIN_PLAN_PATTERNS),
  review: z.array(z.string()).default(BUILTIN_REVIEW_PATTERNS),
  execAction: z.array(z.string()).default(BUILTIN_EXEC_ACTION_PATTERNS),
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
    .default([
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
    ]),

  // Domain 3: Skills, MCP & Disk Synchronization
  profilesDir: z.string().default("~/.agents/profiles"),
  lazyToolProfilesDir: z.string().default("~/.config/lazy-tool/profiles"),
  defaultSkillsRoot: z.string().default("~/.agents/skills"),
  autoSyncDiskProfiles: z.boolean().default(true),
  autoSyncDaemonAgentProfiles: z.boolean().default(true),
  enforceSessionMcpFiltering: z.boolean().default(true),
  mcpServerCatalog: z.record(z.string(), McpServerConfigEntrySchema).default({}),

  // Domain 2: Models & Providers Matrix
  tiers: z.array(HarnessTierConfigSchema).default(BUILTIN_TIERS),
  providerMappings: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default(BUILTIN_PROVIDER_MAPPINGS),
  providerModes: z.record(z.string(), ProviderModeConfigSchema).default(BUILTIN_PROVIDER_MODES),
  bypassProviders: z.array(z.string()).default(["antigravity"]),
  honorSpecialistPreferredProvider: z.boolean().default(true),

  // Domain 1: Specialists & Roles
  specialists: z.array(HarnessSpecialistConfigSchema).default(BUILTIN_SPECIALISTS),
  defaultFallbackRole: z.string().default("general"),
  defaultFallbackTier: z.string().default("flash"),

  // Domain 4: Routing, Heuristics & LLM Fallback
  enableFullstackOrchestratorCollision: z.boolean().default(true),
  fullstackUiPattern: z.string().default(BUILTIN_FULLSTACK_UI_PATTERN),
  fullstackBackendPattern: z.string().default(BUILTIN_FULLSTACK_BACKEND_PATTERN),
  tierPatterns: TierPatternsSchema.default({
    plan: BUILTIN_PLAN_PATTERNS,
    review: BUILTIN_REVIEW_PATTERNS,
    execAction: BUILTIN_EXEC_ACTION_PATTERNS,
    conventionalExecPrefix: BUILTIN_CONVENTIONAL_EXEC_PREFIX,
  }),

  // L2 LLM Fallback Classifier
  llmFallbackEnabled: z.boolean().default(true),
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
  phaseRules: z.record(z.string(), z.string()).default(BUILTIN_PHASE_RULES),

  // Repo Overrides
  enableRepoConfigOverride: z.boolean().default(true),
  repoConfigRelativePath: z.string().default(".paseo/agent-harness.json"),
});

export type AgentHarnessSettings = z.infer<typeof AgentHarnessSettingsSchema>;

export const DEFAULT_AGENT_HARNESS_SETTINGS: AgentHarnessSettings =
  AgentHarnessSettingsSchema.parse({});

export const SETTINGS_SCHEMA_VERSION = 2 as const;

export const agentHarnessSettings = defineSettings({
  id: "agent-harness-settings",
  scope: "host",
  version: SETTINGS_SCHEMA_VERSION,
  schema: AgentHarnessSettingsSchema,
  migrate: (values: unknown, fromVersion: number) => {
    if (fromVersion < 2 && typeof values === "object" && values !== null) {
      try {
        return AgentHarnessSettingsSchema.parse({
          ...(values as Record<string, unknown>),
        });
      } catch (err) {
        console.error("[AgentHarness] Failed to migrate settings from v1 to v2", err);
        return DEFAULT_AGENT_HARNESS_SETTINGS;
      }
    }
    return values;
  },
});
