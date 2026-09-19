import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import type { ScreenshotMetadata } from "../shared/types.js";

export interface ScreenshotGalleryProps {
  screenshots: ScreenshotMetadata[];
}

interface TabButtonProps {
  screenshot: ScreenshotMetadata;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function TabButton({ screenshot, isActive, onSelect }: TabButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(screenshot.id);
  }, [onSelect, screenshot.id]);

  return (
    <Pressable onPress={handlePress} style={isActive ? styles.activeTab : styles.tab}>
      <Text style={isActive ? styles.activeTabText : styles.tabText}>{screenshot.label}</Text>
    </Pressable>
  );
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedId, setSelectedId] = useState<string>(screenshots[0]?.id ?? "");

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  if (screenshots.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No screenshots available yet.</Text>
      </View>
    );
  }

  const active = screenshots.find((s) => s.id === selectedId) ?? screenshots[0];

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {screenshots.map((s) => (
          <TabButton
            key={s.id}
            screenshot={s}
            isActive={s.id === active.id}
            onSelect={handleSelect}
          />
        ))}
      </View>
      <View style={styles.previewBox}>
        <Text style={styles.infoText}>
          Viewport: {active.viewport.width}x{active.viewport.height}
        </Text>
        <Text style={styles.pathText}>Path: {active.relativePath}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: "#161618",
    borderRadius: 8,
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#222226",
  },
  activeTab: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#3b82f6",
  },
  tabText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  activeTabText: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "bold",
  },
  previewBox: {
    height: 200,
    borderWidth: 1,
    borderColor: "#2d2d32",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d0d0e",
  },
  infoText: {
    color: "#e5e7eb",
    fontSize: 13,
  },
  pathText: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 4,
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    color: "#6b7280",
  },
});
