import React, { memo, useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Volume2, Square, Sparkles, X } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "@/styles/theme";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useAudioBriefStore } from "@/audio-brief/audio-brief-store";

export interface TurnAudioBriefButtonProps {
  agentId?: string;
  turnId?: string;
  getContent: () => string;
  serverId?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export const TurnAudioBriefButton = memo(function TurnAudioBriefButton({
  agentId,
  turnId,
  getContent,
  serverId,
  containerStyle,
}: TurnAudioBriefButtonProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId ?? "");
  const currentTurnId = useAudioBriefStore((s) => s.currentTurnId);
  const status = useAudioBriefStore((s) => s.status);
  const playBrief = useAudioBriefStore((s) => s.playBrief);
  const stopBrief = useAudioBriefStore((s) => s.stopBrief);

  const isCurrent = Boolean(turnId && currentTurnId === turnId);
  const isLoading = isCurrent && status === "loading";
  const isPlaying = isCurrent && status === "playing";

  const handlePress = useCallback(() => {
    if (!agentId || !turnId) return;

    if (isLoading || isPlaying) {
      stopBrief();
      return;
    }

    if (!client) return;

    const content = getContent();
    if (!content) return;

    void playBrief({
      client,
      agentId,
      turnId,
      text: content,
    });
  }, [agentId, turnId, isLoading, isPlaying, client, getContent, playBrief, stopBrief]);

  const pressableStyle = useMemo(() => [stylesheet.button, containerStyle], [containerStyle]);

  const accessibilityLabel = useMemo(() => {
    if (isLoading) {
      return t("message.actions.audioBriefLoading");
    }
    if (isPlaying) {
      return t("message.actions.audioBriefStop");
    }
    return t("message.actions.audioBriefPlay");
  }, [isLoading, isPlaying, t]);

  return (
    <Pressable
      onPress={handlePress}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={turnId ? `turn-audio-brief-${turnId}` : "turn-audio-brief"}
    >
      {({ hovered }: { hovered?: boolean }) => {
        if (isLoading) {
          return <LoadingSpinner size={ICON_SIZE.sm} color={stylesheet.iconColor.color} />;
        }
        if (isPlaying) {
          return (
            <Square
              size={ICON_SIZE.sm}
              color={stylesheet.activeColor.color}
              fill={stylesheet.activeColor.color}
            />
          );
        }
        const iconColor = hovered ? stylesheet.iconHoveredColor.color : stylesheet.iconColor.color;
        return <Volume2 size={ICON_SIZE.sm} color={iconColor} />;
      }}
    </Pressable>
  );
});

export const AudioBriefCard = memo(function AudioBriefCard({ turnId }: { turnId?: string }) {
  const { t } = useTranslation();
  const currentTurnId = useAudioBriefStore((s) => s.currentTurnId);
  const briefText = useAudioBriefStore((s) => s.briefText);
  const status = useAudioBriefStore((s) => s.status);
  const stopBrief = useAudioBriefStore((s) => s.stopBrief);
  const [closed, setClosed] = useState(false);

  const handleClose = useCallback(() => {
    stopBrief();
    setClosed(true);
  }, [stopBrief]);

  if (!turnId || currentTurnId !== turnId || !briefText || closed) {
    return null;
  }

  return (
    <View style={stylesheet.cardContainer} testID={`audio-brief-card-${turnId}`}>
      <View style={stylesheet.cardHeader}>
        <View style={stylesheet.titleBadge}>
          <Sparkles size={13} color={stylesheet.activeColor.color} />
          <Text style={stylesheet.cardTitle}>{t("message.actions.audioBriefTitle")}</Text>
          {status === "playing" && (
            <Text style={stylesheet.playingBadge}>• {t("message.actions.audioBriefPlay")}</Text>
          )}
        </View>
        <Pressable
          onPress={handleClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.close")}
          style={stylesheet.closeButton}
        >
          {({ hovered }: { hovered?: boolean }) => (
            <X
              size={13}
              color={hovered ? stylesheet.iconHoveredColor.color : stylesheet.iconColor.color}
            />
          )}
        </Pressable>
      </View>
      <Text style={stylesheet.cardBody} selectable>
        {briefText}
      </Text>
    </View>
  );
});

const stylesheet = StyleSheet.create((theme) => ({
  button: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
  activeColor: {
    color: theme.colors.accent,
  },
  cardContainer: {
    width: "100%",
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing[1],
  },
  titleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  cardTitle: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  playingBadge: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  closeButton: {
    padding: 2,
  },
  cardBody: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.45),
    color: theme.colors.foreground,
  },
}));
