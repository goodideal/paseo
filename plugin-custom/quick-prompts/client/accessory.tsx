import React, { memo, useCallback, useMemo, useState, useEffect } from "react";
import type { PluginComposerAccessoryProps } from "@getpaseo/plugin/client";
import {
  useComposerApi,
  useAgent,
  useWorkspace,
  usePaseo,
  useSettings,
} from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { QuickPromptBar } from "./bar.js";
import { QuickPromptsModal } from "./modal.js";
import { useEffectiveQuickPrompts } from "./use-quick-prompts.js";
import { resolveActiveAgentProfileIds } from "./quick-prompt-resolver.js";
import { executeQuickPrompt } from "./prompt-executor.js";
import {
  quickPromptsSettings,
  type QuickPromptItem,
  type QuickPromptAgentStatus,
} from "../shared/contracts.js";

export const QuickPromptsAccessory = memo(function QuickPromptsAccessory({
  workspaceId,
  agentId,
  theme,
}: PluginComposerAccessoryProps) {
  const composerApi = useComposerApi();
  const paseo = usePaseo();
  const toast = useToast();

  const workspace = useWorkspace(workspaceId, (ws) => ({
    projectId: ws.projectId,
  }));
  const projectId = workspace?.projectId ?? null;

  const agent = useAgent(agentId ?? "", (a) => ({
    status: a.status,
    provider: a.provider,
    model: a.model,
    currentModeId: a.currentModeId,
    thinkingOptionId: a.thinkingOptionId,
    labels: a.labels,
  }));

  const [lastAssistantText, setLastAssistantText] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !paseo?.agents) return;
    let active = true;

    try {
      const handle = paseo.agents.ref(agentId);
      if (handle?.timeline) {
        handle.timeline
          .refetch({ direction: "tail", limit: 20 })
          .then((res) => {
            if (!active || !res?.entries) return;
            for (let i = res.entries.length - 1; i >= 0; i--) {
              const entry = res.entries[i];
              if (entry.item.type === "assistant_message") {
                setLastAssistantText(entry.item.text);
                break;
              }
            }
          })
          .catch(() => {});

        const sub = handle.timeline.subscribe((streamPayload) => {
          if (!active) return;
          if (!("event" in streamPayload)) return;
          const streamEvent = streamPayload.event;
          if (streamEvent.type === "timeline" && streamEvent.item.type === "assistant_message") {
            setLastAssistantText(streamEvent.item.text);
          }
        });

        return () => {
          active = false;
          try {
            sub();
          } catch {
            // Unsubscribe safety
          }
        };
      }
    } catch {
      // Ignored if agent ref unavailable
    }
  }, [agentId, paseo]);

  const activeAgentProfileIds = useMemo(() => {
    if (!agent) return [];
    return resolveActiveAgentProfileIds(
      {
        provider: agent.provider ?? null,
        model: agent.model ?? null,
        currentModeId: agent.currentModeId ?? null,
        thinkingOptionId: agent.thinkingOptionId ?? null,
        labels: agent.labels,
      },
      [],
    );
  }, [agent]);

  const settings = useSettings(quickPromptsSettings);
  const aiSuggestionsEnabled = settings.status === "ready" ? settings.values.aiSuggestions : true;

  const {
    effectiveItems,
    globalItems,
    projectItems,
    disabledGlobalIds,
    order,
    setGlobalItems,
    resetGlobalToDefaults,
    setProjectConfig,
  } = useEffectiveQuickPrompts({
    projectId,
    lastAssistantText,
    agentStatus: (agent?.status as QuickPromptAgentStatus) ?? null,
    agentProfileId: activeAgentProfileIds,
    disableEphemeral: !aiSuggestionsEnabled,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExecutingModelSwitch, setIsExecutingModelSwitch] = useState(false);
  const [availableModels, setAvailableModels] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (!agent?.provider || !paseo?.providers) {
      setAvailableModels([]);
      return;
    }
    let active = true;
    paseo.providers
      .listModels(agent.provider)
      .then((res) => {
        if (!active) return;
        const models = (res?.models ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id }));
        setAvailableModels(models);
      })
      .catch(() => {
        if (active) setAvailableModels([]);
      });
    return () => {
      active = false;
    };
  }, [agent?.provider, paseo?.providers]);

  const handleSelectPrompt = useCallback(
    async (item: QuickPromptItem) => {
      if (isExecutingModelSwitch) return;
      setIsExecutingModelSwitch(true);
      try {
        await executeQuickPrompt({
          item,
          agentId: agentId ?? null,
          paseo,
          composerApi,
          availableModelIds: availableModels.map((m) => m.id),
          onToastError: (message) => toast?.error(message),
        });
      } finally {
        setIsExecutingModelSwitch(false);
      }
    },
    [agentId, paseo, composerApi, availableModels, isExecutingModelSwitch, toast],
  );

  const handleSelectForEdit = useCallback(
    (item: QuickPromptItem) => {
      composerApi.insertText(item.content);
    },
    [composerApi],
  );

  return (
    <>
      <QuickPromptBar
        items={effectiveItems}
        onSelectPrompt={handleSelectPrompt}
        onSelectForEdit={handleSelectForEdit}
        onOpenManage={() => setIsModalOpen(true)}
        isSubmitDisabled={(composerApi.isSubmitDisabled ?? false) || isExecutingModelSwitch}
        theme={theme}
      />
      <QuickPromptsModal
        visible={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectId={projectId}
        globalItems={globalItems}
        projectItems={projectItems}
        disabledGlobalIds={disabledGlobalIds}
        order={order}
        onSaveGlobalItems={setGlobalItems}
        onResetGlobalDefaults={resetGlobalToDefaults}
        onSaveProjectConfig={setProjectConfig}
        availableModels={availableModels}
        theme={theme}
      />
    </>
  );
});
