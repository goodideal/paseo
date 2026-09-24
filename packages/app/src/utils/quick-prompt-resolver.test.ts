import { describe, it, expect } from "vitest";
import {
  resolveEffectiveQuickPrompts,
  resolveActiveAgentProfileIds,
} from "./quick-prompt-resolver";
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

  describe("resolveActiveAgentProfileIds", () => {
    const mockProfiles = [
      {
        id: "p1",
        name: "Claude Code",
        provider: "claude",
        model: "claude-3-7-sonnet",
        modeId: "plan",
      },
      {
        id: "p2",
        name: "Codex Fast",
        provider: "codex",
        model: "gpt-5",
      },
      {
        id: "p3",
        name: "General Reviewer",
        provider: "codex",
      },
    ];

    it("returns empty array when agent is null or undefined", () => {
      expect(resolveActiveAgentProfileIds(null, mockProfiles)).toEqual([]);
      expect(resolveActiveAgentProfileIds(undefined, mockProfiles)).toEqual([]);
    });

    it("matches by labels if present", () => {
      const agent = {
        labels: { profileId: "custom-profile", profile: "Custom Name" },
      };
      const result = resolveActiveAgentProfileIds(agent, mockProfiles);
      expect(result).toContain("custom-profile");
      expect(result).toContain("Custom Name");
    });

    it("matches profiles by provider, model, and mode", () => {
      const agent = {
        provider: "claude",
        model: "claude-3-7-sonnet",
        currentModeId: "plan",
      };
      const result = resolveActiveAgentProfileIds(agent, mockProfiles);
      expect(result).toContain("p1");
      expect(result).toContain("Claude Code");
      expect(result).not.toContain("p2");
    });

    it("matches profiles where model/mode are optional or unspecified in profile", () => {
      const agent = {
        provider: "codex",
        model: "any-model",
      };
      const result = resolveActiveAgentProfileIds(agent, mockProfiles);
      expect(result).toContain("p3");
      expect(result).toContain("General Reviewer");
    });
  });

  it("filters effective quick prompts by agentProfileId", () => {
    const profileItem: QuickPromptItem = {
      id: "profile-prompt",
      label: "Profile Only",
      content: "Do profile work",
      triggerType: "rule",
      ruleCondition: {
        agentProfiles: ["p1"],
      },
      enabled: true,
      createdAt: 20,
      order: 0,
    };

    const resultMatching = resolveEffectiveQuickPrompts({
      globalItems: [...globalItems, profileItem],
      agentProfileId: "p1",
    });
    expect(resultMatching.map((i) => i.id)).toContain("profile-prompt");

    const resultNotMatching = resolveEffectiveQuickPrompts({
      globalItems: [...globalItems, profileItem],
      agentProfileId: "p2",
    });
    expect(resultNotMatching.map((i) => i.id)).not.toContain("profile-prompt");
  });

  it("strictly places project items before global items regardless of their individual order integers", () => {
    const projectItems: QuickPromptItem[] = [
      {
        id: "project-1",
        label: "Project Item 1",
        content: "content",
        triggerType: "fixed",
        enabled: true,
        createdAt: 10,
        order: 5,
      },
      {
        id: "project-2",
        label: "Project Item 2",
        content: "content",
        triggerType: "fixed",
        enabled: true,
        createdAt: 11,
        order: 10,
      },
    ];

    const result = resolveEffectiveQuickPrompts({
      globalItems,
      projectItems,
      disabledGlobalIds: [],
    });

    expect(result.map((i) => i.id)).toEqual(["project-1", "project-2", "global-1", "global-2"]);
  });

  it("respects explicit order array for project items", () => {
    const projectItems: QuickPromptItem[] = [
      {
        id: "project-1",
        label: "Project Item 1",
        content: "content",
        triggerType: "fixed",
        enabled: true,
        createdAt: 10,
        order: 0,
      },
      {
        id: "project-2",
        label: "Project Item 2",
        content: "content",
        triggerType: "fixed",
        enabled: true,
        createdAt: 11,
        order: 1,
      },
    ];

    const result = resolveEffectiveQuickPrompts({
      globalItems: [],
      projectItems,
      order: ["project-2", "project-1"],
    });

    expect(result.map((i) => i.id)).toEqual(["project-2", "project-1"]);
  });
});
