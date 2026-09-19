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
});
