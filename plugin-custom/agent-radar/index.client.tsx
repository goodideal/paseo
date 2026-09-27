import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BlockerReportSchema } from "./shared/types.js";
import { DecisionCard } from "./client/components/decision-card.js";
import { RadarPanelHost } from "./client/components/radar-panel.js";
import { RadarSettingsScreen } from "./client/components/settings-screen.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: (() => void)[] = [];

  // Register timeline renderers (for both watchdog-blocker and radar-blocker)
  const cleanupWatchdogTimeline = client.addTimelineRenderer({
    kind: "watchdog-blocker",
    version: 1,
    schema: BlockerReportSchema,
    Component: (props) => <DecisionCard {...props} />,
  });
  cleanups.push(cleanupWatchdogTimeline);

  const cleanupRadarTimeline = client.addTimelineRenderer({
    kind: "radar-blocker",
    version: 1,
    schema: BlockerReportSchema,
    Component: (props) => <DecisionCard {...props} />,
  });
  cleanups.push(cleanupRadarTimeline);

  // Register the agent radar workspace panel (PascalCase Lucide icon: Activity)
  const cleanupPanel = client.addWorkspacePanel({
    id: "agent-radar-panel",
    title: "Agent Radar",
    icon: "Activity",
    context: "agent",
    Component: (props) => <RadarPanelHost {...props} />,
  });
  cleanups.push(cleanupPanel);

  // Register settings screen for Agent Radar & Watchdog
  if (typeof client.addSettingsScreen === "function") {
    const cleanupSettings = client.addSettingsScreen({
      id: "agent-radar-settings",
      title: "Agent Radar",
      icon: "Activity",
      Component: (props) => <RadarSettingsScreen {...props} />,
    });
    cleanups.push(cleanupSettings);
  }

  // Register Command Center item to quickly open settings
  if (typeof client.addCommandCenterItem === "function") {
    const cleanupCommand = client.addCommandCenterItem({
      id: "agent-radar-settings-command",
      title: "Configure Agent Radar & Watchdog",
      icon: "Activity",
      context: "global",
      onSelect({ openSettings }) {
        openSettings("agent-radar-settings");
      },
    });
    cleanups.push(cleanupCommand);
  }

  return () => {
    cleanups.forEach((c) => c());
  };
}
