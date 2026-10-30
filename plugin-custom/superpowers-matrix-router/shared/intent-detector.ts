import type { MatrixTier, ProviderModelMapping, RouterDecision } from "./types.js";

export const DEFAULT_PROVIDER_MAPPINGS: Record<string, ProviderModelMapping> = {
  opencode: {
    plan: "custom/plan",
    review: "custom/review",
    flash: "custom/flash",
  },
  codex: {
    plan: "plan",
    review: "review",
    flash: "flash",
  },
  claude: {
    plan: "plan",
    review: "review",
    flash: "flash",
  },
  antigravity: {
    plan: "gemini-pro",
    review: "gemini-pro",
    flash: "gemini-3.8-flash-high",
  },
};

// High-confidence patterns for Architectural Design, Strategy, Analysis & Deep Planning
const PLAN_PATTERNS: RegExp[] = [
  /方案|设计|架构|规划|规整|路线图|选型|探讨|重构|策略|演进|评估|调研|对比/i,
  /\b(?:plan|design|architecture|proposal|rfc|spec|strategy|roadmap|brainstorm|evaluate|benchmark)\b/i,
  /分析(?:根因|原因|报告)?|根本原因|根因分析|为什么.*(?:bug|故障|少|没有|异常|慢|卡)|排查根因/i,
  /\bcto\b/i,
  /你(?:看|评估|分析|思考)一下.*(?:问题|建议|改进|优化|看法|思路)/i,
  /(?:改进点|优化点|建议点|薄弱点|风险点|关键点)/i,
  /列出.*(?:top|问题|建议|方案)/i,
  /^\s*\/(?:opsx-propose|opsx-explore|brainstorming|grilling|make-plan|design-is)\b/i,
];

// High-confidence patterns for Code Review & Gate Audits
const REVIEW_PATTERNS: RegExp[] = [
  /^\s*(?:review|cr|audit|审查|审阅|代码审查|门禁审查)\b/i,
  /(?:代码审查|全量审查|质量门禁|合流审查|安全审计|pr\s*review|code\s*review)/i,
  /^\s*\/(?:ocr|review|code-review)\b/i,
  /验收检查|核验变更|audit\s*check/i,
];

// Patterns that indicate direct code implementation / execution (default to flash)
const EXEC_OVERRIDES: RegExp[] = [
  /^\s*(?:fix|feat|chore|refactor|test|docs|style|build|ci|perf)\s*[:：]/i,
  /^\s*\/(?:gitea\s+(?:dev|ship|release)|install-local)\b/i,
  /修复|落地|编写代码|直接修改|添加测试|打包|发布|同步到/i,
];

export function detectMatrixTier(text: string | null | undefined): {
  tier: MatrixTier;
  matchedRule: string;
} {
  if (!text || !text.trim()) {
    return { tier: "flash", matchedRule: "default_empty" };
  }

  const trimmed = text.trim();

  // 1. Explicit execution override (e.g. fix: ..., /gitea ship, etc.)
  for (const pattern of EXEC_OVERRIDES) {
    if (pattern.test(trimmed)) {
      if (REVIEW_PATTERNS.some((rp) => rp.test(trimmed))) {
        return { tier: "review", matchedRule: "review_priority" };
      }
      if (PLAN_PATTERNS.some((pp) => pp.test(trimmed)) && !trimmed.startsWith("fix")) {
        return { tier: "plan", matchedRule: "plan_priority" };
      }
      return { tier: "flash", matchedRule: `exec_override:${pattern}` };
    }
  }

  // 2. Plan & Architecture Exploration has high precedence when strategic keywords are present
  for (const pattern of PLAN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "plan", matchedRule: `plan:${pattern}` };
    }
  }

  // 3. Code Review & Quality Gate Check
  for (const pattern of REVIEW_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "review", matchedRule: `review:${pattern}` };
    }
  }

  return { tier: "flash", matchedRule: "default_fallback" };
}

export function resolveMatrixModel(options: {
  provider: string;
  currentModel?: string | null;
  text?: string | null;
  customMappings?: Record<string, ProviderModelMapping>;
  overrideIfDefaultOnly?: boolean;
}): RouterDecision {
  const { provider, currentModel, text, customMappings, overrideIfDefaultOnly = true } = options;
  const mappings = { ...DEFAULT_PROVIDER_MAPPINGS, ...customMappings };
  const providerMapping = mappings[provider] ?? {
    plan: "plan",
    review: "review",
    flash: "flash",
  };

  const { tier, matchedRule } = detectMatrixTier(text);
  const targetModel = providerMapping[tier];

  // Check if currentModel was explicitly set to something custom by the user
  const isDefaultModel =
    !currentModel ||
    currentModel === "flash" ||
    currentModel === "custom/flash" ||
    currentModel === providerMapping.flash;

  if (overrideIfDefaultOnly && !isDefaultModel && currentModel !== targetModel) {
    // User explicitly chose a non-default model (e.g. gpt-6.1-sol, sonnet, etc.)
    return {
      tier,
      targetModel: currentModel,
      reason: `Preserving user-selected model '${currentModel}' (detected tier: ${tier})`,
      matchedRule: `preserve_user_choice (${matchedRule})`,
      previousModel: currentModel,
    };
  }

  return {
    tier,
    targetModel,
    reason: `Routed to ${tier} model '${targetModel}' based on intent`,
    matchedRule,
    previousModel: currentModel ?? undefined,
  };
}
