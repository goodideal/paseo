import { useEffect, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import {
  DEFAULT_QUICK_PROMPT_ITEMS,
  type QuickPromptItem,
  type QuickPromptAgentStatus,
} from "@getpaseo/protocol/quick-prompts";
import { resolveEffectiveQuickPrompts } from "@/utils/quick-prompt-resolver";

export function globalQuickPromptsQueryKey(serverId: string) {
  return ["quick-prompts", "global", serverId] as const;
}

export function projectQuickPromptsQueryKey(serverId: string, projectId: string) {
  return ["quick-prompts", "project", serverId, projectId] as const;
}

export function useGlobalQuickPrompts(serverId: string) {
  const queryClient = useQueryClient();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  // Subscribe to real-time changed events
  useEffect(() => {
    if (!client) return;
    const unsub = client.on(
      "quick_prompts.changed",
      (msg: { scope: string; projectId?: string }) => {
        if (msg.scope === "global") {
          void queryClient.invalidateQueries({ queryKey: globalQuickPromptsQueryKey(serverId) });
        }
      },
    );
    return unsub;
  }, [client, queryClient, serverId]);

  const query = useFetchQuery<QuickPromptItem[]>({
    queryKey: globalQuickPromptsQueryKey(serverId),
    queryFn: async () => {
      if (!client) {
        return [...DEFAULT_QUICK_PROMPT_ITEMS];
      }
      try {
        const res = await client.quickPromptsGlobalGet();
        return res.items;
      } catch (err) {
        console.warn("[QuickPrompts] Failed to fetch global prompts, using defaults:", err);
        return [...DEFAULT_QUICK_PROMPT_ITEMS];
      }
    },
    enabled: Boolean(serverId),
    staleTimeMs: 60_000,
    dataShape: "list",
  });

  const mutation = useMutation({
    mutationFn: async (items: QuickPromptItem[]) => {
      if (!client) throw new Error("Not connected to host");
      await client.quickPromptsGlobalSet(items);
      return items;
    },
    onSuccess: (items) => {
      queryClient.setQueryData(globalQuickPromptsQueryKey(serverId), items);
    },
  });

  const setGlobalItems = useCallback(
    async (items: QuickPromptItem[]) => {
      await mutation.mutateAsync(items);
    },
    [mutation],
  );

  const resetToDefaults = useCallback(async () => {
    await mutation.mutateAsync([...DEFAULT_QUICK_PROMPT_ITEMS]);
  }, [mutation]);

  return {
    items: query.data ?? [...DEFAULT_QUICK_PROMPT_ITEMS],
    isLoading: query.isLoading,
    setGlobalItems,
    resetToDefaults,
  };
}

export interface ProjectQuickPromptsData {
  projectId: string;
  items: QuickPromptItem[];
  disabledGlobalIds: string[];
  order?: string[];
}

export function useProjectQuickPrompts(serverId: string, projectId?: string | null) {
  const queryClient = useQueryClient();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  useEffect(() => {
    if (!client || !projectId) return;
    const unsub = client.on(
      "quick_prompts.changed",
      (msg: { scope: string; projectId?: string }) => {
        if (msg.scope === "project" && msg.projectId === projectId) {
          void queryClient.invalidateQueries({
            queryKey: projectQuickPromptsQueryKey(serverId, projectId),
          });
        }
      },
    );
    return unsub;
  }, [client, queryClient, serverId, projectId]);

  const query = useFetchQuery<ProjectQuickPromptsData>({
    queryKey: projectQuickPromptsQueryKey(serverId, projectId ?? ""),
    queryFn: async () => {
      if (!client || !projectId) {
        return {
          projectId: projectId ?? "",
          items: [],
          disabledGlobalIds: [] as string[],
          order: undefined as string[] | undefined,
        };
      }
      try {
        return await client.quickPromptsProjectGet(projectId);
      } catch (err) {
        console.warn("[QuickPrompts] Failed to fetch project prompts:", err);
        return {
          projectId,
          items: [],
          disabledGlobalIds: [] as string[],
          order: undefined as string[] | undefined,
        };
      }
    },
    enabled: Boolean(serverId && projectId),
    staleTimeMs: 60_000,
    dataShape: "value",
  });

  const mutation = useMutation({
    mutationFn: async (input: {
      items: QuickPromptItem[];
      disabledGlobalIds: string[];
      order?: string[];
    }) => {
      if (!client || !projectId) throw new Error("Not connected to host or project missing");
      return await client.quickPromptsProjectSet({
        projectId,
        items: input.items,
        disabledGlobalIds: input.disabledGlobalIds,
        order: input.order,
      });
    },
    onSuccess: (data) => {
      if (projectId) {
        queryClient.setQueryData(projectQuickPromptsQueryKey(serverId, projectId), data);
      }
    },
  });

  const setProjectConfig = useCallback(
    async (input: { items: QuickPromptItem[]; disabledGlobalIds: string[]; order?: string[] }) => {
      await mutation.mutateAsync(input);
    },
    [mutation],
  );

  return {
    items: query.data?.items ?? [],
    disabledGlobalIds: query.data?.disabledGlobalIds ?? [],
    order: query.data?.order,
    isLoading: query.isLoading,
    setProjectConfig,
  };
}

export interface UseEffectiveQuickPromptsInput {
  serverId: string;
  workspaceId?: string | null;
  lastAssistantText?: string | null;
  agentStatus?: QuickPromptAgentStatus | null;
  locale?: string;
  disableEphemeral?: boolean;
}

export function useEffectiveQuickPrompts(input: UseEffectiveQuickPromptsInput) {
  const { serverId, workspaceId, lastAssistantText, agentStatus, locale, disableEphemeral } = input;

  const projectId = useSessionStore((state) => {
    if (!serverId || !workspaceId) return null;
    const ws = state.sessions[serverId]?.workspaces?.get(workspaceId);
    return ws?.projectId ?? null;
  });

  const globalPrompts = useGlobalQuickPrompts(serverId);
  const projectPrompts = useProjectQuickPrompts(serverId, projectId);

  const effectiveItems = useMemo(() => {
    return resolveEffectiveQuickPrompts({
      globalItems: globalPrompts.items,
      projectItems: projectId ? projectPrompts.items : null,
      disabledGlobalIds: projectId ? projectPrompts.disabledGlobalIds : null,
      lastAssistantText,
      agentStatus,
      locale,
      disableEphemeral,
    });
  }, [
    globalPrompts.items,
    projectId,
    projectPrompts.items,
    projectPrompts.disabledGlobalIds,
    lastAssistantText,
    agentStatus,
    locale,
    disableEphemeral,
  ]);

  return {
    effectiveItems,
    globalItems: globalPrompts.items,
    projectItems: projectPrompts.items,
    disabledGlobalIds: projectPrompts.disabledGlobalIds,
    projectId,
    isProjectScoped: Boolean(projectId),
    isLoading: globalPrompts.isLoading || (Boolean(projectId) && projectPrompts.isLoading),
    setGlobalItems: globalPrompts.setGlobalItems,
    resetGlobalToDefaults: globalPrompts.resetToDefaults,
    setProjectConfig: projectPrompts.setProjectConfig,
  };
}
