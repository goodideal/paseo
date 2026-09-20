import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { QuickPromptItem } from "@/stores/quick-prompts-store";
import { buildCommandAutocompleteOptions } from "./use-agent-autocomplete";

const mockT: TFunction = ((key: string) => key) as unknown as TFunction;

describe("buildCommandAutocompleteOptions with Quick Prompts", () => {
  const quickPrompts: QuickPromptItem[] = [
    {
      id: "qp-fix",
      label: "修复报错",
      content: "请根据以上报错信息修复问题并验证。",
      shortcut: "fix",
      triggerType: "rule",
      enabled: true,
      createdAt: 1,
      order: 0,
    },
    {
      id: "qp-continue",
      label: "继续",
      content: "请继续执行下一步。",
      shortcut: "continue",
      triggerType: "fixed",
      enabled: true,
      createdAt: 2,
      order: 1,
    },
    {
      id: "qp-disabled",
      label: "已禁用指令",
      content: "内容",
      shortcut: "disabled",
      triggerType: "fixed",
      enabled: false,
      createdAt: 3,
      order: 2,
    },
  ];

  it("includes enabled quick prompts in autocomplete options", () => {
    const options = buildCommandAutocompleteOptions({
      isVisible: true,
      mode: "command",
      commands: [],
      pluginCommands: [],
      quickPrompts,
      isDraftContext: false,
      commandFilterQuery: "",
      activeSlashCommand: { start: 0, end: 1, query: "", position: "start" },
      activeFileMention: null,
      fileSuggestions: [],
      t: mockT,
    });

    const fixOption = options.find((o) => o.id === "fix");
    expect(fixOption).toBeDefined();
    expect(fixOption?.label).toBe("/fix");
    expect((fixOption as { detail?: string; description?: string; type?: string })?.detail).toBe(
      "修复报错",
    );
    expect(
      (fixOption as { detail?: string; description?: string; type?: string })?.description,
    ).toBe("请根据以上报错信息修复问题并验证。");
    expect((fixOption as { detail?: string; description?: string; type?: string })?.type).toBe(
      "quick_prompt",
    );

    const disabledOption = options.find((o) => o.id === "disabled");
    expect(disabledOption).toBeUndefined();
  });

  it("matches query against shortcut and label alias", () => {
    // Search by English shortcut 'fix'
    const matchByShortcut = buildCommandAutocompleteOptions({
      isVisible: true,
      mode: "command",
      commands: [],
      pluginCommands: [],
      quickPrompts,
      isDraftContext: false,
      commandFilterQuery: "fix",
      activeSlashCommand: { start: 0, end: 4, query: "fix", position: "start" },
      activeFileMention: null,
      fileSuggestions: [],
      t: mockT,
    });
    expect(matchByShortcut.map((o) => o.id)).toContain("fix");

    // Search by Chinese label '修复'
    const matchByLabel = buildCommandAutocompleteOptions({
      isVisible: true,
      mode: "command",
      commands: [],
      pluginCommands: [],
      quickPrompts,
      isDraftContext: false,
      commandFilterQuery: "修复",
      activeSlashCommand: { start: 0, end: 3, query: "修复", position: "start" },
      activeFileMention: null,
      fileSuggestions: [],
      t: mockT,
    });
    expect(matchByLabel.map((o) => o.id)).toContain("fix");
  });

  it("includes quick prompts even in inline slash position", () => {
    const options = buildCommandAutocompleteOptions({
      isVisible: true,
      mode: "command",
      commands: [],
      pluginCommands: [],
      quickPrompts,
      isDraftContext: false,
      commandFilterQuery: "fix",
      activeSlashCommand: { start: 5, end: 9, query: "fix", position: "inline" },
      activeFileMention: null,
      fileSuggestions: [],
      t: mockT,
    });

    expect(options.some((o) => o.id === "fix")).toBe(true);
  });
});
