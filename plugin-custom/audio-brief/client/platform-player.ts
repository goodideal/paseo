export interface PlayPlatformAudioParams {
  audioBase64?: string;
  mimeType?: string;
  fallbackText?: string;
  onEnded: () => void;
  onError: (err: Error) => void;
}

// Base fallback for tests and environments without audio support.
export function playPlatformAudio(params: PlayPlatformAudioParams): void {
  params.onEnded();
}

export function stopPlatformAudio(): void {
  // no-op in base environment
}
