import React, { useCallback, useMemo } from "react";
import { Text, View, StyleSheet } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  agentHarnessSettings,
  DEFAULT_AGENT_HARNESS_SETTINGS,
  type AgentHarnessSettings,
} from "../shared/settings.js";

export interface HarnessSettingsScreenProps extends PluginSurfaceProps {
  settingsOverride?: any;
}

export function HarnessSettingsScreen({ theme, settingsOverride }: HarnessSettingsScreenProps) {
  const defaultSettings = useSettings(agentHarnessSettings);
  const settings = settingsOverride ?? defaultSettings;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: theme.colors.surface0,
        },
        content: {
          padding: 16,
          gap: 16,
        },
        loadingContainer: {
          padding: 24,
          alignItems: "center",
          justifyContent: "center",
        },
        loadingText: {
          fontSize: 13,
          color: theme.colors.foregroundMuted,
        },
      }),
    [theme],
  );

  const handleToggle = useCallback(
    (key: keyof AgentHarnessSettings) => (value: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, [key]: value }, settings.revision);
      }
    },
    [settings],
  );

  const handleRetry = useCallback(() => {
    if (typeof settings.reload === "function") {
      void settings.reload();
    }
  }, [settings]);

  const handleReset = useCallback(async () => {
    if (typeof settings.reset === "function") {
      const ok = await settings.reset();
      if (ok) return;
    }
    if (typeof settings.save === "function") {
      const revision = settings.revision ?? "";
      await settings.save(DEFAULT_AGENT_HARNESS_SETTINGS, revision);
    }
  }, [settings]);

  if (settings.status === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading Agent Harness settings…</Text>
      </View>
    );
  }

  if (settings.status !== "ready") {
    const isInvalid = settings.status === "invalid";
    const errorMessage =
      settings.error ??
      (isInvalid ? "Settings configuration is invalid." : "Failed to load settings.");

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <SettingsSection
          title="Configuration Status"
          info={isInvalid ? "Invalid Configuration" : "Load Error"}
        >
          <SettingsCard>
            <SettingsAction
              label={isInvalid ? "Invalid Settings Schema" : "Error Loading Settings"}
              hint={errorMessage}
              actionLabel="Retry"
              disabled={settings.saving}
              onPress={handleRetry}
            />
            <SettingsAction
              label="Reset to Defaults"
              hint="Restore default Agent Harness configuration"
              actionLabel="Reset"
              disabled={settings.saving}
              onPress={handleReset}
            />
          </SettingsCard>
        </SettingsSection>
      </ScrollView>
    );
  }

  const values = settings.values;
  const isSaving = settings.saving;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SettingsSection title="Core Orchestration">
        <SettingsCard>
          <SettingsSwitch
            label="Enable Agent Harness"
            hint="Dynamic domain role routing and tier lifecycle management"
            value={values.enabled}
            disabled={isSaving}
            onValueChange={handleToggle("enabled")}
          />
          <SettingsSwitch
            label="Override Default Model Only"
            hint="Only optimize model tiers when the user has not locked a specific model"
            value={values.overrideIfDefaultOnly}
            disabled={isSaving}
            onValueChange={handleToggle("overrideIfDefaultOnly")}
          />
          <SettingsSwitch
            label="Debug Logs"
            hint="Log harness routing decisions and turn lifecycle transitions to daemon log"
            value={values.debugLogs}
            disabled={isSaving}
            onValueChange={handleToggle("debugLogs")}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Phase Lifecycle & Gates">
        <SettingsCard>
          <SettingsSwitch
            label="Phase Lifecycle State Machine"
            hint="Track turns and detect transitions between design, execution, and review"
            value={values.phaseLifecycleEnabled}
            disabled={isSaving}
            onValueChange={handleToggle("phaseLifecycleEnabled")}
          />
          <SettingsSwitch
            label="Enforce Native Plan Mode"
            hint="Lock provider plan mode during design phase for Claude and OpenCode"
            value={values.enforceNativePlanMode}
            disabled={isSaving}
            onValueChange={handleToggle("enforceNativePlanMode")}
          />
          <SettingsSwitch
            label="Auto Downgrade Plan to Flash"
            hint="Automatically switch from Plan to Flash when modification tools or execution intents occur"
            value={values.autoDowngradePlanOnExec}
            disabled={isSaving}
            onValueChange={handleToggle("autoDowngradePlanOnExec")}
          />
          <SettingsSwitch
            label="Emit Timeline Transitions"
            hint="Render transition milestone cards in the agent chat timeline"
            value={values.emitTimelineTransitions}
            disabled={isSaving}
            onValueChange={handleToggle("emitTimelineTransitions")}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
