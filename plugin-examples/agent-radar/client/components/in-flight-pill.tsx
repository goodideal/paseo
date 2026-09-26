import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import type { InFlightHeartbeat } from "../../shared/types.js";
import { interruptAgentRpc } from "../../shared/rpc.js";
import { useRpc } from "@getpaseo/plugin/client";

interface InFlightPillProps {
  heartbeat: InFlightHeartbeat;
}

export function InFlightPill({ heartbeat }: InFlightPillProps) {
  const [isInterrupting, setIsInterrupting] = useState(false);
  const interruptAgent = useRpc(interruptAgentRpc);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleInterrupt = async () => {
    if (isInterrupting) return;
    setIsInterrupting(true);
    try {
      await interruptAgent({ agentId: heartbeat.agentId });
    } catch (err) {
      console.error("Failed to interrupt agent", err);
    } finally {
      setIsInterrupting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.pillBox}>
        <ActivityIndicator size="small" color="#0a7ea4" style={styles.spinner} />
        <View style={styles.contentBox}>
          <Text style={styles.titleText}>
            {heartbeat.subagentNickname ? `${heartbeat.subagentNickname} ` : "Agent "}
            <Text style={styles.toolName}>{heartbeat.currentToolName}</Text>
          </Text>
          <Text style={styles.descText} numberOfLines={1}>
            {heartbeat.statusDescription} ({formatTime(heartbeat.elapsedSeconds)})
          </Text>
        </View>

        <Pressable
          onPress={handleInterrupt}
          disabled={isInterrupting}
          accessibilityRole="button"
          accessibilityLabel="强制中断等待"
          style={({ pressed }) => [
            styles.interruptButton,
            pressed && styles.interruptButtonPressed,
            isInterrupting && styles.interruptButtonDisabled,
          ]}
        >
          <Text style={styles.interruptText}>{isInterrupting ? "中断中..." : "强制中断"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    marginVertical: 6,
    alignItems: "center",
  },
  pillBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e6e8eb",
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
    maxWidth: "92%",
  },
  spinner: {
    marginRight: 8,
  },
  contentBox: {
    flex: 1,
    marginRight: 8,
  },
  titleText: {
    fontSize: 12,
    color: "#495057",
    fontWeight: "500",
  },
  toolName: {
    fontWeight: "700",
    color: "#212529",
  },
  descText: {
    fontSize: 11,
    color: "#868e96",
    marginTop: 1,
  },
  interruptButton: {
    backgroundColor: "#fff5f5",
    borderWidth: 1,
    borderColor: "#ffc9c9",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 6,
  },
  interruptButtonPressed: {
    backgroundColor: "#ffe3e3",
  },
  interruptButtonDisabled: {
    opacity: 0.6,
  },
  interruptText: {
    fontSize: 11,
    color: "#fa5252",
    fontWeight: "700",
  },
});
