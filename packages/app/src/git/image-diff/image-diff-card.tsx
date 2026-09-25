import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  ActivityIndicator,
  Pressable,
  Modal,
  ImageBackground,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useIsCompactFormFactor } from "@/constants/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { X, ZoomIn } from "lucide-react-native";
import { ZoomableImage } from "@/components/zoomable-viewport/image";

export interface ImageDiffCardProps {
  file: ParsedDiffFile;
  serverId?: string;
  cwd: string;
  baseRef?: string;
  targetRef?: string;
  client: DaemonClient | null;
}

interface ImageDetails {
  uri: string;
  width: number;
  height: number;
  size: number;
}

const CHECKERBOARD_SVG =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"%3E%3Crect width="8" height="8" fill="%2322272e"/%3E%3Crect x="8" width="8" height="8" fill="%231c2128"/%3E%3Crect y="8" width="8" height="8" fill="%231c2128"/%3E%3Crect x="8" y="8" width="8" height="8" fill="%2322272e"/%3E%3C/svg%3E';
const CHECKERBOARD_SVG_SOURCE = { uri: CHECKERBOARD_SVG };
const CHECKERBOARD_IMAGE_STYLE = { resizeMode: "repeat" as const };

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function resolveImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 }),
    );
  });
}

async function fetchBeforeImage(
  client: DaemonClient,
  cwd: string,
  baseRef: string,
  path: string,
): Promise<ImageDetails | null> {
  const blobRes = await client.readGitBlob(cwd, baseRef, path);
  if (blobRes.status !== "ok") return null;
  const uri = `data:${blobRes.mimeType};base64,${blobRes.base64Data}`;
  const dimensions = await resolveImageDimensions(uri);
  return { uri, width: dimensions.width, height: dimensions.height, size: blobRes.size };
}

async function fetchAfterImage(
  client: DaemonClient,
  cwd: string,
  path: string,
  targetRef: string | undefined,
): Promise<ImageDetails | null> {
  if (targetRef) {
    const blobRes = await client.readGitBlob(cwd, targetRef, path);
    if (blobRes.status !== "ok") return null;
    const uri = `data:${blobRes.mimeType};base64,${blobRes.base64Data}`;
    const dimensions = await resolveImageDimensions(uri);
    return { uri, width: dimensions.width, height: dimensions.height, size: blobRes.size };
  }

  const fileRes = await client.readFile(cwd, path);
  if (!fileRes?.bytes) return null;
  const base64 = uint8ArrayToBase64(fileRes.bytes);
  const uri = `data:${fileRes.mime};base64,${base64}`;
  const dimensions = await resolveImageDimensions(uri);
  return { uri, width: dimensions.width, height: dimensions.height, size: fileRes.size };
}

interface DiffSideCardProps {
  label: string;
  variant: "muted" | "warning" | "error" | "success";
  data: ImageDetails | null;
  deltaLabel?: string | null;
  onZoom: (uri: string) => void;
}

const DiffSideCard = memo(function DiffSideCard({
  label,
  variant,
  data,
  deltaLabel,
  onZoom,
}: DiffSideCardProps) {
  const handlePress = useCallback(() => {
    if (data?.uri) onZoom(data.uri);
  }, [data?.uri, onZoom]);

  const imageSource = useMemo(() => (data ? { uri: data.uri } : undefined), [data]);

  if (!data) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <StatusBadge variant="muted" label={label} />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.metaText}>Unavailable</Text>
        </View>
      </View>
    );
  }

  const dimensionText = data.width > 0 && data.height > 0 ? `${data.width} × ${data.height}` : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <StatusBadge variant={variant} label={label} />
          {dimensionText ? <Text style={styles.metaText}>{dimensionText}</Text> : null}
          <Text style={styles.metaText}>{formatFileSize(data.size)}</Text>
          {deltaLabel ? (
            <Text
              style={[
                styles.deltaText,
                deltaLabel.startsWith("+") ? styles.deltaPlus : styles.deltaMinus,
              ]}
            >
              {deltaLabel}
            </Text>
          ) : null}
        </View>
        <Pressable onPress={handlePress} style={styles.zoomButton} accessibilityLabel="Zoom image">
          <ZoomIn size={14} color="#8b949e" />
        </Pressable>
      </View>
      <Pressable onPress={handlePress} style={styles.imageViewport}>
        <ImageBackground
          source={CHECKERBOARD_SVG_SOURCE}
          style={styles.checkerboardBackground}
          imageStyle={CHECKERBOARD_IMAGE_STYLE}
        >
          {imageSource ? (
            <Image source={imageSource} style={styles.image} resizeMode="contain" />
          ) : null}
        </ImageBackground>
      </Pressable>
    </View>
  );
});

