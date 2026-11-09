import React, { memo, useCallback, useState, useEffect, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { audioBriefSynthesizeRpc } from "../shared/contracts.js";
import { useAudioBriefStore } from "./audio-brief-store.js";
import { AudioBriefCard } from "./audio-brief-card.js";
import { primeAudioOnUserGesture } from "./platform-player.js";

export type AudioBriefPopoverProps = PluginButtonContentProps & {
  workspaceId: string;
  agentId: string;
  onOpenSettings?: () => void;
};

export const AudioBriefPopover = memo(function AudioBriefPopover({
  workspaceId,
  agentId,
  theme,
  layout,
  close,
  onOpenSettings,
}: AudioBriefPopoverProps) {
  const paseo = usePaseo();
  const callSynthesizeRpc = useRpc(audioBriefSynthesizeRpc);

  const currentTurnId = useAudioBriefStore((s) => s.currentTurnId);
  const status = useAudioBriefStore((s) => s.status);
  const briefText = useAudioBriefStore((s) => s.briefText);
  const playBrief = useAudioBriefStore((s) => s.playBrief);
  const stopBrief = useAudioBriefStore((s) => s.stopBrief);

  const [lastTurn, setLastTurn] = useState<{ id: string; text: string } | null>(null);
  const [fetchingTurn, setFetchingTurn] = useState(false);

  useEffect(() => {
    if (!agentId || !paseo?.agents) return;
    let active = true;

    async function loadLastAssistantMessage() {
      setFetchingTurn(true);
      try {
        const ref = paseo.agents.ref(agentId);
        const page = await ref.timeline.refetch({ direction: "tail", limit: 20 });
        if (!active || !page?.entries) return;

        for (let i = page.entries.length - 1; i >= 0; i--) {
          const entry = page.entries[i];
          if (entry?.item && entry.item.type === "assistant_message") {
            const text = entry.item.text?.trim();
            const itemAny = entry.item as any;
            const id = itemAny.turnId || itemAny.messageId || itemAny.id || (entry as any).id;
            if (text && id) {
              setLastTurn({ id, text });
              return;
            }
          }
        }
      } catch {
        // Ignored
      } finally {
        if (active) setFetchingTurn(false);
      }
    }

    void loadLastAssistantMessage();
    return () => {
      active = false;
    };
  }, [agentId, paseo]);

  const isLoading = status === "loading";
  const isPlaying = status === "playing";

  const handlePlayLatest = useCallback(() => {
    if (!lastTurn || !agentId) return;

    if (isLoading || isPlaying) {
      stopBrief();
      return;
    }

    primeAudioOnUserGesture();

    void playBrief({
      callRpc: callSynthesizeRpc,
      agentId,
      turnId: lastTurn.id,
      text: lastTurn.text,
    });
  }, [lastTurn, agentId, isLoading, isPlaying, stopBrief, playBrief, callSynthesizeRpc]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: layout.compact ? "100%" : 360,
          backgroundColor: theme.colors.surface0,
          borderRadius: 12,
          padding: 12,
          gap: 10,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 6,
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
        playActionCard: {
          padding: 12,
          borderRadius: 8,
          backgroundColor: isPlaying ? theme.colors.surface2 : theme.colors.surface1,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isPlaying ? theme.colors.accent : theme.colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        playActionTextGroup: {
          flex: 1,
          gap: 2,
        },
        playActionTitle: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        playActionSubtitle: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        playButton: {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: isPlaying ? "#78350f" : theme.colors.accent,
        },
        playButtonText: {
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.accentForeground,
        },
        emptyHint: {
          padding: 16,
          alignItems: "center",
          justifyContent: "center",
        },
        emptyHintText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
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
    [theme, layout.compact, isPlaying],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🔊 Audio Brief</Text>
        <View style={styles.headerActions}>
          {onOpenSettings ? (
            <Pressable
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              onPress={() => {
                onOpenSettings();
                close();
              }}
            >
              <Text style={styles.headerButtonText}>⚙️ 设置</Text>
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

      <View style={styles.playActionCard}>
        <View style={styles.playActionTextGroup}>
          <Text style={styles.playActionTitle}>
            {isPlaying ? "正在播放语音简报" : isLoading ? "正在生成简报…" : "播报最新一轮回复"}
          </Text>
          <Text style={styles.playActionSubtitle} numberOfLines={1}>
            {lastTurn
              ? `最新轮次: ${lastTurn.text.slice(0, 30)}...`
              : fetchingTurn
                ? "正在获取最近回复…"
                : "暂无助手回复"}
          </Text>
        </View>
        <Pressable
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "停止播放" : "播放简报"}
          disabled={!lastTurn || fetchingTurn}
          onPress={handlePlayLatest}
        >
          <Text style={styles.playButtonText}>
            {isLoading ? "⏳ 生成中" : isPlaying ? "⏹ 停止" : "▶️ 播报"}
          </Text>
        </Pressable>
      </View>

      {briefText && currentTurnId ? <AudioBriefCard turnId={currentTurnId} /> : null}

      <View style={styles.footer}>
        <Text style={styles.footerText}>AI 语音提炼总结 · 本地/远程 TTS 驱动</Text>
      </View>
    </View>
  );
});
