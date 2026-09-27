import type { PlayPlatformAudioParams } from "./platform-player.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentPlayer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSubscription: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentTempFile: any = null;

function cleanupCurrentPlayer(): void {
  if (currentSubscription) {
    try {
      currentSubscription.remove();
    } catch {
      // Ignored
    }
    currentSubscription = null;
  }
  if (currentPlayer) {
    try {
      currentPlayer.pause();
      currentPlayer.remove();
    } catch {
      // Ignored
    }
    currentPlayer = null;
  }
  if (currentTempFile) {
    try {
      if (currentTempFile.exists) {
        currentTempFile.delete();
      }
    } catch {
      // Ignored
    }
    currentTempFile = null;
  }
}

export function stopPlatformAudio(): void {
  cleanupCurrentPlayer();
}

export function playPlatformAudio(params: PlayPlatformAudioParams): void {
  cleanupCurrentPlayer();

  if (!params.audioBase64) {
    params.onEnded();
    return;
  }

  void (async () => {
    try {
      // Dynamic imports — expo-audio and expo-file-system are available in the
      // Paseo app's native runtime but not at plugin typecheck time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createAudioPlayer } = await import("expo-audio");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Paths, File } = await import("expo-file-system");

      const ext = params.mimeType?.includes("mp3") ? "mp3" : "wav";
      const cacheDir = Paths.cache;
      const tempFile = new File(cacheDir, `audio-brief-${Date.now()}.${ext}`);
      currentTempFile = tempFile;

      tempFile.write(params.audioBase64!, { encoding: "base64" });

      const player = createAudioPlayer(tempFile.uri);
      currentPlayer = player;

      currentSubscription = player.addListener(
        "playbackStatusUpdate",
        (status: { didJustFinish?: boolean }) => {
          if (status.didJustFinish) {
            cleanupCurrentPlayer();
            params.onEnded();
          }
        },
      );

      player.play();
    } catch (err: unknown) {
      cleanupCurrentPlayer();
      params.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();
}