export function ImageDiffCard({
  file,
  cwd,
  baseRef = "HEAD",
  targetRef,
  client,
}: ImageDiffCardProps) {
  const isCompact = useIsCompactFormFactor();
  const [before, setBefore] = useState<ImageDetails | null>(null);
  const [after, setAfter] = useState<ImageDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);

  const handleCloseModal = useCallback(() => setFullscreenUri(null), []);
  const handleZoom = useCallback((uri: string) => setFullscreenUri(uri), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!client || !cwd) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      try {
        let beforeData: ImageDetails | null = null;
        let afterData: ImageDetails | null = null;

        if (!file.isNew) {
          const oldPath = file.oldPath || file.path;
          try {
            beforeData = await fetchBeforeImage(client, cwd, baseRef, oldPath);
          } catch (e) {
            console.warn("Failed to load before git blob:", e);
          }
        }

        if (!file.isDeleted) {
          try {
            afterData = await fetchAfterImage(client, cwd, file.path, targetRef);
          } catch (e) {
            console.warn("Failed to load after image:", e);
          }
        }

        if (!cancelled) {
          setBefore(beforeData);
          setAfter(afterData);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load diff images");
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, cwd, baseRef, targetRef, file.path, file.oldPath, file.isNew, file.isDeleted]);

  const sizeDelta = useMemo(() => {
    if (!before || !after || before.size <= 0) return null;
    const diff = after.size - before.size;
    const percent = ((diff / before.size) * 100).toFixed(1);
    const sign = diff > 0 ? "+" : "";
    return `${sign}${percent}%`;
  }, [before, after]);

  if (loading) {
    return (
      <View style={styles.centerBox} testID="image-diff-loading">
        <ActivityIndicator size="small" />
        <Text style={styles.metaText}>Loading image diff...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerBox} testID="image-diff-error">
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, isCompact && styles.containerCompact]}>
      {file.isNew && (
        <DiffSideCard label="Added" variant="success" data={after} onZoom={handleZoom} />
      )}
      {file.isDeleted && (
        <DiffSideCard label="Deleted" variant="error" data={before} onZoom={handleZoom} />
      )}
      {!file.isNew && !file.isDeleted && (
        <>
          <DiffSideCard label="Before" variant="error" data={before} onZoom={handleZoom} />
          <DiffSideCard
            label="After"
            variant="success"
            data={after}
            deltaLabel={sizeDelta}
            onZoom={handleZoom}
          />
        </>
      )}

      {fullscreenUri ? (
        <Modal
          visible={Boolean(fullscreenUri)}
          transparent
          animationType="fade"
          onRequestClose={handleCloseModal}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={styles.modalCloseButton} onPress={handleCloseModal}>
              <X size={20} color="#ffffff" />
            </Pressable>
            <View style={styles.modalContent}>
              <ZoomableImage uri={fullscreenUri} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    height: 360,
    maxHeight: 360,
    padding: theme.spacing[3],
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  containerCompact: {
    flexDirection: "column",
  },
  centerBox: {
    padding: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  card: {
    flex: 1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
  cardHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
  deltaText: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    fontWeight: "bold",
  },
  deltaPlus: {
    color: theme.colors.statusWarning,
  },
  deltaMinus: {
    color: theme.colors.statusSuccess,
  },
  zoomButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  checkerboardBackground: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  imageViewport: {
    flex: 1,
    minHeight: 180,
    maxHeight: 250,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[2],
  },
  emptyContainer: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseButton: {
    position: "absolute",
    top: 40,
    right: 24,
    zIndex: 10,
    padding: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  modalContent: {
    width: "90%",
    height: "80%",
  },
}));
