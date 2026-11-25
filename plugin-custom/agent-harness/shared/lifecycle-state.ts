import {
  compileSafeRegex,
  inferTierFromModel,
  isNativePlanModeSupported,
  normalizeTierAlias,
  resolveTierTarget,
} from "./config-resolver.js";
import { supportsNativePlanMode } from "./contracts.js";
import { CONVENTIONAL_EXEC_PREFIX } from "./intent-detector.js";
import {
  HARNESS_METADATA_KEY,
  HARNESS_METADATA_VERSION,
  type DomainRole,
  type EffectiveHarnessConfig,
  type HarnessAgentMetadata,
  type HarnessDowngradeReason,
  type HarnessPhase,
  type MatrixTier,
} from "./types.js";

const WRITE_TOOL_NAME_PATTERN =
  /^(?:edit|multiedit|write|notebookedit|apply_patch|write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content|replace_in_files|replace_symbol_body|replace_content|patch)$/i;

const PASEO_CREATE_AGENT_TOOL_PATTERN =
  /^(?:paseo\.create_agent|mcp_+paseo_+create_agent|paseo__create_agent)$/i;

const EXIT_PLAN_MODE_TOOL_PATTERN = /^(?:exit_plan_mode|exitplanmode)$/i;
const INVOKE_SUBAGENT_TOOL_PATTERN = /^invoke_subagent$/i;

const READONLY_SUBAGENT_TYPES = new Set([
  "research",
  "spec-critic",
  "code-reviewer",
  "qa-verifier",
  "explore",
  "plan",
  "architect",
]);

const DEFAULT_DOC_WHITELIST_PATTERN = /\.(?:md|mdx|txt)$/i;
const OPENSPEC_WHITELIST_PATTERN = /(?:^|\/)openspec\//i;
const ANTIGRAVITY_BRAIN_WHITELIST_PATTERN =
  /^(?:\/Users\/[^/]+|\/home\/[^/]+|~)\/\.gemini\/antigravity-cli\/brain\/.+/;

