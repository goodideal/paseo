import React from "react";
import { View, Text } from "react-native";
import { FolderGit2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  WorkspaceHeaderMenuDesktop,
  WorkspaceHeaderMenuMobile,
} from "@/screens/workspace/workspace-header-menu";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { TerminalProfile } from "@getpaseo/protocol/messages";

const ThemedFolderGit2 = withUnistyles(FolderGit2);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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

export interface WorkspaceHeaderTitleBarProps {
  isLoading: boolean;
  title: string;
  subtitle: string;
  isSubtitleDistinct: boolean;
  isWorktree?: boolean;
  currentBranchName: string | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceScripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds: string[];
  showWorkspaceSetup: boolean;
  showWorkflowRuns?: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  createTerminalDisabled: boolean;
  importAgentDisabled: boolean;
  copyPathDisabled: boolean;
  onCreateDraftTab: () => void;
  onCreateNewTab?: () => void;
  onCreateTerminal: () => void;
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
  isWorktree = false,
  currentBranchName,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceScripts,
  liveTerminalIds,
  showWorkspaceSetup,
  showWorkflowRuns = false,
  showCreateBrowserTab,
  isMobile,
  createTerminalDisabled,
  importAgentDisabled,
  copyPathDisabled,
  onCreateDraftTab,
  onCreateNewTab,
  onCreateTerminal,
  onCreateTerminalWithProfile,
  onCreateBrowser,
  onOpenImportSheet,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
  onOpenWorkflowRuns,
  onScriptTerminalStarted,
  onViewScriptTerminal,
  onOpenUrlInBrowserTab,
}: WorkspaceHeaderTitleBarProps) {
  return (
    <View style={styles.headerTitleContainer}>
      {isLoading ? (
        <View style={styles.headerTitleTextGroup}>
          <View style={styles.headerTitleSkeleton} />
        </View>
      ) : (
        <View style={styles.headerTitleTextGroup}>
          <View style={styles.headerTitleRow}>
            {isWorktree ? (
              <View
                style={styles.headerWorktreeBadge}
                testID="workspace-header-worktree-indicator"
                accessibilityLabel="Worktree"
              >
                <ThemedFolderGit2 size={14} uniProps={mutedColorMapping} />
              </View>
            ) : null}
            <ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>
          </View>
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
            currentBranchName={currentBranchName}
            showWorkspaceSetup={showWorkspaceSetup}
            showWorkflowRuns={showWorkflowRuns}
            showCreateBrowserTab={showCreateBrowserTab}
            createTerminalDisabled={createTerminalDisabled}
            importAgentDisabled={importAgentDisabled}
            copyPathDisabled={copyPathDisabled}
            onCreateDraftTab={onCreateDraftTab}
            onCreateNewTab={onCreateNewTab}
            onCreateTerminal={onCreateTerminal}
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
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            scripts={workspaceScripts}
            liveTerminalIds={liveTerminalIds}
            onScriptTerminalStarted={onScriptTerminalStarted}
            onViewTerminal={onViewScriptTerminal}
            onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
            hideLabels
            presentation="ghost"
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
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  headerWorktreeBadge: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
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
