import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";

export const DEFAULT_RETRY_PROMPT = "请分析刚才执行失败的原因，调整方案并重新尝试完成任务。";

export interface SubagentInlineRetryBarProps {
  onConfirm: (prompt: string) => void;
  onCancel: () => void;
  defaultPrompt?: string;
}

export function SubagentInlineRetryBar({
  onConfirm,
  onCancel,
  defaultPrompt = DEFAULT_RETRY_PROMPT,
}: SubagentInlineRetryBarProps) {
  const [text, setText] = useState<string>(defaultPrompt);

  const handleChangeText = useCallback((value: string) => {
    setText(value);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(text);
  }, [onConfirm, text]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        initialValue={defaultPrompt}
        onChangeText={handleChangeText}
        multiline
        numberOfLines={2}
        placeholder="输入重试指令..."
        accessibilityLabel="重试指令"
      />
      <View style={styles.actionsRow}>
        <Pressable
          style={styles.cancelBtn}
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="取消"
        >
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
        <Pressable
          style={styles.confirmBtn}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="确认重试"
        >
          <Text style={styles.confirmText}>确认重试</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginTop: theme.spacing[1],
    padding: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  input: {
    fontSize: 12,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 44,
    textAlignVertical: "top",
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  cancelBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
  },
  cancelText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  confirmBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.accent,
  },
  confirmText: {
    fontSize: 11,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.accentForeground,
  },
}));