const NEGATIVE_DISCUSSION_PATTERNS: RegExp[] = [
  /不要改|先别写|别改代码|别改|先不要|再想想|再对比|再讨论|还有其他方案|还有别的方法|不急着改|暂不修改/i,
  /\b(?:no|not|don't|dont|wait|stop|hold\s+on|never|cancel)\b/i,
];

const EXPLICIT_EXEC_PATTERNS: RegExp[] = [
  // Chinese affirmative execution / implementation phrases
  /(?:好的[，, ]*)?就?按(?:这个|这套|上述|方案[a-zA-Z0-9_-]*|计划).*(?:改代码|修改|实现|落地|做|写)/i,
  /(?:直接|开始|立即|赶紧)(?:改|写|落地|实现|编写)(?:代码|吧)?/i,
  /(?:开始写代码|改代码吧|写代码吧|实施方案|开始实施|开始实现)/i,
  // Service startup / operational commands
  /(?:启动|重启|停止)(?:一下)?(?:开发|本地|前端|后端)?服务|\b(?:start|restart|stop)\s+(?:the\s+)?(?:dev\s+)?server\b/i,
  // English affirmative execution / implementation phrases
  /\b(?:implement(?:\s+it|\s+this(?:\s+plan)?|\s+now)?|go\s+ahead\s+and\s+implement|start\s+implementing|proceed\s+with\s+implementation|let\'s\s+implement|please\s+implement)\b/i,
];

const SHORT_AFFIRMATIVE_EXEC_WORDS = new Set([
  "yes",
  "yes, go",
  "yes go",
  "yes please",
  "yes, please",
  "yes proceed",
  "yes, proceed",
  "yes do it",
  "yes, continue",
  "yes continue",
  "continue",
  "ok",
  "ok go",
  "ok, go",
  "ok proceed",
  "ok, proceed",
  "ok please",
  "ok, please",
  "ok, continue",
  "ok continue",
  "okay",
  "okay go",
  "okay, go",
  "okay proceed",
  "okay, proceed",
  "okay, continue",
  "okay continue",
  "sure",
  "sure go",
  "sure, go",
  "sure proceed",
  "sure, proceed",
  "sure please",
  "sure, please",
  "sure, continue",
  "sure continue",
  "go",
  "go ahead",
  "let's go",
  "lets go",
  "proceed",
  "please proceed",
  "please go",
  "do it",
  "ship it",
  "sounds good",
  "sounds good, go",
  "sounds good go",
  "sounds good, proceed",
  "lgtm",
  "lgtm, go",
  "lgtm go",
  "好",
  "好的",
  "好，继续",
  "好的，继续",
  "好，开始",
  "好的，开始",
  "好，开始执行",
  "好的，开始执行",
  "好开始",
  "好的开始",
  "继续",
  "继续吧",
  "继续执行",
  "按方案执行",
  "改吧",
  "写吧",
  "开始",
  "开始吧",
  "开始执行",
  "动手吧",
  "可以",
  "可以，开始吧",
  "可以，动手",
  "可以动手",
  "可以，继续",
  "可以继续",
  "同意，继续",
  "同意继续",
  "同意，开始",
  "同意开始",
  "好的继续",
  "好继续",
  "行",
  "行，改吧",
  "行，开始",
  "行，继续",
  "行改吧",
  "没问题",
  "没问题，开始",
  "没问题，继续",
  "可以开始吧",
  "好改吧",
  "好的改吧",
  "按这个来",
]);

function normalizeAffirmativePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

const NORMALIZED_SHORT_AFFIRMATIVE_EXEC_WORDS = new Set<string>();
for (const word of SHORT_AFFIRMATIVE_EXEC_WORDS) {
  NORMALIZED_SHORT_AFFIRMATIVE_EXEC_WORDS.add(normalizeAffirmativePhrase(word));
}

export function hasShortAffirmativeExecConfirmation(
  userText: string,
  planTurnCount: number,
  customWords?: string[],
): boolean {
  if (planTurnCount < 1 || !userText || !userText.trim()) {
    return false;
  }
  const trimmed = userText.trim();
  if (trimmed.length > 32) {
    return false;
  }
  if (/[?？]\s*$/.test(trimmed)) {
    return false;
  }
  for (const pattern of NEGATIVE_DISCUSSION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  const lower = trimmed.toLowerCase();
  const normalized = normalizeAffirmativePhrase(lower);
  if (customWords && customWords.length > 0) {
    for (const w of customWords) {
      if (lower === w.toLowerCase()) return true;
      const normalizedCustom = normalizeAffirmativePhrase(w);
      if (normalizedCustom && normalizedCustom === normalized) return true;
    }
  }

  if (SHORT_AFFIRMATIVE_EXEC_WORDS.has(lower)) {
    return true;
  }
  return (
    SHORT_AFFIRMATIVE_EXEC_WORDS.has(normalized) ||
    NORMALIZED_SHORT_AFFIRMATIVE_EXEC_WORDS.has(normalized)
  );
}

export function shouldEnforceNativePlanMode(params: {
  phaseLifecycleEnabled: boolean;
  enforceNativePlanMode: boolean;
  tier: MatrixTier;
  phase?: HarnessPhase;
  role: DomainRole;
  userModelLocked: boolean;
  roleLockedByLabel: boolean;
  hasParentAgent: boolean;
  provider: string;
  config?: EffectiveHarnessConfig | null;
}): boolean {
  const isSupported = params.config
    ? isNativePlanModeSupported(params.config, params.provider)
    : supportsNativePlanMode(params.provider);

  const isDesignPhase = params.phase ? params.phase === "design" : params.tier === "plan";

  return (
    params.phaseLifecycleEnabled &&
    params.enforceNativePlanMode &&
    isDesignPhase &&
    params.role !== "orchestrator" &&
    !params.userModelLocked &&
    !params.roleLockedByLabel &&
    !params.hasParentAgent &&
    isSupported
  );
}

export function tierToPhase(
  tier: MatrixTier,
  role?: DomainRole,
  config?: EffectiveHarnessConfig | null,
  explicitPhase?: HarnessPhase,
): HarnessPhase {
  const normRole = role?.trim().toLowerCase() ?? "";
  if (
    tier === "review" ||
    normRole === "review" ||
    normRole.endsWith("-reviewer") ||
    normRole.endsWith("-auditor")
  ) {
    return "review";
  }
  if (
    tier === "plan" ||
    normRole === "pm" ||
    normRole.endsWith("-pm") ||
    normRole === "architect" ||
    normRole.endsWith("-architect")
  ) {
    return "design";
  }
  if (explicitPhase) {
    return explicitPhase;
  }
  if (config) {
    const tierCfg =
      config.tiers.find((t) => t.id === tier) ??
      config.tiers.find((t) => t.id === normalizeTierAlias(tier));
    if (tierCfg?.defaultPhase) {
      return tierCfg.defaultPhase;
    }
  }
  return "exec";
}

export function createInitialHarnessMetadata(params: {
  role: DomainRole;
  tier: MatrixTier;
  phase?: HarnessPhase;
  model?: string | null;
  thinkingOptionId?: string | null;
  roleMatchedRule: string;
  tierMatchedRule: string;
  userModelLocked?: boolean;
  roleLockedByLabel?: boolean;
  resumeModeId?: string | null;
  lastBilledTier?: MatrixTier | null;
  lastBilledModel?: string | null;
  lastBilledThinking?: string | null;
  config?: EffectiveHarnessConfig | null;
}): HarnessAgentMetadata {
  return {
    version: HARNESS_METADATA_VERSION,
    role: params.role,
    initialTier: params.tier,
    currentTier: params.tier,
    currentModel: params.model ?? null,
    phase: tierToPhase(params.tier, params.role, params.config, params.phase),
    roleMatchedRule: params.roleMatchedRule,
    tierMatchedRule: params.tierMatchedRule,
    userModelLocked: Boolean(params.userModelLocked),
    roleLockedByLabel: Boolean(params.roleLockedByLabel),
    turnCount: 0,
    planTurnCount: 0,
    writeToolDetectedInPlan: false,
    handoffSuggestedAtTurn: null,
    autoDowngradedAtTurn: null,
    downgradeReason: null,
    lastProcessedTurnId: null,
    resumeModeId: params.resumeModeId ?? null,
    lastBilledTier: params.lastBilledTier ?? null,
    lastBilledModel: params.lastBilledModel ?? null,
    currentThinking: params.thinkingOptionId ?? null,
    lastBilledThinking: params.lastBilledThinking ?? null,
  };
}

export function parseHarnessMetadata(raw: unknown): HarnessAgentMetadata | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const candidate =
    HARNESS_METADATA_KEY in raw ? (raw as Record<string, unknown>)[HARNESS_METADATA_KEY] : raw;

  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }

  const obj = candidate as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    return null;
  }
  if (typeof obj.role !== "string" || typeof obj.currentTier !== "string") {
    return null;
  }
  if (typeof obj.phase !== "string") {
    return null;
  }

  return {
    version: obj.version,
    role: obj.role as DomainRole,
    initialTier: (obj.initialTier ?? obj.currentTier) as MatrixTier,
    currentTier: obj.currentTier as MatrixTier,
    currentModel: typeof obj.currentModel === "string" ? obj.currentModel : null,
    phase: obj.phase as HarnessPhase,
    roleMatchedRule: typeof obj.roleMatchedRule === "string" ? obj.roleMatchedRule : "",
    tierMatchedRule: typeof obj.tierMatchedRule === "string" ? obj.tierMatchedRule : "",
    userModelLocked: Boolean(obj.userModelLocked),
    roleLockedByLabel: Boolean(obj.roleLockedByLabel),
    turnCount: typeof obj.turnCount === "number" ? obj.turnCount : 0,
    planTurnCount: typeof obj.planTurnCount === "number" ? obj.planTurnCount : 0,
    writeToolDetectedInPlan: Boolean(obj.writeToolDetectedInPlan),
    handoffSuggestedAtTurn:
      typeof obj.handoffSuggestedAtTurn === "number" ? obj.handoffSuggestedAtTurn : null,
    autoDowngradedAtTurn:
      typeof obj.autoDowngradedAtTurn === "number" ? obj.autoDowngradedAtTurn : null,
    downgradeReason:
      typeof obj.downgradeReason === "string"
        ? (obj.downgradeReason as HarnessDowngradeReason)
        : null,
    lastProcessedTurnId:
      typeof obj.lastProcessedTurnId === "string" ? obj.lastProcessedTurnId : null,
    resumeModeId: typeof obj.resumeModeId === "string" ? obj.resumeModeId : null,
    lastBilledTier:
      typeof obj.lastBilledTier === "string" ? (obj.lastBilledTier as MatrixTier) : null,
    lastBilledModel: typeof obj.lastBilledModel === "string" ? obj.lastBilledModel : null,
    currentThinking: typeof obj.currentThinking === "string" ? obj.currentThinking : null,
    lastBilledThinking: typeof obj.lastBilledThinking === "string" ? obj.lastBilledThinking : null,
  };
}

