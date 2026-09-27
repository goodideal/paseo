import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image, Modal } from "react-native";
import type { ScreenshotMetadata } from "../shared/types.js";

export interface ScreenshotGalleryProps {
  screenshots: ScreenshotMetadata[];
}

interface TabButtonProps {
  screenshot: ScreenshotMetadata;
  isActive: boolean;
  onSelect: (id: string) => void;
}

const TabButton = React.memo(function TabButton({
  screenshot,
  isActive,
  onSelect,
}: TabButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(screenshot.id);
  }, [onSelect, screenshot.id]);

  const icon = screenshot.id.includes("mobile") ? "📱" : "💻";
  const tabStyle = isActive ? styles.activeTab : styles.tab;
  const textStyle = isActive ? styles.activeTabText : styles.tabText;

  return (
    <Pressable onPress={handlePress} style={tabStyle} accessibilityRole="button">
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={textStyle}>{screenshot.label}</Text>
    </Pressable>
  );
});

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedId, setSelectedId] = useState<string>(screenshots[0]?.id ?? "");
  const [isZoomed, setIsZoomed] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const openZoom = useCallback(() => setIsZoomed(true), []);
  const closeZoom = useCallback(() => setIsZoomed(false), []);

  const active = useMemo(
    () => screenshots.find((s) => s.id === selectedId) ?? screenshots[0],
    [screenshots, selectedId],
  );

  const imageSource = useMemo(
    () => (active?.dataUri ? { uri: active.dataUri } : undefined),
    [active?.dataUri],
  );

  const formattedTime = useMemo(() => {
    if (!active?.capturedAt) return "";
    return new Date(active.capturedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [active?.capturedAt]);

  if (screenshots.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🖼️</Text>
        <Text style={styles.emptyTitle}>No Visual Proof Available</Text>
        <Text style={styles.emptySubtitle}>
          Screenshots will be automatically captured once dev server starts.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Device Switcher Tab Bar */}
      <View style={styles.tabBar}>
        <View style={styles.tabGroup}>
          {screenshots.map((s) => (
            <TabButton
              key={s.id}
              screenshot={s}
              isActive={s.id === active.id}
              onSelect={handleSelect}
            />
          ))}
        </View>
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeText}>
            {active.viewport.width} × {active.viewport.height}
          </Text>
          {formattedTime ? <Text style={styles.metaTimeText}>{formattedTime}</Text> : null}
        </View>
      </View>

      {/* Main Preview Container */}
      <Pressable style={styles.previewBox} onPress={openZoom} accessibilityHint="Click to zoom in">
        {imageSource ? (
          <Image source={imageSource} style={styles.imagePreview} resizeMode="contain" />
        ) : (
          <View style={styles.placeholderContainer}>
            <Text style={styles.placeholderIcon}>📸</Text>
            <Text style={styles.placeholderText}>Screenshot captured to disk</Text>
            <Text style={styles.pathText}>{active.relativePath}</Text>
          </View>
        )}

        {/* Hover/Overlay affordance */}
        <View style={styles.zoomAffordance}>
          <Text style={styles.zoomAffordanceText}>🔍 Click to Enlarge</Text>
        </View>
      </Pressable>

      {/* Lightbox Modal */}
      <Modal visible={isZoomed} transparent animationType="fade" onRequestClose={closeZoom}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>{active.label}</Text>
              <Text style={styles.modalSubtitle}>
                {active.viewport.width}×{active.viewport.height} px • {active.relativePath}
              </Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={closeZoom}>
              <Text style={styles.closeBtnText}>✕ Close</Text>
            </Pressable>
          </View>
          <View style={styles.modalImageContainer}>
            {imageSource ? (
              <Image source={imageSource} style={styles.modalImage} resizeMode="contain" />
            ) : (
              <View style={styles.placeholderContainer}>
                <Text style={styles.placeholderText}>{active.relativePath}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14,
    backgroundColor: "#13151b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#222634",
    marginTop: 10,
  },
  tabBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    flexWrap: "wrap",
    gap: 8,
  },
  tabGroup: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: "#1a1e28",
    borderWidth: 1,
    borderColor: "#2a3040",
  },
  activeTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    backgroundColor: "#2e3856",
    borderWidth: 1,
    borderColor: "#6366f1",
  },
  tabIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  tabText: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500",
  },
  activeTabText: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "600",
  },
  metaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 5,
    backgroundColor: "#1a1e29",
  },
  metaBadgeText: {
    color: "#818cf8",
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "600",
  },
  metaTimeText: {
    color: "#64748b",
    fontSize: 11,
  },
  previewBox: {
    width: "100%",
    height: 260,
    borderWidth: 1,
    borderColor: "#222634",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#0a0c10",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreview: {
    width: "100%",
    height: "100%",
  },
  placeholderContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  placeholderIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  placeholderText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "500",
  },
  pathText: {
    color: "#64748b",
    fontSize: 11,
    marginTop: 4,
    fontFamily: "monospace",
  },
  zoomAffordance: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#334155",
  },
  zoomAffordanceText: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "500",
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#13151b",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#222634",
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  emptyTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptySubtitle: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "center",
    maxWidth: 280,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.92)",
    padding: 24,
    justifyContent: "center",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: "#94a3b8",
    fontSize: 12,
    fontFamily: "monospace",
    marginTop: 2,
  },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#334155",
  },
  closeBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  modalImageContainer: {
    flex: 1,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalImage: {
    width: "100%",
    height: "100%",
  },
});
