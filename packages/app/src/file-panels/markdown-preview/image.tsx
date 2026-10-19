import { useEffect, useState, useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveMarkdownImageSource } from "./image-resolver";
import { persistAttachmentFromBytes } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { FileImage } from "lucide-react-native";
import { ZoomableImage } from "@/components/zoomable-viewport/image";
import { withUnistyles } from "react-native-unistyles";
import { getFileNameFromPath } from "@/attachments/utils";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export interface MarkdownLocalImageProps {
  source: string;
  documentPath: string;
  workspaceRoot?: string;
  client?: DaemonClient | null;
  serverId?: string;
  alt?: string;
}

export function MarkdownLocalImage({
  source,
  documentPath,
  workspaceRoot,
  client,
  alt,
}: MarkdownLocalImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [directUri, setDirectUri] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<AttachmentMetadata | null>(null);
  const attachmentUrl = useAttachmentPreviewUrl(attachment);

  const resolvedSource = useMemo(() => {
    return resolveMarkdownImageSource({ source, documentPath, workspaceRoot });
  }, [source, documentPath, workspaceRoot]);

  useEffect(() => {
    if (!resolvedSource) {
      setStatus("error");
      return;
    }

    if (resolvedSource.kind === "direct") {
      setDirectUri(resolvedSource.uri);
      setStatus("loaded");
      return;
    }

    if (resolvedSource.kind === "file" && client) {
      let disposed = false;

      (async () => {
        try {
          const res = await client.readFile(resolvedSource.cwd, resolvedSource.path);
          if (disposed) return;

          const fileName = getFileNameFromPath(resolvedSource.path);
          const att = await persistAttachmentFromBytes({
            bytes: res.bytes,
            mimeType: res.mime,
            fileName: fileName,
          });

          if (disposed) return;
          setAttachment(att);
          setStatus("loaded");
        } catch {
          if (!disposed) setStatus("error");
        }
      })();

      return () => {
        disposed = true;
      };
    } else {
      setStatus("error");
    }
  }, [resolvedSource, client]);

  const finalUri = directUri ?? attachmentUrl;

  if (status === "loading" || (status === "loaded" && !finalUri)) {
    return (
      <View style={styles.placeholderContainer}>
        <ThemedLoadingSpinner color={UnistylesRuntime.getTheme().colors.foregroundMuted} />
      </View>
    );
  }

  if (status === "error" || !finalUri) {
    const fallbackName =
      resolvedSource?.kind === "file" ? resolvedSource.path.split("/").pop() : alt || "Image";
    return (
      <View style={styles.errorContainer}>
        <FileImage size={24} color={UnistylesRuntime.getTheme().colors.foregroundMuted} />
        <Text style={styles.errorText} numberOfLines={1} ellipsizeMode="middle">
          {fallbackName}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.imageWrapper}>
      <ZoomableImage uri={finalUri} style={styles.image} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  placeholderContainer: {
    height: 200,
    width: "100%",
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: theme.spacing[2],
  },
  errorContainer: {
    height: 100,
    width: "100%",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: theme.spacing[2],
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },

  errorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  imageWrapper: {
    marginVertical: theme.spacing[2],
    width: "100%",
  },
  image: {
    width: "100%",
    minHeight: 200,
    borderRadius: theme.borderRadius.md,
  },
}));
