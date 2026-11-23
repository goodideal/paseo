import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { quickPromptsSettings, quickPromptsWorkspaceLabelsSyncRpc } from "../shared/contracts.js";
import { QuickPromptsModal } from "./modal.js";
import { useGlobalQuickPrompts } from "./use-quick-prompts.js";

export function QuickPromptsSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(quickPromptsSettings);
  const syncWorkspaceLabels = useRpc(quickPromptsWorkspaceLabelsSyncRpc);
  const { items: globalItems, setGlobalItems, resetToDefaults } = useGlobalQuickPrompts();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncHint, setSyncHint] = useState<string | null>(null);

  const style = useMemo(() => ({ color: theme.colors.foreground }), [theme]);

  const toggleAiSuggestions = useCallback(
    (enabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, aiSuggestions: enabled }, settings.revision);
      }
    },
    [settings],
  );

  const toggleAutoLabelWorkspaces = useCallback(
    (enabled: boolean) => {
      if (settings.status === "ready") {
        void settings
          .save({ ...settings.values, autoLabelWorkspaces: enabled }, settings.revision)
          .then((saved) => {
            if (saved && enabled) {
              void syncWorkspaceLabels({ force: false }).catch(() => {});
            }
          });
      }
    },
    [settings, syncWorkspaceLabels],
  );

  const handleSyncWorkspaceLabels = useCallback(() => {
    if (syncing) return;
    setSyncing(true);
    setSyncHint(null);
    void syncWorkspaceLabels({ force: true })
      .then((result) => {
        setSyncHint(`Updated ${result.tagged}, unchanged ${result.skipped}`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setSyncHint(`Sync failed: ${message}`);
      })
      .finally(() => {
        setSyncing(false);
      });
  }, [syncing, syncWorkspaceLabels]);

  if (settings.status === "loading") {
    return <Text style={style}>Loading Quick Tools settings…</Text>;
  }

  const aiSuggestions = settings.status === "ready" ? settings.values.aiSuggestions : true;
  const autoLabelWorkspaces =
    settings.status === "ready" ? settings.values.autoLabelWorkspaces : true;

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
      <SettingsSection title="Workspace Labels">
        <SettingsCard>
          <SettingsSwitch
            label="Auto-label Workspaces"
            hint="Assign Local to local workspaces and WT to Git worktrees"
            value={autoLabelWorkspaces}
            disabled={settings.saving}
            onValueChange={toggleAutoLabelWorkspaces}
          />
          <SettingsAction
            label="Sync Workspace Labels"
            hint={syncHint ?? "Apply Local and WT labels to all active workspaces"}
            actionLabel={syncing ? "Syncing…" : "Sync Now"}
            disabled={syncing}
            onPress={handleSyncWorkspaceLabels}
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
