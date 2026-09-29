import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import contribute from "../index.client.js";
import type {
  PluginClientContext,
  PluginTurnActionContribution,
  PluginSettingsScreenContribution,
} from "@getpaseo/plugin/client";
import { useAudioBriefStore } from "../client/audio-brief-store.js";
import { playPlatformAudio, stopPlatformAudio } from "../client/platform-player.js";
import { AudioBriefCard } from "../client/audio-brief-card.js";

describe("Audio Brief Client", () => {
  beforeEach(() => {
    useAudioBriefStore.getState().stopBrief();
  });

  it("registers settings screen, button, and card turn actions with cleanups", () => {
    const actions: PluginTurnActionContribution[] = [];
    const screens: PluginSettingsScreenContribution[] = [];
    const client: Partial<PluginClientContext> = {
      addSettingsScreen: vi.fn((screen: PluginSettingsScreenContribution) => {
        screens.push(screen);
        return () => {
          const idx = screens.indexOf(screen);
          if (idx !== -1) screens.splice(idx, 1);
        };
      }),
      addTurnAction: vi.fn((action: PluginTurnActionContribution) => {
        actions.push(action);
        return () => {
          const idx = actions.indexOf(action);
          if (idx !== -1) actions.splice(idx, 1);
        };
      }),
    };

    const cleanup = contribute(client as PluginClientContext);
    expect(client.addSettingsScreen).toHaveBeenCalledTimes(1);
    expect(screens[0]?.id).toBe("audio-brief-settings");
    expect(screens[0]?.icon).toBe("Volume2");
    expect(client.addTurnAction).toHaveBeenCalledTimes(2);
    expect(actions.find((a) => a.type === "button")?.id).toBe("audio-brief-button");
    expect(actions.find((a) => a.type === "card")?.id).toBe("audio-brief-card");

    cleanup();
    expect(screens).toHaveLength(0);
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

    // After audio playback completes, briefText and currentTurnId must remain so the card is readable
    expect(useAudioBriefStore.getState().briefText).toBe("Synthesized audio brief summary.");
    expect(useAudioBriefStore.getState().currentTurnId).toBe("turn-1");
    expect(useAudioBriefStore.getState().status).toBe("idle");

    // Stopping the brief clears the store completely
    store.stopBrief();
    expect(useAudioBriefStore.getState().briefText).toBeNull();
    expect(useAudioBriefStore.getState().currentTurnId).toBeNull();
    expect(useAudioBriefStore.getState().status).toBe("idle");
  });

  it("plays speech synthesis when fallback text is provided in browser environment", () => {
    let spokenUtterance: any = null;
    const cancelMock = vi.fn();
    const speakMock = vi.fn((utt) => {
      spokenUtterance = utt;
    });

    class MockSpeechSynthesisUtterance {
      text: string;
      lang?: string;
      onend?: (() => void) | null;
      onerror?: ((e: unknown) => void) | null;
      constructor(text: string) {
        this.text = text;
      }
    }

    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      speechSynthesis: {
        speak: speakMock,
        cancel: cancelMock,
      },
      SpeechSynthesisUtterance: MockSpeechSynthesisUtterance,
    };

    try {
      const onEnded = vi.fn();
      const onError = vi.fn();

      playPlatformAudio({
        fallbackText: "这是一个测试简报",
        onEnded,
        onError,
      });

      expect(speakMock).toHaveBeenCalledTimes(1);
      expect(spokenUtterance).toBeDefined();
      expect(spokenUtterance.text).toBe("这是一个测试简报");
      expect(spokenUtterance.lang).toBe("zh-CN");
      expect(onEnded).not.toHaveBeenCalled();

      // Simulate completion
      spokenUtterance.onend();
      expect(onEnded).toHaveBeenCalledTimes(1);

      // Stop calls cancel
      stopPlatformAudio();
      expect(cancelMock).toHaveBeenCalled();
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it("plays base64 audio when audioBase64 is provided", () => {
    let playCalled = false;
    let endedCallback: (() => void) | null = null;
    const pauseMock = vi.fn();

    class MockAudio {
      src: string;
      currentTime = 0;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        playCalled = true;
        return Promise.resolve();
      }
      pause() {
        pauseMock();
      }
      addEventListener(type: string, listener: () => void) {
        if (type === "ended") endedCallback = listener;
      }
      removeEventListener() {}
    }

    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      Audio: MockAudio,
      URL: {
        createObjectURL: vi.fn(() => "blob:http://localhost/test"),
        revokeObjectURL: vi.fn(),
      },
      atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
      Uint8Array,
      Blob,
    };

    try {
      const onEnded = vi.fn();
      const onError = vi.fn();

      playPlatformAudio({
        audioBase64: "dGVzdA==",
        mimeType: "audio/wav",
        fallbackText: "Test",
        onEnded,
        onError,
      });

      expect(playCalled).toBe(true);
      expect(onEnded).not.toHaveBeenCalled();

      if (endedCallback) {
        (endedCallback as () => void)();
      }
      expect(onEnded).toHaveBeenCalledTimes(1);

      stopPlatformAudio();
      expect(pauseMock).toHaveBeenCalled();
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
