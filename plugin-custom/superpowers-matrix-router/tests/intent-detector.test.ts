import { describe, expect, it } from "vitest";
import { detectMatrixTier, resolveMatrixModel } from "../shared/intent-detector.js";

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
});
