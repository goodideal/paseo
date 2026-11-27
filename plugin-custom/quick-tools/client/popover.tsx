import React, { memo, useCallback, useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent, useWorkspace, usePaseo, useSettings, useRpc } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffectiveQuickPrompts } from "./use-quick-prompts.js";
import { resolveActiveAgentProfileIds } from "./quick-prompt-resolver.js";
import { executeQuickPrompt } from "./prompt-executor.js";
import { PROMPT_COLOR_PALETTE, resolveWorkspaceLabelColorTheme } from "./color-palette.js";
import {
  DEFAULT_LOCAL_LABEL_COLOR,
  DEFAULT_WORKTREE_LABEL_COLOR,
  quickPromptsSettings,
  quickPromptsWorkspaceLabelsSyncRpc,
  type QuickPromptItem,
  type QuickPromptAgentStatus,
  type WorkspaceLabelColor,
} from "../shared/contracts.js";

export type QuickToolsPopoverProps = PluginButtonContentProps & {
  workspaceId: string;
  agentId: string;
  onOpenSettings?: () => void;
};

export type QuickPromptsPopoverProps = QuickToolsPopoverProps;

function normalizeAgentStatus(status?: string): QuickPromptAgentStatus {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "idle";
}

function formatWorkspaceKindBadge(kind?: string): string {
  return kind === "worktree" ? "WT" : "Local";
}

