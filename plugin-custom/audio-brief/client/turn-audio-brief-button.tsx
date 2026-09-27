import React, { memo, useCallback } from "react";
import { Pressable, Text } from "react-native";
import type { PluginTurnActionProps } from "@getpaseo/plugin/client";
import { useTurnState, useRpc } from "@getpaseo/plugin/client";
import { audioBriefSynthesizeRpc } from "../shared/contracts.js";
import { useAudioBriefStore } from "./audio-brief-store.js";

export const TurnAudioBriefButton = memo(function TurnAudioBriefButton({
  turnId,
  agentId,
}: PluginTurnActionProps) {
  const turnState = useTurnState();
  const callSynthesizeRpc = useRpc(audioBriefSynthesizeRpc);

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

    const content = turnState.getContent?.() ?? "";
    if (!content) return;

    void playBrief({
      callRpc: callSynthesizeRpc,
      agentId,
      turnId,
      text: content,
    });
  }, [agentId, turnId, isLoading, isPlaying, turnState, playBrief, stopBrief, callSynthesizeRpc]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Audio Brief"
      testID={turnId ? `turn-audio-brief-${turnId}` : "turn-audio-brief"}
      style={{
        paddingHorizontal: 6,
        paddingVertical: 2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 13 }}>{isLoading ? "⏳" : isPlaying ? "⏹" : "🔊"}</Text>
    </Pressable>
  );
});
