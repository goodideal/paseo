import { describe, it, expect, vi } from "vitest";
import React from "react";
import contribute from "../index.client.js";
import type {
  PluginClientContext,
  PluginComposerAccessoryContribution,
  PluginSettingsScreenContribution,
  PluginCommandCenterItemContribution,
  PluginClientSlashCommandContribution,
} from "@getpaseo/plugin/client";

describe("Quick Prompts Client Entrypoint", () => {
  it("registers composer accessory, settings screen, command center item, and slash commands", () => {
    const accessories: PluginComposerAccessoryContribution[] = [];
    const settingsScreens: PluginSettingsScreenContribution[] = [];
    const commandCenterItems: PluginCommandCenterItemContribution[] = [];
    const slashCommands: PluginClientSlashCommandContribution[] = [];

    const client: Partial<PluginClientContext> = {
      rpc: vi.fn().mockResolvedValue({
        items: [
          { shortcut: "continue", content: "c", enabled: true },
          { shortcut: "review", content: "r", enabled: true },
          { shortcut: "fix", content: "f", enabled: true },
          { shortcut: "test", content: "t", enabled: true },
          { shortcut: "yes", content: "y", enabled: true },
        ],
      }),
      addComposerAccessory: vi.fn((contribution: PluginComposerAccessoryContribution) => {
        accessories.push(contribution);
        return () => {
          const idx = accessories.indexOf(contribution);
          if (idx !== -1) accessories.splice(idx, 1);
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
        expect(client.addComposerAccessory).toHaveBeenCalledTimes(1);
        expect(accessories).toHaveLength(1);
        expect(accessories[0].id).toBe("quick-prompts");

        expect(client.addSettingsScreen).toHaveBeenCalledTimes(1);
        expect(settingsScreens).toHaveLength(1);
        expect(settingsScreens[0].id).toBe("quick-prompts");

        expect(client.addCommandCenterItem).toHaveBeenCalledTimes(1);
        expect(commandCenterItems).toHaveLength(1);
        expect(commandCenterItems[0].id).toBe("quick-prompts-settings");

        expect(client.addSlashCommand).toHaveBeenCalled();
        expect(slashCommands.length).toBeGreaterThan(0);
        const commandNames = slashCommands.map((c) => c.name);
        expect(commandNames).toContain("continue");
        expect(commandNames).toContain("review");
        expect(commandNames).toContain("fix");
        expect(commandNames).toContain("test");
        expect(commandNames).toContain("yes");

        cleanup();
        expect(accessories).toHaveLength(0);
        expect(settingsScreens).toHaveLength(0);
        expect(commandCenterItems).toHaveLength(0);
        expect(slashCommands).toHaveLength(0);
        resolve();
      }, 10);
    });
  });
});
