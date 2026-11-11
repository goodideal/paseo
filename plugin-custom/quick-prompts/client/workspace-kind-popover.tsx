import React, { memo, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";

export type WorkspaceKindPopoverProps = PluginButtonContentProps & {
  workspace: {
    id: string;
    name?: string | null;
    currentBranch?: string | null;
    workspaceDirectory?: string | null;
    projectDisplayName?: string | null;
    workspaceKind?: string;
  };
  isWorktree: boolean;
};

export const WorkspaceKindPopover = memo(function WorkspaceKindPopover({
  workspace,
  isWorktree,
  theme,
  layout,
}: WorkspaceKindPopoverProps) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 260,
          backgroundColor: layout.compact ? "transparent" : (theme.colors.surface0 ?? "#111"),
          padding: 12,
          gap: 10,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        badge: {
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: isWorktree
            ? (theme.colors.surface2 ?? "#222")
            : (theme.colors.surface1 ?? "#1a1a1a"),
          borderWidth: 1,
          borderColor: isWorktree
            ? (theme.colors.accent ?? "#38bdf8")
            : (theme.colors.border ?? "#333"),
        },
        badgeText: {
          fontSize: 11,
          fontWeight: "600",
          color: isWorktree ? (theme.colors.accent ?? "#38bdf8") : theme.colors.foreground,
        },
        title: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.foreground,
          flexShrink: 1,
        },
        infoBlock: {
          gap: 4,
          padding: 8,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1 ?? "#181818",
        },
        row: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        label: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        value: {
          fontSize: 11,
          color: theme.colors.foreground,
          fontWeight: "500",
          maxWidth: 160,
        },
        pathText: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
          fontFamily: "monospace",
          marginTop: 2,
        },
      }),
    [theme, layout.compact, isWorktree],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{isWorktree ? "Git Worktree" : "Local Checkout"}</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {workspace.name || workspace.id}
        </Text>
      </View>

      <View style={styles.infoBlock}>
        {workspace.projectDisplayName ? (
          <View style={styles.row}>
            <Text style={styles.label}>Project</Text>
            <Text style={styles.value} numberOfLines={1}>
              {workspace.projectDisplayName}
            </Text>
          </View>
        ) : null}

        {workspace.currentBranch ? (
          <View style={styles.row}>
            <Text style={styles.label}>Branch</Text>
            <Text style={styles.value} numberOfLines={1}>
              {workspace.currentBranch}
            </Text>
          </View>
        ) : null}

        {workspace.workspaceDirectory ? (
          <View>
            <Text style={styles.label}>Directory</Text>
            <Text style={styles.pathText} numberOfLines={2} ellipsizeMode="middle">
              {workspace.workspaceDirectory}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});
