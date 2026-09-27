import type { PluginClientContext } from "@getpaseo/plugin/client";
import { InspectorPanel } from "./client/InspectorPanel";
import { SettingsScreen } from "./client/SettingsScreen";
import { searchInspectorRpc } from "./shared/inspect";

export default function contribute(client: PluginClientContext) {
  // Register the Workspace Panel
  client.addWorkspacePanel({
    id: "web-inspector-panel",
    title: "Web Inspector",
    icon: "bug-report",
    context: "agent",
    Component: InspectorPanel,
  });

  // Slash Command
  client.addSlashCommand({
    name: "inspect",
    description: "Open the Web Inspector panel",
    argumentHint: "[url]",
    context: "agent",
    onSubmit: (context) => {
      context.openPanel("web-inspector-panel");
    },
  });

  // Attachment Source
  client.addAttachmentSource({
    id: "web-inspector-source",
    title: "Web Diagnostics",
    icon: "bug-report",
    pickerTitle: "Inspect URL",
    searchPlaceholder: "Enter https://... to run headless diagnostics",
    search: searchInspectorRpc,
  });

  // Settings Screen for Auth config
  client.addSettingsScreen({
    id: "web-inspector-settings",
    title: "Web Inspector Auth",
    icon: "key",
    Component: SettingsScreen,
  });

  return () => {};
}
