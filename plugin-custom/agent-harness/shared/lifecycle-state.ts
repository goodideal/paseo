import { supportsNativePlanMode } from "./contracts.js";
import { CONVENTIONAL_EXEC_PREFIX } from "./intent-detector.js";
import {
  HARNESS_METADATA_KEY,
  HARNESS_METADATA_VERSION,
  type DomainRole,
  type HarnessAgentMetadata,
  type HarnessDowngradeReason,
  type HarnessPhase,
  type MatrixTier,
} from "./types.js";

const WRITE_TOOL_NAME_PATTERN =
  /^(?:edit|multiedit|write|notebookedit|apply_patch|write_file|edit_file|replace_in_files|replace_symbol_body|replace_content|patch)$/i;

const DOC_WHITELIST_PATTERN = /\.(?:md|mdx|txt)$/i;
const OPENSPEC_WHITELIST_PATTERN = /(?:^|[\\/])openspec[\\/]/i;

const NEGATIVE_DISCUSSION_PATTERNS: RegExp[] = [
  /不要改|先别写|别改代码|别改|先不要|再想想|再对比|再讨论|还有其他方案|还有别的方法|不急着改|暂不修改/i,
];

const EXPLICIT_EXEC_PATTERNS: RegExp[] = [
  // Chinese affirmative execution / implementation phrases
  /(?:好的[，, ]*)?就?按(?:这个|这套|上述|方案[a-zA-Z0-9_-]*|计划).*(?:改代码|修改|实现|落地|做|写)/i,
  /(?:直接|开始|立即|赶紧)(?:改|写|落地|实现|编写)(?:代码|吧)?/i,
  /(?:开始写代码|改代码吧|写代码吧|实施方案|开始实施|开始实现)/i,
  // English affirmative execution / implementation phrases
  /\b(?:implement(?:\s+it|\s+this(?:\s+plan)?|\s+now)?|go\s+ahead\s+and\s+implement|start\s+implementing|proceed\s+with\s+implementation|let\'s\s+implement|please\s+implement)\b/i,
];

const SHORT_AFFIRMATIVE_EXEC_WORDS = new Set([
  "yes",
  "yes, continue",
  "yes continue",
  "continue",
  "ok",
  "okay",
  "go ahead",
  "proceed",
  "do it",
  "ship it",
  "sounds good",
  "lgtm",
  "好",
  "好的",
  "好，继续",
  "好的，继续",
  "继续",
  "继续吧",
  "改吧",
  "写吧",
  "开始",
  "开始吧",
  "可以",
  "可以，开始吧",
  "好的继续",
  "好继续",
  "行",
  "行，改吧",
  "行改吧",
  "可以开始吧",
  "好改吧",
  "好的改吧",
  "按这个来",
]);

const NORMALIZED_SHORT_AFFIRMATIVE_EXEC_WORDS = new Set<string>();
for (const word of SHORT_AFFIRMATIVE_EXEC_WORDS) {
  NORMALIZED_SHORT_AFFIRMATIVE_EXEC_WORDS.add(
    word
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, " ")
      .trim(),
  );
}

