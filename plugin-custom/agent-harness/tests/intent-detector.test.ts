import { describe, expect, it, vi } from "vitest";
import { resolveEffectiveHarnessConfig } from "../shared/config-resolver.js";
import {
  coerceAutoRoutingTier,
  detectDomainRole,
  detectIntentDeterministic,
  detectIntentRoute,
  detectMatrixTier,
  isDefaultOrUnsetModel,
  isDeprecatedModel,
  isModelBypassed,
  isProviderBypassed,
  resolveHarnessEnv,
  resolveMatrixModel,
  sanitizePromptForRouting,
} from "../shared/intent-detector.js";
import { DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";

describe("sanitizePromptForRouting", () => {
  it("strips system-reminder tags, fenced code blocks, and extra whitespace", () => {
    const raw = `
      <system-reminder>internal instructions</system-reminder>
      请重构登录页面的弹窗交互
      \`\`\`ts
      const foo = "lots of noisy code";
      \`\`\`
      并补充单元测试
    `;
    const cleaned = sanitizePromptForRouting(raw);
    expect(cleaned).not.toContain("system-reminder");
    expect(cleaned).not.toContain("lots of noisy code");
    expect(cleaned).toContain("请重构登录页面的弹窗交互");
    expect(cleaned).toContain("并补充单元测试");
  });

  it("returns empty string for null or whitespace-only input", () => {
    expect(sanitizePromptForRouting(null)).toBe("");
    expect(sanitizePromptForRouting("   \n\t  ")).toBe("");
  });
});

describe("model classification helpers", () => {
  it("flags deprecated gemini-3 models via isDeprecatedModel", () => {
    expect(isDeprecatedModel("gemini-3-flash")).toBe(true);
    expect(isDeprecatedModel("gemini-3.1-pro-high")).toBe(true);
    expect(isDeprecatedModel("GEMINI-3-PRO")).toBe(true);
    expect(isDeprecatedModel("gemini-4-neon")).toBe(false);
    expect(isDeprecatedModel("gemini-4-carbon")).toBe(false);
    expect(isDeprecatedModel("")).toBe(false);
  });

  it("treats unset, tier labels, and Paseo antigravity default gemini-4-neon as default", () => {
    expect(isDefaultOrUnsetModel("antigravity", undefined)).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-neon")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-hydrogen")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-carbon")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-argon")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-3-flash")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-custom-user")).toBe(false);
    expect(isDefaultOrUnsetModel("claude", "plan")).toBe(false);
    expect(isDefaultOrUnsetModel("claude", "plan-xhigh")).toBe(false);
    expect(isDefaultOrUnsetModel("claude", "sonnet")).toBe(false);
    expect(isDefaultOrUnsetModel("claude", "flash")).toBe(true);
    expect(isDefaultOrUnsetModel("claude", "flash-medium")).toBe(true);
    expect(isDefaultOrUnsetModel("claude", "pro-high")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-neon-high")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-hydrogen-medium")).toBe(true);
    expect(isDefaultOrUnsetModel("antigravity", "gemini-4-custom-user-high")).toBe(false);
  });
});

