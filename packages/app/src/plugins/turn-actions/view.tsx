import React, { memo, useMemo } from "react";
import { Platform } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type {
  PluginTurnActionProps,
  PluginTurnActionContribution,
  TurnState,
} from "@getpaseo/plugin/client";
import { TurnStateProvider } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useInstalledPlugins } from "../registry";
import { toPluginTheme } from "../theme";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { PluginInstallationProvider } from "../installation-provider";
import { usePluginHostNavigation } from "../host-navigation";
import type { InstalledPlugin } from "../types";

export interface PluginTurnActionsProps {
  turnId: string;
  agentId: string;
  serverId?: string;
  type: "button" | "card";
  getContent: () => string;
  status?: "streaming" | "completed" | "failed";
}

interface ThemedTurnActionsProps extends PluginTurnActionsProps {
  theme: PluginTheme;
}

interface ResolvedTurnAction {
  plugin: InstalledPlugin;
  action: PluginTurnActionContribution;
}

function resolvePlatform(): "web" | "android" | "ios" {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
}

function collectTurnActions(
  plugins: InstalledPlugin[],
  serverId: string,
  type: "button" | "card",
): ResolvedTurnAction[] {
  const result: ResolvedTurnAction[] = [];
  for (const p of plugins) {
    if (p.serverId !== serverId) continue;
    for (const a of p.turnActions ?? []) {
      if (a.type === type) {
        result.push({ plugin: p, action: a });
      }
    }
  }
  return result.sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0));
}

const ThemedTurnActionsView = memo(function ThemedTurnActionsView({
  turnId,
  agentId,
  serverId = "local",
  type,
  getContent,
  status = "completed",
  theme,
}: ThemedTurnActionsProps) {
  const plugins = useInstalledPlugins();
  const client = useHostRuntimeClient(serverId);
  const navigation = usePluginHostNavigation(serverId);
  const compact = useIsCompactFormFactor();
  const platform = resolvePlatform();

  const turnState: TurnState = useMemo(
    () => ({
      turnId,
      agentId,
      status,
      getContent,
    }),
    [turnId, agentId, status, getContent],
  );

  const hostProps: PluginTurnActionProps = useMemo(
    () => ({
      turnId,
      agentId,
      theme,
      host: {
        id: serverId,
        label: client ? "Local" : serverId,
      },
      layout: {
        compact,
        platform,
      },
      navigation,
    }),
    [turnId, agentId, theme, serverId, client, compact, platform, navigation],
  );

  const actions = useMemo(
    () => collectTurnActions(plugins, serverId, type),
    [plugins, serverId, type],
  );

  if (!client) {
    return null;
  }

  if (actions.length > 0) {
    return (
      <TurnStateProvider value={turnState}>
        {actions.map(({ plugin, action }) => (
          <SurfaceErrorBoundary
            key={`${plugin.id}/${action.id}`}
            installation={plugin}
            Surface={action.Component}
            resetKey={action.id}
          >
            <PluginInstallationProvider plugin={plugin}>
              <action.Component {...hostProps} />
            </PluginInstallationProvider>
          </SurfaceErrorBoundary>
        ))}
      </TurnStateProvider>
    );
  }

  return null;
});

export const PluginTurnActions: React.ComponentType<PluginTurnActionsProps> = withUnistyles(
  ThemedTurnActionsView,
  (theme: Theme) => ({
    theme: toPluginTheme(theme),
  }),
);
