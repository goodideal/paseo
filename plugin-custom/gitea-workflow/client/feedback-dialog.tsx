import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";

export interface FeedbackDialogProps {
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}

const PRESET_TAGS = [
  "🎨 Visual / CSS Defect",
  "🧪 Missing Unit Test",
  "⚠️ Unhandled Edge Case",
  "⚡ Performance Regressed",
  "📝 Documentation / Naming",
] as const;

interface TagPillProps {
  tag: string;
  onSelect: (tag: string) => void;
}

const TagPill = React.memo(function TagPill({ tag, onSelect }: TagPillProps) {
  const handlePress = useCallback(() => {
    onSelect(tag);
  }, [tag, onSelect]);

  return (
    <Pressable style={styles.tagPill} onPress={handlePress}>
      <Text style={styles.tagPillText}>{tag}</Text>
    </Pressable>
  );
});

export function FeedbackDialog({ onSubmit, onCancel }: FeedbackDialogProps) {
  const [text, setText] = useState("");

  const handleAddTag = useCallback((tag: string) => {
    setText((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return `[${tag}] `;
      return `${trimmed}\n- [${tag}] `;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }, [onSubmit, text]);

  const canSubmit = text.trim().length > 0;
  const submitStyle = canSubmit ? styles.submitBtn : styles.submitBtnDisabled;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.badgeWarning}>
          <Text style={styles.badgeWarningText}>CHANGE REQUEST</Text>
        </View>
        <Text style={styles.title}>Guide the Agent&apos;s Next Iteration</Text>
      </View>

      <Text style={styles.subtitle}>
        Provide actionable feedback. The agent will resume coding in the existing worktree to fix
        issues.
      </Text>

      {/* Preset Quick Tags */}
      <View style={styles.tagSection}>
        <Text style={styles.tagLabel}>Quick Tags:</Text>
        <View style={styles.tagsRow}>
          {PRESET_TAGS.map((tag) => (
            <TagPill key={tag} tag={tag} onSelect={handleAddTag} />
          ))}
        </View>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Describe the defect, expected behavior, or missing test cases..."
        placeholderTextColor="#64748b"
        multiline
        value={text}
        onChangeText={setText}
        numberOfLines={4}
      />

      <View style={styles.footer}>
        <Text style={styles.charCount}>{text.length} characters</Text>
        <View style={styles.actions}>
          <Pressable style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable style={submitStyle} onPress={handleSubmit} disabled={!canSubmit}>
            <Text style={styles.submitBtnText}>Dispatch Fix to Agent</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#161922",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e11d48",
    marginTop: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  badgeWarning: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#e11d48",
  },
  badgeWarningText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f8fafc",
  },
  subtitle: {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 18,
    marginBottom: 12,
  },
  tagSection: {
    marginBottom: 10,
  },
  tagLabel: {
    fontSize: 11,
    color: "#64748b",
    marginBottom: 6,
    fontWeight: "500",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: "#202533",
    borderWidth: 1,
    borderColor: "#30374a",
  },
  tagPillText: {
    color: "#cbd5e1",
    fontSize: 11,
  },
  input: {
    minHeight: 90,
    backgroundColor: "#0d0e12",
    color: "#f8fafc",
    padding: 10,
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 18,
    borderWidth: 1,
    borderColor: "#252b3b",
    textAlignVertical: "top",
    marginBottom: 10,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  charCount: {
    color: "#64748b",
    fontSize: 11,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: "#222634",
  },
  cancelBtnText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "500",
  },
  submitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: "#e11d48",
  },
  submitBtnDisabled: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: "#4c1d24",
    opacity: 0.6,
  },
  submitBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
});
