import { describe, it, expect, vi } from "vitest";
import { executeQuickPrompt } from "../client/prompt-executor.js";
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

function makePaseo(
  setModelImpl: () => Promise<void> = async () => {},
  sendImpl: (text: string) => Promise<void> = async () => {},
) {
  const setModel = vi.fn(setModelImpl);
  const send = vi.fn(sendImpl);
  const ref = vi.fn(() => ({ setModel, send }));
  return {
    agents: { ref },
    setModel,
    send,
    ref,
  };
}

describe("executeQuickPrompt", () => {
  it("submits directly through paseo.agents.ref(agentId).send when no target model", async () => {
    const paseo = makePaseo();
    const result = await executeQuickPrompt({
      item: item(),
      agentId: "agent-1",
      paseo: paseo as unknown as PaseoApi,
    });
    expect(result).toBe(true);
    expect(paseo.ref).toHaveBeenCalledWith("agent-1");
    expect(paseo.send).toHaveBeenCalledWith("Do the thing");
  });

  it("switches model before sending when target model is set", async () => {
    const paseo = makePaseo();
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: "agent-1",
      paseo: paseo as unknown as PaseoApi,
      availableModelIds: ["claude-3-7-sonnet", "gpt-5.4"],
    });
    expect(result).toBe(true);
    expect(paseo.ref).toHaveBeenCalledWith("agent-1");
    expect(paseo.setModel).toHaveBeenCalledWith("claude-3-7-sonnet");
    expect(paseo.send).toHaveBeenCalledWith("Do the thing");
  });

  it("blocks submission when target model is not available", async () => {
    const paseo = makePaseo();
    const onToastError = vi.fn();
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: "agent-1",
      paseo: paseo as unknown as PaseoApi,
      availableModelIds: ["gpt-5.4"],
      onToastError,
    });
    expect(result).toBe(false);
    expect(paseo.setModel).not.toHaveBeenCalled();
    expect(paseo.send).not.toHaveBeenCalled();
    expect(onToastError).toHaveBeenCalledTimes(1);
  });

  it("blocks submission and toasts when setModel fails", async () => {
    const onToastError = vi.fn();
    const paseo = makePaseo(async () => {
      throw new Error("boom");
    });
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: "agent-1",
      paseo: paseo as unknown as PaseoApi,
      availableModelIds: ["claude-3-7-sonnet"],
      onToastError,
    });
    expect(result).toBe(false);
    expect(paseo.send).not.toHaveBeenCalled();
    expect(onToastError).toHaveBeenCalledTimes(1);
  });

  it("blocks when no agent id or paseo available and no onSendText", async () => {
    const onToastError = vi.fn();
    const result = await executeQuickPrompt({
      item: item({ targetModelId: "claude-3-7-sonnet" }),
      agentId: null,
      paseo: null,
      onToastError,
    });
    expect(result).toBe(false);
    expect(onToastError).toHaveBeenCalledTimes(1);
  });

  it("supports onSendText callback if provided", async () => {
    const onSendText = vi.fn();
    const result = await executeQuickPrompt({
      item: item(),
      agentId: null,
      paseo: null,
      onSendText,
    });
    expect(result).toBe(true);
    expect(onSendText).toHaveBeenCalledWith("Do the thing");
  });
});
