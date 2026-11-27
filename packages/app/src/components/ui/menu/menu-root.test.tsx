/**
 * @vitest-environment jsdom
 */
import React, { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PluginTranslationRuntime } from "@getpaseo/plugin/client/host";
import { QueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ invokePluginRpc: async () => null }),
  useHosts: () => [{ serverId: "host-a", label: "Local" }],
}));

vi.mock("@/plugins/client-state/source", () => ({
  createPluginClientStateSource: () => ({}),
}));

vi.mock("@/plugins/installation-provider", () => ({
  PluginInstallationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/contexts/toast-context", () => ({
  ToastApiProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  Keyframe: class Keyframe {
    duration() {
      return { withCallback: () => ({}) };
    }
  },
  runOnJS: (fn: unknown) => fn,
}));

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pluginButtonStore } from "@/plugins/buttons/store";
import { PluginComposerPills } from "@/plugins/buttons/view";
import type { InstalledPlugin } from "@/plugins/types";
import { MenuRoot, MenuTrigger } from "./menu-root";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => cleanup());

function createInstallation(): InstalledPlugin {
  return {
    lifetime: new AbortController(),
    locale: "en",
    i18n: new PluginTranslationRuntime({ getLocale: () => "en", subscribe: () => () => {} }),
    id: "agent-harness",
    serverId: "host-a",
    clientBundle: "bundle",
    queryClient: new QueryClient(),
    paseo: {} as InstalledPlugin["paseo"],
    invoke: async () => undefined,
    subscribe: () => {
      throw new Error("Subscriptions are not used here");
    },
    cleanup: () => undefined,
    settingsScreens: [],
    surfaces: [],
    sidebarViews: [],
    sidebarItems: { header: [], footer: [] },
    legacySidebarItems: [],
    workspaceRowBadgeItems: [],
    filePanels: [],
    composerItems: [],
    newWorkspaceItems: [],
    workspacePanels: [],
    commandCenterItems: [],
    clientSlashCommands: [],
    attachmentSources: [],
    themes: [],
    timelineTransformers: [],
    timelineRenderers: [],
    notificationOpenHandlers: [],
  };
}

describe("MenuTrigger", () => {
  it("forwards its rendered trigger to callers", () => {
    const triggerRef = createRef<View>();

    render(
      <MenuRoot>
        <MenuTrigger ref={triggerRef} accessibilityLabel="Open menu">
          <Text>Open</Text>
        </MenuTrigger>
      </MenuRoot>,
    );

    expect(triggerRef.current).not.toBeNull();
  });

  it("closes a wrapping TooltipTrigger when pressed to open the menu", () => {
    const onOpenChange = vi.fn();

    render(
      <MenuRoot onOpenChange={onOpenChange}>
        <Tooltip enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <MenuTrigger accessibilityRole="button" accessibilityLabel="Agent Harness">
              <Text>Standard · UI</Text>
            </MenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <Text>Agent Harness</Text>
          </TooltipContent>
        </Tooltip>
      </MenuRoot>,
    );

    const trigger = screen.getByRole("button", { name: "Agent Harness" });
    fireEvent(trigger, new window.MouseEvent("mouseenter"));
    expect(screen.queryByText("Agent Harness")).not.toBeNull();

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Agent Harness")).toBeNull();
  });

  it("opens only one popover surface and hides the tooltip when a composer pill is clicked across panes", () => {
    const plugin = createInstallation();
    const registration = pluginButtonStore.addComposerPill(plugin, {
      id: "agent-harness",
      workspaceId: "ws-1",
      agentId: "agent-1",
      button: {
        title: "Agent Harness",
        label: "Standard · UI",
        icon: "Scan",
        behavior: {
          kind: "popover",
          Content: () => <Text>Harness Popover Body</Text>,
        },
      },
    });

    try {
      render(
        <View>
          <PluginComposerPills
            serverId="host-a"
            workspaceId="ws-1"
            agentId="agent-1"
            compact={false}
          />
          <PluginComposerPills
            serverId="host-a"
            workspaceId="ws-1"
            agentId="agent-1"
            compact={false}
          />
        </View>,
      );

      const triggers = screen.getAllByRole("button", { name: "Agent Harness" });
      expect(triggers).toHaveLength(2);

      fireEvent(triggers[0]!, new window.MouseEvent("mouseenter"));
      expect(screen.queryByText("Agent Harness")).not.toBeNull();

      fireEvent.click(triggers[0]!);
      expect(screen.queryByText("Agent Harness")).toBeNull();
      expect(screen.getAllByText("Harness Popover Body")).toHaveLength(1);
    } finally {
      registration.remove();
      plugin.i18n.dispose();
    }
  });
});
