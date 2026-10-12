import React, { memo, useCallback, useState } from "react";
import { View, Text, Pressable } from "react-native";
import type { PluginTurnActionProps } from "@getpaseo/plugin/client";
import { useAudioBriefStore } from "./audio-brief-store.js";

export const AudioBriefCard = memo(function AudioBriefCard({ turnId }: PluginTurnActionProps) {
  const currentTurnId = useAudioBriefStore((s) => s.currentTurnId);
  const briefText = useAudioBriefStore((s) => s.briefText);
  const audioBase64 = useAudioBriefStore((s) => s.audioBase64);
  const status = useAudioBriefStore((s) => s.status);
  const error = useAudioBriefStore((s) => s.error);
  const pauseAudio = useAudioBriefStore((s) => s.pauseAudio);
  const replayAudio = useAudioBriefStore((s) => s.replayAudio);
  const stopBrief = useAudioBriefStore((s) => s.stopBrief);
  const [closed, setClosed] = useState(false);

  React.useEffect(() => {
    if (status === "loading" || status === "playing") {
      setClosed(false);
    }
  }, [status]);

  const handleClose = useCallback(() => {
    stopBrief();
    setClosed(true);
  }, [stopBrief]);

  const handleTogglePlayback = useCallback(() => {
    if (status === "playing") {
      pauseAudio();
    } else {
      replayAudio();
    }
  }, [status, pauseAudio, replayAudio]);

  if (!turnId || currentTurnId !== turnId || !briefText || closed) {
    return null;
  }

  const isPlaying = status === "playing";

  return (
    <View
      testID={`audio-brief-card-${turnId}`}
      style={{
        width: "100%",
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#333",
        backgroundColor: "#1e1e1e",
        marginVertical: 4,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#f59e0b" }}>
            ✨ AUDIO BRIEF {isPlaying ? "• 播放中" : ""}
          </Text>
          {audioBase64 || briefText ? (
            <Pressable
              onPress={handleTogglePlayback}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? "停止播放" : "播放语音"}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: isPlaying ? "#78350f" : "#27272a",
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: isPlaying ? "#f59e0b" : "#3f3f46",
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "500",
                  color: isPlaying ? "#fef3c7" : "#e4e4e7",
                }}
              >
                {isPlaying ? "⏹ 停止" : "▶️ 播放语音"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={{ fontSize: 13, color: "#888", padding: 4 }}>✕</Text>
        </Pressable>
      </View>
      {error ? (
        <View
          style={{
            marginBottom: 8,
            padding: 8,
            borderRadius: 6,
            backgroundColor: "rgba(239, 68, 68, 0.12)",
            borderWidth: 1,
            borderColor: "rgba(239, 68, 68, 0.25)",
          }}
        >
          <Text style={{ fontSize: 11, color: "#fca5a5", lineHeight: 16 }}>
            提示: 手机/浏览器限制了异步自动发音，请直接点击上方「▶️ 播放语音」按钮收听。
          </Text>
        </View>
      ) : null}
      <Text style={{ fontSize: 13, lineHeight: 18, color: "#eee" }} selectable>
        {briefText}
      </Text>
    </View>
  );
});
