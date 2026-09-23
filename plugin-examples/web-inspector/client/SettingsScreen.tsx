import React, { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { authSettings } from "../shared/settings";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

export function SettingsScreen(props: PluginSurfaceProps) {
  const state = useSettings(authSettings);
  const [cookieString, setCookieString] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");

  useEffect(() => {
    if (state.status === "ready") {
      setCookieString(state.values.cookieString || "");
      setExtraHeaders(state.values.extraHeaders || "");
    }
  }, [state.status, state.status === "ready" ? state.revision : undefined]);

  const handleSave = async () => {
    if (state.status === "ready" || state.status === "invalid") {
      await state.save({ cookieString, extraHeaders }, state.revision);
    }
  };

  if (state.status === "loading") {
    return (
      <View style={styles.container}>
        <Text>Loading settings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Authentication Settings</Text>
      <Text style={styles.description}>
        Inject cookies or headers to allow the Web Inspector to bypass login walls.
      </Text>

      <Text style={styles.label}>Cookie String (e.g., "session_id=123; user_id=456")</Text>
      <TextInput
        style={styles.input}
        value={cookieString}
        onChangeText={setCookieString}
        placeholder="session_id=abc..."
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Extra HTTP Headers (JSON format)</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={extraHeaders}
        onChangeText={setExtraHeaders}
        placeholder='{"Authorization": "Bearer token"}'
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Pressable
        style={[styles.button, state.saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={state.saving}
      >
        <Text style={styles.buttonText}>{state.saving ? "Saving..." : "Save Config"}</Text>
      </Pressable>

      {state.saveError && <Text style={styles.errorText}>Error: {state.saveError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  header: { fontSize: 20, fontWeight: "600", marginBottom: 8 },
  description: { fontSize: 14, color: "#666", marginBottom: 24 },
  label: { fontSize: 14, fontWeight: "500", marginBottom: 8, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 8,
    backgroundColor: "#fff",
  },
  textarea: { height: 100, textAlignVertical: "top", fontFamily: "monospace" },
  button: {
    backgroundColor: "#007AFF",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "600" },
  errorText: { color: "red", marginTop: 8 },
});
