import { describe, expect, it } from "vitest";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  DEFAULT_QUICK_PROMPT_ITEMS,
  QuickPromptItemSchema,
} from "../shared/contracts.js";

describe("quick-prompts contracts", () => {
  it("defines correct RPC names", () => {
    expect(quickPromptsGlobalGetRpc.name).toBe("quick_prompts.global.get.request");
    expect(quickPromptsGlobalSetRpc.name).toBe("quick_prompts.global.set.request");
    expect(quickPromptsProjectGetRpc.name).toBe("quick_prompts.project.get.request");
    expect(quickPromptsProjectSetRpc.name).toBe("quick_prompts.project.set.request");
  });

  it("validates default quick prompt items", () => {
    expect(DEFAULT_QUICK_PROMPT_ITEMS.length).toBeGreaterThan(0);
    for (const item of DEFAULT_QUICK_PROMPT_ITEMS) {
      expect(QuickPromptItemSchema.safeParse(item).success).toBe(true);
    }
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
