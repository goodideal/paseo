import React, { memo, useCallback, useMemo, useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent, useWorkspace, usePaseo, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffectiveQuickPrompts } from "./use-quick-prompts.js";
import { resolveActiveAgentProfileIds } from "./quick-prompt-resolver.js";
import { executeQuickPrompt } from "./prompt-executor.js";
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

  useEffect(() => {
    if (!agentId || !paseo?.agents) return;
    let active = true;

    async function loadLastAssistantMessage() {
      try {
        const ref = paseo.agents.ref(agentId);
        const page = await ref.timeline.refetch({ direction: "tail", limit: 20 });
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
      } catch {
        // Ignored
      }
    }

    void loadLastAssistantMessage();
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

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "ai" | "rule" | "general">("all");

  const handleSelectPrompt = useCallback(
    async (item: QuickPromptItem) => {
      const ok = await executeQuickPrompt({
        item,
        agentId,
        paseo,
        onToastError: (msg) => toast.show(msg),
      });
      if (ok) {
        close();
      }
    },
    [agentId, close, paseo, toast],
  );

  const filteredItems = useMemo(() => {
    let result = effectiveItems;
    if (filterType === "ai") {
      result = result.filter((i) => i.triggerType === "ephemeral");
    } else if (filterType === "rule") {
      result = result.filter((i) => i.triggerType === "rule");
    } else if (filterType === "general") {
      result = result.filter((i) => i.triggerType === "fixed");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.content.toLowerCase().includes(q) ||
          Boolean(i.shortcut && i.shortcut.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [effectiveItems, filterType, searchQuery]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 360,
          maxHeight: layout.compact ? 400 : 440,
          backgroundColor: theme.colors.surface0,
          borderRadius: 12,
          padding: 12,
          gap: 10,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 4,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        headerTitle: {
          fontSize: 15,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        headerActions: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        headerButton: {
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: 6,
          backgroundColor: theme.colors.surface2,
        },
        headerButtonText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
        },
        searchBox: {
          backgroundColor: theme.colors.surface1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          fontSize: 13,
          color: theme.colors.foreground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        filterRow: {
          flexDirection: "row",
          gap: 6,
        },
        filterTab: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
        },
        filterTabActive: {
          backgroundColor: theme.colors.accent,
        },
        filterTabText: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        filterTabTextActive: {
          color: theme.colors.accentForeground,
          fontWeight: "500",
        },
        scrollList: {
          flex: 1,
        },
        listContent: {
          gap: 6,
          paddingVertical: 2,
        },
        emptyContainer: {
          padding: 24,
          alignItems: "center",
          justifyContent: "center",
        },
        emptyText: {
          fontSize: 13,
          color: theme.colors.foregroundMuted,
        },
        itemCard: {
          padding: 10,
          borderRadius: 8,
          backgroundColor: theme.colors.surface1,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          gap: 4,
        },
        itemCardAi: {
          borderColor: theme.colors.accent,
        },
        itemTopRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        itemLabel: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.foreground,
          flex: 1,
        },
        itemBadge: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
          backgroundColor: theme.colors.surface2,
          paddingHorizontal: 5,
          paddingVertical: 2,
          borderRadius: 4,
        },
        itemContent: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
          lineHeight: 16,
        },
        footer: {
          paddingTop: 4,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        footerText: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
      }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>✨ Quick Prompts</Text>
        <View style={styles.headerActions}>
          {onOpenSettings ? (
            <Pressable
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel="Manage Prompts"
              onPress={() => {
                onOpenSettings();
                close();
              }}
            >
              <Text style={styles.headerButtonText}>⚙️ 管理</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
          >
            <Text style={styles.headerButtonText}>✕</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        style={styles.searchBox}
        placeholder="搜索快捷指令..."
        placeholderTextColor={theme.colors.foregroundMuted}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <View style={styles.filterRow}>
        <Pressable
          style={[styles.filterTab, filterType === "all" && styles.filterTabActive]}
          onPress={() => setFilterType("all")}
        >
          <Text style={[styles.filterTabText, filterType === "all" && styles.filterTabTextActive]}>
            全部
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filterTab, filterType === "ai" && styles.filterTabActive]}
          onPress={() => setFilterType("ai")}
        >
          <Text style={[styles.filterTabText, filterType === "ai" && styles.filterTabTextActive]}>
            AI推荐
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filterTab, filterType === "rule" && styles.filterTabActive]}
          onPress={() => setFilterType("rule")}
        >
          <Text style={[styles.filterTabText, filterType === "rule" && styles.filterTabTextActive]}>
            规则推荐
          </Text>
        </Pressable>
        <Pressable
          style={[styles.filterTab, filterType === "general" && styles.filterTabActive]}
          onPress={() => setFilterType("general")}
        >
          <Text
            style={[styles.filterTabText, filterType === "general" && styles.filterTabTextActive]}
          >
            常用指令
          </Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scrollList} contentContainerStyle={styles.listContent}>
        {isLoading ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>正在加载提示词…</Text>
          </View>
        ) : filteredItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>无匹配的快捷指令</Text>
          </View>
        ) : (
          filteredItems.map((item) => (
            <Pressable
              key={item.id}
              testID={`quick-prompt-item-${item.id}`}
              style={[styles.itemCard, item.triggerType === "ephemeral" && styles.itemCardAi]}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => handleSelectPrompt(item)}
            >
              <View style={styles.itemTopRow}>
                <Text style={styles.itemLabel} numberOfLines={1}>
                  {item.triggerType === "ephemeral"
                    ? "✨ "
                    : item.triggerType === "rule"
                      ? "⚡ "
                      : ""}
                  {item.label}
                </Text>
                {item.shortcut ? (
                  <Text style={styles.itemBadge}>/{item.shortcut}</Text>
                ) : item.targetModelId ? (
                  <Text style={styles.itemBadge}>{item.targetModelId}</Text>
                ) : null}
              </View>
              <Text style={styles.itemContent} numberOfLines={2}>
                {item.content}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>点击即发 · 或在输入框输入 /快捷键</Text>
      </View>
    </View>
  );
});