describe("detectIntentDeterministic (L0 Router)", () => {
  it("prioritizes explicit labels.role and labels.profile over text content", () => {
    const byRole = detectIntentDeterministic({
      labels: { role: "ui-specialist" },
      text: "修复数据库 SQLite 连接池与 WebSocket RPC 协议",
    });
    expect(byRole.role).toBe("ui");
    expect(byRole.roleMatchedRule).toBe("label:role");
    expect(byRole.roleLocked).toBe(true);
    expect(byRole.needsSemanticRouter).toBe(true);

    const byLockedRole = detectIntentDeterministic({
      labels: { role: "architect" },
      text: "梳理多租户数据流向",
    });
    expect(byLockedRole.role).toBe("architect");
    expect(byLockedRole.tier).toBe("plan");
    expect(byLockedRole.phase).toBe("design");
    expect(byLockedRole.deterministic).toBe(true);
    expect(byLockedRole.needsSemanticRouter).toBe(false);

    const byProfile = detectIntentDeterministic({
      labels: { profile: "ui-specialist" },
      text: "普通任务",
    });
    expect(byProfile.role).toBe("ui");
    expect(byProfile.roleMatchedRule).toBe("label:profile");
  });

  it("routes workflow phase and native plan mode deterministically", () => {
    const wfReview = detectIntentDeterministic({
      labels: { "paseo.workflow.phase": "review" },
      text: "执行门禁检查",
    });
    expect(wfReview.phase).toBe("review");
    expect(wfReview.tier).toBe("review");
    expect(wfReview.deterministic).toBe(true);

    const planMode = detectIntentDeterministic({
      modeId: "plan",
      text: "帮我看看这段代码怎么改造比较好",
    });
    expect(planMode.phase).toBe("design");
    expect(planMode.tier).toBe("plan");
    expect(planMode.tierMatchedRule).toBe("mode:plan");
    expect(planMode.deterministic).toBe(true);
  });

  it("matches exact anchored slash commands cleanly without false positives", () => {
    const propose = detectIntentDeterministic({ text: "/opsx-propose 多租户认证方案" });
    expect(propose.tier).toBe("plan");
    expect(propose.phase).toBe("design");
    expect(propose.role).toBe("architect");
    expect(propose.deterministic).toBe(true);
    expect(propose.needsSemanticRouter).toBe(false);

    const grill = detectIntentDeterministic({ text: "/grilling 梳理用户痛点" });
    expect(grill.tier).toBe("plan");
    expect(grill.phase).toBe("design");
    expect(grill.role).toBe("pm");

    const ocr = detectIntentDeterministic({ text: "/ocr 全量门禁审计" });
    expect(ocr.tier).toBe("review");
    expect(ocr.phase).toBe("review");
    expect(ocr.role).toBe("review");

    const giteaDev = detectIntentDeterministic({ text: "/gitea dev and release beta" });
    expect(giteaDev.tier).toBe("standard");
    expect(giteaDev.phase).toBe("exec");
    expect(giteaDev.deterministic).toBe(true);

    const bareGitea = detectIntentDeterministic({ text: "/gitea status" });
    expect(bareGitea.deterministic).toBe(false);
    expect(bareGitea.needsSemanticRouter).toBe(true);

    const reviewPanel = detectIntentDeterministic({ text: "/review-panel 样式调整" });
    expect(reviewPanel.tier).not.toBe("review");
    expect(reviewPanel.deterministic).toBe(false);

    const commitCmd = detectIntentDeterministic({ text: "/commit" });
    expect(commitCmd.tier).toBe("fast");
    expect(commitCmd.phase).toBe("exec");
    expect(commitCmd.deterministic).toBe(true);
  });

  it("matches exact anchored conventional commit prefixes into fast or standard exec", () => {
    for (const fastPrompt of [
      "chore: update dependencies lockfile",
      "docs: update readme typo",
      "style(ui): normalize spacing",
    ]) {
      const res = detectIntentDeterministic({ text: fastPrompt });
      expect(res.tier).toBe("fast");
      expect(res.phase).toBe("exec");
      expect(res.deterministic).toBe(true);
      expect(res.needsSemanticRouter).toBe(false);
    }

    for (const stdPrompt of [
      "fix: 🛑 Blocker Findings (1)",
      "feat(auth)!: add OAuth callback",
      "refactor: extract shared parser",
    ]) {
      const res = detectIntentDeterministic({ text: stdPrompt });
      expect(res.tier).toBe("standard");
      expect(res.phase).toBe("exec");
      expect(res.deterministic).toBe(true);
      expect(res.needsSemanticRouter).toBe(false);
    }

    const crPrefix = detectIntentDeterministic({ text: "cr-1234 fix login bug" });
    expect(crPrefix.deterministic).toBe(false);
    expect(crPrefix.tier).not.toBe("review");
  });

  it("marks empty text as default_empty unless specialist has lockTierOnLabel", () => {
    const emptyDefault = detectIntentDeterministic({ text: "" });
    expect(emptyDefault.role).toBe("general");
    expect(emptyDefault.tierMatchedRule).toBe("default_empty");
    expect(emptyDefault.needsSemanticRouter).toBe(false);

    const lockedReview = detectIntentDeterministic({
      labels: { role: "review" },
      text: "",
    });
    expect(lockedReview.role).toBe("review");
    expect(lockedReview.tier).toBe("review");
    expect(lockedReview.phase).toBe("review");
    expect(lockedReview.tierMatchedRule).not.toBe("default_empty");

    const unlockedBackend = detectIntentDeterministic({
      labels: { role: "backend" },
      text: "",
    });
    expect(unlockedBackend.role).toBe("backend");
    expect(unlockedBackend.tierMatchedRule).toBe("default_empty");
  });

  it("does NOT classify unstructured natural language with regexes and delegates to semantic router", () => {
    const naturalPrompts = [
      "重构 QuickPrompts 弹窗组件的 Unistyles 样式与 hover 交互",
      "你作为CTO，给我优化的方案",
      "全栈需求：开发移动端前端页面与后端数据库接口存储",
      "检查本项目的 dark mode 存在的问题，以及优化方案",
      "修复 daemon WebSocket RPC 协议兼容性与 sqlite 存储",
    ];
    for (const prompt of naturalPrompts) {
      const res = detectIntentDeterministic({ text: prompt });
      expect(res.deterministic).toBe(false);
      expect(res.needsSemanticRouter).toBe(true);
      expect(res.role).toBe("general");
      expect(res.role).not.toBe("orchestrator");
    }

    // Explicit user custom matchPatterns on a lockTierOnLabel specialist keeps custom_pattern role
    // without falsely emitting roleLocked=true or label:role_tier
    const customPatternCfg = resolveEffectiveHarnessConfig({
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      specialists: [
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
        {
          ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[0]!,
          id: "kernel-dev",
          name: "Kernel Dev",
          shortLabel: "Kernel",
          description: "Custom kernel specialist",
          enabled: true,
          builtIn: false,
          preferredProvider: "",
          preferredTier: "plan",
          lockTierOnLabel: true,
          matchPatterns: ["\\b(?:ebpf|netfilter)\\b"],
        },
      ],
    });
    const customMatch = detectIntentDeterministic({
      text: "调试 ebpf netfilter 钩子路径",
      config: customPatternCfg,
    });
    expect(customMatch.role).toBe("kernel-dev");
    expect(customMatch.roleMatchedRule).toBe("custom_pattern:kernel-dev");
    expect(customMatch.roleLocked).toBe(false);
    expect(customMatch.tierMatchedRule).toBe("default_fallback");
    expect(customMatch.needsSemanticRouter).toBe(true);
  });
});