export function extractTimelineItems(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "object" && raw !== null) {
    if ("items" in raw && Array.isArray((raw as { items: unknown }).items)) {
      return (raw as { items: unknown[] }).items;
    }
    if ("entries" in raw && Array.isArray((raw as { entries: unknown }).entries)) {
      return (raw as { entries: unknown[] }).entries.map((entry) =>
        typeof entry === "object" && entry !== null && "item" in entry
          ? (entry as { item: unknown }).item
          : entry,
      );
    }
  }
  return [];
}

function isExemptDocPath(p: string, docPatternRegex?: RegExp | null): boolean {
  const trimmed = p.trim();
  if (!trimmed) {
    return false;
  }
  const slashNormalized = trimmed.replace(/\\/g, "/");
  if (slashNormalized.split("/").includes("..")) {
    return false;
  }
  const normalized = slashNormalized.replace(/\/+/g, "/");
  if (docPatternRegex && docPatternRegex.test(normalized)) {
    return true;
  }
  return (
    DEFAULT_DOC_WHITELIST_PATTERN.test(normalized) ||
    OPENSPEC_WHITELIST_PATTERN.test(normalized) ||
    ANTIGRAVITY_BRAIN_WHITELIST_PATTERN.test(normalized)
  );
}

const PATH_STRING_KEYS = new Set([
  "file_path",
  "filepath",
  "path",
  "relative_path",
  "relativepath",
  "target_file",
  "targetfile",
  "destination",
  "dest",
  "target_dir",
  "targetdir",
  "target_path",
  "targetpath",
  "file",
]);

