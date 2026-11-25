import { describe, expect, it, vi } from "vitest";
import {
  classifyIntentWithLlm,
  coerceAutoRoutingTier,
  detectDomainRole,
  detectDomainRoleHybrid,
  detectIntentRoute,
  detectMatrixTier,
  isModelBypassed,
  resolveHarnessEnv,
  resolveMatrixModel,
} from "../shared/intent-detector.js";

const mockFetchSuccess = async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"role":"architect","tier":"deep"}' } }],
    }),
    { status: 200 },
  );

const mockFetchTimeout = async () => {
  throw new DOMException("The operation was aborted", "TimeoutError");
};

describe("detectMatrixTier", () => {
  it("detects DEEP (design phase) for architectural, CTO, and root-cause analysis requests", () => {
    const planPrompts = [
      "我对当前Provider这块的第一层分类，或者说生态，非常不满意。你作为CTO，给我优化的方案只是第一层分类。",
      "ssh ops, 分析一下线上的hub环境：为什么reader没有任何关联的数据？bug在哪里？分析根因。",
      "你看看，你觉得有哪些问题？列出TOP3",
      "针对模型网关路由架构，设计一个长效的会话亲和性方案",
      "/opsx-propose 设计多渠道 OAuth Provider 扩展",
      "/opsx-explore 探讨缓存淘汰机制与性能基准",
      "根据这个分析报告，你检查一下hub是否具备这个保护机制，给出优化策略",
      "ssh ops, 我认为模型供应商那里还是存在几个比较容易费解的点。你作为CTO，好好思考一下：这块要怎么进行规整？",
    ];

    for (const prompt of planPrompts) {
      const result = detectMatrixTier(prompt);
      expect(result.tier, `Prompt failed to detect deep: "${prompt}"`).toBe("deep");
      expect(result.phase).toBe("design");
    }
  });

  it("detects DEEP (review phase) for code reviews, OCR gates, and audits", () => {
    const reviewPrompts = [
      "review: 审查当前分支与 develop 的所有差异与契约合流",
      "CR 当前 PR 提交并输出审查摘要",
      "/ocr 全量审查与门禁质量检查",
      "执行代码审查与质量门禁审计",
      "验收检查：验证最近提交是否符合规范",
    ];

    for (const prompt of reviewPrompts) {
      const result = detectMatrixTier(prompt);
      expect(result.tier, `Prompt failed to detect deep review: "${prompt}"`).toBe("deep");
      expect(result.phase).toBe("review");
    }
  });

  it("detects STANDARD (exec phase) for code execution, fixes, releases, and general tasks", () => {
    const execPrompts = [
      "fix: 🛑 Blocker Findings (1)",
      "/gitea dev and release beta",
      "/install-local",
      "在统计这里，当我点选了一些筛选之后，如果不点到这个分类里，就不能取消它，非常不方便。",
      "修复前端控制台打印的样式报错",
      "打包镜像并推送到远程仓库",
    ];

    for (const prompt of execPrompts) {
      const result = detectMatrixTier(prompt);
      expect(result.tier, `Prompt failed to detect standard: "${prompt}"`).toBe("standard");
      expect(result.phase).toBe("exec");
    }

    for (const serviceCmd of ["启动服务", "重启开发服务", "start dev server"]) {
      const result = detectIntentRoute(serviceCmd);
      expect(result.tier, `Prompt failed to detect standard: "${serviceCmd}"`).toBe("standard");
      expect(result.phase).toBe("exec");
    }
  });

  it("detects FAST (exec phase) for lightweight lookups, status checks, and chores", () => {
    const fastPrompts = [
      "chore: update dependencies lockfile",
      "docs: update readme typo",
      "查一下最近的错误日志",
      "check status and logs for gateway",
    ];

    for (const prompt of fastPrompts) {
      const result = detectIntentRoute(prompt);
      expect(result.tier, `Prompt failed to detect fast: "${prompt}"`).toBe("fast");
      expect(result.phase).toBe("exec");
    }
  });

  it("never selects manual-only max tier in automatic intent detection or LLM fallback", async () => {
    expect(coerceAutoRoutingTier("max")).toBe("deep");
    expect(coerceAutoRoutingTier("plan")).toBe("deep");
    expect(coerceAutoRoutingTier("flash")).toBe("standard");
    expect(coerceAutoRoutingTier("lite")).toBe("fast");

    const maxHintPrompt = detectIntentRoute("请使用 max xhigh opus 最高档模型彻底排查并设计方案");
    expect(maxHintPrompt.tier).toBe("deep");
    expect(maxHintPrompt.tier).not.toBe("max");

    const llmMaxMock = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"role":"backend","tier":"max"}' } }],
        }),
        { status: 200 },
      );
    const llmResult = await classifyIntentWithLlm({
      text: "复杂并发锁死疑难 Bug",
      fetchImpl: llmMaxMock as unknown as typeof fetch,
    });
    expect(llmResult).toEqual({ role: "backend", tier: "deep" });
  });

  it("detects Chinese planning requests containing '计划' or '考虑如何' as DEEP (design) while keeping execution overrides STANDARD", () => {
    const planDecision = detectIntentRoute(
      "关于运营管理和全局设置，里面的UI非常混乱，包括模板、组件、布局、大小，还有文字，都非常混乱。你去考虑如何进行统一的样式和布局。给我输出个计划。",
    );
    expect(planDecision.tier).toBe("deep");
    expect(planDecision.phase).toBe("design");

    const execDecision = detectIntentRoute("好的，按这个计划改代码");
    expect(execDecision.tier).toBe("standard");
    expect(execDecision.phase).toBe("exec");
  });
});

