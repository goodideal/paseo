import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CrawlerDashboard } from "./client/components/crawler-dashboard.js";

export default function contribute(plugin: PluginClientContext) {
  plugin.addWorkspacePanel({
    id: "visual-crawler-auto-fix",
    title: "Visual QA & Auto-Fix",
    icon: "Bug",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: CrawlerDashboard,
  });
  return () => {};
}
