import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  DEFAULT_LOCAL_LABEL_COLOR,
  DEFAULT_WORKTREE_LABEL_COLOR,
  type WorkspaceLabelColor,
} from "../shared/contracts.js";

export const LOCAL_LABEL_NAME = "Local";
export const WORKTREE_LABEL_NAME = "WT";

const PAGE_LIMIT = 200;

export type WorkspacesApi = Pick<PluginHandlerContext["paseo"]["workspaces"], "list" | "ref">;

export interface WorkspaceLabelColorConfig {
  localLabelColor?: WorkspaceLabelColor;
  worktreeLabelColor?: WorkspaceLabelColor;
  syncColor?: boolean;
  /** When true, only updates colors on workspaces that already carry their target label. */
  onlyExisting?: boolean;
}

export interface TargetLabelResolution {
  target: string;
  opposite: string;
  targetColor: WorkspaceLabelColor;
}

export function normalizeLabelKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export function resolveTargetLabel(
  kind: string | undefined,
  colors?: WorkspaceLabelColorConfig,
): TargetLabelResolution | null {
  if (kind === "worktree") {
    return {
      target: WORKTREE_LABEL_NAME,
      opposite: LOCAL_LABEL_NAME,
      targetColor: colors?.worktreeLabelColor ?? DEFAULT_WORKTREE_LABEL_COLOR,
    };
  }
  if (kind === "local_checkout" || kind === "checkout" || kind === "directory") {
    return {
      target: LOCAL_LABEL_NAME,
      opposite: WORKTREE_LABEL_NAME,
      targetColor: colors?.localLabelColor ?? DEFAULT_LOCAL_LABEL_COLOR,
    };
  }
  return null;
}

export async function tagWorkspace(
  workspaceId: string,
  kind: string | undefined,
  currentLabels: readonly unknown[] = [],
  workspaces: Pick<WorkspacesApi, "ref">,
  options?: WorkspaceLabelColorConfig,
): Promise<boolean> {
  const resolved = resolveTargetLabel(kind, options);
  if (!resolved) return false;

  const targetKey = normalizeLabelKey(resolved.target);
  const oppositeKey = normalizeLabelKey(resolved.opposite);

  let hasTarget = false;
  let hasOpposite = false;
  for (const label of currentLabels) {
    if (typeof label !== "string") continue;
    const key = normalizeLabelKey(label);
    if (!key) continue;
    if (key === targetKey) hasTarget = true;
    if (key === oppositeKey) hasOpposite = true;
  }

  if (hasTarget && !hasOpposite) {
    if (options?.syncColor) {
      await workspaces
        .ref(workspaceId)
        .setLabel(resolved.target, { assigned: true, color: resolved.targetColor });
    }
    return false;
  }

  if (options?.onlyExisting) {
    if (hasTarget && options?.syncColor) {
      await workspaces
        .ref(workspaceId)
        .setLabel(resolved.target, { assigned: true, color: resolved.targetColor });
    }
    return false;
  }

  const handle = workspaces.ref(workspaceId);
  let modified = false;

  if (hasOpposite) {
    await handle.setLabel(resolved.opposite, { assigned: false });
    modified = true;
  }
  if (!hasTarget || options?.syncColor) {
    await handle.setLabel(resolved.target, {
      assigned: true,
      color: resolved.targetColor,
    });
    if (!hasTarget) {
      modified = true;
    }
  }

  return modified;
}

export async function syncAllWorkspaces(
  workspaces: WorkspacesApi,
  options?: WorkspaceLabelColorConfig,
): Promise<{ tagged: number; skipped: number }> {
  let tagged = 0;
  let skipped = 0;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  const syncedColorTargets = new Set<string>();

  for (;;) {
    const result = await workspaces.list(
      cursor ? { page: { limit: PAGE_LIMIT, cursor } } : { page: { limit: PAGE_LIMIT } },
    );
    const entries = result?.entries ?? [];

    for (const workspace of entries) {
      if (workspace.background || workspace.archivingAt) {
        skipped++;
        continue;
      }
      try {
        const resolved = resolveTargetLabel(workspace.workspaceKind, options);
        const currentLabels = workspace.labels ?? [];
        const hasTargetLabel =
          resolved !== null &&
          currentLabels.some(
            (label) =>
              typeof label === "string" &&
              normalizeLabelKey(label) === normalizeLabelKey(resolved.target),
          );
        const canSyncColorHere = resolved !== null && (!options?.onlyExisting || hasTargetLabel);
        const shouldSyncColor =
          Boolean(options?.syncColor) &&
          canSyncColorHere &&
          !syncedColorTargets.has(resolved.target);
        const wasTagged = await tagWorkspace(
          workspace.id,
          workspace.workspaceKind,
          currentLabels,
          workspaces,
          options ? { ...options, syncColor: shouldSyncColor } : undefined,
        );
        if (resolved && (wasTagged || shouldSyncColor)) {
          syncedColorTargets.add(resolved.target);
        }
        if (wasTagged) tagged++;
        else skipped++;
      } catch (error) {
        console.warn(`[QuickTools] Failed to label workspace ${workspace.id}:`, error);
        skipped++;
      }
    }

    const nextCursor = result?.pageInfo?.hasMore ? result.pageInfo.nextCursor : null;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { tagged, skipped };
}
