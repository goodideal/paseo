import React, { memo, useCallback, useMemo, useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent, useWorkspace, usePaseo, useSettings } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffectiveQuickPrompts } from "./use-quick-prompts.js";
import { resolveActiveAgentProfileIds } from "./quick-prompt-resolver.js";
import { executeQuickPrompt } from "./prompt-executor.js";
import { PROMPT_COLOR_PALETTE } from "./color-palette.js";
import {
  quickPromptsSettings,
  type QuickPromptItem,
  type QuickPromptAgentStatus,
} from "../shared/contracts.js";

export type QuickPromptsPopoverProps = PluginButtonContentProps & {
  workspaceId: string;
  agentId: string;
  onOpenSettings?: () => void;
};

function normalizeAgentStatus(status?: string): QuickPromptAgentStatus {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "idle";
}

export const QuickPromptsPopover = memo(function QuickPromptsPopover({
  workspaceId,
  agentId,
  theme,
  layout,
  close,
  onOpenSettings,
}: QuickPromptsPopoverProps) {
  const paseo = usePaseo();
  const toast = useToast();

  const workspace = useWorkspace(workspaceId, (ws) => ({
    projectId: ws.projectId,
  }));
  const projectId = workspace?.projectId ?? null;

  const agent = useAgent(agentId, (a) => ({
    status: a.status,
    provider: a.provider,
    model: a.model,
    currentModeId: a.currentModeId,
    thinkingOptionId: a.thinkingOptionId,
    labels: a.labels,
  }));

  const [lastAssistantText, setLastAssistantText] = useState<string | null>(null);

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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 280,
          backgroundColor: layout.compact ? "transparent" : (theme.colors.surface0 ?? "#111"),
          padding: 8,
          gap: 6,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 2,
          paddingBottom: 2,
        },
        headerTitle: {
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.6,
          color: theme.colors.foregroundMuted,
          textTransform: "uppercase",
        },
        settingsTrigger: {
          width: 20,
          height: 20,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
        },
        settingsTriggerText: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
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
          paddingVertical: 14,
          paddingHorizontal: 16,
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

  if (effectiveItems.length === 0 && !isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>暂无快捷指令</Text>
          {onOpenSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="配置快捷指令"
              onPress={() => {
                onOpenSettings();
                close();
              }}
              style={styles.emptyConfigButton}
            >
              <Text style={styles.emptyConfigText}>⚙ 配置快捷指令</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const isOdd = effectiveItems.length % 2 === 1;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quick Actions</Text>
        {onOpenSettings ? (
          <Pressable
            testID="quick-prompts-settings-trigger"
            style={({ pressed }) => [
              styles.settingsTrigger,
              pressed && { opacity: 0.6, backgroundColor: theme.colors.surface2 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="管理快捷指令"
            onPress={() => {
              onOpenSettings();
              close();
            }}
          >
            <Text style={styles.settingsTriggerText}>⚙</Text>
          </Pressable>
        ) : null}
      </View>

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
    </View>
  );
});
