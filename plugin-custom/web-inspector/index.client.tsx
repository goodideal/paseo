import type { PluginClientContext } from "@getpaseo/plugin/client";
import { InspectorPanel } from "./client/InspectorPanel";
import { SettingsScreen } from "./client/SettingsScreen";
import { searchInspectorRpc } from "./shared/inspect";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // Register the Workspace Panel (Icon must be a valid PascalCase Lucide icon)
  cleanups.push(
    client.addWorkspacePanel({
      id: "web-inspector-panel",
      title: "Web Inspector",
      icon: "Bug",
      context: "agent",
      Component: InspectorPanel,
    }),
  );

  // Slash Command
  cleanups.push(
    client.addSlashCommand({
      name: "inspect",
      description: "Open the Web Inspector panel",
      argumentHint: "[url]",
      context: "agent",
      onSubmit: (context) => {
        context.openPanel("web-inspector-panel");
      },
    }),
  );

  // Attachment Source
  cleanups.push(
    client.addAttachmentSource({
      id: "web-inspector-source",
      title: "Web Diagnostics",
      icon: "Bug",
      pickerTitle: "Inspect URL",
      searchPlaceholder: "Enter https://... to run headless diagnostics",
      search: searchInspectorRpc,
    }),
  );

  // Settings Screen for Auth config
  cleanups.push(
    client.addSettingsScreen({
      id: "web-inspector-settings",
      title: "Web Inspector Auth",
      icon: "Key",
      Component: SettingsScreen,
    }),
  );

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
