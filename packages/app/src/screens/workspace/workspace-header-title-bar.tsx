import React, { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  WorkspaceHeaderMenuDesktop,
  WorkspaceHeaderMenuMobile,
} from "@/screens/workspace/workspace-header-menu";
import {
  WorkspaceScriptsButton,
  type UseWorkspaceScriptsMenuPagesInput,
  type WorkspaceScriptActions,
} from "@/screens/workspace/scripts";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { TerminalProfile } from "@getpaseo/protocol/messages";

function WorkspaceHeaderProjectRow({
  subtitle,
  isSubtitleDistinct,
  serverId,
}: {
  subtitle: string;
  isSubtitleDistinct: boolean;
  serverId: string;
}) {
  const isCompact = useIsCompactFormFactor();
  const hostBadge = useHostBadges({ enabled: isCompact }).get(serverId) ?? null;
  const showProject = isSubtitleDistinct || isCompact;
  if (!showProject && !hostBadge) {
    return null;
  }
  return (
    <View style={styles.headerProjectRow}>
      {showProject ? (
        <Text
          testID="workspace-header-subtitle"
          style={styles.headerProjectTitle}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      ) : null}
      {showProject && hostBadge ? <Text style={styles.headerProjectSeparator}>·</Text> : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}

const NOOP_SCRIPT_ACTIONS: WorkspaceScriptActions = {
  start: () => {},
  stop: () => {},
  restart: () => {},
  copyUrl: () => {},
  selectRoute: () => {},
  resolveLinks: () => ({ selected: null, targets: [] }),
  isStartPending: false,
  isStopPending: false,
};

export interface WorkspaceHeaderTitleBarProps {
  isLoading: boolean;
  title: string;
  subtitle: string;
  isSubtitleDistinct: boolean;
  currentBranchName: string | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceScripts: WorkspaceDescriptor["scripts"];
  scriptActions?: WorkspaceScriptActions;
  liveTerminalIds: string[];
  showWorkspaceSetup: boolean;
  showWorkflowRuns?: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  createTerminalDisabled: boolean;
  importAgentDisabled: boolean;
  copyPathDisabled: boolean;
  onCreateDraftTab?: () => void;
  onCreateNewTab?: () => void;
  onCreateTerminal?: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
  onCreateBrowser: () => void;
  onOpenImportSheet: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
  onOpenWorkflowRuns?: () => void;
  onScriptTerminalStarted: (terminalId: string) => void;
  onViewScriptTerminal: (terminalId: string) => void;
  onOpenUrlInBrowserTab: (url: string) => void;
}

export function WorkspaceHeaderTitleBar({
  isLoading,
  title,
  subtitle,
  isSubtitleDistinct,
  currentBranchName,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceScripts,
  scriptActions,
  liveTerminalIds,
  showWorkspaceSetup,
  showWorkflowRuns = false,
  showCreateBrowserTab,
  isMobile,
  createTerminalDisabled,
  importAgentDisabled,
  copyPathDisabled,
  onCreateTerminalWithProfile,
  onCreateBrowser,
  onOpenImportSheet,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
  onOpenWorkflowRuns,
  onScriptTerminalStarted: _onScriptTerminalStarted,
  onViewScriptTerminal,
  onOpenUrlInBrowserTab,
}: WorkspaceHeaderTitleBarProps) {
  const activeScriptActions = scriptActions ?? NOOP_SCRIPT_ACTIONS;
  const scriptsMenuInput = useMemo<UseWorkspaceScriptsMenuPagesInput>(
    () => ({
      actions: activeScriptActions,
      scripts: workspaceScripts,
      liveTerminalIds,
      onViewTerminal: onViewScriptTerminal,
      onOpenUrlInBrowserTab,
    }),
    [
      activeScriptActions,
      workspaceScripts,
      liveTerminalIds,
      onViewScriptTerminal,
      onOpenUrlInBrowserTab,
    ],
  );

  return (
    <View style={styles.headerTitleContainer}>
      {isLoading ? (
        <View style={styles.headerTitleTextGroup}>
          <View style={styles.headerTitleSkeleton} />
        </View>
      ) : (
        <View style={styles.headerTitleTextGroup}>
          <ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>
          <WorkspaceHeaderProjectRow
            subtitle={subtitle}
            isSubtitleDistinct={isSubtitleDistinct}
            serverId={normalizedServerId}
          />
        </View>
      )}
      <View style={styles.compactHeaderMenuCluster}>
        {isMobile ? (
          <WorkspaceHeaderMenuMobile
            normalizedServerId={normalizedServerId}
            normalizedWorkspaceId={normalizedWorkspaceId}
            scripts={scriptsMenuInput}
            currentBranchName={currentBranchName}
            showWorkspaceSetup={showWorkspaceSetup}
            showWorkflowRuns={showWorkflowRuns}
            showCreateBrowserTab={showCreateBrowserTab}
            createTerminalDisabled={createTerminalDisabled}
            importAgentDisabled={importAgentDisabled}
            copyPathDisabled={copyPathDisabled}
            onCreateTerminalWithProfile={onCreateTerminalWithProfile}
            onCreateBrowser={onCreateBrowser}
            onOpenImportSheet={onOpenImportSheet}
            onCopyWorkspacePath={onCopyWorkspacePath}
            onCopyBranchName={onCopyBranchName}
            onOpenSetupTab={onOpenSetupTab}
            onOpenWorkflowRuns={onOpenWorkflowRuns}
          />
        ) : (
          <WorkspaceHeaderMenuDesktop
            currentBranchName={currentBranchName}
            showWorkspaceSetup={showWorkspaceSetup}
            importAgentDisabled={importAgentDisabled}
            copyPathDisabled={copyPathDisabled}
            onOpenImportSheet={onOpenImportSheet}
            onCopyWorkspacePath={onCopyWorkspacePath}
            onCopyBranchName={onCopyBranchName}
            onOpenSetupTab={onOpenSetupTab}
          />
        )}
        {isMobile && workspaceScripts.length > 0 ? (
          <WorkspaceScriptsButton
            actions={activeScriptActions}
            scripts={workspaceScripts}
            liveTerminalIds={liveTerminalIds}
            onViewTerminal={onViewScriptTerminal}
            onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
            hideLabels
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerTitleContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: theme.spacing[1],
      md: theme.spacing[2],
    },
    overflow: "hidden",
  },
  headerTitleTextGroup: {
    minWidth: 0,
    overflow: "hidden",
    flexShrink: 1,
    flexGrow: {
      xs: 1,
      md: 0,
    },
    flexDirection: {
      xs: "column",
      md: "row",
    },
    alignItems: {
      xs: "stretch",
      md: "center",
    },
    justifyContent: "flex-start",
    gap: {
      xs: 0,
      md: theme.spacing[2],
    },
  },
  headerProjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  headerProjectTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm,
      md: theme.fontSize.base,
    },
    flexShrink: 1,
    minWidth: 0,
  },
  headerProjectSeparator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  headerTitleSkeleton: {
    width: 220,
    maxWidth: "100%",
    height: 22,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.25,
  },
  compactHeaderMenuCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: 0,
      md: theme.spacing[2],
    },
  },
}));
