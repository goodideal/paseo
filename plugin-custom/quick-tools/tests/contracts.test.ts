import { describe, expect, it } from "vitest";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  quickPromptsSettings,
  quickPromptsWorkspaceLabelsSyncRpc,
  DEFAULT_QUICK_PROMPT_ITEMS,
  QuickPromptItemSchema,
} from "../shared/contracts.js";

describe("quick-tools contracts", () => {
  it("defines correct RPC names", () => {
    expect(quickPromptsGlobalGetRpc.name).toBe("quick_tools.prompts.global.get.request");
    expect(quickPromptsGlobalSetRpc.name).toBe("quick_tools.prompts.global.set.request");
    expect(quickPromptsProjectGetRpc.name).toBe("quick_tools.prompts.project.get.request");
    expect(quickPromptsProjectSetRpc.name).toBe("quick_tools.prompts.project.set.request");
    expect(quickPromptsWorkspaceLabelsSyncRpc.name).toBe(
      "quick_tools.workspace_labels.sync.request",
    );
  });

  it("defaults autoLabelWorkspaces and label colors in settings schema", () => {
    expect(quickPromptsSettings.schema.parse({})).toEqual({
      aiSuggestions: true,
      autoLabelWorkspaces: true,
      localLabelColor: "sky",
      worktreeLabelColor: "violet",
    });
    expect(quickPromptsSettings.schema.parse({ aiSuggestions: false })).toEqual({
      aiSuggestions: false,
      autoLabelWorkspaces: true,
      localLabelColor: "sky",
      worktreeLabelColor: "violet",
    });
    expect(
      quickPromptsSettings.schema.parse({
        localLabelColor: "emerald",
        worktreeLabelColor: "amber",
      }),
    ).toEqual({
      aiSuggestions: true,
      autoLabelWorkspaces: true,
      localLabelColor: "emerald",
      worktreeLabelColor: "amber",
    });
    expect(
      quickPromptsSettings.schema.safeParse({
        localLabelColor: "invalid-color",
      }).success,
    ).toBe(false);
  });

  it("validates workspace labels sync RPC payloads including custom label colors", () => {
    expect(quickPromptsWorkspaceLabelsSyncRpc.input.parse(undefined)).toEqual({});
    expect(quickPromptsWorkspaceLabelsSyncRpc.input.parse({ force: true })).toEqual({
      force: true,
    });
    expect(
      quickPromptsWorkspaceLabelsSyncRpc.input.parse({
        force: true,
        localLabelColor: "teal",
        worktreeLabelColor: "orange",
      }),
    ).toEqual({
      force: true,
      localLabelColor: "teal",
      worktreeLabelColor: "orange",
    });
    expect(quickPromptsWorkspaceLabelsSyncRpc.output.parse({ tagged: 2, skipped: 1 })).toEqual({
      tagged: 2,
      skipped: 1,
    });
  });

  it("validates default quick prompt items", () => {
    expect(DEFAULT_QUICK_PROMPT_ITEMS.length).toBeGreaterThan(0);
    for (const item of DEFAULT_QUICK_PROMPT_ITEMS) {
      expect(QuickPromptItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("supports optional targetModelId in QuickPromptItemSchema", () => {
    const itemWithModel = {
      id: "custom-model",
      label: "Model Prompt",
      content: "Do this with opus",
      triggerType: "fixed" as const,
      enabled: true,
      createdAt: 100,
      order: 0,
      targetModelId: "claude-3-7-sonnet",
    };
    const parsed = QuickPromptItemSchema.parse(itemWithModel);
    expect(parsed.targetModelId).toBe("claude-3-7-sonnet");
  });

  it("validates global get/set RPC payloads", () => {
    const defaultGet = quickPromptsGlobalGetRpc.input.parse({});
    expect(defaultGet).toEqual({});

    const setInput = {
      items: [
        {
          id: "custom-1",
          label: "Custom",
          content: "Custom text",
          triggerType: "fixed" as const,
          enabled: true,
          createdAt: 100,
          order: 0,
        },
      ],
    };
    expect(quickPromptsGlobalSetRpc.input.parse(setInput)).toEqual(setInput);
    const setOutput = {
      items: setInput.items,
      success: true,
    };
    expect(quickPromptsGlobalSetRpc.output.parse(setOutput)).toEqual(setOutput);
  });

  it("validates project get/set RPC payloads", () => {
    const getInput = { projectId: "proj-1" };
    expect(quickPromptsProjectGetRpc.input.parse(getInput)).toEqual(getInput);

    const getOutput = {
      projectId: "proj-1",
      items: [],
      disabledGlobalIds: ["builtin-continue"],
      order: ["builtin-review"],
    };
    expect(quickPromptsProjectGetRpc.output.parse(getOutput)).toEqual(getOutput);

    const setInput = {
      projectId: "proj-1",
      disabledGlobalIds: ["builtin-continue"],
    };
    expect(quickPromptsProjectSetRpc.input.parse(setInput)).toEqual(setInput);

    const setOutput = {
      projectId: "proj-1",
      items: [],
      disabledGlobalIds: ["builtin-continue"],
      success: true,
    };
    expect(quickPromptsProjectSetRpc.output.parse(setOutput)).toEqual(setOutput);
  });
});
