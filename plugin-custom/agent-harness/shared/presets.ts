import type { HarnessSpecialistConfig, HarnessTierConfig, ProviderModeConfig } from "./types.js";

export const BUILTIN_TIERS: HarnessTierConfig[] = [
  {
    id: "fast",
    name: "Fast",
    icon: "Zap",
    defaultPhase: "exec",
    description: "Lightweight lookup, routing, and quick edits (0.2x)",
  },
  {
    id: "standard",
    name: "Standard",
    icon: "Cpu",
    defaultPhase: "exec",
    description: "Default engineering workhorse for daily features and tests (1x)",
  },
  {
    id: "plan",
    name: "Plan",
    icon: "Compass",
    defaultPhase: "design",
    description: "Architecture design, planning, and specification (3x)",
  },
  {
    id: "review",
    name: "Review",
    icon: "ShieldCheck",
    defaultPhase: "review",
    description: "Read-only dual-axis code review and security audit (3x)",
  },
  {
    id: "max",
    name: "Max",
    icon: "Flame",
    defaultPhase: "exec",
    description: "Manual peak reasoning for intractable bugs and critical algorithms",
  },
];

export const BUILTIN_BYPASS_MODELS: string[] = ["^gemini-pro-orchestrator"];

export const LEGACY_V4_PROVIDER_MAPPINGS: Record<string, Record<string, string>> = {
  antigravity: {
    plan: "gemini-4-carbon-high",
    review: "gemini-4-argon-high",
    flash: "gemini-4-hydrogen-high",
  },
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
  pi: {
    plan: "headroom/plan",
    review: "headroom/review",
    flash: "headroom/flash",
  },
};

export const LEGACY_V8_PROVIDER_MAPPINGS: Record<string, Record<string, string>> = {
  antigravity: {
    fast: "gemini-4-hydrogen",
    standard: "gemini-4-argon",
    deep: "gemini-4-carbon",
    max: "gemini-4-neon",
  },
  opencode: {
    fast: "custom/lite",
    standard: "custom/flash",
    deep: "custom/pro",
    max: "custom/plan",
  },
  codex: {
    fast: "lite",
    standard: "flash",
    deep: "pro",
    max: "plan",
  },
  claude: {
    fast: "lite",
    standard: "flash",
    deep: "pro",
    max: "plan",
  },
  pi: {
    fast: "headroom/lite",
    standard: "headroom/flash",
    deep: "headroom/pro",
    max: "headroom/plan",
  },
};

export const LEGACY_V8_PROVIDER_THINKING_MAPPINGS: Record<string, Record<string, string>> = {
  antigravity: {
    fast: "medium",
    standard: "high",
    deep: "high",
    max: "xhigh",
  },
  opencode: {
    fast: "low",
    standard: "medium",
    deep: "high",
    max: "xhigh",
  },
  codex: {
    fast: "low",
    standard: "medium",
    deep: "high",
    max: "xhigh",
  },
  claude: {
    fast: "low",
    standard: "medium",
    deep: "high",
    max: "high",
  },
  pi: {
    fast: "low",
    standard: "medium",
    deep: "high",
    max: "xhigh",
  },
};

/**
 * Cross-plugin baseline tier->model mapping. `plugin-custom/gitea-workflow/server/harness-bridge.ts`
 * (`BUILTIN_PROVIDER_TIERS`) mirrors these provider/tier defaults as an offline fallback when
 * `agent-harness` is unreachable; verify `BUILTIN_PROVIDER_TIERS` when changing model or thinking defaults.
 */
export const BUILTIN_PROVIDER_MAPPINGS: Record<string, Record<string, string>> = {
  antigravity: {
    fast: "gemini-4-hydrogen",
    standard: "gemini-4-neon",
    plan: "gemini-4-carbon",
    review: "gemini-4-argon",
    deep: "gemini-4-carbon",
    max: "gemini-4-carbon",
  },
  claude: {
    fast: "lite",
    standard: "flash",
    plan: "pro",
    review: "pro",
    deep: "pro",
    max: "plan",
  },
  codex: {
    fast: "lite",
    standard: "flash",
    plan: "pro",
    review: "pro",
    deep: "pro",
    max: "plan",
  },
  opencode: {
    fast: "custom/lite",
    standard: "custom/flash",
    plan: "custom/pro",
    review: "custom/pro",
    deep: "custom/pro",
    max: "custom/plan",
  },
  pi: {
    fast: "headroom/lite",
    standard: "headroom/flash",
    plan: "headroom/pro",
    review: "headroom/pro",
    deep: "headroom/pro",
    max: "headroom/plan",
  },
};

