const teamUpdateListeners = new Set<(workspaceId: string) => void>();

/**
 * Broadcasts a client-local event when a workspace's `.agents/agent-team.json`
 * or compiled artifacts change so mounted popovers/editors refresh immediately.
 */
export function notifyWorkspaceTeamUpdated(workspaceId: string): void {
  const id = workspaceId.trim();
  if (!id) return;
  for (const listener of Array.from(teamUpdateListeners)) {
    try {
      listener(id);
    } catch {
      // Ignore individual subscriber failures
    }
  }
}

export function subscribeWorkspaceTeamUpdated(
  workspaceId: string | null | undefined,
  listener: () => void,
): () => void {
  const target = workspaceId?.trim();
  if (!target) {
    return () => {};
  }
  const wrapped = (updatedWorkspaceId: string) => {
    if (updatedWorkspaceId === target) {
      listener();
    }
  };
  teamUpdateListeners.add(wrapped);
  return () => {
    teamUpdateListeners.delete(wrapped);
  };
}
