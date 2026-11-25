import React, { memo, useMemo } from "react";
import { useWorkspace, type PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge } from "@getpaseo/plugin/client/ui";
import { parseWorkspaceOwnerMetadata, TEAM_COLLAB_OWNER_META_KEY } from "../shared/contracts.js";
import { useLiveWorkspaceOwner } from "./workspace-store.js";

export const WorkspaceOwnerBadge = memo(function WorkspaceOwnerBadge({
  workspaceId,
}: PluginWorkspaceRowBadgeItemProps) {
  const snapshotOwnerRaw = useWorkspace(workspaceId, (ws) => {
    const maybeMeta = (ws as { metadata?: Record<string, unknown> | null }).metadata;
    return maybeMeta?.[TEAM_COLLAB_OWNER_META_KEY] ?? null;
  });
  const liveOwner = useLiveWorkspaceOwner(workspaceId);

  const owner = useMemo(() => {
    return parseWorkspaceOwnerMetadata(snapshotOwnerRaw) ?? liveOwner;
  }, [liveOwner, snapshotOwnerRaw]);

  const expectedLabelKey = owner ? `@${owner.id.trim().toLowerCase()}` : null;
  const hasNativeOwnerLabel = useWorkspace(workspaceId, (ws) => {
    if (!expectedLabelKey) return false;
    const labels = (ws as { labels?: readonly unknown[] | null }).labels;
    if (!Array.isArray(labels)) return false;
    return labels.some(
      (label) => typeof label === "string" && label.trim().toLowerCase() === expectedLabelKey,
    );
  });

  if (!owner || hasNativeOwnerLabel) {
    return null;
  }

  const isBot = owner.kind === "bot";
  return (
    <WorkspaceRowBadge
      icon={isBot ? "Bot" : "UserCheck"}
      label={`@${owner.id}`}
      tone={isBot ? "info" : "muted"}
    />
  );
});
