import React, { useCallback } from "react";
import { useComposer, type PluginComposerItemProps } from "@getpaseo/plugin/client";
import { Combobox, useToast, type ComboboxItem } from "@getpaseo/plugin/client/ui";
import { useEffectiveQuickPrompts } from "./use-quick-prompts.js";

interface QuickPromptChoice extends ComboboxItem {
  content: string;
  targetModelId?: string;
}

export function QuickPromptsComposerItem(_props: PluginComposerItemProps) {
  const composer = useComposer();
  const toast = useToast();

  // Only render in draft / new-workspace composers; running agent composers already have the rich
  // addComposerPill popover with ephemeral AI suggestions and direct message sending.
  if (composer.context === "agent") {
    return null;
  }

  return <DraftQuickPromptsControl composer={composer} toast={toast} />;
}

function DraftQuickPromptsControl({
  composer,
  toast,
}: {
  composer: ReturnType<typeof useComposer>;
  toast: ReturnType<typeof useToast>;
}) {
  const { effectiveItems } = useEffectiveQuickPrompts({
    disableEphemeral: true,
  });

  const search = useCallback(
    async ({ query }: { query: string }): Promise<readonly QuickPromptChoice[]> => {
      const normalized = query.trim().toLowerCase();
      return effectiveItems
        .filter((item) => {
          if (!normalized) return true;
          return (
            item.label.toLowerCase().includes(normalized) ||
            (item.shortcut && item.shortcut.toLowerCase().includes(normalized)) ||
            item.content.toLowerCase().includes(normalized)
          );
        })
        .map((item) => ({
          id: item.id,
          label: item.shortcut ? `${item.label} (/${item.shortcut})` : item.label,
          description: item.content,
          content: item.content,
          targetModelId: item.targetModelId,
        }));
    },
    [effectiveItems],
  );

  const handleSelect = useCallback(
    async ({ item }: { item: QuickPromptChoice }) => {
      const targetModelId = item.targetModelId?.trim();
      if (targetModelId) {
        try {
          await composer.setModel(targetModelId);
        } catch {
          toast.error("Failed to switch target model");
        }
      }
      composer.setPrompt(item.content);
      try {
        await composer.focus();
      } catch {
        // Focus may reject if the draft composer is not currently revealed on screen.
      }
    },
    [composer, toast],
  );

  return (
    <Combobox
      title="Quick Prompts"
      icon="Sparkles"
      value={null}
      search={search}
      onSelect={handleSelect}
    />
  );
}
