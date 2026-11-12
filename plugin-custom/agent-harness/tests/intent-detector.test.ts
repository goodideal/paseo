import { describe, expect, it } from "vitest";
import {
  classifyIntentWithLlm,
  detectDomainRole,
  detectDomainRoleHybrid,
  detectMatrixTier,
  resolveHarnessEnv,
  resolveMatrixModel,
} from "../shared/intent-detector.js";

const mockFetchSuccess = async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"role":"architect","tier":"plan"}' } }],
    }),
    { status: 200 },
  );

const mockFetchTimeout = async () => {
  throw new DOMException("The operation was aborted", "TimeoutError");
};

describe("detectMatrixTier", () => {
  it("detects PLAN tier for architectural, CTO, and root-cause analysis requests", () => {
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
      expect(result.tier, `Prompt failed to detect plan: "${prompt}"`).toBe("plan");
    }
  });

  it("detects REVIEW tier for code reviews, OCR gates, and audits", () => {
    const reviewPrompts = [
      "review: 审查当前分支与 develop 的所有差异与契约合流",
      "CR 当前 PR 提交并输出审查摘要",
      "/ocr 全量审查与门禁质量检查",
      "执行代码审查与质量门禁审计",
      "验收检查：验证最近提交是否符合规范",
    ];

    for (const prompt of reviewPrompts) {
      const result = detectMatrixTier(prompt);
      expect(result.tier, `Prompt failed to detect review: "${prompt}"`).toBe("review");
    }
  });

  it("detects FLASH tier for code execution, fixes, releases, and general tasks", () => {
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
      expect(result.tier, `Prompt failed to detect flash: "${prompt}"`).toBe("flash");
    }
  });
});

describe("resolveMatrixModel", () => {
  it("resolves model for opencode", () => {
    const planDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "你作为CTO，给我优化的方案",
    });
    expect(planDecision.tier).toBe("plan");
    expect(planDecision.targetModel).toBe("custom/plan");

    const reviewDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "代码审查该模块实现",
    });
    expect(reviewDecision.tier).toBe("review");
    expect(reviewDecision.targetModel).toBe("custom/review");

    const flashDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "fix: 修复一个空指针",
    });
    expect(flashDecision.tier).toBe("flash");
    expect(flashDecision.targetModel).toBe("custom/flash");
  });

  it("resolves model for codex", () => {
    const planDecision = resolveMatrixModel({
      provider: "codex",
      currentModel: "flash",
      text: "架构设计与技术选型方案",
    });
    expect(planDecision.tier).toBe("plan");
    expect(planDecision.targetModel).toBe("plan");

    const reviewDecision = resolveMatrixModel({
      provider: "codex",
      currentModel: "flash",
      text: "review: 门禁复核",
    });
    expect(reviewDecision.tier).toBe("review");
    expect(reviewDecision.targetModel).toBe("review");
  });

  it("preserves explicitly chosen user model if not default flash", () => {
    const decision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/pro",
      text: "方案设计",
      overrideIfDefaultOnly: true,
    });
    expect(decision.targetModel).toBe("custom/pro");
    expect(decision.matchedRule).toContain("preserve_user_choice");
  });

  it("resolves canonical headroom/* model IDs for pi provider", () => {
    const planDecision = resolveMatrixModel({
      provider: "pi",
      currentModel: "headroom/flash",
      text: "设计一套深模块架构方案",
    });
    expect(planDecision.tier).toBe("plan");
    expect(planDecision.targetModel).toBe("headroom/plan");

    const flashDecision = resolveMatrixModel({
      provider: "pi",
      currentModel: "flash",
      text: "fix: 修复探针脚本",
    });
    expect(flashDecision.tier).toBe("flash");
    expect(flashDecision.targetModel).toBe("headroom/flash");
  });

  it("classifies plugin implementation actions as flash execution", () => {
    const decision = resolveMatrixModel({
      provider: "claude",
      currentModel: "flash",
      text: "同意，但在quick button的插件中实现",
    });
    expect(decision.tier).toBe("flash");
    expect(decision.matchedRule).toContain("exec_action");
  });

  it("bypasses orchestration routing for antigravity safety-net provider", () => {
    const decision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: "gemini-3.8-flash-high",
      text: "你作为CTO，设计一套全新的分布式架构方案",
    });
    expect(decision.targetModel).toBe("gemini-3.8-flash-high");
    expect(decision.matchedRule).toBe("bypass_safety_net");
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
    ];
    for (const text of uiTexts) {
      const result = detectDomainRole({ text });
      expect(result.role, `Failed UI detection for: ${text}`).toBe("ui");
    }
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

  it("detects Backend role from daemon, protocol, RPC, and database keywords", () => {
    const backendTexts = [
      "修复 daemon WebSocket RPC 协议兼容性与 sqlite 存储",
      "优化 terminal-worker 进程通信与后端接口性能",
    ];
    for (const text of backendTexts) {
      const result = detectDomainRole({ text });
      expect(result.role, `Failed Backend detection for: ${text}`).toBe("backend");
    }
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

  it("correctly classifies mobile UI design & layout review as UI role and PLAN tier", () => {
    const prompt = "审视所有移动端的 ui 设计和布局，分析如何实现 ui 的一致性以及手机端的友好性。";
    const roleDecision = detectDomainRole({ text: prompt });
    expect(roleDecision.role).toBe("ui");

    const tierDecision = detectMatrixTier(prompt);
    expect(tierDecision.tier).toBe("plan");
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
