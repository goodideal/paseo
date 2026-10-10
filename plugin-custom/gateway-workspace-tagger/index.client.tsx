import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GatewayTaggerSettingsScreen } from "./client/settings-screen.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    client.addSettingsScreen({
      id: "gateway-workspace-tagger",
      title: "Gateway Workspace Tagger",
      icon: "Network",
      Component: GatewayTaggerSettingsScreen,
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "gateway-workspace-tagger-settings",
      title: "Configure Gateway Workspace Tagger",
      icon: "Network",
      context: "global",
      onSelect({ openSettings }) {
        openSettings("gateway-workspace-tagger");
      },
    }),
  );

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
