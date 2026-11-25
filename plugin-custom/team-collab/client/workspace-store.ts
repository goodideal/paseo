import { useSyncExternalStore } from "react";
import { parseWorkspaceOwnerMetadata, type WorkspaceOwnerMetadata } from "../shared/contracts.js";

export interface LiveWorkspaceRecord {
  readonly id: string;
  readonly owner: WorkspaceOwnerMetadata | null;
  readonly isWorktree: boolean;
  readonly branch: string | null;
}

interface RawWorkspaceShape {
  id: string;
  metadata?: unknown;
  workspaceKind?: string | null;
  kind?: string | null;
  gitRuntime?: { currentBranch?: string | null } | null;
  branch?: string | null;
}

const liveWorkspaces = new Map<string, LiveWorkspaceRecord>();
const workspaceListeners = new Set<() => void>();

let rosterRefreshVersion = 0;
const rosterListeners = new Set<() => void>();

function emitWorkspaceChange(): void {
  for (const listener of workspaceListeners) {
    listener();
  }
}

export function toLiveWorkspaceRecord(raw: RawWorkspaceShape): LiveWorkspaceRecord {
  const owner = parseWorkspaceOwnerMetadata(raw.metadata);
  const kind = raw.workspaceKind ?? raw.kind ?? "";
  const isWorktree = kind === "worktree";
  const branch = raw.gitRuntime?.currentBranch ?? raw.branch ?? null;
  return {
    id: raw.id,
    owner,
    isWorktree,
    branch,
  };
}

export function replaceAllLiveWorkspaces(entries: readonly RawWorkspaceShape[]): void {
  liveWorkspaces.clear();
  for (const entry of entries) {
    if (entry && typeof entry.id === "string") {
      liveWorkspaces.set(entry.id, toLiveWorkspaceRecord(entry));
    }
  }
  emitWorkspaceChange();
}

export function upsertLiveWorkspace(raw: RawWorkspaceShape): boolean {
  const next = toLiveWorkspaceRecord(raw);
  const prev = liveWorkspaces.get(raw.id);
  liveWorkspaces.set(raw.id, next);
  const changed =
    !prev ||
    prev.isWorktree !== next.isWorktree ||
    prev.branch !== next.branch ||
    prev.owner?.id !== next.owner?.id ||
    prev.owner?.name !== next.owner?.name ||
    prev.owner?.email !== next.owner?.email ||
    prev.owner?.kind !== next.owner?.kind;
  if (changed) {
    emitWorkspaceChange();
  }
  return changed;
}

export function removeLiveWorkspace(workspaceId: string): boolean {
  const deleted = liveWorkspaces.delete(workspaceId);
  if (deleted) {
    emitWorkspaceChange();
  }
  return deleted;
}

export function setLiveWorkspaceOwner(
  workspaceId: string,
  owner: WorkspaceOwnerMetadata | null,
  extra?: { isWorktree?: boolean; branch?: string | null },
): void {
  const prev = liveWorkspaces.get(workspaceId);
  const next: LiveWorkspaceRecord = {
    id: workspaceId,
    owner,
    isWorktree: extra?.isWorktree ?? prev?.isWorktree ?? false,
    branch: extra?.branch !== undefined ? extra.branch : (prev?.branch ?? null),
  };
  liveWorkspaces.set(workspaceId, next);
  emitWorkspaceChange();
}

export function getLiveWorkspaceRecord(workspaceId: string): LiveWorkspaceRecord | undefined {
  return liveWorkspaces.get(workspaceId);
}

export function subscribeLiveWorkspaces(listener: () => void): () => void {
  workspaceListeners.add(listener);
  return () => {
    workspaceListeners.delete(listener);
  };
}

export function useLiveWorkspaceRecord(workspaceId: string): LiveWorkspaceRecord | null {
  return useSyncExternalStore(
    subscribeLiveWorkspaces,
    () => liveWorkspaces.get(workspaceId) ?? null,
    () => liveWorkspaces.get(workspaceId) ?? null,
  );
}

export function useLiveWorkspaceOwner(workspaceId: string): WorkspaceOwnerMetadata | null {
  const record = useLiveWorkspaceRecord(workspaceId);
  return record?.owner ?? null;
}

export function notifyRosterUpdated(): void {
  rosterRefreshVersion += 1;
  for (const listener of rosterListeners) {
    listener();
  }
}

export function subscribeRosterUpdated(listener: () => void): () => void {
  rosterListeners.add(listener);
  return () => {
    rosterListeners.delete(listener);
  };
}

export function useRosterRefreshVersion(): number {
  return useSyncExternalStore(
    subscribeRosterUpdated,
    () => rosterRefreshVersion,
    () => rosterRefreshVersion,
  );
}
