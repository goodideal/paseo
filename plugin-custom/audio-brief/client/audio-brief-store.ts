import { create } from "zustand";
import { playPlatformAudio, stopPlatformAudio } from "./platform-player.js";
import type { AudioBriefSynthesizeInput, AudioBriefSynthesizeOutput } from "../shared/contracts.js";

export type AudioBriefStatus = "idle" | "loading" | "playing";

export interface AudioBriefState {
  currentTurnId: string | null;
  status: AudioBriefStatus;
  briefText: string | null;
  error: string | null;

  playBrief: (params: {
    callRpc: (input: AudioBriefSynthesizeInput) => Promise<AudioBriefSynthesizeOutput>;
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

  playBrief: async ({ callRpc, agentId, turnId, text, forceRefresh }) => {
    const state = get();

    if (
      state.currentTurnId === turnId &&
      (state.status === "playing" || state.status === "loading")
    ) {
      get().stopBrief();
      return;
    }

    stopPlatformAudio();

    set({
      currentTurnId: turnId,
      status: "loading",
      briefText: null,
      error: null,
    });

    try {
      const response = await callRpc({
        agentId,
        turnId,
        text,
        forceRefresh,
      });

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
