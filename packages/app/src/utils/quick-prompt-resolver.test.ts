import { describe, it, expect } from "vitest";
import { resolveEffectiveQuickPrompts } from "./quick-prompt-resolver";
import type { QuickPromptItem } from "@getpaseo/protocol/quick-prompts";

describe("quick-prompt-resolver", () => {
  const globalItems: QuickPromptItem[] = [
    {
      id: "global-1",
      label: "Continue",
      content: "Please continue",
      triggerType: "fixed",
      enabled: true,
      createdAt: 1,
      order: 0,
    },
    {
      id: "global-2",
      label: "Review",
      content: "Please review",
      triggerType: "fixed",
      enabled: true,
      createdAt: 2,
      order: 1,
    },
    {
      id: "global-disabled",
      label: "Disabled Globally",
      content: "Do not show",
      triggerType: "fixed",
      enabled: false,
      createdAt: 3,
      order: 2,
    },
  ];

  it("inherits all active global items by default when project has no items", () => {
    const result = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems: [],
      disabledGlobalIds: [],
    });

    expect(result.map((i) => i.id)).toEqual(["global-1", "global-2"]);
  });

  it("filters out global items that are disabled in project", () => {
    const result = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems: [],
      disabledGlobalIds: ["global-1"],
    });

    expect(result.map((i) => i.id)).toEqual(["global-2"]);
  });

  it("prepends project items before global items", () => {
    const projectItems: QuickPromptItem[] = [
      {
        id: "project-1",
        label: "Cargo Test",
        content: "cargo test",
        triggerType: "fixed",
        enabled: true,
        createdAt: 10,
        order: 0,
      },
    ];

    const result = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems,
      disabledGlobalIds: ["global-2"],
    });

    expect(result.map((i) => i.id)).toEqual(["project-1", "global-1"]);
  });

  it("evaluates rules on both project and global items", () => {
    const projectItems: QuickPromptItem[] = [
      {
        id: "project-rule",
        label: "Fix Rust Error",
        content: "Fix the rust compiler error",
        triggerType: "rule",
        ruleCondition: {
          keywords: ["rustc", "borrow"],
        },
        enabled: true,
        createdAt: 10,
        order: 0,
      },
    ];

    // Case 1: no error in assistant message
    const noMatch = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems,
      lastAssistantText: "The build succeeded cleanly.",
      agentStatus: "idle",
    });
    expect(noMatch.map((i) => i.id)).toEqual(["global-1", "global-2"]);

    // Case 2: error keyword present
    const match = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems,
      lastAssistantText: "error: rustc failed with borrow check error",
      agentStatus: "idle",
    });
    expect(match.map((i) => i.id)).toEqual(["project-rule", "global-1", "global-2"]);
  });
});
