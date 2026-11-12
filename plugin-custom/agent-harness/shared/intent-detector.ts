import type {
  DomainRole,
  DomainRoleDecision,
  MatrixTier,
  ProviderModelMapping,
  RouterDecision,
} from "./types.js";

// Antigravity is isolated as an offline safety-net fallback and excluded from orchestration routing
export const SAFETY_NET_PROVIDER = "antigravity";

export function normalizeProvider(provider?: string | null): string {
  return provider?.trim().toLowerCase() ?? "";
}

const IDENTITY_MAPPING: ProviderModelMapping = {
  plan: "plan",
  review: "review",
  flash: "flash",
};

export const DEFAULT_PROVIDER_MAPPINGS: Record<string, ProviderModelMapping> = {
  opencode: {
    plan: "custom/plan",
    review: "custom/review",
    flash: "custom/flash",
  },
  codex: IDENTITY_MAPPING,
  claude: IDENTITY_MAPPING,
  pi: {
    plan: "headroom/plan",
    review: "headroom/review",
    flash: "headroom/flash",
  },
};

// High-confidence patterns for Architectural Design, Strategy, Analysis & Deep Planning
const PLAN_PATTERNS: RegExp[] = [
  /方案|设计|架构|规划|规整|路线图|选型|探讨|重构|策略|演进|评估|调研|对比/i,
  /\b(?:plan|design|architecture|proposal|rfc|spec|strategy|roadmap|brainstorm|evaluate|benchmark)\b/i,
  /分析|根本原因|为什么.*(?:bug|故障|少|没有|异常|慢|卡)|排查根因/i,
  /\bcto\b/i,
  /你(?:看|评估|分析|思考)一下.*(?:问题|建议|改进|优化|看法|思路)/i,
  /(?:改进点|优化点|建议点|薄弱点|风险点|关键点)/i,
  /列出.*(?:top|问题|建议|方案)/i,
  /^\s*\/(?:opsx-propose|opsx-explore|brainstorming|grilling|make-plan|design-is)\b/i,
  // Greenfield / fullstack / multi-module application construction from scratch
  /(?:从[零0]开始|全新|从头)?(?:开发|构建|搭建|实现|写一个)(?:全栈|完整|一套|一个)?(?:系统|应用|平台|游戏|项目|服务)/i,
  /全栈|端到端|前后端|排行榜|排名/i,
];

// High-confidence patterns for Code Review & Gate Audits
const REVIEW_PATTERNS: RegExp[] = [
  /^\s*(?:(?:review|cr|audit)\b(?!-)|(?:代码审查|门禁审查|审查|审阅))/i,
  /(?:代码审查|全量审查|质量门禁|合流审查|安全审计|pr\s*review|code\s*review)/i,
  /^\s*\/(?:ocr|review|code-review)\b/i,
  /验收检查|核验变更|audit\s*check/i,
];

// Anchored Conventional Commit or explicit execution slash command prefixes
export const CONVENTIONAL_EXEC_PREFIX: RegExp =
  /^\s*(?:(?:fix|feat|chore|refactor|test|docs|style|build|ci|perf)\s*[:：]|\/(?:gitea\s+(?:dev|ship|release)|install-local)\b)/i;

// Unanchored general execution action phrases
const EXEC_ACTION_PATTERNS: RegExp[] = [
  /修复|落地|编写代码|直接修改|添加测试|打包|发布|同步到|在[^，。！？\n]{1,30}?(?:中|里)实现|给[^，。！？\n]{1,30}?(?:增加|加上)|替换|微调/i,
];

