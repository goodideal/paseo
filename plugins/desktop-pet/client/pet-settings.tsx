import { useCallback } from "react";
import { Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { petSettingsDefinition } from "../shared/contracts.js";

const themes = [
  { label: "Pixel Cat (Classic)", value: "pixel_cat" },
  { label: "Cyber Bot", value: "cyber_bot" },
  { label: "Shiba Inu", value: "shiba_inu" },
] as const;

const riskModes = [
  { label: "Conservative (Strict safety)", value: "conservative" },
  { label: "Balanced (Recommended)", value: "balanced" },
  { label: "Liberal (Fast dev)", value: "liberal" },
] as const;

export function PetSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(petSettingsDefinition);

  const toggleAutoDecision = useCallback(
    (autoDecisionEnabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, autoDecisionEnabled }, settings.revision);
      }
    },
    [settings],
  );

  const toggleSound = useCallback(
    (soundEnabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, soundEnabled }, settings.revision);
      }
    },
    [settings],
  );

  const changeSkin = useCallback(
    (skinTheme: "pixel_cat" | "cyber_bot" | "shiba_inu") => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, skinTheme }, settings.revision);
      }
    },
    [settings],
  );

  const changeRisk = useCallback(
    (riskThreshold: "conservative" | "balanced" | "liberal") => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, riskThreshold }, settings.revision);
      }
    },
    [settings],
  );

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>Loading pet settings…</Text>;
  }

  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foreground }}>Failed to load pet settings.</Text>;
  }

  return (
    <SettingsSection title="Desktop Pet Configuration">
      <SettingsCard>
        <SettingsSwitch
          label="AI Timeout Auto-Decision"
          value={settings.values.autoDecisionEnabled}
          disabled={settings.saving}
          onValueChange={toggleAutoDecision}
        />
        <SettingsSwitch
          label="8-bit Sound Effects"
          value={settings.values.soundEnabled}
          disabled={settings.saving}
          onValueChange={toggleSound}
        />
        <SettingsSelect
          label="Pet Skin & Character"
          value={settings.values.skinTheme}
          options={themes}
          disabled={settings.saving}
          onValueChange={changeSkin}
        />
        <SettingsSelect
          label="Risk Evaluation Threshold"
          value={settings.values.riskThreshold}
          options={riskModes}
          disabled={settings.saving}
          onValueChange={changeRisk}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
