import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export const LOCAL_LABEL_NAME = "Local";
export const WORKTREE_LABEL_NAME = "WT";

const PAGE_LIMIT = 200;

export type WorkspacesApi = Pick<PluginHandlerContext["paseo"]["workspaces"], "list" | "ref">;

export interface TargetLabelResolution {
  target: string;
  opposite: string;
}

export function normalizeLabelKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export function resolveTargetLabel(kind: string | undefined): TargetLabelResolution | null {
  if (kind === "worktree") {
    return { target: WORKTREE_LABEL_NAME, opposite: LOCAL_LABEL_NAME };
  }
  if (kind === "local_checkout" || kind === "checkout" || kind === "directory") {
    return { target: LOCAL_LABEL_NAME, opposite: WORKTREE_LABEL_NAME };
  }
  return null;
}

export async function tagWorkspace(
  workspaceId: string,
  kind: string | undefined,
  currentLabels: readonly unknown[] = [],
  workspaces: Pick<WorkspacesApi, "ref">,
): Promise<boolean> {
  const resolved = resolveTargetLabel(kind);
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
    return false;
  }

  const handle = workspaces.ref(workspaceId);
  let modified = false;

  if (hasOpposite) {
    await handle.setLabel(resolved.opposite, { assigned: false });
    modified = true;
  }
  if (!hasTarget) {
    await handle.setLabel(resolved.target, { assigned: true });
    modified = true;
  }

  return modified;
}

export async function syncAllWorkspaces(
  workspaces: WorkspacesApi,
): Promise<{ tagged: number; skipped: number }> {
  let tagged = 0;
  let skipped = 0;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

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
        const wasTagged = await tagWorkspace(
          workspace.id,
          workspace.workspaceKind,
          workspace.labels ?? [],
          workspaces,
        );
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