describe("resolveMatrixModel", () => {
  it("resolves model and thinking option for opencode", () => {
    const planDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "你作为CTO，给我优化的方案",
    });
    expect(planDecision.tier).toBe("deep");
    expect(planDecision.phase).toBe("design");
    expect(planDecision.targetModel).toBe("custom/pro");
    expect(planDecision.targetThinking).toBe("high");

    const reviewDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "代码审查该模块实现",
    });
    expect(reviewDecision.tier).toBe("deep");
    expect(reviewDecision.phase).toBe("review");
    expect(reviewDecision.targetModel).toBe("custom/pro");

    const stdDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "fix: 修复一个空指针",
    });
    expect(stdDecision.tier).toBe("standard");
    expect(stdDecision.phase).toBe("exec");
    expect(stdDecision.targetModel).toBe("custom/flash");
    expect(stdDecision.targetThinking).toBe("medium");

    const fastDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "chore: clean unused comments",
    });
    expect(fastDecision.tier).toBe("fast");
    expect(fastDecision.targetModel).toBe("custom/lite");
  });

  it("resolves model for codex", () => {
    const planDecision = resolveMatrixModel({
      provider: "codex",
      currentModel: "flash",
      text: "架构设计与技术选型方案",
    });
    expect(planDecision.tier).toBe("deep");
    expect(planDecision.phase).toBe("design");
    expect(planDecision.targetModel).toBe("pro");
    expect(planDecision.targetThinking).toBe("high");

    const reviewDecision = resolveMatrixModel({
      provider: "codex",
      currentModel: "flash",
      text: "review: 门禁复核",
    });
    expect(reviewDecision.tier).toBe("deep");
    expect(reviewDecision.phase).toBe("review");
    expect(reviewDecision.targetModel).toBe("pro");
  });

  it("preserves explicitly chosen user model and manual max model", () => {
    const customDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/claude-opus",
      text: "方案设计",
      overrideIfDefaultOnly: true,
    });
    expect(customDecision.targetModel).toBe("custom/claude-opus");
    expect(customDecision.matchedRule).toContain("preserve_user_choice");

    const manualMaxDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/plan",
      text: "fix: 修复拼写",
      overrideIfDefaultOnly: true,
      customMappings: {
        opencode: {
          fast: "custom/lite",
          standard: "custom/flash",
          deep: "custom/pro",
          max: "custom/plan",
        },
      },
    });
    expect(manualMaxDecision.targetModel).toBe("custom/plan");
    expect(manualMaxDecision.tier).toBe("max");
    expect(manualMaxDecision.targetThinking).toBe("xhigh");
    expect(manualMaxDecision.matchedRule).toContain("preserve_user_choice");
  });

  it("resolves canonical headroom/* model IDs for pi provider", () => {
    const planDecision = resolveMatrixModel({
      provider: "pi",
      currentModel: "headroom/flash",
      text: "设计一套深模块架构方案",
    });
    expect(planDecision.tier).toBe("deep");
    expect(planDecision.targetModel).toBe("headroom/pro");

    const stdDecision = resolveMatrixModel({
      provider: "pi",
      currentModel: "flash",
      text: "fix: 修复探针脚本",
    });
    expect(stdDecision.tier).toBe("standard");
    expect(stdDecision.targetModel).toBe("headroom/flash");

    const fastDecision = resolveMatrixModel({
      provider: "pi",
      currentModel: "headroom/flash",
      text: "查一下日志定位版本",
    });
    expect(fastDecision.tier).toBe("fast");
    expect(fastDecision.targetModel).toBe("headroom/lite");
  });

  it("classifies plugin implementation actions as standard execution", () => {
    const decision = resolveMatrixModel({
      provider: "claude",
      currentModel: "flash",
      text: "同意，但在quick button的插件中实现",
    });
    expect(decision.tier).toBe("standard");
    expect(decision.phase).toBe("exec");
    expect(decision.matchedRule).toContain("exec_action");
  });

  it("bypasses orchestration routing for antigravity native orchestrator models only", () => {
    for (const orchModel of [
      "gemini-pro-orchestrator",
      "gemini-pro-orchestrator-neon",
      "gemini-pro-orchestrator-argon",
    ]) {
      const decision = resolveMatrixModel({
        provider: "antigravity",
        currentModel: orchModel,
        text: "你作为CTO，设计一套全新的分布式架构方案",
      });
      expect(decision.targetModel).toBe(orchModel);
      expect(decision.matchedRule).toBe("bypass_orchestrator_model");
      expect(isModelBypassed(orchModel)).toBe(true);
    }
  });

  it("logs invalid bypassModels regex patterns once without crashing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const invalidPattern = "[unclosed-regex-test-pattern";
      expect(
        isModelBypassed("gemini-4-hydrogen", [invalidPattern, "^gemini-pro-orchestrator"]),
      ).toBe(false);
      expect(
        isModelBypassed("gemini-pro-orchestrator", [invalidPattern, "^gemini-pro-orchestrator"]),
      ).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("routes non-orchestrator antigravity models across Gemini 4 native IDs + thinking and preserves manual max/custom models", () => {
    const planDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: "gemini-4-hydrogen",
      text: "你作为CTO，设计一套全新的分布式架构方案",
    });
    expect(planDecision.tier).toBe("deep");
    expect(planDecision.phase).toBe("design");
    expect(planDecision.targetModel).toBe("gemini-4-carbon");
    expect(planDecision.targetThinking).toBe("high");

    const reviewDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: undefined,
      text: "review: 代码审查与安全门禁审计",
    });
    expect(reviewDecision.tier).toBe("deep");
    expect(reviewDecision.phase).toBe("review");
    expect(reviewDecision.targetModel).toBe("gemini-4-carbon");
    expect(reviewDecision.targetThinking).toBe("high");

    const execDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: undefined,
      text: "fix: 修复按钮对齐问题",
    });
    expect(execDecision.tier).toBe("standard");
    expect(execDecision.phase).toBe("exec");
    expect(execDecision.targetModel).toBe("gemini-4-argon");
    expect(execDecision.targetThinking).toBe("high");

    const lockedMaxDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: "gemini-4-neon",
      text: "fix: 修复文案",
      overrideIfDefaultOnly: true,
    });
    expect(lockedMaxDecision.targetModel).toBe("gemini-4-neon");
    expect(lockedMaxDecision.tier).toBe("max");
    expect(lockedMaxDecision.targetThinking).toBe("xhigh");
    expect(lockedMaxDecision.matchedRule).toContain("preserve_user_choice");
  });
});

