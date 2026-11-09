import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { AudioBriefPopover } from "./client/audio-brief-popover.js";
import { AudioBriefSettingsScreen } from "./client/settings-screen.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // 1. Register Composer Pill using native Paseo API
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  const lifetime = new AbortController();

  const registerPill = (agent: { id: string; workspaceId?: string | null }) => {
    if (stopped || !agent.workspaceId) return;
    pills.get(agent.id)?.remove();
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const pill = client.addComposerPill({
      id: "audio-brief",
      workspaceId,
      agentId,
      button: {
        title: "Audio Brief",
        label: "Audio Brief",
        icon: "Volume2",
        behavior: {
          kind: "popover",
          Content: (props) => (
            <AudioBriefPopover
              {...props}
              workspaceId={workspaceId}
              agentId={agentId}
              onOpenSettings={() => client.openSettings("audio-brief-settings")}
            />
          ),
        },
      },
    });
    pills.set(agent.id, pill);
  };

  const removePill = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  if (client.paseo?.agents) {
    void client.paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            for (const pill of pills.values()) pill.remove();
            pills.clear();
            for (const { agent } of entries) registerPill(agent);
          },
          update: (message) => {
            if (message.type !== "agent_update") return;
            const update = message.payload;
            if (update.kind === "remove") removePill(update.agentId);
            else registerPill(update.agent);
          },
        });
        return undefined;
      })
      .catch((error) => {
        if (!stopped) console.error("[AudioBrief] Agent observation failed", error);
      });
  }

  cleanups.push(() => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  });

  // 2. Register standalone settings screen for Audio Brief (TTS & Prompt configuration)
  if (typeof client.addSettingsScreen === "function") {
    cleanups.push(
      client.addSettingsScreen({
        id: "audio-brief-settings",
        title: "Audio Brief",
        icon: "Volume2",
        Component: (props) => <AudioBriefSettingsScreen {...props} />,
      }),
    );
  }

  // 3. Register Command Center item
  if (typeof client.addCommandCenterItem === "function") {
    cleanups.push(
      client.addCommandCenterItem({
        id: "audio-brief-settings-item",
        title: "Configure Audio Brief",
        icon: "Volume2",
        context: "global",
        onSelect({ openSettings }) {
          openSettings("audio-brief-settings");
        },
      }),
    );
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
