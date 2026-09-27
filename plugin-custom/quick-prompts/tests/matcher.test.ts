import { describe, expect, it } from "vitest";
import type { QuickPromptItem } from "../shared/contracts.js";
import { evaluateQuickPrompts, matchesQuickPromptRule } from "../client/quick-prompt-matcher.js";
import {
  resolveActiveAgentProfileIds,
  resolveEffectiveQuickPrompts,
} from "../client/quick-prompt-resolver.js";
import { extractEphemeralOptions } from "../client/ephemeral-option-extractor.js";

const getId = (item: { id: string }) => item.id;

describe("plugin quick-prompt-matcher & resolver", () => {
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

  it("extracts ephemeral options when assistant provides numbered choices", () => {
    const text =
      "Please choose:\n1. **Option Alpha**: first\n2. **Option Beta**: second\nWhich one?";
    const options = extractEphemeralOptions(text, "en");
    expect(options.length).toBe(2);
    expect(options[0].id).toBe("ephemeral-opt-1");
    expect(options[1].id).toBe("ephemeral-opt-2");
  });

  it("resolves effective quick prompts combining global and project prompts", () => {
    const globalItems = [fixedItem];
    const projectItems: QuickPromptItem[] = [
      {
        id: "project-1",
        label: "Project Quick Prompt",
        content: "Custom content",
        triggerType: "fixed",
        enabled: true,
        createdAt: 10,
        order: 0,
      },
    ];

    const result = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems,
    });

    expect(result.map(getId)).toEqual(["project-1", "item-continue"]);
  });

  it("matches profiles using resolveActiveAgentProfileIds", () => {
    const profiles = [
      { id: "p1", name: "Claude Sonnet", provider: "claude", model: "claude-3-7-sonnet" },
    ];
    const matched = resolveActiveAgentProfileIds(
      { provider: "claude", model: "claude-3-7-sonnet" },
      profiles,
    );
    expect(matched).toContain("p1");
  });
});