// Domain role heuristic patterns
const DOMAIN_ROLE_PATTERNS: ReadonlyArray<{ role: DomainRole; pattern: RegExp }> = [
  {
    role: "pm",
    pattern:
      /\b(?:pm-prd|pm-user-stories|pm-edge-cases|pm-problem|prd|user\s*stories|jtbd)\b|痛点|用户故事|产品需求|验收条件/i,
  },
  {
    role: "ui",
    pattern:
      /\b(?:ui|ux|ui-ux-pro-max|unslop|visual-verdict|unistyles|popover|sheet|pill|hover|tailwind|expo|react\s*native|playwright|css)\b|前端|界面|样式|弹窗|组件|面板|视觉|移动端|手机端|响应式|布局|图标|配色|交互体验/i,
  },
  {
    role: "qa",
    pattern: /\b(?:test-gardener|vitest|e2e|maestro|qa)\b|测试健康度|回归测试|边缘用例/i,
  },
  {
    role: "review",
    pattern: /\b(?:ocr|code-review|security-review)\b|代码审查|安全审计|双轴审查|质量门禁/i,
  },
  {
    role: "backend",
    pattern:
      /\b(?:daemon|websocket|rpc|sqlite|dbx|terminal-worker|worktree|protocol|zod-aot|relay|noise\s*nk|quota|proxy|gateway|scheduler|provider)\b|后端|协议兼容|数据库|进程通信|服务端|配额|网关|代理服务|限流|中间件/i,
  },
  {
    role: "scout",
    pattern:
      /\b(?:scout|spike|prototype|scaffold-exercises|throwaway)\b|敏捷探针|脚手架|快速原型|单点验证/i,
  },
  {
    role: "architect",
    pattern:
      /\b(?:codebase-design|domain-modeling|deep\s*modules?|adr|glossary)\b|深模块|领域建模|系统架构|整体架构|架构设计|架构评估|模块划分|架构是否合理/i,
  },
];

const ROLE_ALIAS_MAP: Readonly<Record<string, DomainRole>> = {
  orchestrator: "orchestrator",
  lead: "orchestrator",
  dispatcher: "orchestrator",
  ui: "ui",
  "ui-specialist": "ui",
  frontend: "ui",
  backend: "backend",
  "backend-specialist": "backend",
  server: "backend",
  pm: "pm",
  product: "pm",
  "product-specialist": "pm",
  architect: "architect",
  qa: "qa",
  "qa-gatekeeper": "qa",
  review: "review",
  "security-review": "review",
  reviewer: "review",
  scout: "scout",
  "scout-specialist": "scout",
  spike: "scout",
  general: "general",
};

const ROLE_PROFILE_FILENAME: Record<DomainRole, string> = {
  orchestrator: "orchestrator.json",
  ui: "ui-specialist.json",
  backend: "backend-specialist.json",
  pm: "product-specialist.json",
  architect: "architect.json",
  qa: "qa-gatekeeper.json",
  review: "security-review.json",
  scout: "scout-specialist.json",
  general: "architect.json",
};

const ROLE_LAZY_TOOL_SLICE: Record<DomainRole, string> = {
  orchestrator: "pm.yaml",
  ui: "ui.yaml",
  backend: "backend.yaml",
  pm: "pm.yaml",
  architect: "backend.yaml",
  qa: "ui.yaml",
  review: "review.yaml",
  scout: "pm.yaml",
  general: "codex.yaml",
};

function joinPosix(base: string, ...segments: string[]): string {
  let result = base ? base.replace(/\/+$/, "") : "";
  for (const segment of segments) {
    const clean = segment.replace(/^\/+|\/+$/g, "");
    if (clean) {
      result = result ? `${result}/${clean}` : clean;
    }
  }
  return result;
}

function resolveHomeDir(homeDir?: string): string {
  if (homeDir?.trim()) return homeDir.trim();
  if (typeof process !== "undefined" && process?.env) {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    if (envHome?.trim()) return envHome.trim();
  }
  return "";
}

function buildRoleDecision(
  role: DomainRole,
  matchedRule: string,
  homeDir?: string,
): DomainRoleDecision {
  const resolvedHome = resolveHomeDir(homeDir);
  return {
    role,
    matchedRule,
    profilePath: resolvedHome
      ? joinPosix(resolvedHome, ".agents", "profiles", ROLE_PROFILE_FILENAME[role])
      : "",
    lazyToolConfigPath: resolvedHome
      ? joinPosix(resolvedHome, ".config", "lazy-tool", "profiles", ROLE_LAZY_TOOL_SLICE[role])
      : "",
  };
}

export function detectMatrixTier(text: string | null | undefined): {
  tier: MatrixTier;
  matchedRule: string;
} {
  if (!text || !text.trim()) {
    return { tier: "flash", matchedRule: "default_empty" };
  }

  const trimmed = text.trim();

  // 1. Anchored conventional commit or execution command prefix always stays on flash execution track
  if (CONVENTIONAL_EXEC_PREFIX.test(trimmed)) {
    return { tier: "flash", matchedRule: `exec_override:${CONVENTIONAL_EXEC_PREFIX}` };
  }

  // 2. Explicit Code Review & Quality Gate Check
  for (const pattern of REVIEW_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "review", matchedRule: `review:${pattern}` };
    }
  }

  // 3. Concrete execution actions take precedence over broad plan keywords (e.g. "修复登录页设计稿的样式", "添加测试对比两种输出")
  for (const pattern of EXEC_ACTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "flash", matchedRule: `exec_action:${pattern}` };
    }
  }

  // 4. Plan & Architecture Exploration when strategic keywords are present
  for (const pattern of PLAN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { tier: "plan", matchedRule: `plan:${pattern}` };
    }
  }

  return { tier: "flash", matchedRule: "default_fallback" };
}

