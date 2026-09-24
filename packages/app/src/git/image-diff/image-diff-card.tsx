
import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text, Image } from "react-native";
import { ParsedDiffFile } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { useIsCompactFormFactor } from "@/constants/layout";

import { StatusBadge } from "@/components/ui/status-badge";

interface ImageDiffCardProps {
  file: ParsedDiffFile;
  serverId: string;
  cwd: string;
  baseRef: string;
  targetRef?: string;
  client: DaemonClient | null;
}

interface ImageDetails {
  uri: string;
  width: number;
  height: number;
  size: number;
}

const CHECKERBOARD_PATTERN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23e5e7eb'/%3E%3Crect x='8' width='8' height='8' fill='%23f3f4f6'/%3E%3Crect y='8' width='8' height='8' fill='%23f3f4f6'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23e5e7eb'/%3E%3C/svg%3E")`;

export function ImageDiffCard({ file, serverId, cwd, baseRef, targetRef, client }: ImageDiffCardProps) {
  const isCompact = useIsCompactFormFactor();
  const [before, setBefore] = useState<ImageDetails | null>(null);
  const [after, setAfter] = useState<ImageDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadImages() {
      if (!client) return;
      setLoading(true);
      setError(null);
      try {
        let beforeData: ImageDetails | null = null;
        let afterData: ImageDetails | null = null;
        
        // Load before image if it's not a newly added file
        if (!file.isNew) {
          const oldPath = file.oldPath || file.path;
          try {
            // Ideally use client.readGitBlob or similar. Fallback to a placeholder URL or read blob
            // For now, since readGitBlob might not be available, we will try to use the raw workspace file API
            // Note: In a real implementation this would fetch from the git store with baseRef
            beforeData = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              uri: `${(client as any).endpoint.replace("ws", "http")}/api/v1/workspace/${cwd}/file/${encodeURIComponent(oldPath)}`,
              width: 0,
              height: 0,
              size: 0
            };
          } catch (e) {
            console.error(e);
          }
        }
        
        // Load after image if it's not deleted
        if (!file.isDeleted) {
          try {
             afterData = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              uri: `${(client as any).endpoint.replace("ws", "http")}/api/v1/workspace/${cwd}/file/${encodeURIComponent(file.path)}`,
              width: 0,
              height: 0,
              size: 0
            };
          } catch (e) {
            console.error(e);
          }
        }
        
        setBefore(beforeData);
        setAfter(afterData);
      } catch {
        setError("Failed to load images");
      } finally {
        setLoading(false);
      }
    }
    loadImages();
  }, [file, serverId, cwd, baseRef, targetRef, client]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }
  
  const renderCard = (label: string, imgData: ImageDetails | null, isBefore: boolean) => {
     if (!imgData) return null;
     return (
       <View style={[styles.card, isCompact ? styles.cardCompact : styles.cardWide]}>
          <View style={styles.cardHeader}>
             <StatusBadge variant={isBefore ? "error" : "success"} label={label} />
          </View>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <View style={[styles.imageContainer, { backgroundImage: CHECKERBOARD_PATTERN } as any]}>
             {/* eslint-disable-next-line react-perf/jsx-no-new-object-as-prop */}
             <Image source={{ uri: imgData.uri }} style={styles.image} resizeMode="contain" />
          </View>
       </View>
     );
  };

  return (
    <View style={[styles.container, isCompact ? styles.containerCompact : styles.containerWide]}>
      
      {file.isNew && renderCard("Added", after, false)}
      {file.isDeleted && renderCard("Deleted", before, true)}
      {!file.isNew && !file.isDeleted && (
         <>
           {renderCard("Before", before, true)}
           {renderCard("After", after, false)}
         </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorText: { color: "red" },
  container: {
    width: "100%",
    padding: 16,
    flex: 1,
    gap: 16,
    justifyContent: "center",
  },
  containerWide: {
    flexDirection: "row",
  },
  containerCompact: {
    flexDirection: "column",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  cardWide: {
    maxWidth: "50%",
  },
  cardCompact: {
    width: "100%",
  },
  cardHeader: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  imageContainer: {
    flex: 1,
    minHeight: 200,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