describe("detectDomainRole", () => {
  it("prioritizes explicit labels.role or labels.profile over text heuristics", () => {
    const result = detectDomainRole({
      labels: { role: "ui-specialist" },
      text: "修复数据库 SQLite 连接池与 WebSocket RPC 协议",
    });
    expect(result.role).toBe("ui");
    expect(result.matchedRule).toBe("label:role");
  });

  it("detects UI role from frontend, component, unistyles, and visual keywords", () => {
    const uiTexts = [
      "重构 QuickPrompts 弹窗组件的 Unistyles 样式与 hover 交互",
      "使用 ui-ux-pro-max 和 unslop 优化移动端面板布局",
      "修复 React Native Sheet 滚动折叠与按钮对齐问题",
      "检查本项目的 dark mode 存在的问题，以及优化方案",
      "深色模式与主题切换样式优化",
      "配置 WorkTree 和 Local 这两个标签的颜色和图标",
      "调整弹窗 popover modal 卡片间距与色板 typography",
    ];
    for (const text of uiTexts) {
      const result = detectDomainRole({ text });
      expect(result.role, `Failed UI detection for: ${text}`).toBe("ui");
    }

    const darkPlanTier = detectIntentRoute("检查本项目的 dark mode 存在的问题，以及优化方案");
    expect(darkPlanTier.tier).toBe("deep");
    expect(darkPlanTier.phase).toBe("design");
  });

  it("detects PM role from PRD, user stories, and product discovery keywords", () => {
    const pmTexts = [
      "使用 pm-prd 与 grilling 梳理痛点并编写 proposal.md 用户故事",
      "拆解产品需求文档 PRD 与验收条件 AC",
    ];
    for (const text of pmTexts) {
      const result = detectDomainRole({ text });
      expect(result.role, `Failed PM detection for: ${text}`).toBe("pm");
    }
  });

  it("detects Scout role from spike, prototype, and scaffold keywords", () => {
    const scoutTexts = [
      "使用 prototype 跑一个 throwaway spike 快速原型验证",
      "用敏捷探针单点验证脚手架脚本",
    ];
    for (const text of scoutTexts) {
      const result = detectDomainRole({ text });
      expect(result.role, `Failed Scout detection for: ${text}`).toBe("scout");
    }
  });

  it("detects Backend role from daemon, protocol, RPC, and database keywords without false-positiving on bare worktree/provider", () => {
    const backendTexts = [
      "修复 daemon WebSocket RPC 协议兼容性与 sqlite 存储",
      "优化 terminal-worker 进程通信与后端接口性能",
      "优化 git worktree 与 provider adapter 状态同步",
    ];
    for (const text of backendTexts) {
      const result = detectDomainRole({ text });
      expect(result.role, `Failed Backend detection for: ${text}`).toBe("backend");
    }

    const nonBackendUiCopy = detectDomainRole({ text: "展示 WorkTree 与 Provider 名称" });
    expect(nonBackendUiCopy.role).not.toBe("backend");
  });

  it("detects Orchestrator role for composite fullstack requirements touching both UI and backend", () => {
    const fullstackText = "全栈需求：开发移动端前端页面与后端数据库接口存储";
    const result = detectDomainRole({ text: fullstackText });
    expect(result.role).toBe("orchestrator");
    expect(result.matchedRule).toBe("heuristic:fullstack_orchestrator");
  });

  it("does not falsely classify 'fix build feedback loop' as orchestrator due to word boundaries", () => {
    const result = detectDomainRole({ text: "fix build feedback loop" });
    expect(result.role).not.toBe("orchestrator");
  });
});

