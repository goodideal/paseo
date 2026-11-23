import { describe, it, expect, vi } from "vitest";
import React from "react";
import contribute from "../index.client.js";
import type {
  PluginClientContext,
  PluginComposerPillContribution,
  PluginButtonRegistration,
  PluginSettingsScreenContribution,
  PluginCommandCenterItemContribution,
  PluginClientSlashCommandContribution,
  PluginComposerItemContribution,
} from "@getpaseo/plugin/client";

describe("Quick Prompts Client Entrypoint", () => {
  it("registers composer pill, composer item, settings screen, command center item, and slash commands", () => {
    const pills: PluginComposerPillContribution[] = [];
    const composerItems: PluginComposerItemContribution[] = [];
    const settingsScreens: PluginSettingsScreenContribution[] = [];
    const commandCenterItems: PluginCommandCenterItemContribution[] = [];
    const slashCommands: PluginClientSlashCommandContribution[] = [];
    let onAgentUpdate: ((message: any) => void) | null = null;

    const client: Partial<PluginClientContext> = {
      paseo: {
        agents: {
          list: vi.fn().mockResolvedValue({
            subscription: {
              subscribe: vi.fn(({ snapshot, update }) => {
                onAgentUpdate = update;
                snapshot({
                  entries: [{ agent: { id: "agent-1", workspaceId: "ws-1" } }],
                });
              }),
            },
          }),
        },
      } as any,
      rpc: vi.fn().mockResolvedValue({
        items: [
          { shortcut: "continue", content: "c", enabled: true },
          { shortcut: "review", content: "r", enabled: true },
          { shortcut: "fix", content: "f", enabled: true },
          { shortcut: "test", content: "t", enabled: true },
          { shortcut: "yes", content: "y", enabled: true },
        ],
      }),
      addComposerPill: vi.fn(
        (contribution: PluginComposerPillContribution): PluginButtonRegistration => {
          pills.push(contribution);
          return {
            update: vi.fn(),
            remove: vi.fn(() => {
              const idx = pills.indexOf(contribution);
              if (idx !== -1) pills.splice(idx, 1);
            }),
          };
        },
      ),
      addComposerItem: vi.fn((contribution: PluginComposerItemContribution) => {
        composerItems.push(contribution);
        return () => {
          const idx = composerItems.indexOf(contribution);
          if (idx !== -1) composerItems.splice(idx, 1);
        };
      }),
      addSettingsScreen: vi.fn((contribution: PluginSettingsScreenContribution) => {
        settingsScreens.push(contribution);
        return () => {
          const idx = settingsScreens.indexOf(contribution);
          if (idx !== -1) settingsScreens.splice(idx, 1);
        };
      }),
      addCommandCenterItem: vi.fn((contribution: PluginCommandCenterItemContribution) => {
        commandCenterItems.push(contribution);
        return () => {
          const idx = commandCenterItems.indexOf(contribution);
          if (idx !== -1) commandCenterItems.splice(idx, 1);
        };
      }),
      addSlashCommand: vi.fn((contribution: PluginClientSlashCommandContribution) => {
        slashCommands.push(contribution);
        return () => {
          const idx = slashCommands.indexOf(contribution);
          if (idx !== -1) slashCommands.splice(idx, 1);
        };
      }),
    };

    const cleanup = contribute(client as PluginClientContext);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(client.addComposerPill).toHaveBeenCalledTimes(1);
        expect(pills.length).toBe(1);
        expect(pills[0].id).toBe("quick-prompts");
        expect(pills[0].button.behavior.kind).toBe("popover");

        // Subsequent upsert for the same workspace keeps the pill pinned in place (no remove + re-add)
        onAgentUpdate?.({
          type: "agent_update",
          payload: {
            kind: "upsert",
            agent: { id: "agent-1", workspaceId: "ws-1" },
          },
        });
        expect(client.addComposerPill).toHaveBeenCalledTimes(1);
        expect(pills).toHaveLength(1);

        // Clearing workspaceId removes the pill
        onAgentUpdate?.({
          type: "agent_update",
          payload: {
            kind: "upsert",
            agent: { id: "agent-1", workspaceId: null },
          },
        });
        expect(pills).toHaveLength(0);

        // Re-assigning workspaceId re-registers the pill
        onAgentUpdate?.({
          type: "agent_update",
          payload: {
            kind: "upsert",
            agent: { id: "agent-1", workspaceId: "ws-1" },
          },
        });
        expect(client.addComposerPill).toHaveBeenCalledTimes(2);
        expect(pills).toHaveLength(1);

        expect(client.addComposerItem).toHaveBeenCalledTimes(1);
        expect(composerItems).toHaveLength(1);
        expect(composerItems[0].id).toBe("quick-prompts-draft");

        expect(client.addSettingsScreen).toHaveBeenCalledTimes(1);
        expect(settingsScreens).toHaveLength(1);
        expect(settingsScreens[0].id).toBe("quick-tools");

        expect(client.addCommandCenterItem).toHaveBeenCalledTimes(1);
        expect(commandCenterItems).toHaveLength(1);
        expect(commandCenterItems[0].id).toBe("quick-tools-settings");

        expect(client.addSlashCommand).toHaveBeenCalled();
        expect(slashCommands.length).toBeGreaterThan(0);
        expect(client.rpc).toHaveBeenCalledWith(
          expect.objectContaining({ name: "quick_tools.workspace_labels.sync.request" }),
          {},
        );

        cleanup();
        expect(pills).toHaveLength(0);
        expect(composerItems).toHaveLength(0);
        expect(settingsScreens).toHaveLength(0);
        expect(commandCenterItems).toHaveLength(0);
        expect(slashCommands).toHaveLength(0);
        resolve();
      }, 25);
    });
  });
});
