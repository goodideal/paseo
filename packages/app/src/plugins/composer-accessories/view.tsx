import React, { memo, useMemo } from "react";
import { Platform } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type {
  PluginComposerAccessoryProps,
  PluginComposerAccessoryContribution,
  ComposerApi,
} from "@getpaseo/plugin/client";
import { ComposerApiProvider } from "@getpaseo/plugin/client";
import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useInstalledPlugins } from "../registry";
import { toPluginTheme } from "../theme";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { PluginInstallationProvider } from "../installation-provider";
import { usePluginHostNavigation } from "../host-navigation";
import { createPluginClientStateSource } from "../client-state/source";
import type { InstalledPlugin } from "../types";

export interface PluginComposerAccessoriesProps {
  workspaceId?: string | null;
  agentId?: string | null;
  serverId: string;
  composerApi: ComposerApi;
}

interface ThemedAccessoriesProps extends PluginComposerAccessoriesProps {
  theme: PluginTheme;
}

interface ResolvedAccessory {
  plugin: InstalledPlugin;
  accessory: PluginComposerAccessoryContribution;
}

function resolvePlatform(): "web" | "android" | "ios" {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
}

function collectAccessories(plugins: InstalledPlugin[], serverId: string): ResolvedAccessory[] {
  const result: ResolvedAccessory[] = [];
  for (const p of plugins) {
    if (p.serverId !== serverId) continue;
    for (const acc of p.composerAccessories ?? []) {
      result.push({ plugin: p, accessory: acc });
    }
  }
  return result.sort((a, b) => (a.accessory.order ?? 0) - (b.accessory.order ?? 0));
}

const ThemedAccessoriesView = memo(function ThemedAccessoriesView({
  workspaceId,
  agentId,
  serverId,
  composerApi,
  theme,
}: ThemedAccessoriesProps) {
  const plugins = useInstalledPlugins();
  const client = useHostRuntimeClient(serverId);
  const navigation = usePluginHostNavigation(serverId);
  const compact = useIsCompactFormFactor();
  const platform = resolvePlatform();
  const stateSource = useMemo(() => createPluginClientStateSource(serverId), [serverId]);

  const hostProps: PluginComposerAccessoryProps = useMemo(
    () => ({
      workspaceId: workspaceId ?? "",
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
    [workspaceId, agentId, theme, serverId, client, compact, platform, navigation],
  );

  const accessories = useMemo(() => collectAccessories(plugins, serverId), [plugins, serverId]);

  if (!client || accessories.length === 0) {
    return null;
  }

  return (
    <ComposerApiProvider value={composerApi}>
      {accessories.map(({ plugin, accessory }) => (
        <SurfaceErrorBoundary
          key={`${plugin.id}/${accessory.id}`}
          installation={plugin}
          Surface={accessory.Component}
          resetKey={accessory.id}
        >
          <PluginInstallationProvider plugin={plugin}>
            <PluginClientStateProvider source={stateSource}>
              <accessory.Component {...hostProps} />
            </PluginClientStateProvider>
          </PluginInstallationProvider>
        </SurfaceErrorBoundary>
      ))}
    </ComposerApiProvider>
  );
});

export const PluginComposerAccessories: React.ComponentType<PluginComposerAccessoriesProps> =
  withUnistyles(ThemedAccessoriesView, (theme: Theme) => ({
    theme: toPluginTheme(theme),
  }));
