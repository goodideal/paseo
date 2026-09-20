import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Paths, File } from "expo-file-system";
import type { PlayPlatformAudioParams } from "./platform-player";

let currentPlayer: AudioPlayer | null = null;
let currentSubscription: { remove: () => void } | null = null;
let currentTempFile: File | null = null;

function cleanupCurrentPlayer(): void {
  if (currentSubscription) {
    currentSubscription.remove();
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

  try {
    const ext = params.mimeType?.includes("mp3") ? "mp3" : "wav";
    const cacheDir = Paths.cache;
    const tempFile = new File(cacheDir, `audio-brief-${Date.now()}.${ext}`);
    currentTempFile = tempFile;

    tempFile.write(params.audioBase64, { encoding: "base64" });

    const player = createAudioPlayer(tempFile.uri);
    currentPlayer = player;

    currentSubscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        cleanupCurrentPlayer();
        params.onEnded();
      }
    });

    player.play();
  } catch (err) {
    cleanupCurrentPlayer();
    params.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
