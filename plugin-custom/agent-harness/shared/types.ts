export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Built-in matrix tiers supported out of the box.
 * MatrixTier is widened to allow user-defined custom tiers and legacy aliases.
 */
export type BuiltInMatrixTier = "fast" | "standard" | "plan" | "review" | "max";
export type LegacyMatrixTier = "flash" | "deep";
export type ModelTierId = "fast" | "standard" | "plan" | "review" | "deep" | "max" | "auto";
export type MatrixTier = BuiltInMatrixTier | (string & {});

/** Live model descriptor returned by Paseo `providers.snapshot()`. */
export interface HostProviderModelInfo {
  id: string;
  label?: string;
  isDefault?: boolean;
  thinkingOptions?: Array<{ id: string; label?: string }>;
}

/** Live provider runtime entry normalized from Paseo `providers.snapshot()`. */
export interface HostProviderRuntimeInfo {
  provider: string;
  enabled: boolean;
  status?: string;
  label?: string;
  defaultModel?: string;
  models: HostProviderModelInfo[];
}

/**
 * Built-in domain roles supported out of the box.
 * DomainRole is widened to allow user-defined specialist roles.
 */
export type BuiltInDomainRole =
  | "orchestrator"
  | "ui"
  | "backend"
  | "pm"
  | "architect"
  | "qa"
  | "review"
  | "scout"
  | "general";
export type DomainRole = BuiltInDomainRole | (string & {});

/** Specialist handoff target role (supports built-in and user-defined roles). */
export type HandoffTargetRole =
  | "architect"
  | "pm"
  | "ui"
  | "backend"
  | "qa"
  | "review"
  | "scout"
  | (string & {});

export type ProviderModelMapping = Record<string, string>;

export interface RouterDecision {
  tier: MatrixTier;
  targetProvider?: string;
  targetModel: string;
  targetThinking?: string | null;
  phase?: HarnessPhase;
  reason: string;
  matchedRule: string;
  previousModel?: string;
  fallbackReason?: string | null;
}

export interface DomainRoleDecision {
  role: DomainRole;
  matchedRule: string;
  profilePath: string;
  lazyToolConfigPath: string;
  specialistConfig?: HarnessSpecialistConfig;
}

/** Top-level key stored inside `agent.metadata` for Agent Harness lifecycle tracking. */
export const HARNESS_METADATA_KEY = "agentHarness" as const;

/** Schema version for persisted `HarnessAgentMetadata` records. */
export const HARNESS_METADATA_VERSION = 1 as const;

/** Execution lifecycle phase decoupled from domain role. */
export type HarnessPhase = "design" | "exec" | "review" | (string & {});

/** Trigger reason recorded when a model tier transition or specialist handoff occurs. */
export type HarnessDowngradeReason =
  | "explicit_exec_intent"
  | "write_tool_in_plan"
  | "plan_turn_soft_limit"
  | "plan_approved"
  | "manual_switch"
  | "specialist_handoff";

/** Timeline transition event classification emitted to Paseo timeline. */
export type HarnessTransitionKind =
  | "initial_route"
  | "plan_approved"
  | "auto_downgrade"
  | "manual_switch"
  | "specialist_handoff";

/**
 * Persisted per-agent lifecycle state stored under `agent.metadata.agentHarness`.
 *
 * Declared as a structural `type` alias with explicit `| null` fields (no `undefined`)
 * so instances are directly assignable to Paseo `JsonValue` and `Record<string, JsonValue>`.
 *
 * Mirrors DeepSeek Harness `{ lastUsed, pending }` dual-state projection:
 * - `currentTier` / `currentModel`: pending configuration that will execute the NEXT turn.
 * - `lastBilledTier` / `lastBilledModel`: actual configuration that billed the LAST completed turn.
 */
// oxlint-disable-next-line typescript/consistent-type-definitions -- structural type alias required for JsonValue assignability
export type HarnessAgentMetadata = {
  version: number;
  role: DomainRole;
  initialTier: MatrixTier;
  currentTier: MatrixTier;
  currentModel: string | null;
  phase: HarnessPhase;
  roleMatchedRule: string;
  tierMatchedRule: string;
  userModelLocked: boolean;
  roleLockedByLabel: boolean;
  turnCount: number;
  planTurnCount: number;
  writeToolDetectedInPlan: boolean;
  handoffSuggestedAtTurn: number | null;
  autoDowngradedAtTurn: number | null;
  downgradeReason: HarnessDowngradeReason | null;
  lastProcessedTurnId: string | null;
  resumeModeId: string | null;
  lastBilledTier: MatrixTier | null;
  lastBilledModel: string | null;
  currentThinking?: string | null;
  lastBilledThinking?: string | null;
};

/* Granular Specialist & Harness Configuration Types (v2) */

export interface HarnessTierConfig {
  id: string;
  name: string;
  icon?: string;
  defaultPhase: HarnessPhase;
  description?: string;
}

export interface ProviderModeConfig {
  supportsNativePlanMode: boolean;
  resumeExecutionModeId?: string;
}

export type McpServerConfigEntry =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      alwaysLoad?: boolean;
    }
  | {
      type: "http";
      url: string;
      headers?: Record<string, string>;
      alwaysLoad?: boolean;
    }
  | {
      type: "sse";
      url: string;
      headers?: Record<string, string>;
      alwaysLoad?: boolean;
    };