export const BUILTIN_PROVIDER_THINKING_MAPPINGS: Record<string, Record<string, string>> = {
  antigravity: {
    fast: "medium",
    standard: "high",
    plan: "high",
    review: "high",
    deep: "high",
    max: "high",
  },
  claude: {
    fast: "low",
    standard: "medium",
    plan: "high",
    review: "high",
    deep: "high",
    max: "high",
  },
  codex: {
    fast: "low",
    standard: "medium",
    plan: "high",
    review: "high",
    deep: "high",
    max: "xhigh",
  },
  opencode: {
    fast: "low",
    standard: "medium",
    plan: "high",
    review: "high",
    deep: "high",
    max: "xhigh",
  },
  pi: {
    fast: "low",
    standard: "medium",
    plan: "high",
    review: "high",
    deep: "high",
    max: "xhigh",
  },
};

export const BUILTIN_PROVIDER_MODES: Record<string, ProviderModeConfig> = {
  antigravity: {
    supportsNativePlanMode: false,
    resumeExecutionModeId: "full-access",
  },
  claude: {
    supportsNativePlanMode: true,
    resumeExecutionModeId: "acceptEdits",
  },
  "claude-code": {
    supportsNativePlanMode: true,
    resumeExecutionModeId: "acceptEdits",
  },
  opencode: {
    supportsNativePlanMode: true,
    resumeExecutionModeId: "build",
  },
};

export const LEGACY_V4_ORCHESTRATOR_DISPATCHER_RULE =
  '- Paseo Thin Dispatcher Rule: As `role=orchestrator` (running on fast `flash` model), DO NOT write complex architecture or business code yourself, and DO NOT use Claude\'s internal `Agent` tool! Instead, act strictly as a fast Thin Dispatcher: 1) Spawn `role=architect` and `role=pm` via `harness_handoff` (or `paseo run --workspace "$PASEO_WORKSPACE_ID" --label role=<architect|pm> --title "<Role Task>" "<Prompt>"`, preserving `PASEO_AGENT_ID` and honoring each specialist\'s configured provider and model) to define `design.md`, shared contracts, and `proposal.md`/`spec.md`; 2) Once contracts are ready, spawn `role=backend` and `role=ui` in parallel (`harness_handoff` or `paseo run --no-wait` + `paseo wait`); 3) Spawn `role=review` for dual-axis gate verification, run final targeted verification, and report the summary.';

export const LEGACY_V8_ORCHESTRATOR_DISPATCHER_RULE =
  '- Paseo Thin Dispatcher Rule: As `role=orchestrator` (running on `fast` tier), DO NOT write complex architecture or business code yourself, and DO NOT use Claude\'s internal `Agent` tool! Instead, act strictly as a fast Thin Dispatcher: 1) Spawn `role=architect` (`deep`) and `role=pm` (`deep`) via `harness_handoff` (or `paseo run --workspace "$PASEO_WORKSPACE_ID" --label role=<architect|pm> --title "<Role Task>" "<Prompt>"`, preserving `PASEO_AGENT_ID` and honoring each specialist\'s configured provider and model) to define `design.md`, shared contracts, and `proposal.md`/`spec.md`; 2) Once contracts are ready, spawn `role=backend` (`standard`) and `role=ui` (`standard`) in parallel (`harness_handoff` or `paseo run --no-wait` + `paseo wait`); 3) Spawn `role=review` (`deep`) for dual-axis gate verification, run final targeted verification, and report the summary.';

export const ORCHESTRATOR_DISPATCHER_RULE =
  '- Paseo Thin Dispatcher Rule: As `role=orchestrator` (running on `fast` tier), DO NOT write complex architecture or business code yourself, and DO NOT use Claude\'s internal `Agent` tool! Instead, act strictly as a fast Thin Dispatcher: 1) Spawn `role=architect` (`plan`) and `role=pm` (`plan`) via `harness_handoff` (or `paseo run --workspace "$PASEO_WORKSPACE_ID" --label role=<architect|pm> --title "<Role Task>" "<Prompt>"`, preserving `PASEO_AGENT_ID` and honoring each specialist\'s configured provider and model) to define `design.md`, shared contracts, and `proposal.md`/`spec.md`; 2) Once contracts are ready, spawn `role=backend` (`standard`) and `role=ui` (`standard`) in parallel (`harness_handoff` or `paseo run --no-wait` + `paseo wait`); 3) Spawn `role=review` (`review`) for dual-axis gate verification, run final targeted verification, and report the summary.';

