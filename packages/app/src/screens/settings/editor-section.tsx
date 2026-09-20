import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { QuickPromptsModal } from "@/composer/quick-prompts";

export function EditorSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const [quickPromptsOpen, setQuickPromptsOpen] = useState(false);

  const handleChange = useCallback(
    (vimKeybindings: boolean) => void updateSettings({ vimKeybindings }),
    [updateSettings],
  );

  const handleAiSuggestionsChange = useCallback(
    (aiQuickPromptSuggestions: boolean) => void updateSettings({ aiQuickPromptSuggestions }),
    [updateSettings],
  );

  const handleOpenQuickPrompts = useCallback(() => {
    setQuickPromptsOpen(true);
  }, []);

  const handleCloseQuickPrompts = useCallback(() => {
    setQuickPromptsOpen(false);
  }, []);

  return (
    <>
      <SettingsSection title={t("settings.editor.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.editor.vimKeybindings")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.editor.vimHint")}</Text>
            </View>
            <Switch
              value={settings.vimKeybindings}
              onValueChange={handleChange}
              accessibilityLabel={t("settings.editor.vimKeybindings")}
              testID="vim-keybindings-toggle"
            />
          </View>

          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.editor.aiSuggestions.title")}
              </Text>
              <Text style={settingsStyles.rowHint}>{t("settings.editor.aiSuggestions.hint")}</Text>
            </View>
            <Switch
              value={settings.aiQuickPromptSuggestions}
              onValueChange={handleAiSuggestionsChange}
              accessibilityLabel={t("settings.editor.aiSuggestions.title")}
              testID="ai-quick-prompt-suggestions-toggle"
            />
          </View>

          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.editor.quickPrompts.title")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.editor.quickPrompts.hint")}</Text>
            </View>
            <Button
              variant="secondary"
              size="sm"
              onPress={handleOpenQuickPrompts}
              testID="manage-quick-prompts-button"
            >
              {t("settings.editor.quickPrompts.manage")}
            </Button>
          </View>
        </View>
      </SettingsSection>

      <QuickPromptsModal
        visible={quickPromptsOpen}
        onClose={handleCloseQuickPrompts}
        initialTab="global"
      />
    </>
  );
}
