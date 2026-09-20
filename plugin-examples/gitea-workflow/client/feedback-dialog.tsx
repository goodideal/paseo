import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";

export interface FeedbackDialogProps {
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}

export function FeedbackDialog({ onSubmit, onCancel }: FeedbackDialogProps) {
  const [text, setText] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }, [onSubmit, text]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reject & Request Changes</Text>
      <TextInput
        style={styles.input}
        placeholder="Explain what needs to be fixed..."
        placeholderTextColor="#6b7280"
        multiline
        value={text}
        onChangeText={setText}
      />
      <View style={styles.actions}>
        <Pressable style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.btnText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.submitBtn} onPress={handleSubmit}>
          <Text style={styles.submitBtnText}>Submit Feedback</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#1c1c1f",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ef4444",
    marginTop: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#f87171",
    marginBottom: 8,
  },
  input: {
    minHeight: 80,
    backgroundColor: "#111113",
    color: "#ffffff",
    padding: 8,
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#2e2e34",
  },
  submitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#ef4444",
  },
  btnText: {
    color: "#ffffff",
    fontSize: 12,
  },
  submitBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "bold",
  },
});