export const LEGACY_ORCHESTRATOR_DISPATCHER_RULE =
  '- Paseo Thin Dispatcher Rule: As `role=orchestrator` (running on fast `flash` model), DO NOT write complex architecture or business code yourself, and DO NOT use Claude\'s internal `Agent` tool! Instead, act strictly as a fast Thin Dispatcher: 1) Spawn `role=architect` (`plan` model) and `role=pm` (`plan` model) via `paseo run --workspace "$PASEO_WORKSPACE_ID" --provider claude --mode bypassPermissions --label role=<architect|pm> --title "<Role Task>" "<Prompt>"` (preserving `PASEO_AGENT_ID` so they group cleanly in your Subagents Track pill) to define `design.md`, shared contracts, and `proposal.md`/`spec.md`; 2) Once contracts are ready, spawn `role=backend` (`flash`) and `role=ui` (`flash`) in parallel (`--no-wait` + `paseo wait`); 3) Spawn `role=review` (`review`) for dual-axis gate verification, run final `npm test`, and report the summary.';

export const LEGACY_V3_REVIEW_DESCRIPTION =
  "双轴代码审查与安全合规审计官（Standards 规范轴 + Spec 契约轴 + OCR 硬门禁）";

export const LEGACY_V3_REVIEW_HANDOFF_PROMPT =
  "Perform dual-axis code review (Standards + Spec) and OCR gate scan.";

export const LEGACY_V3_EXEC_PHASE_RULE =
  "- [Phase: Fast Execution] Rule: You are running on the fast flash model (phase=exec). Implement minimal, targeted code changes per spec and verify with targeted tests (npx vitest run <file> --bail=1, NEVER full suite), npm run typecheck, and npm run lint. Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic), once green, spawn or hand off via paseo-handoff to Reviewer (Gate) (--label role=review) for dual-axis review (Standards + Spec) and local ocr scan.";

export const LEGACY_V3_REVIEW_PHASE_RULE =
  "- [Phase: Review Gate] Rule: You are running on the review model (phase=review). Perform read-only dual-axis audit (Standards + Spec) and ocr gate verification; do not author large feature implementations directly.";

export const LEGACY_V4_DESIGN_PHASE_RULE =
  "- [Phase: Design & Planning] Rule: You are running on the high-reasoning plan model (phase=design). Present concise architectural proposals, trade-offs, and specs (for UI tasks, present concise visual concepts, layout wireframes, and UX trade-offs — DO NOT dump long HTML/React code blocks). Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session! Once the plan is confirmed, you or the user can exit plan mode via the `ExitPlanMode` permission or invoke the host tool `harness_handoff` (targetRole: ui, backend, qa, or review) to hand off execution to a fast flash specialist.";

export const LEGACY_V4_EXEC_PHASE_RULE =
  "- [Phase: Fast Execution] Rule: You are running on the fast flash model (phase=exec). Implement minimal, targeted code changes per spec and verify with targeted tests (npx vitest run <file> --bail=1, NEVER full suite), npm run typecheck, and npm run lint. Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic), once green, spawn or hand off via harness_handoff / paseo-handoff to Reviewer (Gate) (--label role=review) for dual-axis review (Standards + Spec) and agy + ocr delegate gate verification (`ocr delegate preview` + `ocr delegate rule`).";

export const LEGACY_V4_REVIEW_PHASE_RULE =
  "- [Phase: Review Gate] Rule: You are running on the review model (phase=review). Perform read-only dual-axis audit (Standards + Spec) and agy + ocr delegate gate verification (`ocr delegate preview --format json` + `ocr delegate rule --format json <paths...>`, LLM-free on OCR side — do NOT invoke standalone LLM-backed `ocr review`); do not author large feature implementations directly.";

