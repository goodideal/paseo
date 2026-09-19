import type {
  QuickPromptAgentStatus,
  QuickPromptItem,
  QuickPromptRuleCondition,
} from "@/stores/quick-prompts-store";

export interface EvaluateQuickPromptsInput {
  items: readonly QuickPromptItem[];
  lastAssistantText?: string | null;
  agentStatus?: QuickPromptAgentStatus | null;
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

export function matchesQuickPromptRule(
  item: QuickPromptItem,
  context: { lastAssistantText?: string | null; agentStatus?: QuickPromptAgentStatus | null },
): boolean {
  if (!item.enabled) {
    return false;
  }

  if (item.triggerType === "fixed") {
    return true;
  }

  const condition = item.ruleCondition;
  if (!condition) {
    return false;
  }

  const hasStatus = Array.isArray(condition.agentStatuses) && condition.agentStatuses.length > 0;
  const hasKeywords =
    Array.isArray(condition.keywords) && condition.keywords.some((k) => k.trim().length > 0);
  const hasRegex = typeof condition.regex === "string" && condition.regex.trim().length > 0;

  if (!hasStatus && !hasKeywords && !hasRegex) {
    return false;
  }

  if (hasStatus && !matchesStatusCondition(condition, context.agentStatus)) {
    return false;
  }

  if (!hasKeywords && !hasRegex) {
    return hasStatus;
  }

  const rawText = context.lastAssistantText ?? "";
  const normalizedText = rawText.toLowerCase();

  const keywordMatched = hasKeywords && matchesKeywordsCondition(condition, normalizedText);
  const regexMatched = hasRegex && matchesRegexCondition(condition, rawText);

  return keywordMatched || regexMatched;
}

export function evaluateQuickPrompts(input: EvaluateQuickPromptsInput): QuickPromptItem[] {
  const { items, lastAssistantText, agentStatus } = input;
  const context = { lastAssistantText, agentStatus };

  return items
    .filter((item) => matchesQuickPromptRule(item, context))
    .sort((a, b) => a.order - b.order);
}
