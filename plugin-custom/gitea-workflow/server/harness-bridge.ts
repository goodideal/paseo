import type { GiteaHarnessMode, WorkflowHarnessExecutionInfo } from "../shared/types.js";
import type { SettingsManager } from "./settings-manager.js";

export type WorkflowProviderId = "claude" | "codex" | "opencode" | "antigravity" | "pi";
export type HarnessTier = "fast" | "standard" | "plan" | "review" | "deep" | "max";
export type HarnessPhase = "design" | "exec" | "review";

export interface ProviderTierConfig {
  model: string;
  thinkingOptionId: string;
}

export const BUILTIN_PROVIDER_TIERS: Record<
  WorkflowProviderId,
  Record<HarnessTier, ProviderTierConfig>
> = {
  claude: {
    fast: { model: "lite", thinkingOptionId: "low" },
    standard: { model: "flash", thinkingOptionId: "medium" },
    plan: { model: "pro", thinkingOptionId: "high" },
    review: { model: "pro", thinkingOptionId: "high" },
    deep: { model: "pro", thinkingOptionId: "high" },
    max: { model: "plan", thinkingOptionId: "high" },
  },
  codex: {
    fast: { model: "lite", thinkingOptionId: "low" },
    standard: { model: "flash", thinkingOptionId: "medium" },
    plan: { model: "pro", thinkingOptionId: "high" },
    review: { model: "pro", thinkingOptionId: "high" },
    deep: { model: "pro", thinkingOptionId: "high" },
    max: { model: "plan", thinkingOptionId: "xhigh" },
  },
  antigravity: {
    fast: { model: "gemini-4-hydrogen", thinkingOptionId: "medium" },
    standard: { model: "gemini-4-neon", thinkingOptionId: "high" },
    plan: { model: "gemini-4-carbon", thinkingOptionId: "high" },
    review: { model: "gemini-4-argon", thinkingOptionId: "high" },
    deep: { model: "gemini-4-carbon", thinkingOptionId: "high" },
    max: { model: "gemini-4-carbon", thinkingOptionId: "high" },
  },
  opencode: {
    fast: { model: "custom/lite", thinkingOptionId: "low" },
    standard: { model: "custom/flash", thinkingOptionId: "medium" },
    plan: { model: "custom/pro", thinkingOptionId: "high" },
    review: { model: "custom/pro", thinkingOptionId: "high" },
    deep: { model: "custom/pro", thinkingOptionId: "high" },
    max: { model: "custom/plan", thinkingOptionId: "xhigh" },
  },
  pi: {
    fast: { model: "headroom/lite", thinkingOptionId: "low" },
    standard: { model: "headroom/flash", thinkingOptionId: "medium" },
    plan: { model: "headroom/pro", thinkingOptionId: "high" },
    review: { model: "headroom/pro", thinkingOptionId: "high" },
    deep: { model: "headroom/pro", thinkingOptionId: "high" },
    max: { model: "headroom/plan", thinkingOptionId: "xhigh" },
  },
};

export interface HarnessSpecialistEntry {
  id?: string;
  role?: string;
  enabled?: boolean;
  readonly?: boolean;
  preferredTier?: HarnessTier | string;
  preferredProvider?: string;
  modelOverride?: string | null;
  thinkingOptionId?: string | null;
  lazyToolSlice?: string | null;
  matchPatterns?: string[];
}

export interface HarnessAgentTeamInfo {
  projectSlug?: string;
  preset?: string;
  rolesCount?: number;
  roles?: Record<string, HarnessSpecialistEntry> | HarnessSpecialistEntry[];
}