export const LEGACY_V5_UI_MATCH_PATTERNS: readonly string[] = [
  "\\b(?:ui|ux|ui-ux-pro-max|unslop|visual-verdict|unistyles|popover|sheet|pill|hover|tailwind|expo|react\\s*native|playwright|css)\\b",
  "前端|界面|样式|弹窗|组件|面板|视觉|移动端|手机端|响应式|布局|图标|配色|交互体验",
];

export const LEGACY_V5_UI_ALLOWED_MCP: readonly string[] = [
  "playwright",
  "browser-tools",
  "serena",
  "claude-mem",
];

export const LEGACY_V5_GENERAL_ALLOWED_MCP: readonly string[] = ["serena", "claude-mem", "hub"];

export const LEGACY_V5_FULLSTACK_UI_PATTERN =
  "(?:\\b(?:ui|ux)\\b|前端|界面|样式|组件|移动端|手机端|页面)";

export const LEGACY_V5_EXEC_ACTION_PATTERN =
  "按(?:这个|这套|上述)?(?:方案|计划)[^，。！？\\n]{0,20}?(?:改|修改|写|实现|落地)|修复|落地|编写代码|直接修改|添加测试|打包|发布|同步到|在[^，。！？\\n]{1,30}?(?:中|里)实现|给[^，。！？\\n]{1,30}?(?:增加|加上)|替换|微调";

export const LEGACY_V6_SPECIALIST_PRIMARY_SKILLS: Readonly<Record<string, readonly string[]>> = {
  orchestrator: ["paseo", "superpowers:dispatching-parallel-agents"],
  ui: ["ui-ux-pro-max", "unslop", "visual-verdict"],
  backend: ["mattpocock-skills:codebase-design", "mattpocock-skills:tdd", "test-gardener"],
  pm: ["pm-prd", "pm-user-stories", "pm-edge-cases", "pm-problem", "mattpocock-skills:grilling"],
  architect: [
    "mattpocock-skills:codebase-design",
    "mattpocock-skills:domain-modeling",
    "mattpocock-skills:grilling",
  ],
  qa: ["test-gardener", "superpowers:verification-before-completion", "pm-edge-cases"],
  review: ["mattpocock-skills:code-review", "open-code-review-delegate", "gitea"],
  scout: ["prototype", "scaffold-exercises"],
  general: ["mattpocock-skills:codebase-design", "mattpocock-skills:domain-modeling"],
};

export const LEGACY_V7_UI_MATCH_PATTERNS: readonly string[] = [
  "\\b(?:ui|ux|ui-ux-pro-max|unslop|visual-verdict|unistyles|popover|sheet|pill|hover|tailwind|expo|react\\s*native|playwright|css|scss|sass|dark\\s*mode|light\\s*mode|color[-\\s]*scheme|theming|design[-\\s]*tokens?)\\b",
  "前端|界面|样式|弹窗|组件|面板|视觉|移动端|手机端|响应式|布局|图标|配色|交互体验|暗黑模式|深色模式|浅色模式|亮色模式|主题切换|主题色",
];

export const LEGACY_V7_BACKEND_MATCH_PATTERNS: readonly string[] = [
  "\\b(?:daemon|websocket|rpc|sqlite|dbx|terminal-worker|worktree|protocol|zod-aot|relay|noise\\s*nk|quota|proxy|gateway|scheduler|provider)\\b",
  "后端|协议兼容|数据库|进程通信|服务端|配额|网关|代理服务|限流|中间件",
];

export const LEGACY_V7_PM_PRIMARY_SKILLS: readonly string[] = [
  "pm-prd",
  "pm-user-stories",
  "pm-edge-cases",
  "pm-problem",
  "grilling",
];

export const LEGACY_V8_SPECIALIST_PROVIDERS: Readonly<Record<string, string>> = {
  orchestrator: "claude",
  ui: "claude",
  backend: "codex",
  pm: "claude",
  architect: "claude",
  qa: "codex",
  review: "antigravity",
  scout: "pi",
  general: "",
};

export const LEGACY_V8_SPECIALIST_PRIMARY_SKILLS: Readonly<Record<string, readonly string[]>> = {
  orchestrator: ["paseo", "codebase-design"],
  ui: ["ui-ux-pro-max", "unslop", "visual-verdict", "diagnosing-bugs", "pr"],
  backend: ["codebase-design", "tdd", "diagnosing-bugs", "test-gardener", "pr"],
  pm: [
    "grilling",
    "deliver-prd",
    "deliver-user-stories",
    "deliver-edge-cases",
    "define-problem-statement",
  ],
  architect: ["codebase-design", "domain-modeling", "grilling"],
  qa: ["test-gardener", "tdd", "diagnosing-bugs", "deliver-edge-cases"],
  review: ["code-review", "open-code-review-delegate", "gitea"],
  scout: ["prototype", "scaffold-exercises"],
  general: ["codebase-design", "domain-modeling", "tdd", "diagnosing-bugs"],
};

