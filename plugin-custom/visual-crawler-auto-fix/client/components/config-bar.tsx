import React, { useCallback } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { styles } from "./styles.js";

export interface ConfigBarProps {
  targetUrl: string;
  onChangeTargetUrl: (url: string) => void;
  maxHops: number;
  onChangeMaxHops: (hops: number) => void;
  maxDepth: number;
  onChangeMaxDepth: (depth: number) => void;
  timeWindowEnabled: boolean;
  onToggleTimeWindow: (enabled: boolean) => void;
  windowStart: string;
  onChangeWindowStart: (val: string) => void;
  windowEnd: string;
  onChangeWindowEnd: (val: string) => void;
  isRunning: boolean;
  onStartCrawl: () => void;
  onStopCrawl: () => void;
  onSaveSchedule: () => void;
}

export const ConfigBar = React.memo(function ConfigBar({
  targetUrl,
  onChangeTargetUrl,
  maxHops,
  onChangeMaxHops,
  maxDepth,
  onChangeMaxDepth,
  timeWindowEnabled,
  onToggleTimeWindow,
  windowStart,
  onChangeWindowStart,
  windowEnd,
  onChangeWindowEnd,
  isRunning,
  onStartCrawl,
  onStopCrawl,
  onSaveSchedule,
}: ConfigBarProps) {
  const handleHopsChange = useCallback(
    (text: string) => {
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > 0) {
        onChangeMaxHops(num);
      }
    },
    [onChangeMaxHops],
  );

  const handleDepthChange = useCallback(
    (text: string) => {
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > 0) {
        onChangeMaxDepth(num);
      }
    },
    [onChangeMaxDepth],
  );

  return (
    <View style={styles.inputGroup}>
      {/* Target URL */}
      <View style={styles.inputRow}>
        <Text style={[styles.inputLabel, { width: 70 }]}>Target URL</Text>
        <TextInput
          style={[styles.textInput, { flex: 1 }]}
          value={targetUrl}
          onChangeText={onChangeTargetUrl}
          placeholder="https://example.com or http://localhost:3000"
          placeholderTextColor="#656D76"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isRunning}
        />
      </View>

      {/* Hops & Depth Limits */}
      <View style={styles.inputRow}>
        <Text style={[styles.inputLabel, { width: 70 }]}>Limits</Text>
        <Text style={styles.inputLabel}>Hops:</Text>
        <TextInput
          style={[styles.textInput, { width: 55, textAlign: "center" }]}
          value={String(maxHops)}
          onChangeText={handleHopsChange}
          keyboardType="numeric"
          editable={!isRunning}
        />
        <Text style={styles.inputLabel}>Depth:</Text>
        <TextInput
          style={[styles.textInput, { width: 55, textAlign: "center" }]}
          value={String(maxDepth)}
          onChangeText={handleDepthChange}
          keyboardType="numeric"
          editable={!isRunning}
        />

        {/* Quick chips */}
        <Pressable
          style={styles.buttonOutline}
          onPress={() => onChangeMaxHops(50)}
          disabled={isRunning}
        >
          <Text style={styles.buttonOutlineText}>50 Hops</Text>
        </Pressable>
        <Pressable
          style={styles.buttonOutline}
          onPress={() => onChangeMaxHops(100)}
          disabled={isRunning}
        >
          <Text style={styles.buttonOutlineText}>100 Hops</Text>
        </Pressable>
      </View>

      {/* Night Schedule & Time Window */}
      <View style={styles.inputRow}>
        <Text style={[styles.inputLabel, { width: 70 }]}>Schedule</Text>
        <Pressable
          style={[
            styles.buttonOutline,
            timeWindowEnabled
              ? { borderColor: "#2EA043", backgroundColor: "rgba(46, 160, 67, 0.15)" }
              : undefined,
          ]}
          onPress={() => onToggleTimeWindow(!timeWindowEnabled)}
          disabled={isRunning}
        >
          <Text style={styles.buttonOutlineText}>
            {timeWindowEnabled ? "Window Active" : "Enable Window"}
          </Text>
        </Pressable>

        {timeWindowEnabled && (
          <>
            <TextInput
              style={[styles.textInput, { width: 60, textAlign: "center" }]}
              value={windowStart}
              onChangeText={onChangeWindowStart}
              placeholder="23:00"
              placeholderTextColor="#656D76"
              editable={!isRunning}
            />
            <Text style={styles.inputLabel}>to</Text>
            <TextInput
              style={[styles.textInput, { width: 60, textAlign: "center" }]}
              value={windowEnd}
              onChangeText={onChangeWindowEnd}
              placeholder="06:00"
              placeholderTextColor="#656D76"
              editable={!isRunning}
            />
          </>
        )}

        <Pressable
          style={[styles.buttonOutline, { marginLeft: "auto" }]}
          onPress={onSaveSchedule}
          disabled={isRunning}
        >
          <Text style={styles.buttonOutlineText}>Save Schedule</Text>
        </Pressable>
      </View>

      {/* Action Buttons */}
      <View style={[styles.controlsRow, { marginTop: 4 }]}>
        {!isRunning ? (
          <Pressable style={styles.buttonPrimary} onPress={onStartCrawl}>
            <Text style={styles.buttonPrimaryText}>Run Crawl Now</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.buttonDanger} onPress={onStopCrawl}>
            <Text style={styles.buttonDangerText}>Stop Crawl</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});
