import type { PluginServerContext } from "@getpaseo/plugin";
import { audioBriefSynthesizeRpc } from "./shared/contracts.js";
import { AudioBriefService } from "./server/audio-brief-service.js";
import { audioBriefSettings, type AudioBriefSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  let currentSettings: AudioBriefSettings = audioBriefSettings.schema.parse({});

  if (typeof server.registerSettings === "function") {
    const settings = server.registerSettings(audioBriefSettings);
    void settings.read().then((state) => {
      if (state.status === "ready") {
        currentSettings = state.values;
      }
    });

    settings.subscribe((state) => {
      if (state.status === "ready") {
        currentSettings = state.values;
      }
    });
  }

  const service = new AudioBriefService({
    getSettings: () => currentSettings,
  });

  server.handle(audioBriefSynthesizeRpc, async (input) => {
    return service.synthesizeBrief({
      agentId: input.agentId,
      turnId: input.turnId,
      text: input.text,
      customPrompt: input.customPrompt,
      forceRefresh: input.forceRefresh,
    });
  });

  return () => {};
}
