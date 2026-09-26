import React, { useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import type { DecisionOption } from "../../shared/types.js";

interface ActionButtonsProps {
  options: DecisionOption[];
  onSelect: (optionId: string) => Promise<void>;
  disabled?: boolean;
}

export function ActionButtons({ options, onSelect, disabled }: ActionButtonsProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const handlePress = useCallback(
    async (optionId: string) => {
      if (disabled || submittingId !== null) return;
      setSubmittingId(optionId);
      try {
        await onSelect(optionId);
      } finally {
        setSubmittingId(null);
      }
    },
    [disabled, submittingId, onSelect],
  );

  if (!options || options.length === 0) return null;

  return (
    <View style={styles.container}>
      {options.map((opt, index) => {
        const isPrimary = index === 0;
        const isSubmitting = submittingId === opt.id;
        const isDisabled = disabled || (submittingId !== null && !isSubmitting);

        return (
          <View
            key={opt.id}
            style={[
              styles.buttonWrapper,
              isPrimary ? styles.primaryWrapper : styles.secondaryWrapper,
            ]}
          >
            <Pressable
              onPress={() => handlePress(opt.id)}
              disabled={isDisabled}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              style={({ pressed }) => [
                styles.buttonInner,
                isPrimary ? styles.primaryInner : styles.secondaryInner,
                pressed && (isPrimary ? styles.primaryPressed : styles.secondaryPressed),
                isDisabled && styles.disabled,
              ]}
            >
              <View style={styles.contentContainer}>
                {isSubmitting && (
                  <ActivityIndicator
                    size="small"
                    color={isPrimary ? "#fff" : "#11181C"}
                    style={styles.spinner}
                  />
                )}
                <Text
                  style={[
                    styles.buttonText,
                    isPrimary ? styles.primaryText : styles.secondaryText,
                    isDisabled && styles.disabledText,
                  ]}
                >
                  {opt.label}
                </Text>
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  buttonWrapper: {
    borderRadius: 8,
    overflow: "hidden",
  },
  primaryWrapper: {
    backgroundColor: "#0a7ea4",
  },
  secondaryWrapper: {
    backgroundColor: "#f1f3f5",
    borderWidth: 1,
    borderColor: "#e6e8eb",
  },
  buttonInner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 36,
  },
  primaryInner: {
    backgroundColor: "transparent",
  },
  secondaryInner: {
    backgroundColor: "transparent",
  },
  primaryPressed: {
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  secondaryPressed: {
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  disabled: {
    opacity: 0.6,
  },
  contentContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  spinner: {
    marginRight: 2,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  primaryText: {
    color: "#ffffff",
  },
  secondaryText: {
    color: "#11181C",
  },
  disabledText: {
    opacity: 0.8,
  },
});
