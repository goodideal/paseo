import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import {
  HARNESS_TRANSITION_TIMELINE_KIND,
  HARNESS_TRANSITION_TIMELINE_VERSION,
  HarnessTransitionPayloadSchema,
} from "./shared/contracts.js";
import {
  extractAgentHarnessMetadata,
  formatHarnessPillLabel,
  resolveHarnessPillIcon,
} from "./client/metadata-utils.js";
import { HarnessTransitionCard } from "./client/transition-card.js";
import { HarnessPopover } from "./client/harness-popover.js";
import { HarnessSettingsScreen } from "./client/settings-screen.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  // 1. Timeline Transition Card Renderer
  if (typeof client.addTimelineRenderer === "function") {
    cleanups.push(
      client.addTimelineRenderer({
        kind: HARNESS_TRANSITION_TIMELINE_KIND,
        version: HARNESS_TRANSITION_TIMELINE_VERSION,
        schema: HarnessTransitionPayloadSchema,
        Component: (props) => <HarnessTransitionCard {...props} />,
      }),
    );
  }

  // 2. Settings Screen
  if (typeof client.addSettingsScreen === "function") {
    cleanups.push(
      client.addSettingsScreen({
        id: "agent-harness-settings",
        title: "Agent Harness",
        icon: "Compass",
        Component: HarnessSettingsScreen,
      }),
    );
  }

  // 3. Command Center Item
  if (typeof client.addCommandCenterItem === "function") {
    cleanups.push(
      client.addCommandCenterItem({
        id: "agent-harness-settings-command",
        title: "Configure Agent Harness",
        icon: "Compass",
        context: "global",
        onSelect({ openSettings }) {
          openSettings("agent-harness-settings");
        },
      }),
    );
  }

  // 4. Composer Pill observation & dynamic dual-state label updates
  const pills = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  const lifetime = new AbortController();

  const removePill = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  const registerPill = (agent: { id: string; workspaceId?: string | null; metadata?: unknown }) => {
    if (stopped) return;
    if (!agent.workspaceId) {
      removePill(agent.id);
      return;
    }

    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const meta = extractAgentHarnessMetadata(agent.metadata);
    const label = formatHarnessPillLabel(meta);
    const icon = resolveHarnessPillIcon(meta);

    const existingPill = pills.get(agentId);
    if (existingPill) {
      existingPill.update({
        label,
        icon,
      });
      return;
    }

    if (typeof client.addComposerPill === "function") {
      const pill = client.addComposerPill({
        id: "agent-harness",
        workspaceId,
        agentId,
        button: {
          title: "Agent Harness",
          label,
          icon,
          behavior: {
            kind: "popover",
            Content: (props) => (
              <HarnessPopover
                {...props}
                workspaceId={workspaceId}
                agentId={agentId}
                onOpenSettings={() => client.openSettings?.("agent-harness-settings")}
              />
            ),
          },
        },
      });
      pills.set(agentId, pill);
    }
  };

  const syncPill = registerPill;

  let activeSubscription: { close?: () => void; release?: () => void } | null = null;
  let activeUnsub: (() => void) | undefined;

  if (client.paseo?.agents?.list) {
    void client.paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(({ subscription }) => {
        const sub = subscription as unknown as { close?: () => void; release?: () => void };
        if (stopped) {
          sub.close?.() ?? void sub.release?.();
          return undefined;
        }

        activeSubscription = sub;

        if (typeof subscription.subscribe === "function") {
          activeUnsub = subscription.subscribe({
            snapshot: ({ entries }) => {
              for (const pill of pills.values()) pill.remove();
              pills.clear();
              for (const { agent } of entries) registerPill(agent);
            },
            update: (message) => {
              if (message.type !== "agent_update") return;
              const update = message.payload;
              if (update.kind === "remove") {
                removePill(update.agentId);
              } else {
                registerPill(update.agent);
              }
            },
          });
        }

        return undefined;
      })
      .catch((error) => {
        if (!stopped) {
          console.error("[AgentHarness] Agent observation failed:", error);
        }
      });
  }

  cleanups.push(() => {
    stopped = true;
    lifetime.abort();
    activeUnsub?.();
    activeSubscription?.close?.() ?? void activeSubscription?.release?.();
    for (const pill of pills.values()) {
      pill.remove();
    }
    pills.clear();
  });

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