export function resolveMatrixModel(options: {
  provider: string;
  currentModel?: string | null;
  text?: string | null;
  customMappings?: Record<string, Partial<ProviderModelMapping>>;
  overrideIfDefaultOnly?: boolean;
}): RouterDecision {
  const { provider, currentModel, text, customMappings, overrideIfDefaultOnly = true } = options;
  const normalizedProvider = provider.trim().toLowerCase();

  // Treat empty string targetModel as "preserve existing model without modification"
  if (normalizedProvider === SAFETY_NET_PROVIDER) {
    return {
      tier: "flash",
      targetModel: currentModel ?? "",
      reason:
        "Antigravity is isolated as a safety-net fallback and excluded from orchestration routing",
      matchedRule: "bypass_safety_net",
      previousModel: currentModel ?? undefined,
    };
  }

  const defaultMapping = Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, normalizedProvider)
    ? DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]
    : IDENTITY_MAPPING;
  const customOverride =
    customMappings &&
    (Object.hasOwn(customMappings, normalizedProvider) || Object.hasOwn(customMappings, provider))
      ? (customMappings[normalizedProvider] ?? customMappings[provider])
      : undefined;
  const providerMapping: ProviderModelMapping = { ...defaultMapping };
  if (customOverride) {
    for (const key of ["plan", "review", "flash"] as const) {
      const val = customOverride[key]?.trim();
      if (val) {
        providerMapping[key] = val;
      }
    }
  }

  const { tier, matchedRule } = detectMatrixTier(text);
  const targetModel = providerMapping[tier] || defaultMapping[tier] || currentModel || "";

  // Treat unset or router-managed tier models as routable defaults; preserve custom user models (e.g. custom/pro)
  const routerManagedModels = new Set<string>(
    [
      providerMapping.plan,
      providerMapping.review,
      providerMapping.flash,
      defaultMapping.plan,
      defaultMapping.review,
      defaultMapping.flash,
      "plan",
      "review",
      "flash",
    ].filter((m): m is string => Boolean(m?.trim())),
  );
  const isDefaultModel = !currentModel || routerManagedModels.has(currentModel);

  if (overrideIfDefaultOnly && !isDefaultModel) {
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

export function detectDomainRole(options: {
  text?: string | null;
  labels?: Readonly<Record<string, string>> | null;
  homeDir?: string;
}): DomainRoleDecision {
  for (const labelKey of ["role", "profile"] as const) {
    const rawLabel = options.labels?.[labelKey];
    const normalized = rawLabel?.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    const mappedRole = Object.hasOwn(ROLE_ALIAS_MAP, normalized)
      ? ROLE_ALIAS_MAP[normalized]
      : undefined;
    if (mappedRole) {
      return buildRoleDecision(mappedRole, `label:${labelKey}`, options.homeDir);
    }
  }

  const trimmed = options.text?.trim() ?? "";
  if (trimmed) {
    // 1. Composite Full-Stack / Multi-Domain Collision Check:
    // If text touches UI/Frontend AND Backend/Persistence/Database, promote to Thin Dispatcher (orchestrator -> flash)
    const hasUi = /(?:\b(?:ui|ux)\b|前端|界面|样式|组件|移动端|手机端|页面)/i.test(trimmed);
    const hasBackend =
      /(?:\b(?:db|sqlite)\b|后台|后端|服务|接口|数据|保存|存储|数据库|持久化|排名)/i.test(trimmed);
    if (hasUi && hasBackend) {
      return buildRoleDecision("orchestrator", "heuristic:fullstack_orchestrator", options.homeDir);
    }

    for (const entry of DOMAIN_ROLE_PATTERNS) {
      if (entry.pattern.test(trimmed)) {
        return buildRoleDecision(entry.role, `heuristic:${entry.role}`, options.homeDir);
      }
    }
  }

  return buildRoleDecision("general", "default_general", options.homeDir);
}

export function resolveHarnessEnv(options: {
  role: DomainRole;
  existingEnv?: Readonly<Record<string, string>>;
  homeDir?: string;
}): Record<string, string> {
  const decision = buildRoleDecision(options.role, "env_resolve", options.homeDir);
  const baseEnv: Record<string, string> = { ...options.existingEnv };

  const isRoleSwitch = Boolean(
    baseEnv.PASEO_HARNESS_ROLE && baseEnv.PASEO_HARNESS_ROLE !== options.role,
  );
  baseEnv.PASEO_HARNESS_ROLE = options.role;
  if (decision.profilePath) {
    baseEnv.PASEO_HARNESS_PROFILE = decision.profilePath;
  } else if (isRoleSwitch) {
    delete baseEnv.PASEO_HARNESS_PROFILE;
  }

  // Preserve explicit user override if present; if switching roles from parent, refresh to target role slice
  if (!baseEnv.LAZY_TOOL_CONFIG || isRoleSwitch) {
    if (decision.lazyToolConfigPath) {
      baseEnv.LAZY_TOOL_CONFIG = decision.lazyToolConfigPath;
    } else if (isRoleSwitch) {
      delete baseEnv.LAZY_TOOL_CONFIG;
    }
  }

  return baseEnv;
}

const VALID_ROLES = new Set<DomainRole>([
  "orchestrator",
  "ui",
  "backend",
  "pm",
  "architect",
  "qa",
  "review",
  "scout",
  "general",
]);

const VALID_TIERS = new Set<MatrixTier>(["plan", "review", "flash"]);

export interface LlmIntentClassifierOptions {
  text: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function classifyIntentWithLlm(
  options: LlmIntentClassifierOptions,
): Promise<{ role: DomainRole; tier: MatrixTier } | null> {
  const trimmed = options.text?.trim();
  if (!trimmed) {
    return null;
  }

  const fetchFn = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchFn) {
    return null;
  }

  let endpoint =
    options.endpoint?.trim() ||
    (typeof process !== "undefined" ? process.env?.HARNESS_LLM_ENDPOINT?.trim() : "");
  let apiKey =
    options.apiKey?.trim() ||
    (typeof process !== "undefined" ? process.env?.HARNESS_LLM_API_KEY?.trim() : "") ||
    "";

  if (!endpoint && options.fetchImpl) {
    endpoint = "https://llm.invalid/v1/chat/completions";
    apiKey = apiKey || "test-placeholder-key";
  }

  if (!endpoint) {
    return null;
  }

  const model = options.model || "lite";
  const timeoutMs = options.timeoutMs ?? 450;

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 45,
        messages: [
          {
            role: "system",
            content:
              'Classify coding task into JSON {"role":"ui"|"backend"|"pm"|"architect"|"qa"|"review"|"scout"|"general","tier":"flash"|"plan"|"review"}. Output raw JSON only.',
          },
          {
            role: "user",
            content: trimmed.slice(0, 500),
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      return null;
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as { role?: unknown; tier?: unknown };
    const role =
      typeof parsed.role === "string" && VALID_ROLES.has(parsed.role as DomainRole)
        ? (parsed.role as DomainRole)
        : "general";
    const tier =
      typeof parsed.tier === "string" && VALID_TIERS.has(parsed.tier as MatrixTier)
        ? (parsed.tier as MatrixTier)
        : "flash";

    return { role, tier };
  } catch {
    return null;
  }
}

export async function detectDomainRoleHybrid(options: {
  text?: string | null;
  labels?: Readonly<Record<string, string>> | null;
  homeDir?: string;
  llmFallback?: Omit<LlmIntentClassifierOptions, "text"> & { enabled?: boolean };
}): Promise<DomainRoleDecision> {
  const fastDecision = detectDomainRole(options);
  if (fastDecision.matchedRule !== "default_general") {
    return fastDecision;
  }

  const trimmed = options.text?.trim() ?? "";
  if (!trimmed || options.llmFallback?.enabled === false) {
    return fastDecision;
  }

  const llmResult = await classifyIntentWithLlm({
    ...options.llmFallback,
    text: trimmed,
  });

  if (llmResult && llmResult.role !== "general") {
    return buildRoleDecision(llmResult.role, `llm_fallback:${llmResult.role}`, options.homeDir);
  }

  return fastDecision;
}
