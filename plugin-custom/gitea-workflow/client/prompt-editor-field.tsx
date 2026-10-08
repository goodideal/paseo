import React, { useState, useEffect } from "react";
import { View, Text, Pressable, TextInput, Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export interface PromptEditorFieldProps {
  label: string;
  hint: string;
  value: string;
  placeholder?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  disabled?: boolean;
  onChangeText: (text: string) => void;
  theme: PluginTheme;
  rows?: number;
}

export function PromptEditorField({
  label,
  hint,
  value,
  placeholder,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  disabled,
  onChangeText,
  theme,
  rows = 12,
}: PromptEditorFieldProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (text: string) => {
    setLocalValue(text);
    onChangeText(text);
  };

  const monoFont = Platform.select({
    web: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    default: "monospace",
  });

  return (
    <View style={{ paddingVertical: 16, paddingHorizontal: 16 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 10,
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.foreground }}>
            {label}
          </Text>
          {hint ? (
            <Text
              style={{
                fontSize: 12,
                color: theme.colors.foregroundMuted,
                marginTop: 3,
                lineHeight: 17,
              }}
            >
              {hint}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {secondaryActionLabel && onSecondaryAction ? (
            <Pressable
              role="button"
              accessibilityRole="button"
              disabled={disabled}
              onPress={onSecondaryAction}
              style={({ pressed }: any) => ({
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface0,
                opacity: disabled ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 12, color: theme.colors.foreground, fontWeight: "500" }}>
                {secondaryActionLabel}
              </Text>
            </Pressable>
          ) : null}

          {actionLabel && onAction ? (
            <Pressable
              role="button"
              accessibilityRole="button"
              disabled={disabled}
              onPress={onAction}
              style={({ pressed }: any) => ({
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface0,
                opacity: disabled ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 12, color: theme.colors.foreground, fontWeight: "500" }}>
                {actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <TextInput
        aria-label={label}
        accessibilityLabel={label}
        value={localValue}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        editable={!disabled}
        multiline={true}
        numberOfLines={rows}
        style={{
          minHeight: 220,
          width: "100%",
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: isFocused ? theme.colors.accent : theme.colors.border,
          backgroundColor: theme.colors.surface0,
          color: theme.colors.foreground,
          fontFamily: monoFont,
          fontSize: 12.5,
          lineHeight: 19,
          textAlignVertical: "top",
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />
    </View>
  );
}
