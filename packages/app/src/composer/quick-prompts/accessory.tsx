import React, { memo, useCallback, useMemo, useState } from "react";
import type { PluginComposerAccessoryProps } from "@getpaseo/plugin/client";
import { useComposerApi } from "@getpaseo/plugin/client";
import { QuickPromptBar } from "./bar";
import { QuickPromptsModal } from "./modal";
import { useEffectiveQuickPrompts } from "@/hooks/use-quick-prompts";
import { useAgentProfiles } from "@/agent-profiles";
import { resolveActiveAgentProfileIds } from "@/utils/quick-prompt-resolver";
import { useSessionStore } from "@/stores/session-store";
import type { QuickPromptAgentStatus, QuickPromptItem } from "@getpaseo/protocol/quick-prompts";
import type { StreamItem } from "@/types/stream";
import { useTranslation } from "react-i18next";

function findLatestAssistantText(streamTail?: readonly StreamItem[]): string | null {
  if (!streamTail) return null;
  for (let i = streamTail.length - 1; i >= 0; i--) {
    const item = streamTail[i];
    if (item.kind === "assistant_message" && item.text) {
      return item.text;
    }
  }
  return null;
}

export const QuickPromptsAccessory = memo(function QuickPromptsAccessory({
  workspaceId,
  agentId,
  host,
}: PluginComposerAccessoryProps) {
  const { i18n } = useTranslation();
  const composerApi = useComposerApi();
  const serverId = host.id;

  const agentState = useSessionStore((state) => {
    if (!agentId) return null;
    const session = state.sessions[serverId];
    const agent = session?.agents?.get(agentId);
    if (!agent) return null;
    return {
      status: agent.status,
      model: agent.model,
      provider: agent.provider,
      currentModeId: agent.currentModeId,
      thinkingOptionId: agent.thinkingOptionId,
      labels: agent.labels,
    };
  });

  const streamTail = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agentStreamTail?.get(agentId) : undefined,
  );
  const lastAssistantText = useMemo(() => findLatestAssistantText(streamTail), [streamTail]);
  const { profiles } = useAgentProfiles(serverId);
  const activeAgentProfileIds = useMemo(() => {
    if (!agentState) return [];
    return resolveActiveAgentProfileIds(
      {
        provider: agentState.provider ?? null,
        model: agentState.model ?? null,
        currentModeId: agentState.currentModeId ?? null,
        thinkingOptionId: agentState.thinkingOptionId ?? null,
        labels: agentState.labels,
      },
      profiles,
    );
  }, [agentState, profiles]);

  const { effectiveItems: activeQuickPrompts } = useEffectiveQuickPrompts({
    serverId,
    workspaceId,
    lastAssistantText,
    agentStatus: (agentState?.status as QuickPromptAgentStatus) ?? null,
    agentProfileId: activeAgentProfileIds,
    locale: i18n.language,
  });

  const [isQuickPromptsModalOpen, setIsQuickPromptsModalOpen] = useState(false);

  const handleOpenQuickPromptsManage = useCallback(() => {
    setIsQuickPromptsModalOpen(true);
  }, []);

  const handleCloseQuickPromptsManage = useCallback(() => {
    setIsQuickPromptsModalOpen(false);
  }, []);

  const handleSelectQuickPrompt = useCallback(
    (item: QuickPromptItem) => {
      composerApi.submitText(item.content);
    },
    [composerApi],
  );

  const handleSelectQuickPromptForEdit = useCallback(
    (item: QuickPromptItem) => {
      composerApi.insertText(item.content);
    },
    [composerApi],
  );

  return (
    <>
      <QuickPromptBar
        items={activeQuickPrompts}
        onSelectPrompt={handleSelectQuickPrompt}
        onSelectForEdit={handleSelectQuickPromptForEdit}
        onOpenManage={handleOpenQuickPromptsManage}
        isSubmitDisabled={composerApi.isSubmitDisabled ?? false}
      />
      <QuickPromptsModal
        visible={isQuickPromptsModalOpen}
        onClose={handleCloseQuickPromptsManage}
        serverId={serverId}
        workspaceId={workspaceId}
      />
    </>
  );
});
