import { create } from "zustand";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { playPlatformAudio, stopPlatformAudio } from "./platform-player";

export type AudioBriefStatus = "idle" | "loading" | "playing";

interface AudioBriefState {
  currentTurnId: string | null;
  status: AudioBriefStatus;
  briefText: string | null;
  error: string | null;

  playBrief: (params: {
    client: DaemonClient;
    agentId: string;
    turnId: string;
    text: string;
    forceRefresh?: boolean;
  }) => Promise<void>;

  stopBrief: () => void;
}

export const useAudioBriefStore = create<AudioBriefState>((set, get) => ({
  currentTurnId: null,
  status: "idle",
  briefText: null,
  error: null,

  playBrief: async ({ client, agentId, turnId, text, forceRefresh }) => {
    const state = get();

    // Toggle off if already playing/loading this exact turn
    if (
      state.currentTurnId === turnId &&
      (state.status === "playing" || state.status === "loading")
    ) {
      get().stopBrief();
      return;
    }

    // Stop previous audio if any
    stopPlatformAudio();

    set({
      currentTurnId: turnId,
      status: "loading",
      briefText: null,
      error: null,
    });

    try {
      const response = await client.synthesizeAgentMessageBrief(agentId, turnId, text, {
        forceRefresh,
      });

      // If user navigated away or stopped while waiting
      if (get().currentTurnId !== turnId) {
        return;
      }

      if (response.error) {
        set({
          status: "idle",
          currentTurnId: null,
          briefText: null,
          error: response.error,
        });
        return;
      }

      set({
        status: "playing",
        briefText: response.briefText,
        error: null,
      });

      playPlatformAudio({
        audioBase64: response.audioBase64,
        mimeType: response.mimeType,
        fallbackText: response.briefText,
        onEnded: () => {
          if (get().currentTurnId === turnId) {
            set({
              status: "idle",
              currentTurnId: null,
              briefText: null,
              error: null,
            });
          }
        },
        onError: (err) => {
          if (get().currentTurnId === turnId) {
            set({
              status: "idle",
              currentTurnId: null,
              briefText: null,
              error: err.message,
            });
          }
        },
      });
    } catch (err) {
      if (get().currentTurnId === turnId) {
        set({
          status: "idle",
          currentTurnId: null,
          briefText: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },

  stopBrief: () => {
    stopPlatformAudio();
    set({
      currentTurnId: null,
      status: "idle",
      briefText: null,
      error: null,
    });
  },
}));
