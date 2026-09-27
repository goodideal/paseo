import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TurnAudioBriefButton } from "./client/turn-audio-brief-button.js";
import { AudioBriefCard } from "./client/audio-brief-card.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

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
