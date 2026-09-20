import type { PlayPlatformAudioParams } from "./platform-player";

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentEndedListener: (() => void) | null = null;
let currentErrorListener: (() => void) | null = null;

export function stopPlatformAudio(): void {
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
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function playPlatformAudio(params: PlayPlatformAudioParams): void {
  stopPlatformAudio();

  if (params.audioBase64) {
    try {
      const mime = params.mimeType || "audio/wav";
      const blob = base64ToBlob(params.audioBase64, mime);
      const url = URL.createObjectURL(blob);
      currentAudioUrl = url;

      const audio = new Audio(url);
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

      audio.play().catch((err) => {
        stopPlatformAudio();
        params.onError(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    } catch (err) {
      stopPlatformAudio();
      params.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
  }

  if (params.fallbackText && typeof window !== "undefined" && window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(params.fallbackText);
    utterance.addEventListener("end", () => params.onEnded(), { once: true });
    utterance.addEventListener(
      "error",
      () => params.onError(new Error("Speech synthesis failed")),
      { once: true },
    );
    window.speechSynthesis.speak(utterance);
    return;
  }

  params.onEnded();
}
