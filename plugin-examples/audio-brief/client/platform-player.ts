export interface PlayPlatformAudioParams {
  audioBase64?: string;
  mimeType?: string;
  fallbackText?: string;
  onEnded: () => void;
  onError: (err: Error) => void;
}

let activeAudio: unknown = null;

export function playPlatformAudio(params: PlayPlatformAudioParams): void {
  stopPlatformAudio();

  const globalScope = globalThis as unknown as {
    window?: unknown;
    Audio?: new (src: string) => {
      play: () => Promise<void>;
      pause: () => void;
      currentTime: number;
      onended: (() => void) | null;
      onerror: (() => void) | null;
    };
  };

  if (globalScope.window && globalScope.Audio && params.audioBase64) {
    try {
      const mime = params.mimeType || "audio/wav";
      const src = `data:${mime};base64,${params.audioBase64}`;
      const audio = new globalScope.Audio(src);
      activeAudio = audio;

      audio.onended = () => {
        activeAudio = null;
        params.onEnded();
      };

      audio.onerror = () => {
        activeAudio = null;
        params.onError(new Error("Audio playback failed"));
      };

      void audio.play().catch((err: unknown) => {
        activeAudio = null;
        params.onError(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    } catch (e: unknown) {
      params.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
  }

  // Non-browser or tests fallback
  params.onEnded();
}

export function stopPlatformAudio(): void {
  if (activeAudio) {
    try {
      const audio = activeAudio as { pause: () => void; currentTime: number };
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // ignore
    }
    activeAudio = null;
  }
}