export const BUILTIN_SPECIALISTS: HarnessSpecialistConfig[] = [
  {
    id: "orchestrator",
    name: "Thin Dispatcher (Orchestrator)",
    shortLabel: "Orchestrator",
    description: "极速薄调度中枢：秒级意图分流与跨角色专家派发，自身不编写复杂架构或业务代码",
    icon: "Layers",
    color: "blue",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "fast",
    modelOverride: "",
    defaultModeId: "full-access",
    lockTierOnLabel: true,
    handoffEnabled: false,
    handoffPriority: 99,
    handoffTitlePrefix: "[Orchestrator]",
    handoffDefaultPrompt: "Orchestrate subagents across architecture, PM, backend, and UI.",
    syncToDaemonProfile: true,
    primarySkills: ["paseo"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: ["docs/architecture.md", "docs/agent-lifecycle.md"],
    qualityGates: [],
    ssotOutputTarget: "",
    rolePromptTemplate: ORCHESTRATOR_DISPATCHER_RULE,
    lazyToolSlice: "pm.yaml",
    allowedMcpServers: ["claude-mem", "hub"],
    excludedMcpServers: ["dbx", "playwright"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["lead", "dispatcher"],
    matchPatterns: [],
    profileFilename: "orchestrator.json",
  },
  {
    id: "ui",
    name: "UI / Frontend Specialist",
    shortLabel: "UI",
    description: "前端界面与高保真交互体验专家，基于 UI/UX Pro Max 规范设计与实现",
    icon: "Palette",
    color: "pink",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "standard",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: false,
    handoffEnabled: true,
    handoffPriority: 10,
    handoffTitlePrefix: "[UI]",
    handoffDefaultPrompt: "Implement responsive and polished frontend UI components per spec.",
    syncToDaemonProfile: true,
    primarySkills: ["ui-ux-pro-max", "unslop"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: ["docs/design.md", "docs/unistyles.md", "docs/hover.md", "docs/mobile-panels.md"],
    qualityGates: ["visual-verdict", "platform-gating: isWeb vs isNative"],
    ssotOutputTarget: "",
    rolePromptTemplate: "",
    lazyToolSlice: "ui.yaml",
    allowedMcpServers: ["playwright", "serena", "claude-mem"],
    excludedMcpServers: ["dbx", "terminal-worker-heavy"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["frontend", "ui-specialist"],
    matchPatterns: [],
    profileFilename: "ui-specialist.json",
  },
  {
    id: "backend",
    name: "Backend / Systems Specialist",
    shortLabel: "Backend",
    description: "后端系统、WebSocket/RPC 协议、数据库与并发架构专家",
    icon: "Server",
    color: "cyan",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "standard",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: false,
    handoffEnabled: true,
    handoffPriority: 20,
    handoffTitlePrefix: "[Backend]",
    handoffDefaultPrompt: "Implement backend service APIs, database logic, and protocol handlers.",
    syncToDaemonProfile: true,
    primarySkills: ["codebase-design", "tdd"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: [
      "docs/architecture.md",
      "docs/protocol-compatibility.md",
      "docs/rpc-namespacing.md",
      "docs/terminal-worker.md",
    ],
    qualityGates: ["protocol-backward-compatibility", "single-file-vitest", "typecheck-and-lint"],
    ssotOutputTarget: "",
    rolePromptTemplate: "",
    lazyToolSlice: "backend.yaml",
    allowedMcpServers: ["serena", "claude-mem", "dbx", "hub"],
    excludedMcpServers: ["playwright", "browser-tools"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["server", "backend-specialist"],
    matchPatterns: [],
    profileFilename: "backend-specialist.json",
  },
  {
    id: "pm",
    name: "Product / PM Specialist",
    shortLabel: "PM",
    description: "专业产品规划、痛点挖掘、用户故事拆解与 PRD 产出专家",
    icon: "FileText",
    color: "amber",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "plan",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: true,
    handoffEnabled: false,
    handoffPriority: 30,
    handoffTitlePrefix: "[PM]",
    handoffDefaultPrompt: "Analyze requirements and output user stories and PRD proposal.",
    syncToDaemonProfile: true,
    primarySkills: ["grilling", "deliver-prd"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: ["docs/product.md", "docs/agent-lifecycle.md", "docs/glossary.md"],
    qualityGates: [],
    ssotOutputTarget: "openspec/changes/<change-name>/proposal.md",
    rolePromptTemplate: "",
    lazyToolSlice: "pm.yaml",
    allowedMcpServers: ["claude-mem", "hub"],
    excludedMcpServers: ["dbx", "playwright"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["product", "product-specialist"],
    matchPatterns: [],
    profileFilename: "product-specialist.json",
  },
  {
    id: "architect",
    name: "Architect & Domain Modeling Specialist",
    shortLabel: "Architect",
    description: "系统架构师与领域建模专家，基于深模块理论设计系统边界与契约",
    icon: "Compass",
    color: "purple",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "plan",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: true,
    handoffEnabled: false,
    handoffPriority: 40,
    handoffTitlePrefix: "[Architect]",
    handoffDefaultPrompt: "Design deep module interfaces, domain models, and ADR specs.",
    syncToDaemonProfile: true,
    primarySkills: ["codebase-design", "domain-modeling"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: [
      "docs/architecture.md",
      "docs/data-model.md",
      "docs/protocol-compatibility.md",
      "docs/glossary.md",
    ],
    qualityGates: [],
    ssotOutputTarget: "openspec/changes/<change-name>/design.md",
    rolePromptTemplate: "",
    lazyToolSlice: "architect.yaml",
    allowedMcpServers: ["serena", "claude-mem", "hub"],
    excludedMcpServers: ["playwright", "dbx"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["system-architect"],
    matchPatterns: [],
    profileFilename: "architect.json",
  },
  {
    id: "qa",
    name: "QA Gatekeeper & Test Engineer",
    shortLabel: "QA",
    description: "独立质量守卫与跨端回归验收专家，专注边缘用例与测试资产健康度",
    icon: "CheckCircle",
    color: "emerald",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "standard",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: false,
    handoffEnabled: true,
    handoffPriority: 50,
    handoffTitlePrefix: "[QA]",
    handoffDefaultPrompt:
      "Add regression tests, verify edge cases, and ensure test suite adequacy.",
    syncToDaemonProfile: true,
    primarySkills: ["diagnosing-bugs", "test-gardener"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: ["docs/qa.md", "docs/testing.md", "docs/mobile-testing.md"],
    qualityGates: [
      "never-run-full-test-suite-locally",
      "platform-gating-verification",
      "evidence-before-assertions",
    ],
    ssotOutputTarget: "",
    rolePromptTemplate: "",
    lazyToolSlice: "qa.yaml",
    allowedMcpServers: ["serena", "claude-mem", "playwright"],
    excludedMcpServers: ["dbx"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["qa-gatekeeper", "tester"],
    matchPatterns: [],
    profileFilename: "qa-gatekeeper.json",
  },
  {
    id: "review",
    name: "Reviewer & Security Audit Gate",
    shortLabel: "Gate",
    description:
      "双轴代码审查与安全合规审计官（Standards 规范轴 + Spec 契约轴 + agy + ocr delegate 门禁）",
    icon: "ShieldCheck",
    color: "orange",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "review",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: true,
    handoffEnabled: true,
    handoffPriority: 60,
    handoffTitlePrefix: "[Review]",
    handoffDefaultPrompt:
      "Perform dual-axis code review (Standards + Spec) and agy + ocr delegate gate audit (ocr delegate preview + ocr delegate rule).",
    syncToDaemonProfile: true,
    primarySkills: ["code-review", "open-code-review-delegate"],
    mandatorySkillActivation: true,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: [
      "SECURITY.md",
      "docs/coding-standards.md",
      "docs/protocol-compatibility.md",
      "docs/protocol-validation.md",
    ],
    qualityGates: ["dual-axis-semantic-review", "open-code-review-delegate-gate"],
    ssotOutputTarget: "",
    rolePromptTemplate: "",
    lazyToolSlice: "review.yaml",
    allowedMcpServers: ["serena", "claude-mem"],
    excludedMcpServers: ["playwright", "dbx"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["security-review", "reviewer"],
    matchPatterns: [],
    profileFilename: "security-review.json",
  },
  {
    id: "scout",
    name: "Scout (Pi Spike / Fast Prototype)",
    shortLabel: "Scout",
    description: "轻量极速探针与敏捷脚手架专家，基于 Pi 运行时快速执行验证性 Spike 与单点脚本",
    icon: "Zap",
    color: "amber",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "fast",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: false,
    handoffEnabled: false,
    handoffPriority: 70,
    handoffTitlePrefix: "[Scout]",
    handoffDefaultPrompt: "Run fast spike experiment and validate throwaway prototype.",
    syncToDaemonProfile: true,
    primarySkills: ["prototype"],
    mandatorySkillActivation: false,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: ["docs/architecture.md"],
    qualityGates: [],
    ssotOutputTarget: "",
    rolePromptTemplate: "",
    lazyToolSlice: "scout.yaml",
    allowedMcpServers: ["claude-mem"],
    excludedMcpServers: ["dbx", "playwright"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: ["scout-specialist", "spike"],
    matchPatterns: [],
    profileFilename: "scout-specialist.json",
  },
  {
    id: "general",
    name: "General Engineering Specialist",
    shortLabel: "General",
    description: "通用工程实践与敏捷开发专家，默认兼备架构分析与系统研发规范",
    icon: "Cpu",
    color: "slate",
    enabled: true,
    builtIn: true,
    preferredProvider: "",
    preferredTier: "standard",
    modelOverride: "",
    defaultModeId: "",
    lockTierOnLabel: false,
    handoffEnabled: false,
    handoffPriority: 80,
    handoffTitlePrefix: "[General]",
    handoffDefaultPrompt: "Analyze task requirements and implement robust code changes.",
    syncToDaemonProfile: false,
    primarySkills: ["codebase-design", "tdd"],
    mandatorySkillActivation: false,
    skillsRoot: "/Users/jerry/.agents/skills",
    docsFocus: [
      "docs/architecture.md",
      "docs/data-model.md",
      "docs/protocol-compatibility.md",
      "docs/glossary.md",
    ],
    qualityGates: [],
    ssotOutputTarget: "",
    rolePromptTemplate: "",
    lazyToolSlice: "general.yaml",
    allowedMcpServers: ["serena", "claude-mem", "hub", "sequential-thinking"],
    excludedMcpServers: ["playwright", "dbx"],
    injectedMcpServers: [],
    extraEnv: {},
    aliases: [],
    matchPatterns: [],
    profileFilename: "general.json",
  },
];

export interface SlashCommandRouteEntry {
  command: string;
  subcommands?: readonly string[];
  phase: "design" | "exec" | "review";
  tier: "fast" | "standard" | "plan" | "review";
  role?: string;
}

export const BUILTIN_SLASH_COMMAND_ROUTES: readonly SlashCommandRouteEntry[] = [
  { command: "/opsx-propose", phase: "design", tier: "plan", role: "architect" },
  { command: "/opsx:propose", phase: "design", tier: "plan", role: "architect" },
  { command: "/opsx-explore", phase: "design", tier: "plan", role: "architect" },
  { command: "/opsx:explore", phase: "design", tier: "plan", role: "architect" },
  { command: "/brainstorming", phase: "design", tier: "plan", role: "architect" },
  { command: "/make-plan", phase: "design", tier: "plan", role: "architect" },
  { command: "/design-is", phase: "design", tier: "plan", role: "architect" },
  { command: "/codebase-design", phase: "design", tier: "plan", role: "architect" },
  { command: "/domain-modeling", phase: "design", tier: "plan", role: "architect" },
  { command: "/grilling", phase: "design", tier: "plan", role: "pm" },
  { command: "/deliver-prd", phase: "design", tier: "plan", role: "pm" },
  { command: "/deliver-user-stories", phase: "design", tier: "plan", role: "pm" },
  { command: "/define-problem-statement", phase: "design", tier: "plan", role: "pm" },
  { command: "/ocr", phase: "review", tier: "review", role: "review" },
  { command: "/review", phase: "review", tier: "review", role: "review" },
  { command: "/code-review", phase: "review", tier: "review", role: "review" },
  {
    command: "/gitea",
    subcommands: ["dev", "ship", "release"],
    phase: "exec",
    tier: "standard",
  },
  { command: "/install-local", phase: "exec", tier: "standard" },
  { command: "/implement", phase: "exec", tier: "standard" },
  { command: "/tdd", phase: "exec", tier: "standard" },
  { command: "/fix", phase: "exec", tier: "standard" },
  { command: "/diagnosing-bugs", phase: "exec", tier: "standard", role: "qa" },
  { command: "/unslop", phase: "exec", tier: "standard", role: "ui" },
  { command: "/ui-ux-pro-max", phase: "exec", tier: "standard", role: "ui" },
  { command: "/prototype", phase: "exec", tier: "fast", role: "scout" },
  { command: "/commit", phase: "exec", tier: "fast" },
  { command: "/changelog", phase: "exec", tier: "fast" },
  { command: "/docs", phase: "exec", tier: "fast" },
];

export const BUILTIN_CONVENTIONAL_PREFIXES: {
  fast: readonly string[];
  standard: readonly string[];
} = {
  fast: ["chore", "docs", "style"],
  standard: ["feat", "fix", "refactor", "perf", "test", "build", "ci"],
};

export const LEGACY_V8_DESIGN_PHASE_RULE =
  "- [Phase: Design & Planning] Rule: You are running in read-only planning phase (phase=design, typically on `deep` tier). Present concise architectural proposals, trade-offs, and specs (for UI tasks, present concise visual concepts, layout wireframes, and UX trade-offs — DO NOT dump long HTML/React code blocks). Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session! Once the plan is confirmed, exit plan mode via `ExitPlanMode` (which automatically steps down to `standard` tier) or invoke the host tool `harness_handoff` (targetRole: ui, backend, qa, or review) to hand off execution to a specialist.";

export const LEGACY_V8_EXEC_PHASE_RULE =
  "- [Phase: Execution] Rule: You are running in read-write execution phase (phase=exec). Implement minimal, targeted code changes per spec and verify with targeted tests (npx vitest run <file> --bail=1, NEVER full suite), npm run typecheck, and npm run lint. Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic), once green, spawn or hand off via harness_handoff / paseo-handoff to Reviewer (Gate) (--label role=review) for dual-axis review (Standards + Spec) and agy + ocr delegate gate verification (`ocr delegate preview` + `ocr delegate rule`).";

export const LEGACY_V8_REVIEW_PHASE_RULE =
  "- [Phase: Review Gate] Rule: You are running in read-only review phase (phase=review, typically on `deep` tier). Perform read-only dual-axis audit (Standards + Spec) and agy + ocr delegate gate verification (`ocr delegate preview --format json` + `ocr delegate rule --format json <paths...>`, LLM-free on OCR side — do NOT invoke standalone LLM-backed `ocr review`); do not author large feature implementations directly.";

export const BUILTIN_PHASE_RULES: Record<string, string> = {
  orchestrator: ORCHESTRATOR_DISPATCHER_RULE,
  design:
    "- [Phase: Design & Planning] Rule: You are running in read-only planning phase (phase=design, typically on `plan` tier). Present concise architectural proposals, trade-offs, and specs (for UI tasks, present concise visual concepts, layout wireframes, and UX trade-offs — DO NOT dump long HTML/React code blocks). Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session! Once the plan is confirmed, exit plan mode via `ExitPlanMode` (which automatically steps down to `standard` tier) or invoke the host tool `harness_handoff` (targetRole: ui, backend, qa, or review) to hand off execution to a specialist.",
  exec: "- [Phase: Execution] Rule: You are running in read-write execution phase (phase=exec). Implement minimal, targeted code changes per spec and verify with targeted tests (npx vitest run <file> --bail=1, NEVER full suite), npm run typecheck, and npm run lint. Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic), once green, spawn or hand off via harness_handoff / invoke_subagent to Reviewer (Gate) (--label role=review) for dual-axis review (Standards + Spec) and agy + ocr delegate gate verification (`ocr delegate preview` + `ocr delegate rule`).",
  review:
    "- [Phase: Review Gate] Rule: You are running in read-only review phase (phase=review, typically on `review` tier). Perform read-only dual-axis audit (Standards + Spec) and agy + ocr delegate gate verification (`ocr delegate preview --format json` + `ocr delegate rule --format json <paths...>`, LLM-free on OCR side — do NOT invoke standalone LLM-backed `ocr review`); do not author large feature implementations directly.",
};
