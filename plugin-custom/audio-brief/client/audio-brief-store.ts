import { create } from "zustand";
import { playPlatformAudio, stopPlatformAudio } from "./platform-player.js";
import type { AudioBriefSynthesizeInput, AudioBriefSynthesizeOutput } from "../shared/contracts.js";

export type AudioBriefStatus = "idle" | "loading" | "playing";

export interface AudioBriefState {
  currentTurnId: string | null;
  status: AudioBriefStatus;
  briefText: string | null;
  audioBase64: string | null;
  mimeType: string | null;
  error: string | null;

  playBrief: (params: {
    callRpc: (input: AudioBriefSynthesizeInput) => Promise<AudioBriefSynthesizeOutput>;
    agentId: string;
    turnId: string;
    text: string;
    forceRefresh?: boolean;
  }) => Promise<void>;

  stopBrief: () => void;
  pauseAudio: () => void;
  replayAudio: () => void;
}

export const useAudioBriefStore = create<AudioBriefState>((set, get) => ({
  currentTurnId: null,
  status: "idle",
  briefText: null,
  audioBase64: null,
  mimeType: null,
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
      audioBase64: null,
      mimeType: null,
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
          audioBase64: null,
          mimeType: null,
          error: response.error,
        });
        return;
      }

      set({
        status: "playing",
        briefText: response.briefText,
        audioBase64: response.audioBase64 ?? null,
        mimeType: response.mimeType ?? null,
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
            });
          }
        },
        onError: (err) => {
          if (get().currentTurnId === turnId) {
            set({
              status: "idle",
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
          audioBase64: null,
          mimeType: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },

  replayAudio: () => {
    const state = get();
    if (!state.currentTurnId || (!state.audioBase64 && !state.briefText)) {
      return;
    }
    stopPlatformAudio();
    set({ status: "playing", error: null });
    playPlatformAudio({
      audioBase64: state.audioBase64 ?? undefined,
      mimeType: state.mimeType ?? undefined,
      fallbackText: state.briefText ?? undefined,
      onEnded: () => {
        set({ status: "idle" });
      },
      onError: (err) => {
        set({ status: "idle", error: err.message });
      },
    });
  },

  pauseAudio: () => {
    stopPlatformAudio();
    set({
      status: "idle",
    });
  },

  stopBrief: () => {
    stopPlatformAudio();
    set({
      currentTurnId: null,
      status: "idle",
      briefText: null,
      audioBase64: null,
      mimeType: null,
      error: null,
    });
  },
}));
