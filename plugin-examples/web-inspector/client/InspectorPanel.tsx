import React, { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Image } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { inspectUrlRpc, type InspectOutput } from "../shared/inspect";

export function InspectorPanel() {
  const [url, setUrl] = useState("https://example.com");
  const callInspect = useRpc(inspectUrlRpc);

  const mutation = useMutation<InspectOutput, Error, string>({
    mutationFn: async (targetUrl: string) => {
      return callInspect({ url: targetUrl });
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Web Inspector Diagnostics</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="Enter URL to inspect"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[styles.button, mutation.isPending && styles.buttonDisabled]}
          onPress={() => mutation.mutate(url)}
          disabled={mutation.isPending}
        >
          <Text style={styles.buttonText}>{mutation.isPending ? "Running..." : "Inspect"}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.resultContainer}>
        {mutation.isError && <Text style={styles.errorText}>Error: {String(mutation.error)}</Text>}
        {mutation.data && (
          <View style={styles.report}>
            <Text style={styles.summary}>{mutation.data.diagnostics}</Text>

            {mutation.data.screenshotBase64 && (
              <Image
                source={{ uri: `data:image/jpeg;base64,${mutation.data.screenshotBase64}` }}
                style={styles.image}
                resizeMode="contain"
              />
            )}

            <Text style={styles.sectionTitle}>
              Console Errors ({mutation.data.consoleLogs.filter((l) => l.type === "error").length})
            </Text>
            {mutation.data.consoleLogs
              .filter((l) => l.type === "error")
              .map((log, i) => (
                <View key={i} style={styles.logItem}>
                  <Text style={styles.logText}>
                    [{log.type}] {log.text}
                  </Text>
                  {log.location && <Text style={styles.logLocation}>{log.location}</Text>}
                </View>
              ))}

            <Text style={styles.sectionTitle}>
              Network Errors ({mutation.data.networkErrors.length})
            </Text>
            {mutation.data.networkErrors.map((err, i) => (
              <View key={i} style={styles.logItem}>
                <Text style={styles.logText}>
                  {err.status} {err.statusText} - {err.method} {err.url}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  header: { fontSize: 18, fontWeight: "600", marginBottom: 16 },
  inputRow: { flexDirection: "row", marginBottom: 16, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  button: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 6,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "500" },
  resultContainer: { flex: 1 },
  errorText: { color: "red", marginBottom: 8 },
  report: { gap: 16 },
  summary: { fontSize: 16, fontWeight: "500" },
  image: { width: "100%", height: 300, backgroundColor: "#f0f0f0", borderRadius: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "600", marginTop: 8, color: "#333" },
  logItem: { backgroundColor: "#f9f9f9", padding: 8, borderRadius: 4, marginBottom: 4 },
  logText: { fontSize: 12, fontFamily: "monospace", color: "#d32f2f" },
  logLocation: { fontSize: 10, color: "#666", marginTop: 4 },
});
