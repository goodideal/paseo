import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inspectUrlRpc, searchInspectorRpc } from "./shared/inspect";
import { handleInspectUrl, handleAttachmentSearch } from "./server/inspect";
import { authSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(authSettings);

  server.handle(inspectUrlRpc, async (input) => handleInspectUrl(input, settings));
  server.handle(searchInspectorRpc, async (input) => handleAttachmentSearch(input, settings));

  return () => {};
}
