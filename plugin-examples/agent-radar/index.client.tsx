import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BlockerReportSchema } from "./shared/types.js";
import { DecisionCard } from "./client/components/decision-card.js";
import { RadarPanelHost } from "./client/components/radar-panel.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: (() => void)[] = [];

  // Register timeline renderers (for both watchdog-blocker and radar-blocker)
  const cleanupWatchdogTimeline = client.addTimelineRenderer({
    kind: "watchdog-blocker",
    version: 1,
    schema: BlockerReportSchema,
    Component: DecisionCard,
  });
  cleanups.push(cleanupWatchdogTimeline);

  const cleanupRadarTimeline = client.addTimelineRenderer({
    kind: "radar-blocker",
    version: 1,
    schema: BlockerReportSchema,
    Component: DecisionCard,
  });
  cleanups.push(cleanupRadarTimeline);

  // Register the agent radar workspace panel (PascalCase Lucide icon: Activity)
  const cleanupPanel = client.addWorkspacePanel({
    id: "agent-radar-panel",
    title: "Agent Radar",
    icon: "Activity",
    context: "agent",
    Component: RadarPanelHost,
  });
  cleanups.push(cleanupPanel);

  return () => {
    cleanups.forEach((c) => c());
  };
}
