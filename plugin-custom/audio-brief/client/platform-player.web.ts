import type { PlayPlatformAudioParams } from "./platform-player.js";

// DOM type shims for non-dom lib environments (tsconfig.examples.json uses lib: ES2023 only).
// Metro resolves .web.ts only for web builds where DOM is actually available at runtime.
interface AudioElement {
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface WindowLike {
  speechSynthesis?: {
    cancel(): void;
    speak(utterance: unknown): void;
  };
  URL: {
    createObjectURL(blob: unknown): string;
    revokeObjectURL(url: string): void;
  };
  atob(data: string): string;
  Uint8Array: typeof Uint8Array;
  Blob: new (parts: unknown[], options?: { type?: string }) => unknown;
  Audio: new (src: string) => AudioElement;
  SpeechSynthesisUtterance: new (text: string) => {
    addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  };
}

function getWindow(): WindowLike | null {
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    return globalThis as unknown as WindowLike;
  }
  return null;
}

let currentAudio: AudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentEndedListener: (() => void) | null = null;
let currentErrorListener: (() => void) | null = null;

export function stopPlatformAudio(): void {
  const w = getWindow();
  if (currentAudio) {
    if (currentEndedListener) {
      currentAudio.removeEventListener("ended", currentEndedListener);
      currentEndedListener = null;
    }
    if (currentErrorListener) {
      currentAudio.removeEventListener("error", currentErrorListener);
      currentErrorListener = null;
    }
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (currentAudioUrl && w) {
    w.URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  if (w?.speechSynthesis) {
    w.speechSynthesis.cancel();
  }
}

function base64ToBlob(w: WindowLike, base64: string, mimeType: string): unknown {
  const binaryString = w.atob(base64);
  const bytes = new w.Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new w.Blob([bytes], { type: mimeType });
}

export function playPlatformAudio(params: PlayPlatformAudioParams): void {
  stopPlatformAudio();
  const w = getWindow();

  if (params.audioBase64 && w) {
    try {
      const mime = params.mimeType || "audio/wav";
      const blob = base64ToBlob(w, params.audioBase64, mime);
      const url = w.URL.createObjectURL(blob);
      currentAudioUrl = url;

      const audio = new w.Audio(url);
      currentAudio = audio;

      const onEnded = () => {
        stopPlatformAudio();
        params.onEnded();
      };
      currentEndedListener = onEnded;
      audio.addEventListener("ended", onEnded, { once: true });

      const onError = () => {
        stopPlatformAudio();
        params.onError(new Error("Audio playback failed"));
      };
      currentErrorListener = onError;
      audio.addEventListener("error", onError, { once: true });

      audio.play().catch((err: unknown) => {
        stopPlatformAudio();
        params.onError(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    } catch (err: unknown) {
      stopPlatformAudio();
      params.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
  }

  if (params.fallbackText && w?.speechSynthesis) {
    const utterance = new w.SpeechSynthesisUtterance(params.fallbackText);
    utterance.addEventListener("end", () => params.onEnded(), { once: true });
    utterance.addEventListener(
      "error",
      () => params.onError(new Error("Speech synthesis failed")),
      { once: true },
    );
    w.speechSynthesis.speak(utterance);
    return;
  }

  params.onEnded();
}
