import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./client/review-panel.js";
import { HostSettingsScreen } from "./client/host-settings.js";

export default function contribute(plugin: PluginClientContext) {
  plugin.addWorkspacePanel({
    id: "gitea-workflow-review",
    title: "Gitea Review",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ReviewPanel,
  });

  plugin.addSettingsScreen({
    id: "config",
    title: "Gitea Workflow",
    icon: "GitBranch",
    Component: HostSettingsScreen,
  });

  return () => {};
}
