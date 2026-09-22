import { describe, expect, it } from "vitest";
import type { QuickPromptItem } from "@/stores/quick-prompts-store";
import { evaluateQuickPrompts, matchesQuickPromptRule } from "./quick-prompt-matcher";

const getId = (item: { id: string }) => item.id;

describe("quick-prompt-matcher", () => {
  const fixedItem: QuickPromptItem = {
    id: "item-continue",
    label: "继续",
    content: "请继续。",
    triggerType: "fixed",
    enabled: true,
    createdAt: 1,
    order: 0,
  };

  const errorRuleItem: QuickPromptItem = {
    id: "item-fix",
    label: "修复报错",
    content: "请修复以上报错。",
    triggerType: "rule",
    ruleCondition: {
      keywords: ["error", "failed", "失败"],
    },
    enabled: true,
    createdAt: 2,
    order: 1,
  };

  const statusRuleItem: QuickPromptItem = {
    id: "item-status",
    label: "检查状态",
    content: "检查当前状态。",
    triggerType: "rule",
    ruleCondition: {
      agentStatuses: ["error"],
    },
    enabled: true,
    createdAt: 3,
    order: 2,
  };

  const regexRuleItem: QuickPromptItem = {
    id: "item-regex",
    label: "选项确认",
    content: "确认方案 1。",
    triggerType: "rule",
    ruleCondition: {
      regex: "方案\\s*\\d+",
    },
    enabled: true,
    createdAt: 4,
    order: 3,
  };

  it("matches fixed items unconditionally when enabled", () => {
    expect(matchesQuickPromptRule(fixedItem, {})).toBe(true);
    expect(matchesQuickPromptRule({ ...fixedItem, enabled: false }, {})).toBe(false);
  });

  it("matches keywords case-insensitively", () => {
    expect(
      matchesQuickPromptRule(errorRuleItem, { lastAssistantText: "Task FAILED with code 1" }),
    ).toBe(true);
    expect(
      matchesQuickPromptRule(errorRuleItem, { lastAssistantText: "运行失败，请查看日志" }),
    ).toBe(true);
    expect(
      matchesQuickPromptRule(errorRuleItem, { lastAssistantText: "All operations succeeded." }),
    ).toBe(false);
  });

  it("matches regex patterns", () => {
    expect(
      matchesQuickPromptRule(regexRuleItem, { lastAssistantText: "请选择：方案 1 还是方案 2？" }),
    ).toBe(true);
    expect(matchesQuickPromptRule(regexRuleItem, { lastAssistantText: "请选择其它方法" })).toBe(
      false,
    );
  });

  it("handles invalid regex gracefully without throwing", () => {
    const invalidRegexItem: QuickPromptItem = {
      ...regexRuleItem,
      ruleCondition: { regex: "(unclosed group" },
    };
    expect(matchesQuickPromptRule(invalidRegexItem, { lastAssistantText: "test text" })).toBe(
      false,
    );
  });

  it("matches agent status correctly", () => {
    expect(matchesQuickPromptRule(statusRuleItem, { agentStatus: "error" })).toBe(true);
    expect(matchesQuickPromptRule(statusRuleItem, { agentStatus: "idle" })).toBe(false);
    expect(matchesQuickPromptRule(statusRuleItem, { agentStatus: null })).toBe(false);
  });

  it("requires agent status when combined with keywords", () => {
    const combinedItem: QuickPromptItem = {
      id: "combined",
      label: "综合测试",
      content: "内容",
      triggerType: "rule",
      ruleCondition: {
        agentStatuses: ["idle"],
        keywords: ["ready"],
      },
      enabled: true,
      createdAt: 5,
      order: 4,
    };

    // Status matches AND keyword matches
    expect(
      matchesQuickPromptRule(combinedItem, {
        agentStatus: "idle",
        lastAssistantText: "Agent is ready.",
      }),
    ).toBe(true);

    // Status does not match, even if keyword matches
    expect(
      matchesQuickPromptRule(combinedItem, {
        agentStatus: "running",
        lastAssistantText: "Agent is ready.",
      }),
    ).toBe(false);

    // Status matches, but keyword does not match
    expect(
      matchesQuickPromptRule(combinedItem, {
        agentStatus: "idle",
        lastAssistantText: "Working on it...",
      }),
    ).toBe(false);
  });

  it("filters and sorts matching items by order", () => {
    const items: QuickPromptItem[] = [
      { ...regexRuleItem, order: 10 },
      { ...fixedItem, order: 0 },
      { ...errorRuleItem, order: 5 },
    ];

    const result = evaluateQuickPrompts({
      items,
      lastAssistantText: "Error encountered in 方案 2",
      agentStatus: "idle",
    });

    expect(result.map(getId)).toEqual(["item-continue", "item-fix", "item-regex"]);
  });

  it("excludes disabled items from results", () => {
    const items: QuickPromptItem[] = [
      { ...fixedItem, enabled: false },
      { ...errorRuleItem, enabled: true },
    ];

    const result = evaluateQuickPrompts({
      items,
      lastAssistantText: "Some error occurred",
    });

    expect(result.map(getId)).toEqual(["item-fix"]);
  });

  it("prepends ephemeral options when agent is idle and options are detected", () => {
    const items = [fixedItem];
    const text = "Options:\n1. **Option A**: first\n2. **Option B**: second\nWhich one?";
    const result = evaluateQuickPrompts({
      items,
      agentStatus: "idle",
      lastAssistantText: text,
      locale: "en",
    });

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("ephemeral-opt-1");
    expect(result[1].id).toBe("ephemeral-opt-2");
    expect(result[2].id).toBe("item-continue");
  });

  it("does not extract ephemeral options when agent is running", () => {
    const items = [fixedItem];
    const text = "1. Option A\n2. Option B";
    const result = evaluateQuickPrompts({
      items,
      agentStatus: "running",
      lastAssistantText: text,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("item-continue");
  });

  it("respects disableEphemeral flag", () => {
    const items = [fixedItem];
    const text = "1. **Fast**: Quick\n2. **Slow**: Full";
    const result = evaluateQuickPrompts({
      items,
      agentStatus: "idle",
      lastAssistantText: text,
      disableEphemeral: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("item-continue");
  });

  describe("agentProfiles condition", () => {
    const profileItem: QuickPromptItem = {
      id: "item-profile-only",
      label: "前端专精",
      content: "请优先使用 React 与 CSS 优化。",
      triggerType: "rule",
      ruleCondition: {
        agentProfiles: ["frontend-expert", "ui-dev"],
      },
      enabled: true,
      createdAt: 10,
      order: 5,
    };

    const profileAndKeywordItem: QuickPromptItem = {
      id: "item-profile-keyword",
      label: "审核代码",
      content: "请执行严格审核。",
      triggerType: "rule",
      ruleCondition: {
        agentProfiles: ["reviewer"],
        keywords: ["review", "pr"],
      },
      enabled: true,
      createdAt: 11,
      order: 6,
    };

    it("matches when agentProfileId matches condition (single string, case-insensitive)", () => {
      expect(
        matchesQuickPromptRule(profileItem, {
          agentProfileId: "Frontend-Expert",
        }),
      ).toBe(true);
      expect(
        matchesQuickPromptRule(profileItem, {
          agentProfileId: "UI-DEV",
        }),
      ).toBe(true);
    });

    it("matches when agentProfileId is an array of candidate IDs/names", () => {
      expect(
        matchesQuickPromptRule(profileItem, {
          agentProfileId: ["other-profile", "frontend-expert"],
        }),
      ).toBe(true);
    });

    it("rejects when agentProfileId does not match", () => {
      expect(
        matchesQuickPromptRule(profileItem, {
          agentProfileId: "backend-dev",
        }),
      ).toBe(false);
    });

    it("rejects when agentProfileId is missing or null", () => {
      expect(matchesQuickPromptRule(profileItem, {})).toBe(false);
      expect(matchesQuickPromptRule(profileItem, { agentProfileId: null })).toBe(false);
    });

    it("requires both profile AND keywords when both are specified", () => {
      // Matches both
      expect(
        matchesQuickPromptRule(profileAndKeywordItem, {
          agentProfileId: "reviewer",
          lastAssistantText: "Please review this pull request.",
        }),
      ).toBe(true);

      // Matches profile but not keywords
      expect(
        matchesQuickPromptRule(profileAndKeywordItem, {
          agentProfileId: "reviewer",
          lastAssistantText: "All good, no issues found.",
        }),
      ).toBe(false);

      // Matches keywords but not profile
      expect(
        matchesQuickPromptRule(profileAndKeywordItem, {
          agentProfileId: "coder",
          lastAssistantText: "Please review this pull request.",
        }),
      ).toBe(false);
    });

    it("evaluates quick prompts with agentProfileId filter correctly", () => {
      const items = [fixedItem, profileItem, profileAndKeywordItem];

      // With frontend profile
      const frontendResult = evaluateQuickPrompts({
        items,
        agentProfileId: "frontend-expert",
      });
      expect(frontendResult.map(getId)).toEqual(["item-continue", "item-profile-only"]);

      // With reviewer profile and matching text
      const reviewerResult = evaluateQuickPrompts({
        items,
        agentProfileId: "reviewer",
        lastAssistantText: "Ready for review",
      });
      expect(reviewerResult.map(getId)).toEqual(["item-continue", "item-profile-keyword"]);
    });
  });
});
