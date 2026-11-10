import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import type { PaseoWorkspaceActions } from "@getpaseo/client";

export const WORKTREE_LABEL: WorkspaceLabelDefinition = { name: "Worktree", color: "sky" };
export const LOCAL_LABEL: WorkspaceLabelDefinition = { name: "Local", color: "amber" };

export function resolveTargetLabel(kind: string): {
  target: WorkspaceLabelDefinition;
  opposite: WorkspaceLabelDefinition;
} | null {
  if (kind === "worktree") return { target: WORKTREE_LABEL, opposite: LOCAL_LABEL };
  if (kind === "local_checkout" || kind === "checkout") {
    return { target: LOCAL_LABEL, opposite: WORKTREE_LABEL };
  }
  return null;
}

export async function tagWorkspace(
  workspaceId: string,
  kind: string,
  currentLabels: readonly (string | WorkspaceLabelDefinition)[] = [],
  workspaces: Pick<PaseoWorkspaceActions, "setLabel">,
): Promise<boolean> {
  const resolved = resolveTargetLabel(kind);
  if (!resolved) return false;

  const targetKey = workspaceLabelKey(resolved.target.name);
  const oppositeKey = workspaceLabelKey(resolved.opposite.name);
  const hasTarget = currentLabels.some((l) => {
    if (!l) return false;
    const name = typeof l === "string" ? l : (l as { name?: string })?.name;
    return typeof name === "string" && workspaceLabelKey(name) === targetKey;
  });
  const hasOpposite = currentLabels.some((l) => {
    if (!l) return false;
    const name = typeof l === "string" ? l : (l as { name?: string })?.name;
    return typeof name === "string" && workspaceLabelKey(name) === oppositeKey;
  });

  let modified = false;
  if (hasOpposite) {
    await workspaces.setLabel(workspaceId, resolved.opposite, false);
    modified = true;
  }
  if (!hasTarget) {
    await workspaces.setLabel(workspaceId, resolved.target, true);
    modified = true;
  }
  return modified;
}

export async function syncAllWorkspaces(
  workspaces: Pick<PaseoWorkspaceActions, "list" | "setLabel">,
): Promise<{ tagged: number; skipped: number }> {
  const listResult = await workspaces.list();
  const list = Array.isArray(listResult) ? listResult : (listResult?.entries ?? []);
  let tagged = 0;
  let skipped = 0;
  for (const ws of list) {
    const wasTagged = await tagWorkspace(ws.id, ws.workspaceKind, ws.labels ?? [], workspaces);
    if (wasTagged) tagged++;
    else skipped++;
  }
  return { tagged, skipped };
}
