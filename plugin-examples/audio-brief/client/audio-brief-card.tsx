import React, { memo, useCallback, useState } from "react";
import { View, Text, Pressable } from "react-native";
import type { PluginTurnActionProps } from "@getpaseo/plugin/client";
import { useAudioBriefStore } from "./audio-brief-store.js";

export const AudioBriefCard = memo(function AudioBriefCard({ turnId }: PluginTurnActionProps) {
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
          marginBottom: 6,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "600", color: "#f59e0b" }}>
          ✨ AUDIO BRIEF {status === "playing" ? "• PLAYING" : ""}
        </Text>
        <Pressable onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={{ fontSize: 13, color: "#888" }}>✕</Text>
        </Pressable>
      </View>
      <Text style={{ fontSize: 13, lineHeight: 18, color: "#eee" }} selectable>
        {briefText}
      </Text>
    </View>
  );
});