describe("coerceAutoRoutingTier", () => {
  it("maps max to plan/review, legacy aliases to canonical v9 tiers, and never returns max", () => {
    expect(coerceAutoRoutingTier("max")).toBe("plan");
    expect(coerceAutoRoutingTier("max", "review")).toBe("review");
    expect(coerceAutoRoutingTier("plan")).toBe("plan");
    expect(coerceAutoRoutingTier("review")).toBe("review");
    expect(coerceAutoRoutingTier("deep")).toBe("plan");
    expect(coerceAutoRoutingTier("deep", "review")).toBe("review");
    expect(coerceAutoRoutingTier("flash")).toBe("standard");
    expect(coerceAutoRoutingTier("lite")).toBe("fast");
  });
});

describe("resolveMatrixModel", () => {
  it("resolves v9 tiers and thinking options for opencode, codex, and pi", () => {
    const planDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/flash",
      text: "/opsx-propose 优化架构方案",
    });
    expect(planDecision.tier).toBe("plan");
    expect(planDecision.phase).toBe("design");
    expect(planDecision.targetModel).toBe("custom/pro");
    expect(planDecision.targetThinking).toBe("high");

    const reviewDecision = resolveMatrixModel({
      provider: "codex",
      currentModel: "flash",
      text: "/ocr 门禁复核",
    });
    expect(reviewDecision.tier).toBe("review");
    expect(reviewDecision.phase).toBe("review");
    expect(reviewDecision.targetModel).toBe("pro");
    expect(reviewDecision.targetThinking).toBe("high");

    const piFast = resolveMatrixModel({
      provider: "pi",
      currentModel: "headroom/flash",
      text: "chore: update scripts",
    });
    expect(piFast.tier).toBe("fast");
    expect(piFast.targetModel).toBe("headroom/lite");
  });

  it("preserves explicitly chosen user model and manual max model", () => {
    const customDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/claude-opus",
      text: "/opsx-propose 方案设计",
      overrideIfDefaultOnly: true,
    });
    expect(customDecision.targetModel).toBe("custom/claude-opus");
    expect(customDecision.matchedRule).toContain("preserve_user_choice");

    const manualMaxDecision = resolveMatrixModel({
      provider: "opencode",
      currentModel: "custom/plan",
      text: "fix: 修复拼写",
      overrideIfDefaultOnly: true,
    });
    expect(manualMaxDecision.targetModel).toBe("custom/plan");
    expect(manualMaxDecision.tier).toBe("max");
    expect(manualMaxDecision.targetThinking).toBe("xhigh");
    expect(manualMaxDecision.matchedRule).toContain("preserve_user_choice");
  });

  it("bypasses orchestrator models and configured bypassProviders safely", () => {
    expect(isProviderBypassed("custom-bypass", { bypassProviders: ["custom-bypass"] } as any)).toBe(
      true,
    );

    for (const orchModel of [
      "gemini-pro-orchestrator",
      "gemini-pro-orchestrator-neon",
      "gemini-pro-orchestrator-argon",
    ]) {
      const decision = resolveMatrixModel({
        provider: "antigravity",
        currentModel: orchModel,
        text: "/opsx-propose 架构",
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

  it("routes antigravity across v9 defaults (neon standard, carbon plan, argon review, hydrogen fast)", () => {
    const planDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: "gemini-4-hydrogen",
      text: "/opsx-propose 分布式架构",
    });
    expect(planDecision.tier).toBe("plan");
    expect(planDecision.phase).toBe("design");
    expect(planDecision.targetModel).toBe("gemini-4-carbon");
    expect(planDecision.targetThinking).toBe("high");

    const reviewDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: undefined,
      text: "/ocr 代码审查与安全门禁审计",
    });
    expect(reviewDecision.tier).toBe("review");
    expect(reviewDecision.phase).toBe("review");
    expect(reviewDecision.targetModel).toBe("gemini-4-argon");
    expect(reviewDecision.targetThinking).toBe("high");

    const execDecision = resolveMatrixModel({
      provider: "antigravity",
      currentModel: "gemini-4-neon",
      text: "fix: 修复按钮对齐问题",
    });
    expect(execDecision.tier).toBe("standard");
    expect(execDecision.phase).toBe("exec");
    expect(execDecision.targetModel).toBe("gemini-4-neon");
    expect(execDecision.targetThinking).toBe("high");
  });
});

