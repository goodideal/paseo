import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TurnAudioBriefButton } from "./client/turn-audio-brief-button.js";
import { AudioBriefCard } from "./client/audio-brief-card.js";
import { AudioBriefSettingsScreen } from "./client/settings-screen.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // Register standalone settings screen for Audio Brief (TTS & Prompt configuration)
  if (typeof client.addSettingsScreen === "function") {
    cleanups.push(
      client.addSettingsScreen({
        id: "audio-brief-settings",
        title: "Audio Brief",
        icon: "Volume2",
        Component: (props) => <AudioBriefSettingsScreen {...props} />,
      }),
    );
  }

  // Safely guard turn actions for older or official baseline clients
  if (typeof client.addTurnAction === "function") {
    cleanups.push(
      client.addTurnAction({
        id: "audio-brief-button",
        type: "button",
        order: 10,
        Component: (props) => <TurnAudioBriefButton {...props} />,
      }),
    );

    cleanups.push(
      client.addTurnAction({
        id: "audio-brief-card",
        type: "card",
        order: 10,
        Component: (props) => <AudioBriefCard {...props} />,
      }),
    );
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
