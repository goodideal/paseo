import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  DEFAULT_LOCAL_LABEL_COLOR,
  DEFAULT_WORKTREE_LABEL_COLOR,
  quickPromptsSettings,
  quickPromptsWorkspaceLabelsSyncRpc,
  type WorkspaceLabelColor,
} from "../shared/contracts.js";
import { WORKSPACE_LABEL_COLOR_OPTIONS } from "./color-palette.js";
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

  const isReady = settings.status === "ready";
  const controlsDisabled = !isReady || settings.saving;
  const aiSuggestions = isReady ? settings.values.aiSuggestions : true;
  const autoLabelWorkspaces = isReady ? settings.values.autoLabelWorkspaces : true;
  const localLabelColor: WorkspaceLabelColor = isReady
    ? (settings.values.localLabelColor ?? DEFAULT_LOCAL_LABEL_COLOR)
    : DEFAULT_LOCAL_LABEL_COLOR;
  const worktreeLabelColor: WorkspaceLabelColor = isReady
    ? (settings.values.worktreeLabelColor ?? DEFAULT_WORKTREE_LABEL_COLOR)
    : DEFAULT_WORKTREE_LABEL_COLOR;

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
        setSyncHint(null);
        void settings
          .save({ ...settings.values, autoLabelWorkspaces: enabled }, settings.revision)
          .then((saved) => {
            if (!saved) {
              setSyncHint("Failed to save workspace label setting");
              return;
            }
            if (enabled) {
              void syncWorkspaceLabels({
                force: false,
                syncColor: true,
                localLabelColor,
                worktreeLabelColor,
              }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                setSyncHint(`Sync failed: ${message}`);
              });
            }
          });
      }
    },
    [localLabelColor, settings, syncWorkspaceLabels, worktreeLabelColor],
  );

  const updateLabelColor = useCallback(
    (field: "localLabelColor" | "worktreeLabelColor", nextColor: WorkspaceLabelColor) => {
      if (settings.status !== "ready") return;
      setSyncHint(null);
      const nextLocalColor = field === "localLabelColor" ? nextColor : localLabelColor;
      const nextWorktreeColor = field === "worktreeLabelColor" ? nextColor : worktreeLabelColor;
      void settings
        .save({ ...settings.values, [field]: nextColor }, settings.revision)
        .then((saved) => {
          if (!saved) {
            setSyncHint("Failed to save label color");
            return;
          }
          void syncWorkspaceLabels({
            force: false,
            syncColor: true,
            localLabelColor: nextLocalColor,
            worktreeLabelColor: nextWorktreeColor,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            setSyncHint(`Sync failed: ${message}`);
          });
        });
    },
    [localLabelColor, settings, syncWorkspaceLabels, worktreeLabelColor],
  );

  const handleLocalLabelColorChange = useCallback(
    (nextColor: WorkspaceLabelColor) => {
      updateLabelColor("localLabelColor", nextColor);
    },
    [updateLabelColor],
  );

  const handleWorktreeLabelColorChange = useCallback(
    (nextColor: WorkspaceLabelColor) => {
      updateLabelColor("worktreeLabelColor", nextColor);
    },
    [updateLabelColor],
  );

  const handleSyncWorkspaceLabels = useCallback(() => {
    if (syncing || !isReady) return;
    setSyncing(true);
    setSyncHint(null);
    void syncWorkspaceLabels({
      force: true,
      syncColor: true,
      localLabelColor,
      worktreeLabelColor,
    })
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
  }, [isReady, localLabelColor, syncing, syncWorkspaceLabels, worktreeLabelColor]);

  if (settings.status === "loading") {
    return <Text style={style}>Loading Quick Tools settings…</Text>;
  }

  const effectiveSyncHint =
    (settings.saveError ? `Save failed: ${settings.saveError}` : null) ??
    syncHint ??
    "Apply Local and WT labels to all active workspaces";

  return (
    <>
      <SettingsSection title="Quick Prompts">
        <SettingsCard>
          <SettingsSwitch
            label="AI Suggestions"
            hint="Extract one-click reply suggestions from assistant messages"
            value={aiSuggestions}
            disabled={controlsDisabled}
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
            disabled={controlsDisabled}
            onValueChange={toggleAutoLabelWorkspaces}
          />
          <SettingsSelect
            label="Local Label Color"
            hint="Badge color for Local workspace labels"
            value={localLabelColor}
            options={WORKSPACE_LABEL_COLOR_OPTIONS}
            disabled={controlsDisabled}
            onValueChange={handleLocalLabelColorChange}
          />
          <SettingsSelect
            label="WT Label Color"
            hint="Badge color for Git worktree (WT) workspace labels"
            value={worktreeLabelColor}
            options={WORKSPACE_LABEL_COLOR_OPTIONS}
            disabled={controlsDisabled}
            onValueChange={handleWorktreeLabelColorChange}
          />
          <SettingsAction
            label="Sync Workspace Labels"
            hint={effectiveSyncHint}
            actionLabel={syncing ? "Syncing…" : "Sync Now"}
            disabled={controlsDisabled || syncing}
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