export const QuickToolsPopover = memo(function QuickToolsPopover({
  workspaceId,
  agentId,
  theme,
  layout,
  close,
  onOpenSettings,
}: QuickToolsPopoverProps) {
  const paseo = usePaseo();
  const toast = useToast();
  const syncWorkspaceLabels = useRpc(quickPromptsWorkspaceLabelsSyncRpc);

  const workspace = useWorkspace(workspaceId, (ws) => ({
    projectId: ws.projectId,
    kind: ws.kind,
    branch: ws.branch,
    directory: ws.directory,
  }));
  const projectId = workspace?.projectId ?? null;

  const agent = useAgent(agentId, (a) => ({
    status: a.status,
    provider: a.provider,
    model: a.model,
    cwd: a.cwd,
    currentModeId: a.currentModeId,
    thinkingOptionId: a.thinkingOptionId,
    labels: a.labels,
  }));

  const [lastAssistantText, setLastAssistantText] = useState<string | null>(null);
  const [syncingLabels, setSyncingLabels] = useState(false);

  // Background passive timeline observation without blocking UI mount
  useEffect(() => {
    if (!agentId || !paseo?.agents) return;
    let active = true;

    try {
      const ref = paseo.agents.ref(agentId);
      ref.timeline
        .refetch({ direction: "tail", limit: 10 })
        .then((page) => {
          if (!active || !page?.entries) return;
          for (let i = page.entries.length - 1; i >= 0; i--) {
            const entry = page.entries[i];
            if (entry?.item && entry.item.type === "assistant_message") {
              const text = entry.item.text?.trim();
              if (text) {
                setLastAssistantText(text);
                return;
              }
            }
          }
        })
        .catch(() => {});
    } catch {
      // Ignored
    }

    return () => {
      active = false;
    };
  }, [agentId, paseo]);

  const activeProfileIds = useMemo(
    () => resolveActiveAgentProfileIds(agent?.labels),
    [agent?.labels],
  );

  const settings = useSettings(quickPromptsSettings);
  const aiSuggestions = settings.status === "ready" ? settings.values.aiSuggestions : true;
  const localLabelColor: WorkspaceLabelColor =
    settings.status === "ready"
      ? (settings.values.localLabelColor ?? DEFAULT_LOCAL_LABEL_COLOR)
      : DEFAULT_LOCAL_LABEL_COLOR;
  const worktreeLabelColor: WorkspaceLabelColor =
    settings.status === "ready"
      ? (settings.values.worktreeLabelColor ?? DEFAULT_WORKTREE_LABEL_COLOR)
      : DEFAULT_WORKTREE_LABEL_COLOR;

  const { effectiveItems, isLoading } = useEffectiveQuickPrompts({
    projectId,
    lastAssistantText,
    agentStatus: normalizeAgentStatus(agent?.status),
    agentProfileId: activeProfileIds,
    disableEphemeral: !aiSuggestions,
  });

  const handleSelectPrompt = useCallback(
    async (item: QuickPromptItem) => {
      close();
      await executeQuickPrompt({
        item,
        agentId,
        paseo,
        onToastError: (msg) => toast.show(msg),
      });
    },
    [agentId, close, paseo, toast],
  );

  const targetDirectory = workspace?.directory || agent?.cwd || "";
  const branchName = workspace?.branch ?? null;
  const kindBadge = formatWorkspaceKindBadge(workspace?.kind);
  const kindColorKey: WorkspaceLabelColor =
    workspace?.kind === "worktree" ? worktreeLabelColor : localLabelColor;
  const kindColorTheme = resolveWorkspaceLabelColorTheme(
    kindColorKey,
    theme?.colors?.surface1 ?? theme?.colors?.surface0,
  );

  const handleCopy = useCallback(
    async (value: string, label: string) => {
      if (!value) return;
      try {
        await copyText(value);
        toast.show(`Copied ${label}`);
      } catch {
        toast.error(`Failed to copy ${label}`);
      }
    },
    [toast],
  );

  const handleSyncLabels = useCallback(async () => {
    if (syncingLabels) return;
    setSyncingLabels(true);
    try {
      const result = await syncWorkspaceLabels({ force: true });
      toast.show(`Labels synced: ${result.tagged} updated, ${result.skipped} unchanged`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Sync failed: ${message}`);
    } finally {
      setSyncingLabels(false);
    }
  }, [syncWorkspaceLabels, syncingLabels, toast]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 288,
          backgroundColor: layout.compact ? "transparent" : (theme.colors.surface0 ?? "#111"),
          padding: 8,
          gap: 8,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 2,
        },
        headerTitle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.6,
          color: theme.colors.foregroundMuted,
          textTransform: "uppercase",
        },
        settingsTrigger: {
          width: 22,
          height: 22,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
        },
        infoCard: {
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          paddingHorizontal: 8,
          paddingVertical: 6,
          gap: 4,
        },
        infoTopRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        },
        kindBadge: {
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        kindBadgeText: {
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        branchRow: {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
        },
        branchText: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foreground,
          flexShrink: 1,
        },
        pathText: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        actionsRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 5,
        },
        actionChip: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 26,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
        actionChipText: {
          fontSize: 11,
          fontWeight: "500",
          color: theme.colors.foreground,
        },
        sectionTitle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.6,
          color: theme.colors.foregroundMuted,
          textTransform: "uppercase",
          paddingHorizontal: 2,
        },
        grid: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 5,
        },
        card: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          width: "48.9%",
          height: 30,
          paddingHorizontal: 8,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        cardFullWidth: {
          width: "100%",
        },
        cardDynamic: {
          borderColor: theme.colors.accent,
        },
        labelRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          flexShrink: 1,
          minWidth: 0,
        },
        badgeDot: {
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.colors.accent,
        },
        cardText: {
          fontSize: 12,
          fontWeight: "500",
          color: theme.colors.foreground,
        },
        cardTextDynamic: {
          color: theme.colors.foreground,
        },
        shortcutTag: {
          fontSize: 10,
          fontWeight: "500",
          color: theme.colors.foregroundMuted,
          opacity: 0.75,
          marginLeft: 4,
        },
        emptyContainer: {
          paddingVertical: 10,
          paddingHorizontal: 12,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        },
        emptyText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
        },
        emptyConfigButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: 28,
          paddingHorizontal: 12,
          borderRadius: 6,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        emptyConfigText: {
          fontSize: 12,
          fontWeight: "500",
          color: theme.colors.foreground,
        },
      }),
    [theme, layout.compact],
  );

  const isOdd = effectiveItems.length % 2 === 1;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quick Tools</Text>
        {onOpenSettings ? (
          <Pressable
            testID="quick-tools-settings-trigger"
            style={({ pressed }) => [
              styles.settingsTrigger,
              pressed && { opacity: 0.6, backgroundColor: theme.colors.surface2 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Configure Quick Tools"
            onPress={() => {
              onOpenSettings();
              close();
            }}
          >
            <Icon name="Settings" size={13} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>

      {targetDirectory || branchName ? (
        <View style={styles.infoCard} testID="quick-tools-info-card">
          <View style={styles.infoTopRow}>
            <View
              testID="quick-tools-kind-badge"
              style={[
                styles.kindBadge,
                {
                  backgroundColor: kindColorTheme.tint,
                  borderColor: kindColorTheme.border,
                },
              ]}
            >
              <Text style={[styles.kindBadgeText, { color: kindColorTheme.text }]}>
                {kindBadge}
              </Text>
            </View>
            {branchName ? (
              <Pressable
                testID="quick-tools-branch-copy"
                style={({ pressed }) => [styles.branchRow, pressed && { opacity: 0.65 }]}
                accessibilityRole="button"
                accessibilityLabel={`Copy branch ${branchName}`}
                onPress={() => void handleCopy(branchName, "branch")}
              >
                <Icon name="GitBranch" size={11} color={theme.colors.foregroundMuted} />
                <Text style={styles.branchText} numberOfLines={1}>
                  {branchName}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {targetDirectory ? (
            <Pressable
              testID="quick-tools-path-copy"
              style={({ pressed }) => [pressed && { opacity: 0.65 }]}
              accessibilityRole="button"
              accessibilityLabel={`Copy path ${targetDirectory}`}
              onPress={() => void handleCopy(targetDirectory, "path")}
            >
              <Text style={styles.pathText} numberOfLines={1} ellipsizeMode="middle">
                {targetDirectory}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        {targetDirectory ? (
          <Pressable
            testID="quick-tools-action-copy-path"
            style={({ pressed }) => [
              styles.actionChip,
              pressed && { opacity: 0.7, backgroundColor: theme.colors.surface2 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy Path"
            onPress={() => void handleCopy(targetDirectory, "path")}
          >
            <Icon name="Copy" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.actionChipText}>Copy Path</Text>
          </Pressable>
        ) : null}
        {branchName ? (
          <Pressable
            testID="quick-tools-action-copy-branch"
            style={({ pressed }) => [
              styles.actionChip,
              pressed && { opacity: 0.7, backgroundColor: theme.colors.surface2 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy Branch"
            onPress={() => void handleCopy(branchName, "branch")}
          >
            <Icon name="GitBranch" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.actionChipText}>Copy Branch</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="quick-tools-action-sync-labels"
          disabled={syncingLabels}
          style={({ pressed }) => [
            styles.actionChip,
            syncingLabels && { opacity: 0.5 },
            pressed && { opacity: 0.7, backgroundColor: theme.colors.surface2 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Sync Labels"
          onPress={() => void handleSyncLabels()}
        >
          <Icon name="Tag" size={11} color={theme.colors.foregroundMuted} />
          <Text style={styles.actionChipText}>{syncingLabels ? "Syncing…" : "Sync Labels"}</Text>
        </Pressable>
      </View>

      {effectiveItems.length === 0 && !isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No quick prompts</Text>
          {onOpenSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Configure Quick Tools"
              onPress={() => {
                onOpenSettings();
                close();
              }}
              style={styles.emptyConfigButton}
            >
              <Icon name="Settings" size={12} color={theme.colors.foreground} />
              <Text style={styles.emptyConfigText}>Configure Prompts</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Quick Prompts</Text>
          <View style={styles.grid}>
            {effectiveItems.map((item, index) => {
              const isLastOdd = isOdd && index === effectiveItems.length - 1;
              const isDynamic = item.triggerType === "ephemeral" || item.triggerType === "rule";
              const colorConfig =
                item.color && PROMPT_COLOR_PALETTE[item.color]
                  ? PROMPT_COLOR_PALETTE[item.color]
                  : null;
              const hasCustomTint = colorConfig && colorConfig.tint !== "transparent";
              const textColor = colorConfig ? colorConfig.text : theme.colors.foreground;

              return (
                <Pressable
                  key={`btn-${item.id}`}
                  testID={`quick-prompt-chip-${item.id}`}
                  style={({ pressed }) => [
                    styles.card,
                    isLastOdd && styles.cardFullWidth,
                    isDynamic && styles.cardDynamic,
                    hasCustomTint && {
                      backgroundColor: colorConfig.tint,
                      borderColor: colorConfig.border,
                    },
                    pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => handleSelectPrompt(item)}
                >
                  <View style={styles.labelRow}>
                    {item.icon ? (
                      <Icon name={item.icon} size={12} color={textColor} />
                    ) : isDynamic ? (
                      <View style={styles.badgeDot} />
                    ) : null}
                    <Text
                      style={[
                        styles.cardText,
                        colorConfig ? { color: textColor } : isDynamic && styles.cardTextDynamic,
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  </View>

                  {item.shortcut ? (
                    <Text
                      style={[
                        styles.shortcutTag,
                        colorConfig ? { color: textColor, opacity: 0.8 } : undefined,
                      ]}
                      numberOfLines={1}
                    >
                      /{`${item.shortcut}`}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
});

export const QuickPromptsPopover = QuickToolsPopover;