export interface EffectiveHarnessConfig {
  enabled?: boolean;
  defaultFallbackRole?: string;
  honorSpecialistPreferredProvider?: boolean;
  specialists?: Record<string, HarnessSpecialistEntry> | HarnessSpecialistEntry[];
  providerMappings?: Record<
    string,
    Record<
      string,
      | string
      | {
          model?: string;
          thinkingOptionId?: string | null;
          thinking?: string | null;
        }
    >
  >;
  providerThinkingMappings?: Record<string, Record<string, string>>;
  agentTeamPreset?: string | null;
  agentTeam?: HarnessAgentTeamInfo | null;
}

const BUILTIN_UI_REGEX =
  /\b(ui|ux|css|style|theme|tailwind|unistyles|component|modal|sheet|popover|sidebar|panel|button|icon|layout|responsive|mobile|animation|hover|font|color|view|screen|frontend|react|tsx|前端|界面|样式|组件|弹窗|按钮|图标|布局|响应式|主题|视图)\b/i;

const BUILTIN_BACKEND_REGEX =
  /\b(backend|server|daemon|api|rpc|websocket|ws|db|database|sql|sqlite|postgres|redis|store|schema|zod|migration|auth|token|webhook|poller|worktree|git|cli|worker|queue|concurrency|后端|服务端|接口|协议|数据库|鉴权|并发|队列)\b/i;

const BUILTIN_QA_REGEX =
  /\b(qa|test|vitest|jest|playwright|e2e|benchmark|coverage|flaky|regression|测试|单测|验收|用例)\b/i;

const BUILTIN_OPS_REGEX =
  /\b(ops|devops|ci|cd|docker|dockerfile|compose|k8s|kubernetes|prometheus|grafana|pipeline|workflow|deploy|release|容器|流水线|部署|运维)\b/i;

const CHORE_DOCS_STYLE_TITLE_REGEX = /^\s*(?:chore|docs|style)\s*(?:\([^)]*\))?\s*[:：]/i;

const NON_EXEC_ROLES = new Set([
  "orchestrator",
  "pm",
  "fe-pm",
  "architect",
  "fe-architect",
  "be-architect",
  "review",
  "be-reviewer",
  "ops-auditor",
]);

export function normalizeWorkflowProvider(raw?: string): WorkflowProviderId {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return "claude";
  const prefix = value.split("/")[0]?.trim() || value;
  if (prefix.includes("codex")) return "codex";
  if (prefix.includes("opencode")) return "opencode";
  if (prefix.includes("antigravity") || prefix === "agy") return "antigravity";
  if (prefix === "pi" || prefix.startsWith("pi-") || prefix.startsWith("pi_")) return "pi";
  if (prefix.includes("claude")) return "claude";
  return "claude";
}

export function normalizeHarnessTier(
  raw?: string,
  fallback: HarnessTier = "standard",
  phase?: HarnessPhase,
): HarnessTier {
  const value = (raw || "").trim().toLowerCase();
  if (
    value === "fast" ||
    value === "standard" ||
    value === "plan" ||
    value === "review" ||
    value === "max"
  ) {
    return value;
  }
  if (value === "deep") {
    if (phase === "review") {
      return "review";
    }
    if (phase === "design" || phase === "exec") {
      return "plan";
    }
    return "deep";
  }
  return fallback;
}

export function ensureProviderModelSelection(
  rawProvider?: string,
  defaultTier: HarnessTier = "standard",
  explicitModel?: string,
): string {
  const trimmed = (rawProvider || "").trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0) {
    const providerPart = normalizeWorkflowProvider(trimmed.slice(0, slashIndex));
    const cleanExplicit = explicitModel
      ? stripLeadingProviderPrefix(providerPart, explicitModel)
      : "";
    const rawSuffix = stripLeadingProviderPrefix(providerPart, trimmed.slice(slashIndex + 1));
    const modelPart =
      cleanExplicit || rawSuffix || BUILTIN_PROVIDER_TIERS[providerPart][defaultTier].model;
    return `${providerPart}/${modelPart}`;
  }
  const provider = normalizeWorkflowProvider(trimmed);
  const cleanExplicit = explicitModel ? stripLeadingProviderPrefix(provider, explicitModel) : "";
  const model = cleanExplicit || BUILTIN_PROVIDER_TIERS[provider][defaultTier].model;
  return `${provider}/${model}`;
}

