import { describe, it, expect, vi } from "vitest";
import { executeQuickPrompt } from "../client/prompt-executor.js";
import type { ComposerApi } from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import type { QuickPromptItem } from "../shared/contracts.js";

function item(overrides: Partial<QuickPromptItem> = {}): QuickPromptItem {
  return {
    id: "item-1",
    label: "Prompt",
    content: "Do the thing",
    triggerType: "fixed",
    enabled: true,
    createdAt: 1,
    order: 0,
    ...overrides,
  };
}

function makeComposer(): ComposerApi & {
  submitText: ReturnType<typeof vi.fn>;
  insertText: ReturnType<typeof vi.fn>;
} {
  const submitText = vi.fn();
  const insertText = vi.fn();
  return { submitText, insertText };
}

function makePaseo(setModelImpl: () => Promise<void>): PaseoApi & { agents: any } {
  const setModel = vi.fn(setModelImpl);
  return {
    agents: {
      ref: vi.fn(() => ({ setModel })),
    },
  } as any;
}

describe("executeQuickPrompt", () => {
  it("submits directly when no target model", async () => {
    const composer = makeComposer();
    const paseo = makePaseo(async () => {});
    const result = await executeQuickPrompt({
      item: item(),
      agentId: "agent-1",
      paseo,
      composerApi: composer,
    });
    expect(result).toBe(true);
    expect(composer.submitText).toHaveBeenCalledWith("Do the thing");
  });

  it("switches model before submitting when target model is set", async () => {
    const composer = makeComposer();
    const setModel = vi.fn(async () => {});
    const ref = vi.fn(() => ({ setModel }));
    const paseo = { agents: { ref } } as any;
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: "agent-1",
      paseo,
      composerApi: composer,
      availableModelIds: ["claude-3-7-sonnet", "gpt-5.4"],
    });
    expect(result).toBe(true);
    expect(ref).toHaveBeenCalledWith("agent-1");
    expect(setModel).toHaveBeenCalledWith("claude-3-7-sonnet");
    expect(composer.submitText).toHaveBeenCalledWith("Do the thing");
  });

  it("blocks submission when target model is not available", async () => {
    const composer = makeComposer();
    const onToastError = vi.fn();
    const setModel = vi.fn(async () => {});
    const paseo = { agents: { ref: vi.fn(() => ({ setModel })) } } as any;
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: "agent-1",
      paseo,
      composerApi: composer,
      availableModelIds: ["gpt-5.4"],
      onToastError,
    });
    expect(result).toBe(false);
    expect(setModel).not.toHaveBeenCalled();
    expect(composer.submitText).not.toHaveBeenCalled();
    expect(onToastError).toHaveBeenCalledTimes(1);
  });

  it("blocks submission and toasts when setModel fails", async () => {
    const composer = makeComposer();
    const onToastError = vi.fn();
    const setModel = vi.fn(async () => {
      throw new Error("boom");
    });
    const paseo = { agents: { ref: vi.fn(() => ({ setModel })) } } as any;
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: "agent-1",
      paseo,
      composerApi: composer,
      availableModelIds: ["claude-3-7-sonnet"],
      onToastError,
    });
    expect(result).toBe(false);
    expect(composer.submitText).not.toHaveBeenCalled();
    expect(onToastError).toHaveBeenCalledTimes(1);
  });

  it("blocks when no agent id or paseo available", async () => {
    const composer = makeComposer();
    const onToastError = vi.fn();
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: null,
      paseo: null,
      composerApi: composer,
      onToastError,
    });
    expect(result).toBe(false);
    expect(composer.submitText).not.toHaveBeenCalled();
    expect(onToastError).toHaveBeenCalledTimes(1);
  });
});