describe("resolveHarnessEnv", () => {
  it("injects UI profile and lazy-tool ui.yaml when role is ui", () => {
    const env = resolveHarnessEnv({
      role: "ui",
      existingEnv: { PATH: "/usr/bin" },
      homeDir: "/Users/jerry",
    });
    expect(env.PASEO_HARNESS_ROLE).toBe("ui");
    expect(env.PASEO_HARNESS_PROFILE).toBe("/Users/jerry/.agents/profiles/ui-specialist.json");
    expect(env.LAZY_TOOL_CONFIG).toBe("/Users/jerry/.config/lazy-tool/profiles/ui.yaml");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("injects review profile and lazy-tool review.yaml when role is review", () => {
    const env = resolveHarnessEnv({
      role: "review",
      existingEnv: { PATH: "/usr/bin" },
      homeDir: "/Users/jerry",
    });
    expect(env.PASEO_HARNESS_ROLE).toBe("review");
    expect(env.PASEO_HARNESS_PROFILE).toBe("/Users/jerry/.agents/profiles/security-review.json");
    expect(env.LAZY_TOOL_CONFIG).toBe("/Users/jerry/.config/lazy-tool/profiles/review.yaml");
  });

  it("preserves caller-provided LAZY_TOOL_CONFIG if already present", () => {
    const env = resolveHarnessEnv({
      role: "backend",
      existingEnv: { LAZY_TOOL_CONFIG: "/custom/override.yaml" },
      homeDir: "/Users/jerry",
    });
    expect(env.PASEO_HARNESS_ROLE).toBe("backend");
    expect(env.PASEO_HARNESS_PROFILE).toBe("/Users/jerry/.agents/profiles/backend-specialist.json");
    expect(env.LAZY_TOOL_CONFIG).toBe("/custom/override.yaml");
  });
  it("refreshes LAZY_TOOL_CONFIG when inherited from a parent harness with different role", () => {
    const env = resolveHarnessEnv({
      role: "ui",
      existingEnv: {
        PASEO_HARNESS_ROLE: "backend",
        LAZY_TOOL_CONFIG: "/Users/jerry/.config/lazy-tool/profiles/backend.yaml",
      },
      homeDir: "/Users/jerry",
    });
    expect(env.PASEO_HARNESS_ROLE).toBe("ui");
    expect(env.LAZY_TOOL_CONFIG).toBe("/Users/jerry/.config/lazy-tool/profiles/ui.yaml");
  });

  it("reports label:profile when matched via profile label instead of role label", () => {
    const result = detectDomainRole({
      labels: { profile: "ui-specialist" },
      text: "普通任务",
    });
    expect(result.role).toBe("ui");
    expect(result.matchedRule).toBe("label:profile");
  });

  it("does not false-positive match REVIEW tier on hyphenated words like review-panel or cr-1234", () => {
    const resultPanel = detectMatrixTier("review-panel 样式调整");
    expect(resultPanel.tier).not.toBe("review");

    const resultCr = detectMatrixTier("cr-1234 fix login bug");
    expect(resultCr.tier).not.toBe("review");
  });

  it("correctly classifies mobile UI design & layout review as UI role and DEEP (design) tier", () => {
    const prompt = "审视所有移动端的 ui 设计和布局，分析如何实现 ui 的一致性以及手机端的友好性。";
    const roleDecision = detectDomainRole({ text: prompt });
    expect(roleDecision.role).toBe("ui");

    const tierDecision = detectMatrixTier(prompt);
    expect(tierDecision.tier).toBe("deep");
    expect(tierDecision.phase).toBe("design");
  });

  it("falls back to L2 LLM classifier when L1 heuristic returns general, and degrades gracefully on timeout", async () => {
    const hybridDecision = await detectDomainRoleHybrid({
      text: "梳理多租户隔离策略与数据流向",
      homeDir: "/Users/jerry",
      llmFallback: {
        enabled: true,
        fetchImpl: mockFetchSuccess as unknown as typeof fetch,
      },
    });
    expect(hybridDecision.role).toBe("architect");
    expect(hybridDecision.matchedRule).toBe("llm_fallback:architect");

    const degraded = await classifyIntentWithLlm({
      text: "梳理多租户隔离策略与数据流向",
      fetchImpl: mockFetchTimeout as unknown as typeof fetch,
      timeoutMs: 50,
    });
    expect(degraded).toBeNull();
  });

  it("returns null when no endpoint or apiKey is configured and no fetchImpl is injected", async () => {
    const originalEndpoint = process.env.HARNESS_LLM_ENDPOINT;
    const originalKey = process.env.HARNESS_LLM_API_KEY;
    const originalBase = process.env.ANTHROPIC_BASE_URL;
    const originalAuth = process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      delete process.env.HARNESS_LLM_ENDPOINT;
      delete process.env.HARNESS_LLM_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      const result = await classifyIntentWithLlm({
        text: "梳理多租户隔离策略与数据流向",
      });
      expect(result).toBeNull();
    } finally {
      if (originalEndpoint !== undefined) process.env.HARNESS_LLM_ENDPOINT = originalEndpoint;
      if (originalKey !== undefined) process.env.HARNESS_LLM_API_KEY = originalKey;
      if (originalBase !== undefined) process.env.ANTHROPIC_BASE_URL = originalBase;
      if (originalAuth !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = originalAuth;
    }
  });
});