const PATH_ARRAY_KEYS = new Set([
  "paths",
  "files",
  "target_files",
  "targetfiles",
  "file_paths",
  "filepaths",
]);

function parseJsonRecord(val: unknown): Record<string, unknown> | null {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function collectPathsFromRecord(src: Record<string, unknown> | null, out: string[]): void {
  if (!src) {
    return;
  }
  for (const [key, val] of Object.entries(src)) {
    const lowerKey = key.toLowerCase();
    if (typeof val === "string" && PATH_STRING_KEYS.has(lowerKey) && val.trim()) {
      out.push(val);
    } else if (Array.isArray(val) && PATH_ARRAY_KEYS.has(lowerKey)) {
      for (const item of val) {
        if (typeof item === "string" && item.trim()) {
          out.push(item);
        }
      }
    }
  }
}

function extractPathsFromTool(item: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const detail = parseJsonRecord(item.detail);
  const detailInput = detail ? parseJsonRecord(detail.input) : null;
  const input = parseJsonRecord(item.input);
  const args = parseJsonRecord(item.args) ?? parseJsonRecord(item.arguments);

  collectPathsFromRecord(detail, paths);
  collectPathsFromRecord(detailInput, paths);
  collectPathsFromRecord(input, paths);
  collectPathsFromRecord(args, paths);

  return paths;
}

function resolveFallbackToolName(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resolveAutoDowngradeReason(
  shouldDowngrade: boolean,
  inspection: {
    detectedCodeWrite: boolean;
    planExitInvoked?: boolean;
    writableSubagentInvoked?: boolean;
  },
): HarnessDowngradeReason | null {
  if (!shouldDowngrade) {
    return null;
  }
  if (inspection.detectedCodeWrite) {
    return "write_tool_in_plan";
  }
  if (inspection.planExitInvoked) {
    return "plan_approved";
  }
  if (inspection.writableSubagentInvoked) {
    return "write_tool_in_plan";
  }
  return "explicit_exec_intent";
}

function extractSubagentTypeName(records: ReadonlyArray<Record<string, unknown> | null>): string {
  for (const rec of records) {
    if (!rec) continue;
    for (const [key, val] of Object.entries(rec)) {
      const lower = key.toLowerCase();
      if (
        (lower === "typename" ||
          lower === "type_name" ||
          lower === "subagent_type" ||
          lower === "agenttype" ||
          lower === "agent_type") &&
        typeof val === "string" &&
        val.trim()
      ) {
        return val.trim().toLowerCase();
      }
    }
  }
  return "";
}

function isReadOnlySubagentType(typeName: string): boolean {
  if (!typeName) {
    return true;
  }
  if (READONLY_SUBAGENT_TYPES.has(typeName)) {
    return true;
  }
  return (
    typeName.endsWith("-reviewer") ||
    typeName.endsWith("-auditor") ||
    typeName.endsWith("-critic") ||
    typeName.endsWith("-verifier")
  );
}

export function inspectTurnTimeline(
  items: readonly unknown[],
  docWhitelistPattern?: string,
): {
  latestUserText: string;
  detectedCodeWrite: boolean;
  handoffInvoked: boolean;
  planExitInvoked: boolean;
  writableSubagentInvoked: boolean;
} {
  let lastUserIndex = -1;
  let latestUserText = "";

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (typeof item === "object" && item !== null) {
      const candidate = item as Record<string, unknown>;
      if (
        candidate.type === "user_message" ||
        (candidate.type === "message" && candidate.role === "user")
      ) {
        lastUserIndex = i;
        if (typeof candidate.text === "string") {
          latestUserText = candidate.text;
        } else if (typeof candidate.content === "string") {
          latestUserText = candidate.content;
        }
        break;
      }
    }
  }

  const currentTurnItems = lastUserIndex >= 0 ? items.slice(lastUserIndex + 1) : items;

  let detectedCodeWrite = false;
  let handoffInvoked = false;
  let planExitInvoked = false;
  let writableSubagentInvoked = false;
  const docRegex = docWhitelistPattern ? compileSafeRegex(docWhitelistPattern) : null;

  for (const rawItem of currentTurnItems) {
    if (typeof rawItem !== "object" || rawItem === null) {
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    const detail = parseJsonRecord(item.detail);
    const detailInputObj = detail ? parseJsonRecord(detail.input) : null;

    const toolName =
      typeof item.name === "string" ? item.name : resolveFallbackToolName(item.toolName);
    const detailType = detail && typeof detail.type === "string" ? detail.type : "";
    const status = typeof item.status === "string" ? item.status.toLowerCase() : "";
    const isFailedCall =
      status === "error" || status === "failed" || status === "denied" || status === "rejected";

    // 1. Check handoff invocation & plan exit / writable subagent calls
    const isSkillCall = /^(?:skill)$/i.test(toolName);
    const inputObj = parseJsonRecord(item.input);
    const argsObj = parseJsonRecord(item.args) ?? parseJsonRecord(item.arguments);
    const skillName =
      (inputObj && typeof inputObj.skill === "string" ? inputObj.skill : "") ||
      (argsObj && typeof argsObj.skill === "string" ? argsObj.skill : "") ||
      toolName;

    if (
      toolName === "harness_handoff" ||
      toolName.endsWith("__harness_handoff") ||
      toolName.includes("paseo-handoff") ||
      (isSkillCall && skillName.includes("paseo-handoff"))
    ) {
      handoffInvoked = true;
    }

    if (PASEO_CREATE_AGENT_TOOL_PATTERN.test(toolName)) {
      const candidateInput = detailInputObj ?? inputObj ?? argsObj;
      const labelsObj = candidateInput ? parseJsonRecord(candidateInput.labels) : null;
      if (
        !candidateInput ||
        Boolean(labelsObj?.role) ||
        Boolean(labelsObj?.profile) ||
        labelsObj?.[HARNESS_LEAF_LABEL_KEY] === "1"
      ) {
        handoffInvoked = true;
      }
    }

    if (
      !isFailedCall &&
      (EXIT_PLAN_MODE_TOOL_PATTERN.test(toolName) || detailType === "exit_plan_mode")
    ) {
      planExitInvoked = true;
    }

    if (!isFailedCall && INVOKE_SUBAGENT_TOOL_PATTERN.test(toolName)) {
      const subagentType = extractSubagentTypeName([detailInputObj, detail, inputObj, argsObj]);
      if (!isReadOnlySubagentType(subagentType)) {
        writableSubagentInvoked = true;
      }
    }

    const command =
      (detail && typeof detail.command === "string" ? detail.command : "") ||
      (inputObj && typeof inputObj.command === "string" ? inputObj.command : "") ||
      (argsObj && typeof argsObj.command === "string" ? argsObj.command : "") ||
      (typeof item.input === "string" ? item.input : "") ||
      (typeof item.arguments === "string" ? item.arguments : "");

    if (command && (/\bpaseo\s+run\b/.test(command) || command.includes("paseo-handoff"))) {
      handoffInvoked = true;
    }

    // 2. Check code write tools
    const isWriteTool =
      WRITE_TOOL_NAME_PATTERN.test(toolName) || detailType === "edit" || detailType === "write";

    if (isWriteTool) {
      const paths = extractPathsFromTool(item);
      if (paths.length === 0) {
        detectedCodeWrite = true;
      } else {
        const allExempt = paths.every((p) => isExemptDocPath(p, docRegex));
        if (!allExempt) {
          detectedCodeWrite = true;
        }
      }
    }
  }

  return {
    latestUserText,
    detectedCodeWrite,
    handoffInvoked,
    planExitInvoked,
    writableSubagentInvoked,
  };
}

export function hasExplicitExecTransitionIntent(userText: string): boolean {
  if (!userText || !userText.trim()) {
    return false;
  }
  const trimmed = userText.trim();

  // Negative / discussion check
  for (const pattern of NEGATIVE_DISCUSSION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // Anchored Conventional Commit or command prefix
  if (CONVENTIONAL_EXEC_PREFIX.test(trimmed)) {
    return true;
  }

  // Affirmative transition phrases
  for (const pattern of EXPLICIT_EXEC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

export interface EvaluateTurnAfterTransitionParams {
  meta: HarnessAgentMetadata;
  turnId: string | null;
  settings: {
    planTurnSoftLimit: number;
    autoDowngradePlanOnExec: boolean;
  };
  timelineInspection: {
    latestUserText: string;
    detectedCodeWrite: boolean;
    handoffInvoked: boolean;
    planExitInvoked?: boolean;
    writableSubagentInvoked?: boolean;
  };
  providerStandardModel?: string;
  providerStandardThinking?: string | null;
  /** @deprecated Legacy alias for `providerStandardModel`. */
  providerFlashModel?: string;
  lockTierOnLabel?: boolean;
}

export interface EvaluateTurnAfterTransitionResult {
  nextMeta: HarnessAgentMetadata;
  shouldDowngrade: boolean;
  standardModel: string;
  standardThinking: string | null;
  /** @deprecated Legacy alias for `standardModel`. */
  flashModel: string;
  downgradeReason: HarnessDowngradeReason | null;
  canAutoDowngrade: boolean;
}

export function evaluateTurnAfterTransition(
  params: EvaluateTurnAfterTransitionParams,
): EvaluateTurnAfterTransitionResult {
  const {
    meta,
    turnId,
    settings,
    timelineInspection,
    providerStandardModel,
    providerStandardThinking,
    providerFlashModel,
    lockTierOnLabel,
  } = params;
  const nextTurnCount = meta.turnCount + 1;
  const isPlanDesign = meta.phase === "design";
  const nextPlanTurnCount = isPlanDesign ? meta.planTurnCount + 1 : meta.planTurnCount;

  // Snapshot the billed configuration for the turn that just ran
  const billedTier = meta.currentTier;
  const billedModel = meta.currentModel;
  const billedThinking = meta.currentThinking ?? null;

  let handoffSuggestedAtTurn = meta.handoffSuggestedAtTurn;
  if (
    isPlanDesign &&
    nextPlanTurnCount >= settings.planTurnSoftLimit &&
    handoffSuggestedAtTurn === null
  ) {
    handoffSuggestedAtTurn = nextTurnCount;
  }

  const isRoleProtected =
    lockTierOnLabel !== undefined
      ? lockTierOnLabel
      : meta.role === "pm" || meta.role === "architect";

  const canAutoDowngrade =
    settings.autoDowngradePlanOnExec &&
    meta.autoDowngradedAtTurn === null &&
    !meta.userModelLocked &&
    !(meta.roleLockedByLabel && isRoleProtected);

  const hasExecIntent =
    nextTurnCount >= 2 &&
    !timelineInspection.handoffInvoked &&
    (hasExplicitExecTransitionIntent(timelineInspection.latestUserText) ||
      hasShortAffirmativeExecConfirmation(timelineInspection.latestUserText, meta.planTurnCount));

  const shouldDowngrade =
    isPlanDesign &&
    canAutoDowngrade &&
    (timelineInspection.detectedCodeWrite ||
      Boolean(timelineInspection.planExitInvoked) ||
      Boolean(timelineInspection.writableSubagentInvoked) ||
      hasExecIntent);

  const downgradeReason: HarnessDowngradeReason | null = resolveAutoDowngradeReason(
    shouldDowngrade,
    timelineInspection,
  );

  const standardModel = providerStandardModel ?? providerFlashModel ?? "flash";
  const standardThinking = providerStandardThinking ?? null;

  const nextMeta: HarnessAgentMetadata = {
    ...meta,
    turnCount: nextTurnCount,
    planTurnCount: nextPlanTurnCount,
    writeToolDetectedInPlan:
      meta.writeToolDetectedInPlan || (isPlanDesign && timelineInspection.detectedCodeWrite),
    handoffSuggestedAtTurn,
    currentTier: shouldDowngrade ? "standard" : meta.currentTier,
    currentModel: shouldDowngrade ? standardModel : meta.currentModel,
    currentThinking: shouldDowngrade ? standardThinking : (meta.currentThinking ?? null),
    phase: shouldDowngrade ? "exec" : meta.phase,
    autoDowngradedAtTurn: shouldDowngrade ? nextTurnCount : meta.autoDowngradedAtTurn,
    downgradeReason: shouldDowngrade ? downgradeReason : meta.downgradeReason,
    lastProcessedTurnId: turnId,
    lastBilledTier: billedTier,
    lastBilledModel: billedModel,
    lastBilledThinking: billedThinking,
  };

  return {
    nextMeta,
    shouldDowngrade,
    standardModel,
    standardThinking,
    flashModel: standardModel,
    downgradeReason,
    canAutoDowngrade,
  };
}

export const HARNESS_BYPASSED_META_KEY = "agentHarnessBypassed" as const;
export const HARNESS_LEAF_META_KEY = "agentHarnessLeaf" as const;
export const HARNESS_LEAF_LABEL_KEY = "paseo.harness-leaf" as const;
export const HARNESS_WORKFLOW_UNATTENDED_LABEL_KEY = "paseo.workflow.unattended" as const;
export const HARNESS_WORKFLOW_PHASE_LABEL_KEY = "paseo.workflow.phase" as const;
export const HARNESS_WORKFLOW_TIER_LABEL_KEY = "paseo.workflow.tier" as const;

export function extractSnapshotModel(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const candidate = snapshot as {
    runtimeInfo?: { model?: unknown } | null;
    model?: unknown;
    options?: { model?: unknown } | null;
  };
  for (const val of [candidate.runtimeInfo?.model, candidate.model, candidate.options?.model]) {
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

/** Extracts the active thinking option from a live agent snapshot. */
export function extractSnapshotThinking(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const candidate = snapshot as {
    runtimeInfo?: { thinkingOptionId?: unknown } | null;
    effectiveThinkingOptionId?: unknown;
    thinkingOptionId?: unknown;
    options?: { thinkingOptionId?: unknown } | null;
  };
  for (const val of [
    candidate.runtimeInfo?.thinkingOptionId,
    candidate.effectiveThinkingOptionId,
    candidate.thinkingOptionId,
    candidate.options?.thinkingOptionId,
  ]) {
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Reconciles persisted `agentHarness` metadata against a live runtime snapshot
 * when the user changes models externally or resumes a legacy v4 metadata record.
 * Returns `{ meta, changed: false }` untouched when snapshot model is unavailable.
 */
export function reconcileRuntimeHarnessMetadata(params: {
  meta: HarnessAgentMetadata;
  snapshot: unknown;
  provider: string;
  config: EffectiveHarnessConfig;
}): { meta: HarnessAgentMetadata; changed: boolean } {
  const { meta, snapshot, provider, config } = params;
  const snapModel = extractSnapshotModel(snapshot);
  if (!snapModel) {
    return { meta, changed: false };
  }

  const snapThinking = extractSnapshotThinking(snapshot);
  const inferred = inferTierFromModel(config, provider, snapModel, meta.currentTier);
  const canonicalInitialTier = normalizeTierAlias(meta.initialTier);
  const canonicalLastBilledTier = meta.lastBilledTier
    ? normalizeTierAlias(meta.lastBilledTier)
    : null;

  if (snapModel !== meta.currentModel) {
    const resolvedThinking =
      snapThinking ??
      resolveTierTarget(config, provider, inferred.tier).thinkingOptionId ??
      meta.currentThinking ??
      null;
    return {
      meta: {
        ...meta,
        initialTier: canonicalInitialTier,
        currentTier: inferred.tier,
        currentModel: snapModel,
        currentThinking: resolvedThinking,
        lastBilledTier: canonicalLastBilledTier,
        userModelLocked: !inferred.isRouterManagedNonMax,
        tierMatchedRule: "runtime_sync:external_model_change",
      },
      changed: true,
    };
  }

  const canonicalCurrentTier = normalizeTierAlias(meta.currentTier);
  const isLegacyTier = canonicalCurrentTier !== meta.currentTier;
  let nextCurrentTier = meta.currentTier;
  if (isLegacyTier) {
    nextCurrentTier = inferred.isKnownTierModel ? inferred.tier : canonicalCurrentTier;
  }
  const baseThinking = meta.currentThinking ?? null;
  const nextThinking = snapThinking ?? baseThinking;

  if (
    nextCurrentTier !== meta.currentTier ||
    canonicalInitialTier !== meta.initialTier ||
    canonicalLastBilledTier !== meta.lastBilledTier ||
    nextThinking !== baseThinking
  ) {
    return {
      meta: {
        ...meta,
        initialTier: canonicalInitialTier,
        currentTier: nextCurrentTier,
        currentThinking: nextThinking,
        lastBilledTier: canonicalLastBilledTier,
      },
      changed: true,
    };
  }

  return { meta, changed: false };
}
