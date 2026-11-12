import { describe, it, expect, vi } from "vitest";
import React from "react";
import contribute from "../index.client.js";
import type {
  PluginClientContext,
  PluginComposerPillContribution,
  PluginHeaderButtonContribution,
  PluginButtonRegistration,
  PluginSettingsScreenContribution,
  PluginCommandCenterItemContribution,
  PluginClientSlashCommandContribution,
  PluginComposerItemContribution,
} from "@getpaseo/plugin/client";

describe("Quick Prompts Client Entrypoint", () => {
  it("registers composer pill, composer item, workspace header buttons, settings screen, command center item, and slash commands", () => {
    const pills: PluginComposerPillContribution[] = [];
    const composerItems: PluginComposerItemContribution[] = [];
    const headerButtons: PluginHeaderButtonContribution[] = [];
    const settingsScreens: PluginSettingsScreenContribution[] = [];
    const commandCenterItems: PluginCommandCenterItemContribution[] = [];
    const slashCommands: PluginClientSlashCommandContribution[] = [];

    let workspaceUpdateCallback: ((msg: any) => void) | null = null;

    const client: Partial<PluginClientContext> = {
      paseo: {
        agents: {
          list: vi.fn().mockResolvedValue({
            subscription: {
              subscribe: vi.fn(({ snapshot }) => {
                snapshot({
                  entries: [{ agent: { id: "agent-1", workspaceId: "ws-1" } }],
                });
              }),
            },
          }),
        },
        workspaces: {
          list: vi.fn().mockResolvedValue({
            subscription: {
              subscribe: vi.fn(({ snapshot, update }) => {
                workspaceUpdateCallback = update;
                snapshot({
                  entries: [
                    {
                      id: "ws-wt",
                      workspaceKind: "worktree",
                      name: "feat/worktree-branch",
                      currentBranch: "feat/worktree-branch",
                    },
                    {
                      id: "ws-local",
                      workspaceKind: "local_checkout",
                      name: "main",
                      currentBranch: "main",
                    },
                    {
                      id: "ws-dir",
                      workspaceKind: "directory",
                      name: "plain-dir",
                    },
                  ],
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
      addHeaderButton: vi.fn(
        (contribution: PluginHeaderButtonContribution): PluginButtonRegistration => {
          headerButtons.push(contribution);
          return {
            update: vi.fn(),
            remove: vi.fn(() => {
              const idx = headerButtons.indexOf(contribution);
              if (idx !== -1) headerButtons.splice(idx, 1);
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
        expect(client.addComposerPill).toHaveBeenCalled();
        expect(pills.length).toBeGreaterThan(0);
        expect(pills[0].id).toBe("quick-prompts");
        expect(pills[0].button.behavior.kind).toBe("popover");

        // Workspace header buttons (Worktree vs Local)
        expect(client.addHeaderButton).toHaveBeenCalled();
        expect(headerButtons).toHaveLength(2); // ws-wt and ws-local, but not ws-dir

        const wtBtn = headerButtons.find((b) => b.workspaceId === "ws-wt");
        expect(wtBtn).toBeDefined();
        expect(wtBtn?.button.title).toBe("Git Worktree");
        expect(wtBtn?.button.label).toBe("Worktree");
        expect(wtBtn?.button.icon).toBe("FolderGit2");
        expect(wtBtn?.button.behavior.kind).toBe("popover");

        const localBtn = headerButtons.find((b) => b.workspaceId === "ws-local");
        expect(localBtn).toBeDefined();
        expect(localBtn?.button.title).toBe("Local Checkout");
        expect(localBtn?.button.label).toBe("Local");
        expect(localBtn?.button.icon).toBe("Monitor");
        expect(localBtn?.button.behavior.kind).toBe("popover");

        // Dynamic update: remove ws-wt
        expect(workspaceUpdateCallback).toBeDefined();
        workspaceUpdateCallback?.({
          type: "workspace_update",
          payload: { kind: "remove", id: "ws-wt" },
        });
        expect(headerButtons.find((b) => b.workspaceId === "ws-wt")).toBeUndefined();
        expect(headerButtons).toHaveLength(1);

        expect(client.addComposerItem).toHaveBeenCalledTimes(1);
        expect(composerItems).toHaveLength(1);
        expect(composerItems[0].id).toBe("quick-prompts-draft");

        expect(client.addSettingsScreen).toHaveBeenCalledTimes(1);
        expect(settingsScreens).toHaveLength(1);
        expect(settingsScreens[0].id).toBe("quick-prompts");

        expect(client.addCommandCenterItem).toHaveBeenCalledTimes(1);
        expect(commandCenterItems).toHaveLength(1);
        expect(commandCenterItems[0].id).toBe("quick-prompts-settings");

        expect(client.addSlashCommand).toHaveBeenCalled();
        expect(slashCommands.length).toBeGreaterThan(0);

        cleanup();
        expect(pills).toHaveLength(0);
        expect(composerItems).toHaveLength(0);
        expect(headerButtons).toHaveLength(0);
        expect(settingsScreens).toHaveLength(0);
        expect(commandCenterItems).toHaveLength(0);
        expect(slashCommands).toHaveLength(0);
        resolve();
      }, 25);
    });
  });
});