function stripLeadingProviderPrefix(provider: WorkflowProviderId, rawModel: string): string {
  const trimmed = rawModel.trim();
  const prefix = `${provider}/`;
  if (trimmed.toLowerCase().startsWith(prefix)) {
    return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}

function isModelOverrideCompatibleWithProvider(
  provider: WorkflowProviderId,
  modelOverride: string,
  specialistPreferredProvider?: string,
): boolean {
  const trimmed = modelOverride.trim();
  if (!trimmed) return false;
  if (
    specialistPreferredProvider &&
    normalizeWorkflowProvider(specialistPreferredProvider) !== provider
  ) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("gemini-4-") && provider !== "antigravity") return false;
  if (lower.startsWith("custom/") && provider !== "opencode") return false;
  if (lower.startsWith("headroom/") && provider !== "pi") return false;
  if (
    (lower.startsWith("claude/") && provider !== "claude") ||
    (lower.startsWith("codex/") && provider !== "codex") ||
    (lower.startsWith("antigravity/") && provider !== "antigravity") ||
    (lower.startsWith("opencode/") && provider !== "opencode") ||
    (lower.startsWith("pi/") && provider !== "pi")
  ) {
    return false;
  }
  return true;
}

export async function fetchEffectiveHarnessConfig(
  paseo: unknown,
  options: {
    workspaceId?: string | null;
    cwd?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<EffectiveHarnessConfig | null> {
  const invoke = (paseo as { plugins?: { invoke?: (...args: unknown[]) => Promise<unknown> } })
    ?.plugins?.invoke;
  if (typeof invoke !== "function") {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const invokePromise = invoke.call(
      (paseo as { plugins: unknown }).plugins,
      "agent-harness",
      "agent_harness.config.effective.request",
      {
        workspaceId: options.workspaceId ?? null,
        cwd: options.cwd ?? null,
      },
    );
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const raw = await Promise.race([invokePromise, timeoutPromise]);
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw as Record<string, unknown>;
    if ("config" in record) {
      const cfg = record.config;
      if (!cfg || typeof cfg !== "object") {
        return null;
      }
      const cfgObj = cfg as Record<string, unknown>;
      if (cfgObj.enabled === false) {
        return null;
      }
      return {
        ...(cfgObj as EffectiveHarnessConfig),
        ...("agentTeam" in record && record.agentTeam !== undefined && !("agentTeam" in cfgObj)
          ? { agentTeam: record.agentTeam as HarnessAgentTeamInfo | null }
          : {}),
      };
    }
    if ("specialists" in record || "providerMappings" in record || "enabled" in record) {
      if (record.enabled === false) {
        return null;
      }
      return record as EffectiveHarnessConfig;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function normalizeSpecialistsMap(
  effectiveConfig: EffectiveHarnessConfig | null,
): Map<string, HarnessSpecialistEntry> {
  const map = new Map<string, HarnessSpecialistEntry>();
  if (!effectiveConfig) return map;

  const addEntries = (
    source: Record<string, HarnessSpecialistEntry> | HarnessSpecialistEntry[] | undefined,
  ) => {
    if (!source) return;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (!item || typeof item !== "object") continue;
        const key = (item.role || item.id || "").trim();
        if (key) {
          map.set(key, { ...item, role: key });
        }
      }
    } else if (typeof source === "object") {
      for (const [key, item] of Object.entries(source)) {
        if (!item || typeof item !== "object") continue;
        const roleKey = (item.role || item.id || key).trim();
        if (roleKey) {
          map.set(roleKey, { ...item, role: roleKey });
        }
      }
    }
  };

  addEntries(effectiveConfig.specialists);
  addEntries(effectiveConfig.agentTeam?.roles);
  return map;
}

export function countHarnessSpecialists(effectiveConfig: EffectiveHarnessConfig | null): number {
  if (!effectiveConfig) return 0;
  const map = normalizeSpecialistsMap(effectiveConfig);
  let count = 0;
  for (const spec of map.values()) {
    if (spec.enabled !== false) {
      count += 1;
    }
  }
  return count;
}

function resolveAgentTeamPreset(
  team: HarnessAgentTeamInfo,
  effectiveConfig: EffectiveHarnessConfig,
): string {
  if (typeof team.preset === "string" && team.preset.trim().length > 0) {
    return team.preset.trim();
  }
  if (
    typeof effectiveConfig.agentTeamPreset === "string" &&
    effectiveConfig.agentTeamPreset.trim().length > 0
  ) {
    return effectiveConfig.agentTeamPreset.trim();
  }
  return "custom";
}

function resolveAgentTeamRolesCount(
  team: HarnessAgentTeamInfo,
  effectiveConfig: EffectiveHarnessConfig,
): number {
  if (typeof team.rolesCount === "number" && Number.isFinite(team.rolesCount)) {
    return Math.max(0, Math.trunc(team.rolesCount));
  }
  if (Array.isArray(team.roles)) {
    return team.roles.length;
  }
  if (team.roles && typeof team.roles === "object") {
    return Object.keys(team.roles).length;
  }
  return countHarnessSpecialists(effectiveConfig);
}

export function extractAgentTeamDiagnostic(
  effectiveConfig: EffectiveHarnessConfig | null,
  fallbackProjectSlug: string,
): { projectSlug: string; preset: string; rolesCount: number } | undefined {
  if (!effectiveConfig) return undefined;
  if (effectiveConfig.agentTeam && typeof effectiveConfig.agentTeam === "object") {
    const team = effectiveConfig.agentTeam;
    const projectSlug =
      typeof team.projectSlug === "string" && team.projectSlug.trim().length > 0
        ? team.projectSlug.trim()
        : fallbackProjectSlug;
    const preset = resolveAgentTeamPreset(team, effectiveConfig);
    const rolesCount = resolveAgentTeamRolesCount(team, effectiveConfig);
    return { projectSlug, preset, rolesCount };
  }
  if (
    typeof effectiveConfig.agentTeamPreset === "string" &&
    effectiveConfig.agentTeamPreset.trim().length > 0
  ) {
    return {
      projectSlug: fallbackProjectSlug,
      preset: effectiveConfig.agentTeamPreset.trim(),
      rolesCount: countHarnessSpecialists(effectiveConfig),
    };
  }
  return undefined;
}

function matchesPatterns(patterns: string[] | undefined, text: string): boolean {
  if (!patterns || patterns.length === 0 || !text) return false;
  for (const rawPattern of patterns) {
    if (!rawPattern) continue;
    try {
      const regex = new RegExp(rawPattern, "i");
      if (regex.test(text)) return true;
    } catch {
      if (text.toLowerCase().includes(rawPattern.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

function resolveRoleAndTier(params: {
  workflowPhase: string;
  explicitRole?: string;
  issueTitle?: string;
  issueBody?: string;
  effectiveConfig: EffectiveHarnessConfig | null;
  specialistsMap: Map<string, HarnessSpecialistEntry>;
}): {
  phase: HarnessPhase;
  role: string;
  tier: HarnessTier;
  specialist: HarnessSpecialistEntry | undefined;
} {
  const rawPhase = (params.workflowPhase || "implement").trim().toLowerCase();
  const explicitRole = params.explicitRole?.trim() || "";
  const issueTitle = params.issueTitle || "";
  const issueBody = params.issueBody || "";
  const issueText = `${issueTitle}\n${issueBody}`.trim();
  const { specialistsMap, effectiveConfig } = params;

  const isRoleEnabled = (role: string): boolean => {
    const entry = specialistsMap.get(role);
    return Boolean(entry && entry.enabled !== false);
  };

  const roleMatchesIssue = (role: string, fallbackRegex?: RegExp): boolean => {
    if (!issueText) return false;
    const entry = specialistsMap.get(role);
    if (entry?.matchPatterns && entry.matchPatterns.length > 0) {
      return matchesPatterns(entry.matchPatterns, issueText);
    }
    return fallbackRegex ? fallbackRegex.test(issueText) : false;
  };

  if (rawPhase === "brainstorm") {
    let role = explicitRole;
    if (!role) {
      if (isRoleEnabled("pm")) {
        role = "pm";
      } else if (isRoleEnabled("fe-pm")) {
        role = "fe-pm";
      } else if (isRoleEnabled("architect")) {
        role = "architect";
      } else if (specialistsMap.size === 0) {
        role = "pm";
      } else {
        role = "architect";
      }
    }
    const specialist = specialistsMap.get(role);
    const tier = normalizeHarnessTier(specialist?.preferredTier, "plan", "design");
    return { phase: "design", role, tier, specialist };
  }

  if (rawPhase === "spec" || rawPhase === "plan") {
    let role = explicitRole;
    if (!role) {
      if (isRoleEnabled("fe-architect") && roleMatchesIssue("fe-architect", BUILTIN_UI_REGEX)) {
        role = "fe-architect";
      } else if (
        isRoleEnabled("be-architect") &&
        roleMatchesIssue("be-architect", BUILTIN_BACKEND_REGEX)
      ) {
        role = "be-architect";
      } else if (isRoleEnabled("architect")) {
        role = "architect";
      } else if (isRoleEnabled("fe-architect")) {
        role = "fe-architect";
      } else if (isRoleEnabled("be-architect")) {
        role = "be-architect";
      } else {
        role = "architect";
      }
    }
    const specialist = specialistsMap.get(role);
    const tier = normalizeHarnessTier(specialist?.preferredTier, "plan", "design");
    return { phase: "design", role, tier, specialist };
  }

  if (rawPhase === "review") {
    let role = explicitRole;
    if (!role) {
      if (
        isRoleEnabled("be-reviewer") &&
        (roleMatchesIssue("be-reviewer", BUILTIN_BACKEND_REGEX) || !isRoleEnabled("review"))
      ) {
        role = "be-reviewer";
      } else if (
        isRoleEnabled("ops-auditor") &&
        (roleMatchesIssue("ops-auditor", BUILTIN_OPS_REGEX) || !isRoleEnabled("review"))
      ) {
        role = "ops-auditor";
      } else {
        role = "review";
      }
    }
    const specialist = specialistsMap.get(role);
    const tier = normalizeHarnessTier(specialist?.preferredTier, "review", "review");
    return { phase: "review", role, tier, specialist };
  }

  // auto_design, implement, or other execution stages -> phase: "exec"
  const isExecRoleEnabled = (candidateRole: string): boolean => {
    const entry = specialistsMap.get(candidateRole);
    return Boolean(entry && entry.enabled !== false && entry.readonly !== true);
  };

  let role = explicitRole;
  if (!role && issueText) {
    for (const [candidateRole, spec] of specialistsMap.entries()) {
      if (spec.enabled === false || spec.readonly === true || NON_EXEC_ROLES.has(candidateRole)) {
        continue;
      }
      if (spec.matchPatterns && spec.matchPatterns.length > 0) {
        if (matchesPatterns(spec.matchPatterns, issueText)) {
          role = candidateRole;
          break;
        }
      }
    }

    if (!role) {
      if (BUILTIN_UI_REGEX.test(issueText)) {
        if (specialistsMap.size === 0 || isExecRoleEnabled("ui")) {
          role = "ui";
        } else if (isExecRoleEnabled("fe-developer")) {
          role = "fe-developer";
        }
      } else if (BUILTIN_BACKEND_REGEX.test(issueText)) {
        if (specialistsMap.size === 0 || isExecRoleEnabled("backend")) {
          role = "backend";
        } else if (isExecRoleEnabled("be-developer")) {
          role = "be-developer";
        }
      } else if (BUILTIN_QA_REGEX.test(issueText)) {
        if (specialistsMap.size === 0 || isExecRoleEnabled("qa")) {
          role = "qa";
        }
      }
    }
  }

  if (!role) {
    role = effectiveConfig?.defaultFallbackRole?.trim() || "general";
  }

  const specialist = specialistsMap.get(role);
  const isFastTitle = CHORE_DOCS_STYLE_TITLE_REGEX.test(issueTitle);
  const tier: HarnessTier = isFastTitle
    ? "fast"
    : normalizeHarnessTier(specialist?.preferredTier, "standard", "exec");

  return { phase: "exec", role, tier, specialist };
}

function resolveModelAndThinking(params: {
  provider: WorkflowProviderId;
  configuredProvider: WorkflowProviderId;
  tier: HarnessTier;
  phase: HarnessPhase;
  configuredModel?: string;
  specialist?: HarnessSpecialistEntry;
  effectiveConfig: EffectiveHarnessConfig | null;
}): { model: string; thinkingOptionId: string | null } {
  const {
    provider,
    configuredProvider,
    tier,
    phase,
    configuredModel,
    specialist,
    effectiveConfig,
  } = params;
  const builtin = BUILTIN_PROVIDER_TIERS[provider][tier];

  const remoteMapping = effectiveConfig?.providerMappings?.[provider]?.[tier];
  const remoteThinkingMapVal = effectiveConfig?.providerThinkingMappings?.[provider]?.[tier];
  let mappedModel = builtin.model;
  let mappedThinking = builtin.thinkingOptionId;

  if (typeof remoteThinkingMapVal === "string" && remoteThinkingMapVal.trim().length > 0) {
    mappedThinking = remoteThinkingMapVal.trim();
  }

  if (typeof remoteMapping === "string" && remoteMapping.trim().length > 0) {
    const cleanRemote = stripLeadingProviderPrefix(provider, remoteMapping);
    if (cleanRemote.length > 0) {
      mappedModel = cleanRemote;
    }
  } else if (remoteMapping && typeof remoteMapping === "object") {
    if (typeof remoteMapping.model === "string" && remoteMapping.model.trim().length > 0) {
      const cleanRemote = stripLeadingProviderPrefix(provider, remoteMapping.model);
      if (cleanRemote.length > 0) {
        mappedModel = cleanRemote;
      }
    }
    const remoteThinking = remoteMapping.thinkingOptionId ?? remoteMapping.thinking;
    if (typeof remoteThinking === "string" && remoteThinking.trim().length > 0) {
      mappedThinking = remoteThinking.trim();
    }
  }

  if (
    typeof specialist?.thinkingOptionId === "string" &&
    specialist.thinkingOptionId.trim().length > 0
  ) {
    mappedThinking = specialist.thinkingOptionId.trim();
  }

  // Only inject thinkingOptionId when remote effectiveConfig is present
  const thinkingOptionId = effectiveConfig ? mappedThinking : null;

  const hasExplicitModelForProvider = Boolean(
    configuredModel &&
    provider === configuredProvider &&
    isModelOverrideCompatibleWithProvider(provider, configuredModel),
  );
  if (phase !== "review" && hasExplicitModelForProvider && configuredModel) {
    const cleanConfigured = stripLeadingProviderPrefix(provider, configuredModel);
    if (cleanConfigured.length > 0) {
      return {
        model: cleanConfigured,
        thinkingOptionId,
      };
    }
  }

  if (
    specialist?.modelOverride &&
    isModelOverrideCompatibleWithProvider(
      provider,
      specialist.modelOverride,
      specialist.preferredProvider,
    )
  ) {
    const cleanOverride = stripLeadingProviderPrefix(provider, specialist.modelOverride);
    if (cleanOverride.length > 0) {
      return {
        model: cleanOverride,
        thinkingOptionId,
      };
    }
  }

  return {
    model: mappedModel,
    thinkingOptionId,
  };
}

export type WorkflowSettingsReader = Partial<
  Pick<
    SettingsManager,
    | "getHarnessMode"
    | "getAgentProvider"
    | "getAgentModel"
    | "getReviewProviderOverride"
    | "getHasExplicitProviderOverride"
    | "current"
  >
>;

export interface ResolveWorkflowAgentLaunchParams {
  paseo?: unknown;
  settingsManager?: WorkflowSettingsReader;
  projectId?: string;
  workspaceId?: string;
  cwd?: string;
  runId?: string;
  phase?: string;
  explicitRole?: string;
  role?: string;
  issueTitle?: string;
  issueBody?: string;
  effectiveConfig?: EffectiveHarnessConfig | null;
  timeoutMs?: number;
}

export interface ResolvedWorkflowAgentLaunch {
  provider: WorkflowProviderId;
  model: string;
  providerSelection: string;
  thinkingOptionId: string | null;
  labels: Record<string, string>;
  metadata?: Record<string, unknown>;
  harnessInfo: WorkflowHarnessExecutionInfo;
}

export async function resolveWorkflowAgentLaunch(
  params: ResolveWorkflowAgentLaunchParams,
): Promise<ResolvedWorkflowAgentLaunch> {
  const { settingsManager, projectId, workspaceId, cwd, runId } = params;
  const workflowPhase = params.phase || "implement";
  const explicitRole = params.explicitRole ?? params.role;

  const harnessMode: GiteaHarnessMode =
    typeof settingsManager?.getHarnessMode === "function"
      ? settingsManager.getHarnessMode(projectId)
      : "auto";

  const rawConfiguredProvider =
    typeof settingsManager?.getAgentProvider === "function"
      ? settingsManager.getAgentProvider(projectId)
      : "claude";
  const configuredProvider = normalizeWorkflowProvider(rawConfiguredProvider);

  const rawConfiguredModel =
    typeof settingsManager?.getAgentModel === "function"
      ? settingsManager.getAgentModel(projectId)
      : undefined;
  const configuredModel =
    typeof rawConfiguredModel === "string" && rawConfiguredModel.trim().length > 0
      ? rawConfiguredModel.trim()
      : undefined;

  const rawReviewOverride =
    typeof settingsManager?.getReviewProviderOverride === "function"
      ? settingsManager.getReviewProviderOverride(projectId)
      : undefined;
  const reviewProviderOverride =
    typeof rawReviewOverride === "string" && rawReviewOverride.trim().length > 0
      ? normalizeWorkflowProvider(rawReviewOverride)
      : undefined;

  const hasExplicitProviderOverride =
    typeof settingsManager?.getHasExplicitProviderOverride === "function"
      ? settingsManager.getHasExplicitProviderOverride(projectId)
      : Boolean(
          projectId &&
          (
            settingsManager as {
              current?: { projects?: Record<string, { agentProviderOverride?: string }> };
            }
          )?.current?.projects?.[projectId]?.agentProviderOverride?.trim(),
        );

  if (harnessMode === "disabled") {
    const { phase, role, tier } = resolveRoleAndTier({
      workflowPhase,
      explicitRole,
      issueTitle: params.issueTitle,
      issueBody: params.issueBody,
      effectiveConfig: null,
      specialistsMap: new Map(),
    });
    const provider =
      phase === "review" && reviewProviderOverride ? reviewProviderOverride : configuredProvider;
    const cleanConfigured =
      configuredModel &&
      provider === configuredProvider &&
      isModelOverrideCompatibleWithProvider(provider, configuredModel)
        ? stripLeadingProviderPrefix(provider, configuredModel)
        : "";
    const model = cleanConfigured || BUILTIN_PROVIDER_TIERS[provider][tier].model;
    const providerSelection = `${provider}/${model}`;

    const labels: Record<string, string> = {
      "paseo.workflow": "gitea-workflow",
      "paseo.workflow.phase": phase,
      "paseo.workflow.unattended": "1",
      ...(runId ? { "paseo.workflow.run-id": String(runId) } : {}),
    };

    const harnessInfo: WorkflowHarnessExecutionInfo = {
      enabled: false,
      mode: "disabled",
      role,
      tier,
      phase,
      provider,
      model,
      thinkingOptionId: null,
      lazyToolSlice: null,
      agentTeamPreset: null,
    };

    return {
      provider,
      model,
      providerSelection,
      thinkingOptionId: null,
      labels,
      metadata: { agentHarnessBypassed: true },
      harnessInfo,
    };
  }

  const effectiveConfig =
    params.effectiveConfig !== undefined
      ? params.effectiveConfig
      : await fetchEffectiveHarnessConfig(params.paseo, {
          workspaceId,
          cwd,
          timeoutMs: params.timeoutMs,
        });

  const specialistsMap = normalizeSpecialistsMap(effectiveConfig);
  const { phase, role, tier, specialist } = resolveRoleAndTier({
    workflowPhase,
    explicitRole,
    issueTitle: params.issueTitle,
    issueBody: params.issueBody,
    effectiveConfig,
    specialistsMap,
  });

  let provider: WorkflowProviderId = configuredProvider;
  if (harnessMode === "provider_locked") {
    if (phase === "review" && reviewProviderOverride) {
      provider = reviewProviderOverride;
    } else {
      provider = configuredProvider;
    }
  } else {
    // harnessMode === "auto"
    if (phase === "review") {
      if (reviewProviderOverride) {
        provider = reviewProviderOverride;
      } else if (effectiveConfig) {
        const reviewSpecialist = specialist ?? specialistsMap.get("review");
        provider = reviewSpecialist?.preferredProvider
          ? normalizeWorkflowProvider(reviewSpecialist.preferredProvider)
          : "antigravity";
      } else {
        provider = configuredProvider;
      }
    } else {
      if (hasExplicitProviderOverride) {
        provider = configuredProvider;
      } else if (
        effectiveConfig &&
        effectiveConfig.honorSpecialistPreferredProvider !== false &&
        specialist?.preferredProvider
      ) {
        provider = normalizeWorkflowProvider(specialist.preferredProvider);
      } else {
        provider = configuredProvider;
      }
    }
  }

  const { model, thinkingOptionId } = resolveModelAndThinking({
    provider,
    configuredProvider,
    tier,
    phase,
    configuredModel,
    specialist,
    effectiveConfig,
  });

  const providerSelection = `${provider}/${model}`;
  const lazyToolSlice = specialist?.lazyToolSlice ?? null;
  const agentTeamPreset =
    effectiveConfig?.agentTeamPreset ?? effectiveConfig?.agentTeam?.preset ?? null;

  const labels: Record<string, string> = {
    role,
    "paseo.harness-leaf": "1",
    "paseo.workflow": "gitea-workflow",
    "paseo.workflow.phase": phase,
    "paseo.workflow.tier": tier,
    "paseo.workflow.unattended": "1",
    ...(runId ? { "paseo.workflow.run-id": String(runId) } : {}),
  };

  const harnessInfo: WorkflowHarnessExecutionInfo = {
    enabled: Boolean(effectiveConfig),
    mode: harnessMode,
    role,
    tier,
    phase,
    provider,
    model,
    thinkingOptionId,
    lazyToolSlice,
    agentTeamPreset,
  };

  return {
    provider,
    model,
    providerSelection,
    thinkingOptionId,
    labels,
    harnessInfo,
  };
}
