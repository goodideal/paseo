import { useCallback, useEffect, useState } from "react";
import type { WorkspaceEvolutionDigest } from "@getpaseo/protocol/evolution";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export interface UseWorkspaceEvolutionInput {
  serverId?: string | null;
  workspaceId: string | null | undefined;
  clientOverride?: ReturnType<typeof useHostRuntimeClient>;
}

export interface UseWorkspaceEvolutionResult {
  digest: WorkspaceEvolutionDigest | null;
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWorkspaceEvolution(
  input: UseWorkspaceEvolutionInput,
): UseWorkspaceEvolutionResult {
  const runtimeClient = useHostRuntimeClient(input.serverId ?? "");
  const client = input.clientOverride ?? runtimeClient;
  const workspaceId = input.workspaceId;

  const [digest, setDigest] = useState<WorkspaceEvolutionDigest | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = useCallback(
    async (forceRefresh = false) => {
      if (!client || !workspaceId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const response = await client.getWorkspaceEvolutionDigest(workspaceId, {
          forceRefresh,
        });
        if (response.error) {
          setError(response.error);
        } else {
          setDigest(response.digest);
        }
        setIsAnalyzing(response.isAnalyzing ?? false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [client, workspaceId],
  );

  useEffect(() => {
    void fetchDigest(false);
  }, [fetchDigest]);

  useEffect(() => {
    if (!client || !workspaceId) return undefined;
    const unsubscribe = client.on("workspace.evolution.updated", (msg) => {
      if (msg.payload.workspaceId === workspaceId) {
        setDigest(msg.payload.digest);
        setIsAnalyzing(false);
      }
    });
    return unsubscribe;
  }, [client, workspaceId]);

  const refresh = useCallback(async () => {
    await fetchDigest(true);
  }, [fetchDigest]);

  return {
    digest,
    isLoading,
    isAnalyzing,
    error,
    refresh,
  };
}
