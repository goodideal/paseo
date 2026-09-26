import type { PluginServerContext } from "@getpaseo/plugin";
import { audioBriefSynthesizeRpc } from "./shared/contracts.js";
import { AudioBriefService } from "./server/audio-brief-service.js";

export default function contribute(server: PluginServerContext) {
  const service = new AudioBriefService();

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
