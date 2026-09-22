import { extractEphemeralOptions } from "./ephemeral-option-extractor";
import type {
  QuickPromptAgentStatus,
  QuickPromptItem,
  QuickPromptRuleCondition,
} from "@/stores/quick-prompts-store";

export interface EvaluateQuickPromptsInput {
  items: readonly QuickPromptItem[];
  lastAssistantText?: string | null;
  agentStatus?: QuickPromptAgentStatus | null;
  agentProfileId?: string | readonly string[] | null;
  locale?: string;
  disableEphemeral?: boolean;
}

function matchesStatusCondition(
  condition: QuickPromptRuleCondition,
  agentStatus?: QuickPromptAgentStatus | null,
): boolean {
  if (!condition.agentStatuses || condition.agentStatuses.length === 0) {
    return true;
  }
  return Boolean(agentStatus && condition.agentStatuses.includes(agentStatus));
}

function matchesProfileCondition(
  condition: QuickPromptRuleCondition,
  agentProfileId?: string | readonly string[] | null,
): boolean {
  if (!condition.agentProfiles || condition.agentProfiles.length === 0) {
    return true;
  }
  if (!agentProfileId) {
    return false;
  }
  const candidateIds = (Array.isArray(agentProfileId) ? agentProfileId : [agentProfileId])
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  if (candidateIds.length === 0) {
    return false;
  }

  return condition.agentProfiles.some((target) => {
    const trimmedTarget = target.trim().toLowerCase();
    return trimmedTarget.length > 0 && candidateIds.includes(trimmedTarget);
  });
}

function matchesKeywordsCondition(
  condition: QuickPromptRuleCondition,
  normalizedText: string,
): boolean {
  if (!condition.keywords || condition.keywords.length === 0) {
    return false;
  }
  return condition.keywords.some((keyword) => {
    const trimmed = keyword.trim().toLowerCase();
    return trimmed.length > 0 && normalizedText.includes(trimmed);
  });
}

function matchesRegexCondition(condition: QuickPromptRuleCondition, rawText: string): boolean {
  if (!condition.regex || condition.regex.trim().length === 0) {
    return false;
  }
  try {
    const re = new RegExp(condition.regex, "i");
    return re.test(rawText);
  } catch {
    return false;
  }
}

function hasAnyRuleCondition(condition: QuickPromptRuleCondition): boolean {
  if (Array.isArray(condition.agentProfiles) && condition.agentProfiles.length > 0) return true;
  if (Array.isArray(condition.agentStatuses) && condition.agentStatuses.length > 0) return true;
  if (Array.isArray(condition.keywords) && condition.keywords.some((k) => k.trim().length > 0))
    return true;
  if (typeof condition.regex === "string" && condition.regex.trim().length > 0) return true;
  return false;
}

function matchesTextCondition(condition: QuickPromptRuleCondition, rawText: string): boolean {
  const hasKeywords =
    Array.isArray(condition.keywords) && condition.keywords.some((k) => k.trim().length > 0);
  const hasRegex = typeof condition.regex === "string" && condition.regex.trim().length > 0;
  if (!hasKeywords && !hasRegex) {
    return true;
  }
  const keywordMatched = hasKeywords && matchesKeywordsCondition(condition, rawText.toLowerCase());
  const regexMatched = hasRegex && matchesRegexCondition(condition, rawText);
  return keywordMatched || regexMatched;
}

export function matchesQuickPromptRule(
  item: QuickPromptItem,
  context: {
    lastAssistantText?: string | null;
    agentStatus?: QuickPromptAgentStatus | null;
    agentProfileId?: string | readonly string[] | null;
  },
): boolean {
  if (!item.enabled) {
    return false;
  }

  if (item.triggerType === "fixed" || item.triggerType === "ephemeral") {
    return true;
  }

  const condition = item.ruleCondition;
  if (!condition || !hasAnyRuleCondition(condition)) {
    return false;
  }

  if (!matchesProfileCondition(condition, context.agentProfileId)) {
    return false;
  }

  if (!matchesStatusCondition(condition, context.agentStatus)) {
    return false;
  }

  return matchesTextCondition(condition, context.lastAssistantText ?? "");
}

export function evaluateQuickPrompts(input: EvaluateQuickPromptsInput): QuickPromptItem[] {
  const { items, lastAssistantText, agentStatus, agentProfileId, locale, disableEphemeral } = input;
  const context = { lastAssistantText, agentStatus, agentProfileId };

  const matchedItems = items.filter((item) => matchesQuickPromptRule(item, context));

  const ephemeralItems =
    !disableEphemeral && agentStatus === "idle" && lastAssistantText
      ? extractEphemeralOptions(lastAssistantText, locale)
      : [];

  return [...ephemeralItems, ...matchedItems].sort((a, b) => a.order - b.order);
}
