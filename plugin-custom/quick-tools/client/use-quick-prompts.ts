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

// Module-level in-memory cache to guarantee 0ms instant mount
let cachedGlobalItems: QuickPromptItem[] | null = null;
const cachedProjectConfigs = new Map<
  string,
  { items: QuickPromptItem[]; disabledGlobalIds: string[]; order?: string[] }
>();

export function setCachedGlobalItems(items: QuickPromptItem[]) {
  cachedGlobalItems = items;
}

export function setCachedProjectConfig(
  projectId: string,
  config: { items: QuickPromptItem[]; disabledGlobalIds: string[]; order?: string[] },
) {
  cachedProjectConfigs.set(projectId, config);
}

export function useGlobalQuickPrompts() {
  const getGlobalRpc = useRpc(quickPromptsGlobalGetRpc);
  const setGlobalRpc = useRpc(quickPromptsGlobalSetRpc);

  const [items, setItems] = useState<QuickPromptItem[]>(
    () => cachedGlobalItems ?? [...DEFAULT_QUICK_PROMPT_ITEMS],
  );
  const [isLoading, setIsLoading] = useState(!cachedGlobalItems);

  const fetchGlobal = useCallback(async () => {
    try {
      if (!cachedGlobalItems) {
        setIsLoading(true);
      }
      const res = await getGlobalRpc({});
      cachedGlobalItems = res.items;
      setItems(res.items);
    } catch (err) {
      if (!cachedGlobalItems) {
        setItems([...DEFAULT_QUICK_PROMPT_ITEMS]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getGlobalRpc]);

  useEffect(() => {
    void fetchGlobal();
  }, [fetchGlobal]);

  const setGlobalItems = useCallback(
    async (newItems: QuickPromptItem[]) => {
      cachedGlobalItems = newItems;
      setItems(newItems);
      const res = await setGlobalRpc({ items: newItems });
      cachedGlobalItems = res.items;
      setItems(res.items);
    },
    [setGlobalRpc],
  );

  const resetToDefaults = useCallback(async () => {
    const defaults = [...DEFAULT_QUICK_PROMPT_ITEMS];
    cachedGlobalItems = defaults;
    setItems(defaults);
    const res = await setGlobalRpc({ items: defaults });
    cachedGlobalItems = res.items;
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

  const cached = projectId ? cachedProjectConfigs.get(projectId) : null;
  const [items, setItems] = useState<QuickPromptItem[]>(() => cached?.items ?? []);
  const [disabledGlobalIds, setDisabledGlobalIds] = useState<string[]>(
    () => cached?.disabledGlobalIds ?? [],
  );
  const [order, setOrder] = useState<string[] | undefined>(() => cached?.order);
  const [isLoading, setIsLoading] = useState(Boolean(projectId && !cached));

  const fetchProject = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setDisabledGlobalIds([]);
      setOrder(undefined);
      return;
    }
    try {
      if (!cachedProjectConfigs.has(projectId)) {
        setIsLoading(true);
      }
      const res = await getProjectRpc({ projectId });
      const config = {
        items: res.items,
        disabledGlobalIds: res.disabledGlobalIds,
        order: res.order,
      };
      cachedProjectConfigs.set(projectId, config);
      setItems(res.items);
      setDisabledGlobalIds(res.disabledGlobalIds);
      setOrder(res.order);
    } catch {
      // Ignored
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
      const config = {
        items: res.items,
        disabledGlobalIds: res.disabledGlobalIds,
        order: res.order,
      };
      cachedProjectConfigs.set(projectId, config);
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
