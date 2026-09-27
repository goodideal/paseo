import React, { memo, useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View, StyleSheet } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { QuickPromptItem } from "../shared/contracts.js";

export interface QuickPromptBarProps {
  items: readonly QuickPromptItem[];
  onSelectPrompt: (item: QuickPromptItem) => void;
  onSelectForEdit: (item: QuickPromptItem) => void;
  onOpenManage: () => void;
  isSubmitDisabled?: boolean;
  theme?: PluginTheme;
}

interface QuickPromptChipProps {
  item: QuickPromptItem;
  onSelectPrompt: (item: QuickPromptItem) => void;
  onSelectForEdit: (item: QuickPromptItem) => void;
  isSubmitDisabled?: boolean;
  theme?: PluginTheme;
}

const QuickPromptChip = memo(function QuickPromptChip({
  item,
  onSelectPrompt,
  onSelectForEdit,
  isSubmitDisabled,
  theme,
}: QuickPromptChipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const handlePress = useCallback(() => {
    if (isSubmitDisabled) return;
    onSelectPrompt(item);
  }, [isSubmitDisabled, item, onSelectPrompt]);

  const handleLongPress = useCallback(() => {
    onSelectForEdit(item);
  }, [item, onSelectForEdit]);

  const isEphemeral = item.triggerType === "ephemeral";
  const isRule = item.triggerType === "rule";

  const accentColor = theme?.colors.accent ?? "#3b82f6";
  const fgColor = theme?.colors.foreground ?? "#f3f4f6";
  const surface2Color = theme?.colors.surface2 ?? "#262626";
  const surface3Color = theme?.colors.surface1 ?? "#333333";
  const borderColor = isEphemeral
    ? accentColor
    : isRule
      ? (theme?.colors.accentForeground ?? "#60a5fa")
      : (theme?.colors.border ?? "#404040");

  return (
    <Pressable
      testID={`quick-prompt-chip-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      delayLongPress={350}
      onPress={handlePress}
      onLongPress={handleLongPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: isHovered || pressed ? surface3Color : surface2Color,
          borderColor,
          opacity: isSubmitDisabled ? 0.65 : 1,
        },
      ]}
    >
      {(isEphemeral || isRule) && <Text style={[styles.iconText, { color: accentColor }]}>✨</Text>}
      <Text
        style={[
          styles.chipText,
          {
            color:
              isEphemeral || isRule ? (theme?.colors.accentForeground ?? accentColor) : fgColor,
            fontWeight: isEphemeral ? "600" : "500",
          },
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {item.label}
      </Text>
    </Pressable>
  );
});

export const QuickPromptBar = memo(function QuickPromptBar({
  items,
  onSelectPrompt,
  onSelectForEdit,
  onOpenManage,
  isSubmitDisabled,
  theme,
}: QuickPromptBarProps) {
  const [isAddHovered, setIsAddHovered] = useState(false);
  const handleAddHoverIn = useCallback(() => setIsAddHovered(true), []);
  const handleAddHoverOut = useCallback(() => setIsAddHovered(false), []);

  if (items.length === 0) {
    return null;
  }

  const surface2 = theme?.colors.surface2 ?? "#262626";
  const surface3 = theme?.colors.surface1 ?? "#333333";
  const border = theme?.colors.border ?? "#404040";
  const fgMuted = theme?.colors.foregroundMuted ?? "#9ca3af";

  return (
    <View style={styles.wrapper} testID="quick-prompt-bar">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="always"
      >
        {items.map((item) => (
          <QuickPromptChip
            key={item.id}
            item={item}
            onSelectPrompt={onSelectPrompt}
            onSelectForEdit={onSelectForEdit}
            isSubmitDisabled={isSubmitDisabled}
            theme={theme}
          />
        ))}

        <Pressable
          testID="quick-prompt-manage-button"
          accessibilityRole="button"
          accessibilityLabel="Manage Quick Prompts"
          onPress={onOpenManage}
          onHoverIn={handleAddHoverIn}
          onHoverOut={handleAddHoverOut}
          style={({ pressed }) => [
            styles.manageButton,
            {
              backgroundColor: isAddHovered || pressed ? surface3 : surface2,
              borderColor: border,
            },
          ]}
        >
          <Text style={[styles.manageIconText, { color: fgMuted }]}>+</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 16,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 9999,
    borderWidth: 1,
  },
  iconText: {
    fontSize: 10,
    marginRight: 2,
  },
  chipText: {
    fontSize: 13,
  },
  manageButton: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9999,
    borderWidth: 1,
  },
  manageIconText: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "600",
  },
});
