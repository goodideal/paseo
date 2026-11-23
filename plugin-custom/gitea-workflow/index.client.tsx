import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GiteaWorkbenchPanel } from "./client/gitea-workbench-panel.js";
import { HostSettingsScreen } from "./client/host-settings.js";

export default function contribute(plugin: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    plugin.addWorkspacePanel({
      id: "gitea-workflow-review",
      title: "Gitea Workflow",
      icon: "GitPullRequest",
      context: "workspace",
      locations: ["workspace", "explorer"],
      Component: (props) => <GiteaWorkbenchPanel {...props} />,
    }),
  );

  if (typeof plugin.addCommandCenterItem === "function") {
    cleanups.push(
      plugin.addCommandCenterItem({
        id: "open-gitea-workflow",
        title: "Open Gitea Workflow",
        icon: "GitPullRequest",
        context: "workspace",
        onSelect({ openPanel }) {
          openPanel("gitea-workflow-review");
        },
      }),
    );
  }

  cleanups.push(
    plugin.addSettingsScreen({
      id: "config",
      title: "Gitea Workflow",
      icon: "GitBranch",
      Component: (props) => <HostSettingsScreen {...props} />,
    }),
  );

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
