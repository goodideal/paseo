import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import contribute from "../index.client.js";
import type { PluginClientContext, PluginTurnActionContribution } from "@getpaseo/plugin/client";
import { useAudioBriefStore } from "../client/audio-brief-store.js";

describe("Audio Brief Client", () => {
  beforeEach(() => {
    useAudioBriefStore.getState().stopBrief();
  });

  it("registers both button and card turn actions with cleanups", () => {
    const actions: PluginTurnActionContribution[] = [];
    const client: Partial<PluginClientContext> = {
      addTurnAction: vi.fn((action: PluginTurnActionContribution) => {
        actions.push(action);
        return () => {
          const idx = actions.indexOf(action);
          if (idx !== -1) actions.splice(idx, 1);
        };
      }),
    };

    const cleanup = contribute(client as PluginClientContext);
    expect(client.addTurnAction).toHaveBeenCalledTimes(2);
    expect(actions.find((a) => a.type === "button")?.id).toBe("audio-brief-button");
    expect(actions.find((a) => a.type === "card")?.id).toBe("audio-brief-card");

    cleanup();
    expect(actions).toHaveLength(0);
  });

  it("handles audio brief store state transitions", async () => {
    const fakeRpc = vi.fn().mockResolvedValue({
      briefText: "Synthesized audio brief summary.",
      audioBase64: "dGVzdA==",
      mimeType: "audio/wav",
      durationMs: 150,
      error: null,
    });

    const store = useAudioBriefStore.getState();
    expect(store.status).toBe("idle");
    expect(store.currentTurnId).toBeNull();

    const promise = store.playBrief({
      callRpc: fakeRpc,
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Completed task message.",
    });

    expect(useAudioBriefStore.getState().status).toBe("loading");
    expect(useAudioBriefStore.getState().currentTurnId).toBe("turn-1");

    await promise;

    // After playback finishes / mocks complete
    expect(fakeRpc).toHaveBeenCalledWith({
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Completed task message.",
      forceRefresh: undefined,
    });
  });
});
