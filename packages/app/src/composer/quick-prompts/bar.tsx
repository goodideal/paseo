import React, { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Plus, Sparkles } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { QuickPromptItem } from "@/stores/quick-prompts-store";

export interface QuickPromptBarProps {
  items: readonly QuickPromptItem[];
  onSelectPrompt: (item: QuickPromptItem) => void;
  onSelectForEdit: (item: QuickPromptItem) => void;
  onOpenManage: () => void;
  isSubmitDisabled?: boolean;
}

interface QuickPromptChipProps {
  item: QuickPromptItem;
  onSelectPrompt: (item: QuickPromptItem) => void;
  onSelectForEdit: (item: QuickPromptItem) => void;
  isSubmitDisabled?: boolean;
}

const QuickPromptChip = memo(function QuickPromptChip({
  item,
  onSelectPrompt,
  onSelectForEdit,
  isSubmitDisabled,
}: QuickPromptChipProps) {
  const { t } = useTranslation();
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

  const handleContextMenu = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      onSelectForEdit(item);
    },
    [item, onSelectForEdit],
  );

  const isEphemeral = item.triggerType === "ephemeral";
  const isRule = item.triggerType === "rule";

  const chipStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.chip,
      isRule && styles.chipRule,
      isEphemeral && styles.chipEphemeral,
      (isHovered || pressed) && styles.chipHovered,
      isSubmitDisabled && styles.chipSubmitDisabled,
    ],
    [isHovered, isRule, isEphemeral, isSubmitDisabled],
  );

  return (
    <Pressable
      testID={`quick-prompt-chip-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityHint={t("composer.quickPrompts.bar.accessibilityHint")}
      delayLongPress={350}
      onPress={handlePress}
      onLongPress={handleLongPress}
      {...{ onContextMenu: handleContextMenu }}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={chipStyle}
    >
      {isEphemeral && (
        <View style={styles.iconWrapper}>
          <Sparkles size={11} color={styles.ephemeralIcon.color} />
        </View>
      )}
      {!isEphemeral && isRule && (
        <View style={styles.iconWrapper}>
          <Sparkles size={11} color={styles.sparkleIcon.color} />
        </View>
      )}
      <Text
        style={[
          styles.chipText,
          isRule && styles.chipTextRule,
          isEphemeral && styles.chipTextEphemeral,
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
}: QuickPromptBarProps) {
  const { t } = useTranslation();
  const [isAddHovered, setIsAddHovered] = useState(false);
  const handleAddHoverIn = useCallback(() => setIsAddHovered(true), []);
  const handleAddHoverOut = useCallback(() => setIsAddHovered(false), []);

  const manageButtonStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.manageButton,
      (isAddHovered || pressed) && styles.manageButtonHovered,
    ],
    [isAddHovered],
  );

  if (items.length === 0) {
    return null;
  }

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
          />
        ))}

        <Pressable
          testID="quick-prompt-manage-button"
          accessibilityRole="button"
          accessibilityLabel={t("composer.quickPrompts.bar.manageAccessibility")}
          onPress={onOpenManage}
          onHoverIn={handleAddHoverIn}
          onHoverOut={handleAddHoverOut}
          style={manageButtonStyle}
        >
          <Plus size={14} color={styles.manageIcon.color} />
        </Pressable>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  wrapper: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5] ?? 6,
    paddingRight: theme.spacing[4],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.full ?? 9999,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    userSelect: "none",
  },
  chipEphemeral: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface3 ?? theme.colors.surface2,
  },
  chipRule: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface3 ?? theme.colors.surface2,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface3 ?? theme.colors.surface2,
    borderColor: theme.colors.accent,
  },
  chipSubmitDisabled: {
    opacity: 0.65,
  },
  iconWrapper: {
    marginRight: -1,
  },
  sparkleIcon: {
    color: theme.colors.accent,
  },
  ephemeralIcon: {
    color: theme.colors.accent,
  },
  chipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: "500",
    userSelect: "none",
  },
  chipTextEphemeral: {
    color: theme.colors.accentBright ?? theme.colors.accent,
    fontWeight: "600",
  },
  chipTextRule: {
    color: theme.colors.accentBright ?? theme.colors.accent,
  },
  manageButton: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full ?? 9999,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  manageButtonHovered: {
    backgroundColor: theme.colors.surface3 ?? theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  manageIcon: {
    color: theme.colors.foregroundMuted,
  },
}));
