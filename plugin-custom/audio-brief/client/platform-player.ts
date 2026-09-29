export interface PlayPlatformAudioParams {
  audioBase64?: string;
  mimeType?: string;
  fallbackText?: string;
  onEnded: () => void;
  onError: (err: Error) => void;
}

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
  URL?: {
    createObjectURL(blob: unknown): string;
    revokeObjectURL(url: string): void;
  };
  atob?(data: string): string;
  Uint8Array?: typeof Uint8Array;
  Blob?: new (parts: unknown[], options?: { type?: string }) => unknown;
  Audio?: new (src: string) => AudioElement;
  SpeechSynthesisUtterance?: new (text: string) => {
    lang?: string;
    onend?: (() => void) | null;
    onerror?: ((e: unknown) => void) | null;
    addEventListener?(type: string, listener: () => void, options?: { once?: boolean }): void;
  };
}

function getWindow(): WindowLike | null {
  if (typeof globalThis !== "undefined" && "window" in globalThis) {
    return (globalThis as unknown as { window: WindowLike }).window;
  }
  return null;
}

let currentAudio: AudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentEndedListener: (() => void) | null = null;
let currentErrorListener: (() => void) | null = null;
let currentUtterance: unknown = null;

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
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      // Ignored
    }
    currentAudio = null;
  }
  if (currentAudioUrl && w?.URL) {
    try {
      w.URL.revokeObjectURL(currentAudioUrl);
    } catch {
      // Ignored
    }
    currentAudioUrl = null;
  }
  if (w?.speechSynthesis) {
    try {
      w.speechSynthesis.cancel();
    } catch {
      // Ignored
    }
  }
  currentUtterance = null;
}

function base64ToBlob(w: WindowLike, base64: string, mimeType: string): unknown {
  if (!w.atob || !w.Uint8Array || !w.Blob) return null;
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

  // 1. If base64 audio payload is provided and Audio is supported, play via HTML5 Audio
  if (params.audioBase64 && w?.Audio && w.URL?.createObjectURL) {
    try {
      const mime = params.mimeType || "audio/wav";
      const blob = base64ToBlob(w, params.audioBase64, mime);
      if (blob) {
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
      }
    } catch (err: unknown) {
      stopPlatformAudio();
      params.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
  }

  // 2. If fallback text is available and browser SpeechSynthesis is supported, synthesize speech
  if (params.fallbackText && w?.speechSynthesis && w.SpeechSynthesisUtterance) {
    try {
      const utterance = new w.SpeechSynthesisUtterance(params.fallbackText);
      currentUtterance = utterance;

      if (/[一-龥]/.test(params.fallbackText)) {
        utterance.lang = "zh-CN";
      }

      const onEnd = () => {
        currentUtterance = null;
        params.onEnded();
      };
      const onError = () => {
        currentUtterance = null;
        params.onError(new Error("Speech synthesis failed"));
      };

      utterance.onend = onEnd;
      utterance.onerror = onError;
      if (typeof utterance.addEventListener === "function") {
        utterance.addEventListener("end", onEnd, { once: true });
        utterance.addEventListener("error", onError, { once: true });
      }

      w.speechSynthesis.speak(utterance);
      return;
    } catch (err: unknown) {
      currentUtterance = null;
      params.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
  }

  // 3. Fallback for non-audio or unsupported environments
  params.onEnded();
}