describe("detectDomainRole & detectIntentRoute wrappers", () => {
  it("exposes backward-compatible detectDomainRole and detectMatrixTier wrappers without heuristic text guessing", () => {
    const roleDecision = detectDomainRole({
      labels: { role: "backend" },
      text: "任意文本",
    });
    expect(roleDecision.role).toBe("backend");
    expect(roleDecision.matchedRule).toBe("label:role");

    const unknownText = detectDomainRole({ text: "fix build feedback loop" });
    expect(unknownText.role).toBe("general");

    const slashTier = detectMatrixTier("/review 检查代码");
    expect(slashTier.tier).toBe("review");
    expect(slashTier.phase).toBe("review");

    const routeResult = detectIntentRoute("fix: 修复空指针");
    expect(routeResult.tier).toBe("standard");
    expect(routeResult.phase).toBe("exec");
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

  it("preserves caller-provided LAZY_TOOL_CONFIG and refreshes on role switch", () => {
    const env = resolveHarnessEnv({
      role: "backend",
      existingEnv: { LAZY_TOOL_CONFIG: "/custom/override.yaml" },
      homeDir: "/Users/jerry",
    });
    expect(env.PASEO_HARNESS_PROFILE).toBe("/Users/jerry/.agents/profiles/backend-specialist.json");
    expect(env.LAZY_TOOL_CONFIG).toBe("/custom/override.yaml");

    const switched = resolveHarnessEnv({
      role: "ui",
      existingEnv: {
        PASEO_HARNESS_ROLE: "backend",
        LAZY_TOOL_CONFIG: "/Users/jerry/.config/lazy-tool/profiles/backend.yaml",
      },
      homeDir: "/Users/jerry",
    });
    expect(switched.PASEO_HARNESS_ROLE).toBe("ui");
    expect(switched.LAZY_TOOL_CONFIG).toBe("/Users/jerry/.config/lazy-tool/profiles/ui.yaml");
  });
});
