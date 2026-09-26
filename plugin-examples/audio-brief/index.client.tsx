import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TurnAudioBriefButton } from "./client/turn-audio-brief-button.js";
import { AudioBriefCard } from "./client/audio-brief-card.js";

export default function contribute(client: PluginClientContext) {
  const cleanupButton = client.addTurnAction({
    id: "audio-brief-button",
    type: "button",
    order: 10,
    Component: TurnAudioBriefButton,
  });

  const cleanupCard = client.addTurnAction({
    id: "audio-brief-card",
    type: "card",
    order: 10,
    Component: AudioBriefCard,
  });

  return () => {
    cleanupButton();
    cleanupCard();
  };
}