export interface AgentTeamSummary {
  projectSlug: string;
  preset: string;
  manifestPath: string;
  checkoutRoot: string;
  mainRepoRoot: string;
  hasLocalAntigravityPlugin: boolean;
  targets?: string[];
  localFederatedTargets?: string[];
  roles: string[];
}

export interface HarnessSpecialistConfig {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  icon: string;
  color?: string;
  enabled: boolean;
  builtIn: boolean;
  readonly?: boolean;
  preferredProvider?: string;
  preferredTier?: MatrixTier;
  modelOverride?: string;
  defaultModeId?: string;
  thinkingOptionId?: string;
  lockTierOnLabel?: boolean;
  handoffEnabled: boolean;
  handoffPriority: number;
  handoffTitlePrefix: string;
  handoffDefaultPrompt: string;
  syncToDaemonProfile: boolean;
  primarySkills: string[];
  mandatorySkillActivation: boolean;
  skillsRoot?: string;
  docsFocus: string[];
  qualityGates: string[];
  ssotOutputTarget?: string;
  rolePromptTemplate?: string;
  lazyToolSlice?: string;
  allowedMcpServers: string[];
  excludedMcpServers: string[];
  injectedMcpServers: string[];
  extraEnv?: Record<string, string>;
  aliases: string[];
  matchPatterns: string[];
  profileFilename?: string;
}

/** Local repo override defined in `<repoRoot>/.paseo/agent-harness.json`. */
export interface RepoHarnessOverride {
  enabled?: boolean;
  defaultFallbackRole?: string;
  defaultFallbackTier?: string;
  specialistOverrides?: Record<string, Partial<HarnessSpecialistConfig>>;
  extraDocsFocus?: string[];
  extraQualityGates?: string[];
}

/**
 * Resolved effective configuration merging Host Plugin Settings with Repo Overrides.
 */
export interface EffectiveHarnessConfig {
  enabled: boolean;
  overrideIfDefaultOnly: boolean;
  debugLogs: boolean;
  phaseLifecycleEnabled: boolean;
  planTurnSoftLimit: number;
  autoDowngradePlanOnExec: boolean;
  enforceNativePlanMode: boolean;
  emitTimelineTransitions: boolean;
  docWhitelistPattern: string;
  affirmativeConfirmWords: string[];
  profilesDir: string;
  lazyToolProfilesDir: string;
  defaultSkillsRoot: string;
  autoSyncDiskProfiles: boolean;
  autoSyncDaemonAgentProfiles: boolean;
  /** @deprecated Legacy MCP session filtering flag retained for v8 settings compatibility. */
  enforceSessionMcpFiltering?: boolean;
  mcpServerCatalog: Record<string, McpServerConfigEntry>;
  tiers: HarnessTierConfig[];
  providerMappings: Record<string, Record<string, string>>;
  providerThinkingMappings?: Record<string, Record<string, string>>;
  providerModes: Record<string, ProviderModeConfig>;
  bypassProviders: string[];
  bypassModels: string[];
  honorSpecialistPreferredProvider: boolean;
  specialists: HarnessSpecialistConfig[];
  defaultFallbackRole: string;
  defaultFallbackTier: string;
  routerEnabled: boolean;
  routerProvider: string;
  routerModel: string;
  routerEffort: "low" | "medium" | "high";
  routerTimeoutMs: number;
  routerConfidenceThreshold: number;
  /** @deprecated Legacy heuristic collision flag retained for v8 settings compatibility. */
  enableFullstackOrchestratorCollision?: boolean;
  /** @deprecated Legacy heuristic pattern retained for v8 settings compatibility. */
  fullstackUiPattern?: string;
  /** @deprecated Legacy heuristic pattern retained for v8 settings compatibility. */
  fullstackBackendPattern?: string;
  /** @deprecated Legacy heuristic tier regex patterns retained for v8 settings compatibility. */
  tierPatterns?: {
    plan: string[];
    review: string[];
    fastAction?: string[];
    execAction: string[];
    conventionalExecPrefix: string;
  };
  /** @deprecated Legacy HTTP LLM fallback flag retained for v8 settings compatibility. */
  llmFallbackEnabled?: boolean;
  /** @deprecated Legacy HTTP LLM fallback endpoint retained for v8 settings compatibility. */
  llmFallbackEndpoint?: string;
  /** @deprecated Legacy HTTP LLM fallback API key retained for v8 settings compatibility. */
  llmFallbackApiKey?: string;
  /** @deprecated Legacy HTTP LLM fallback model retained for v8 settings compatibility. */
  llmFallbackModel?: string;
  /** @deprecated Legacy HTTP LLM fallback timeout retained for v8 settings compatibility. */
  llmFallbackTimeoutMs?: number;
  /** @deprecated Legacy HTTP LLM fallback role flag retained for v8 settings compatibility. */
  llmFallbackApplyRole?: boolean;
  injectSystemPromptBanner: boolean;
  enforceWorkspaceBoundaryGuardrail: boolean;
  workspaceBoundaryNotice: string;
  phaseRules: Record<string, string>;
  enableRepoConfigOverride: boolean;
  repoConfigRelativePath: string;
  repoOverrideLoaded?: boolean;
  repoRoot?: string;
  agentTeam?: AgentTeamSummary | null;
}