export function hasShortAffirmativeExecConfirmation(
  userText: string,
  planTurnCount: number,
): boolean {
  if (planTurnCount < 1 || !userText || !userText.trim()) {
    return false;
  }
  const trimmed = userText.trim();
  if (trimmed.length > 32) {
    return false;
  }
  for (const pattern of NEGATIVE_DISCUSSION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  const lower = trimmed.toLowerCase();
  if (SHORT_AFFIRMATIVE_EXEC_WORDS.has(lower)) {
    return true;
  }
  const normalized = lower.replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
  return (
    SHORT_AFFIRMATIVE_EXEC_WORDS.has(normalized) ||
    NORMALIZED_SHORT_AFFIRMATIVE_EXEC_WORDS.has(normalized)
  );
}

export function shouldEnforceNativePlanMode(params: {
  phaseLifecycleEnabled: boolean;
  enforceNativePlanMode: boolean;
  tier: MatrixTier;
  role: DomainRole;
  userModelLocked: boolean;
  roleLockedByLabel: boolean;
  hasParentAgent: boolean;
  provider: string;
}): boolean {
  return (
    params.phaseLifecycleEnabled &&
    params.enforceNativePlanMode &&
    params.tier === "plan" &&
    params.role !== "orchestrator" &&
    !params.userModelLocked &&
    !params.roleLockedByLabel &&
    !params.hasParentAgent &&
    supportsNativePlanMode(params.provider)
  );
}

export function tierToPhase(tier: MatrixTier, role?: DomainRole): HarnessPhase {
  if (tier === "review" || role === "review") {
    return "review";
  }
  if (tier === "plan") {
    return "design";
  }
  return "exec";
}

export function createInitialHarnessMetadata(params: {
  role: DomainRole;
  tier: MatrixTier;
  model?: string | null;
  roleMatchedRule: string;
  tierMatchedRule: string;
  userModelLocked?: boolean;
  roleLockedByLabel?: boolean;
  resumeModeId?: string | null;
  lastBilledTier?: MatrixTier | null;
  lastBilledModel?: string | null;
}): HarnessAgentMetadata {
  return {
    version: HARNESS_METADATA_VERSION,
    role: params.role,
    initialTier: params.tier,
    currentTier: params.tier,
    currentModel: params.model ?? null,
    phase: tierToPhase(params.tier, params.role),
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

function isExemptDocPath(p: string): boolean {
  const trimmed = p.trim();
  if (!trimmed) {
    return false;
  }
  return DOC_WHITELIST_PATTERN.test(trimmed) || OPENSPEC_WHITELIST_PATTERN.test(trimmed);
}

function extractPathsFromTool(item: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const detail =
    typeof item.detail === "object" && item.detail !== null
      ? (item.detail as Record<string, unknown>)
      : null;
  if (detail) {
    if (typeof detail.filePath === "string") {
      paths.push(detail.filePath);
    }
    if (typeof detail.path === "string") {
      paths.push(detail.path);
    }
  }

  let input =
    typeof item.input === "object" && item.input !== null
      ? (item.input as Record<string, unknown>)
      : null;
  if (!input && typeof item.input === "string") {
    try {
      const parsed = JSON.parse(item.input) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore unparseable JSON string input
    }
  }

  let args =
    typeof item.args === "object" && item.args !== null
      ? (item.args as Record<string, unknown>)
      : null;
  if (!args && typeof item.args === "string") {
    try {
      const parsed = JSON.parse(item.args) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore unparseable JSON string args
    }
  }
  if (!args && typeof item.arguments === "object" && item.arguments !== null) {
    args = item.arguments as Record<string, unknown>;
  }
  if (!args && typeof item.arguments === "string") {
    try {
      const parsed = JSON.parse(item.arguments) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore unparseable JSON string arguments
    }
  }

  for (const src of [input, args]) {
    if (!src) {
      continue;
    }
    for (const key of ["file_path", "path", "filePath", "relative_path", "target_file"]) {
      if (typeof src[key] === "string") {
        paths.push(src[key] as string);
      }
    }
    if (Array.isArray(src.paths)) {
      for (const p of src.paths) {
        if (typeof p === "string") {
          paths.push(p);
        }
      }
    }
  }

  return paths;
}

export function inspectTurnTimeline(items: readonly unknown[]): {
  latestUserText: string;
  detectedCodeWrite: boolean;
  handoffInvoked: boolean;
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

  for (const rawItem of currentTurnItems) {
    if (typeof rawItem !== "object" || rawItem === null) {
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    const detail =
      typeof item.detail === "object" && item.detail !== null
        ? (item.detail as Record<string, unknown>)
        : null;

    const toolName =
      typeof item.name === "string"
        ? item.name
        : typeof item.toolName === "string"
          ? item.toolName
          : "";
    const detailType = detail && typeof detail.type === "string" ? detail.type : "";

    // 1. Check handoff invocation (harness_handoff host tool, Skill paseo-handoff, or shell paseo run / paseo-handoff)
    const parseRecord = (val: unknown): Record<string, unknown> | null => {
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
    };

    const isSkillCall = /^(?:skill)$/i.test(toolName);
    const inputObj = parseRecord(item.input);
    const argsObj = parseRecord(item.args) ?? parseRecord(item.arguments);
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
        // Write tool invoked without detectable path: non-whitelisted mutation
        detectedCodeWrite = true;
      } else {
        const allExempt = paths.every(isExemptDocPath);
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
  };
  providerFlashModel?: string;
}

export interface EvaluateTurnAfterTransitionResult {
  nextMeta: HarnessAgentMetadata;
  shouldDowngrade: boolean;
  flashModel: string;
  downgradeReason: HarnessDowngradeReason | null;
  canAutoDowngrade: boolean;
}

export function evaluateTurnAfterTransition(
  params: EvaluateTurnAfterTransitionParams,
): EvaluateTurnAfterTransitionResult {
  const { meta, turnId, settings, timelineInspection, providerFlashModel } = params;
  const nextTurnCount = meta.turnCount + 1;
  const isPlanDesign = meta.currentTier === "plan" && meta.phase === "design";
  const nextPlanTurnCount = isPlanDesign ? meta.planTurnCount + 1 : meta.planTurnCount;

  // Snapshot the billed configuration for the turn that just ran
  const billedTier = meta.currentTier;
  const billedModel = meta.currentModel;

  let handoffSuggestedAtTurn = meta.handoffSuggestedAtTurn;
  if (
    isPlanDesign &&
    nextPlanTurnCount >= settings.planTurnSoftLimit &&
    handoffSuggestedAtTurn === null
  ) {
    handoffSuggestedAtTurn = nextTurnCount;
  }

  const canAutoDowngrade =
    settings.autoDowngradePlanOnExec &&
    meta.autoDowngradedAtTurn === null &&
    !meta.userModelLocked &&
    !(meta.roleLockedByLabel && (meta.role === "pm" || meta.role === "architect"));

  const hasExecIntent =
    nextTurnCount >= 2 &&
    !timelineInspection.handoffInvoked &&
    (hasExplicitExecTransitionIntent(timelineInspection.latestUserText) ||
      hasShortAffirmativeExecConfirmation(timelineInspection.latestUserText, meta.planTurnCount));

  const shouldDowngrade =
    isPlanDesign && canAutoDowngrade && (timelineInspection.detectedCodeWrite || hasExecIntent);

  const downgradeReason: HarnessDowngradeReason | null = shouldDowngrade
    ? timelineInspection.detectedCodeWrite
      ? "write_tool_in_plan"
      : "explicit_exec_intent"
    : null;

  const flashModel = providerFlashModel ?? "flash";

  const nextMeta: HarnessAgentMetadata = {
    ...meta,
    turnCount: nextTurnCount,
    planTurnCount: nextPlanTurnCount,
    writeToolDetectedInPlan:
      meta.writeToolDetectedInPlan || (isPlanDesign && timelineInspection.detectedCodeWrite),
    handoffSuggestedAtTurn,
    currentTier: shouldDowngrade ? "flash" : meta.currentTier,
    currentModel: shouldDowngrade ? flashModel : meta.currentModel,
    phase: shouldDowngrade ? "exec" : meta.phase,
    autoDowngradedAtTurn: shouldDowngrade ? nextTurnCount : meta.autoDowngradedAtTurn,
    downgradeReason: shouldDowngrade ? downgradeReason : meta.downgradeReason,
    lastProcessedTurnId: turnId,
    lastBilledTier: billedTier,
    lastBilledModel: billedModel,
  };

  return {
    nextMeta,
    shouldDowngrade,
    flashModel,
    downgradeReason,
    canAutoDowngrade,
  };
}
