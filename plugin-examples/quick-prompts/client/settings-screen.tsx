import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { quickPromptsSettings } from "../shared/contracts.js";
import { QuickPromptsModal } from "./modal.js";
import { useGlobalQuickPrompts } from "./use-quick-prompts.js";

export function QuickPromptsSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(quickPromptsSettings);
  const { items: globalItems, setGlobalItems, resetToDefaults } = useGlobalQuickPrompts();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const style = useMemo(() => ({ color: theme.colors.foreground }), [theme]);

  const toggleAiSuggestions = useCallback(
    (enabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ aiSuggestions: enabled }, settings.revision);
      }
    },
    [settings],
  );

  if (settings.status === "loading") {
    return <Text style={style}>Loading quick prompt settings…</Text>;
  }

  const aiSuggestions = settings.status === "ready" ? settings.values.aiSuggestions : true;

  return (
    <>
      <SettingsSection title="Quick Prompts">
        <SettingsCard>
          <SettingsSwitch
            label="AI Suggestions"
            hint="Extract one-click reply suggestions from assistant messages"
            value={aiSuggestions}
            disabled={settings.saving}
            onValueChange={toggleAiSuggestions}
          />
          <SettingsAction
            label="Manage Prompts"
            hint="Configure global quick prompts, shortcuts, and rule conditions"
            actionLabel="Open Manager"
            onPress={() => setIsModalOpen(true)}
          />
        </SettingsCard>
      </SettingsSection>
      <QuickPromptsModal
        visible={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        globalItems={globalItems}
        onSaveGlobalItems={setGlobalItems}
        onResetGlobalDefaults={resetToDefaults}
        theme={theme}
      />
    </>
  );
}
