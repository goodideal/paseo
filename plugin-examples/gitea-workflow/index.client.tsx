import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./client/review-panel";

export default function contribute(plugin: PluginClientContext) {
  plugin.addWorkspacePanel({
    id: "gitea-workflow-review",
    title: "Gitea Review",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ReviewPanel,
  });
  return () => {};
}
