export interface PlayPlatformAudioParams {
  audioBase64?: string;
  mimeType?: string;
  fallbackText?: string;
  onEnded: () => void;
  onError: (err: Error) => void;
}

export function playPlatformAudio(params: PlayPlatformAudioParams): void {
  // Base environment / tests fallback
  params.onEnded();
}

export function stopPlatformAudio(): void {
  // Base environment / tests fallback
}
