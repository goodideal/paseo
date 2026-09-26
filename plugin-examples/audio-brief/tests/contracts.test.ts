import { describe, expect, it } from "vitest";
import { audioBriefSynthesizeRpc } from "../shared/contracts.js";
import type { AudioBriefSynthesizeInput, AudioBriefSynthesizeOutput } from "../shared/types.js";

describe("audioBriefSynthesizeRpc", () => {
  it("has correct RPC name", () => {
    expect(audioBriefSynthesizeRpc.name).toBe("audio_brief.synthesize.request");
  });

  it("validates valid input payload", () => {
    const input: AudioBriefSynthesizeInput = {
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Completed refactoring task.",
      customPrompt: "Keep it under 30 words.",
      forceRefresh: true,
    };
    expect(audioBriefSynthesizeRpc.input.parse(input)).toEqual(input);
  });

  it("validates minimal valid input payload", () => {
    const minimalInput = {
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Completed refactoring task.",
    };
    expect(audioBriefSynthesizeRpc.input.parse(minimalInput)).toEqual(minimalInput);
  });

  it("rejects invalid input missing required fields", () => {
    const invalidInput = {
      agentId: "agent-1",
    };
    expect(() => audioBriefSynthesizeRpc.input.parse(invalidInput)).toThrow();
  });

  it("validates valid output payload", () => {
    const output: AudioBriefSynthesizeOutput = {
      briefText: "Summary of completed task.",
      audioBase64: "dGVzdA==",
      mimeType: "audio/wav",
      durationMs: 120,
      error: null,
    };
    expect(audioBriefSynthesizeRpc.output.parse(output)).toEqual(output);
  });

  it("validates minimal valid output payload", () => {
    const minimalOutput = {
      briefText: "Summary only.",
    };
    expect(audioBriefSynthesizeRpc.output.parse(minimalOutput)).toEqual(minimalOutput);
  });

  it("rejects invalid output missing briefText", () => {
    const invalidOutput = {
      audioBase64: "dGVzdA==",
    };
    expect(() => audioBriefSynthesizeRpc.output.parse(invalidOutput)).toThrow();
  });
});
