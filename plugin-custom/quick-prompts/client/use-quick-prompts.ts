import { useEffect, useState, useCallback, useMemo } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  quickPromptsGlobalGetRpc,
  quickPromptsGlobalSetRpc,
  quickPromptsProjectGetRpc,
  quickPromptsProjectSetRpc,
  DEFAULT_QUICK_PROMPT_ITEMS,
  type QuickPromptItem,
  type QuickPromptAgentStatus,
} from "../shared/contracts.js";
import { resolveEffectiveQuickPrompts } from "./quick-prompt-resolver.js";

export function useGlobalQuickPrompts() {
  const getGlobalRpc = useRpc(quickPromptsGlobalGetRpc);
  const setGlobalRpc = useRpc(quickPromptsGlobalSetRpc);

  const [items, setItems] = useState<QuickPromptItem[]>([...DEFAULT_QUICK_PROMPT_ITEMS]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchGlobal = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await getGlobalRpc({});
      setItems(res.items);
    } catch (err) {
      console.warn("[QuickPromptsPlugin] Failed to fetch global prompts, using defaults:", err);
      setItems([...DEFAULT_QUICK_PROMPT_ITEMS]);
    } finally {
      setIsLoading(false);
    }
  }, [getGlobalRpc]);

  useEffect(() => {
    void fetchGlobal();
  }, [fetchGlobal]);

  const setGlobalItems = useCallback(
    async (newItems: QuickPromptItem[]) => {
      const res = await setGlobalRpc({ items: newItems });
      setItems(res.items);
    },
    [setGlobalRpc],
  );

  const resetToDefaults = useCallback(async () => {
    const res = await setGlobalRpc({ items: [...DEFAULT_QUICK_PROMPT_ITEMS] });
    setItems(res.items);
  }, [setGlobalRpc]);

  return {
    items,
    isLoading,
    fetchGlobal,
    setGlobalItems,
    resetToDefaults,
  };
}

export function useProjectQuickPrompts(projectId?: string | null) {
  const getProjectRpc = useRpc(quickPromptsProjectGetRpc);
  const setProjectRpc = useRpc(quickPromptsProjectSetRpc);

  const [items, setItems] = useState<QuickPromptItem[]>([]);
  const [disabledGlobalIds, setDisabledGlobalIds] = useState<string[]>([]);
  const [order, setOrder] = useState<string[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProject = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setDisabledGlobalIds([]);
      setOrder(undefined);
      return;
    }
    try {
      setIsLoading(true);
      const res = await getProjectRpc({ projectId });
      setItems(res.items);
      setDisabledGlobalIds(res.disabledGlobalIds);
      setOrder(res.order);
    } catch (err) {
      console.warn("[QuickPromptsPlugin] Failed to fetch project prompts:", err);
      setItems([]);
      setDisabledGlobalIds([]);
      setOrder(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [getProjectRpc, projectId]);

  useEffect(() => {
    void fetchProject();
  }, [fetchProject]);

  const setProjectConfig = useCallback(
    async (input: {
      items?: QuickPromptItem[];
      disabledGlobalIds?: string[];
      order?: string[];
    }) => {
      if (!projectId) return;
      const res = await setProjectRpc({
        projectId,
        items: input.items,
        disabledGlobalIds: input.disabledGlobalIds,
        order: input.order,
      });
      setItems(res.items);
      setDisabledGlobalIds(res.disabledGlobalIds);
      setOrder(res.order);
    },
    [setProjectRpc, projectId],
  );

  return {
    items,
    disabledGlobalIds,
    order,
    isLoading,
    fetchProject,
    setProjectConfig,
  };
}

export interface UseEffectiveQuickPromptsInput {
  projectId?: string | null;
  lastAssistantText?: string | null;
  agentStatus?: QuickPromptAgentStatus | null;
  agentProfileId?: string | readonly string[] | null;
  locale?: string;
  disableEphemeral?: boolean;
}

export function useEffectiveQuickPrompts(input: UseEffectiveQuickPromptsInput) {
  const { projectId, lastAssistantText, agentStatus, agentProfileId, locale, disableEphemeral } =
    input;

  const globalPrompts = useGlobalQuickPrompts();
  const projectPrompts = useProjectQuickPrompts(projectId);

  const effectiveItems = useMemo(() => {
    return resolveEffectiveQuickPrompts({
      globalItems: globalPrompts.items,
      projectItems: projectId ? projectPrompts.items : null,
      disabledGlobalIds: projectId ? projectPrompts.disabledGlobalIds : null,
      order: projectId ? projectPrompts.order : null,
      lastAssistantText,
      agentStatus,
      agentProfileId,
      locale,
      disableEphemeral,
    });
  }, [
    globalPrompts.items,
    projectId,
    projectPrompts.items,
    projectPrompts.disabledGlobalIds,
    projectPrompts.order,
    lastAssistantText,
    agentStatus,
    agentProfileId,
    locale,
    disableEphemeral,
  ]);

  return {
    effectiveItems,
    globalItems: globalPrompts.items,
    projectItems: projectPrompts.items,
    disabledGlobalIds: projectPrompts.disabledGlobalIds,
    order: projectPrompts.order,
    projectId,
    isProjectScoped: Boolean(projectId),
    isLoading: globalPrompts.isLoading || (Boolean(projectId) && projectPrompts.isLoading),
    setGlobalItems: globalPrompts.setGlobalItems,
    resetGlobalToDefaults: globalPrompts.resetToDefaults,
    setProjectConfig: projectPrompts.setProjectConfig,
  };
}
