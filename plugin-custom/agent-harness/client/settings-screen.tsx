import React, { useCallback, useMemo } from "react";
import { Text, View, StyleSheet } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings, useRpc } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  agentHarnessSettings,
  DEFAULT_AGENT_HARNESS_SETTINGS,
  type AgentHarnessSettings,
} from "../shared/settings.js";
import { harnessInspectEnvironmentRpc, harnessSyncProfilesRpc } from "../shared/contracts.js";

export interface HarnessSettingsScreenProps extends PluginSurfaceProps {
  settingsOverride?: any;
}

export function HarnessSettingsScreen({ theme, settingsOverride }: HarnessSettingsScreenProps) {
  const defaultSettings = useSettings(agentHarnessSettings);
  const settings = settingsOverride ?? defaultSettings;
  const toast = useToast();
  const inspectRpc = useRpc(harnessInspectEnvironmentRpc);
  const syncProfilesRpc = useRpc(harnessSyncProfilesRpc);

  const [inspectInfo, setInspectInfo] = React.useState<any>(null);
  const [isSyncing, setIsSyncing] = React.useState(false);

  React.useEffect(() => {
    inspectRpc({})
      .then((res) => setInspectInfo(res))
      .catch(() => {});
  }, [inspectRpc]);

  const handleSync = useCallback(
    async (action: "import_from_disk" | "export_to_disk" | "sync_daemon_profiles") => {
      if (isSyncing) return;
      setIsSyncing(true);
      try {
        const res = await syncProfilesRpc({ action });
        toast.show(res.message, { variant: res.success ? "success" : "error" });
        const refreshed = await inspectRpc({});
        setInspectInfo(refreshed);
      } catch (err) {
        toast.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSyncing(false);
      }
    },
    [inspectRpc, isSyncing, syncProfilesRpc, toast],
  );

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
        infoText: {
          fontSize: 12,
          color: theme.colors.foreground,
          lineHeight: 18,
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

  const handleSelect = useCallback(
    (key: keyof AgentHarnessSettings) => (value: any) => {
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

  const fallbackModelOptions = [
    { label: "Lite (lite)", value: "lite" },
    { label: "Pro (pro)", value: "pro" },
    { label: "Flash (flash)", value: "flash" },
  ];

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
          <SettingsSwitch
            label="Enable Repo-level Overrides"
            hint="Allow loading .paseo/agent-harness.json from workspace root"
            value={values.enableRepoConfigOverride}
            disabled={isSaving}
            onValueChange={handleToggle("enableRepoConfigOverride")}
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
          <SettingsSelect
            label="Plan Turn Soft Limit"
            hint="Turn count before suggesting handoff to execution specialist"
            value={String(values.planTurnSoftLimit)}
            options={[
              { label: "2 Turns", value: "2" },
              { label: "3 Turns (Default)", value: "3" },
              { label: "5 Turns", value: "5" },
              { label: "10 Turns", value: "10" },
            ]}
            disabled={isSaving}
            onValueChange={(v) => handleSelect("planTurnSoftLimit")(Number(v))}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="L2 LLM Fallback Intent Classifier">
        <SettingsCard>
          <SettingsSwitch
            label="Enable LLM Fallback Classifier"
            hint="Use LLM endpoint to classify ambiguous intents when regex heuristics miss"
            value={values.llmFallbackEnabled}
            disabled={isSaving}
            onValueChange={handleToggle("llmFallbackEnabled")}
          />
          <SettingsSelect
            label="LLM Fallback Model"
            value={values.llmFallbackModel}
            options={fallbackModelOptions}
            disabled={isSaving}
            onValueChange={handleSelect("llmFallbackModel")}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Profile Synchronization & Environment">
        <SettingsCard>
          <SettingsSwitch
            label="Auto-Sync Disk Profiles"
            hint="Automatically write specialist profiles to ~/.agents/profiles/*.json on save"
            value={values.autoSyncDiskProfiles}
            disabled={isSaving}
            onValueChange={handleToggle("autoSyncDiskProfiles")}
          />
          <SettingsSwitch
            label="Auto-Sync Paseo Agent Profiles"
            hint="Synchronize enabled specialists to Paseo native agentProfiles selector"
            value={values.autoSyncDaemonAgentProfiles}
            disabled={isSaving}
            onValueChange={handleToggle("autoSyncDaemonAgentProfiles")}
          />
          <SettingsSwitch
            label="Enforce Session MCP Filtering"
            hint="Filter allowed/excluded MCP servers per specialist role in agent.open.before"
            value={values.enforceSessionMcpFiltering}
            disabled={isSaving}
            onValueChange={handleToggle("enforceSessionMcpFiltering")}
          />
          <SettingsAction
            label="Import Profiles from Disk"
            hint={`Scan ${values.profilesDir} and merge custom profiles`}
            actionLabel="Import"
            disabled={isSyncing}
            onPress={() => handleSync("import_from_disk")}
          />
          <SettingsAction
            label="Export Profiles to Disk"
            hint={`Write all specialists to ${values.profilesDir}`}
            actionLabel="Export"
            disabled={isSyncing}
            onPress={() => handleSync("export_to_disk")}
          />
          <SettingsAction
            label="Sync Daemon Agent Profiles"
            hint="Update Paseo native agentProfiles from active specialists"
            actionLabel="Sync Profiles"
            disabled={isSyncing}
            onPress={() => handleSync("sync_daemon_profiles")}
          />
        </SettingsCard>
        {inspectInfo ? (
          <SettingsCard>
            <Text style={styles.infoText}>
              Host Environment Status:{"\n"}• Disk Profiles Found:{" "}
              {inspectInfo.diskProfiles?.length ?? 0}
              {"\n"}• Lazy-Tool Slices Found: {inspectInfo.lazyToolSlices?.length ?? 0}
              {"\n"}• Workspace Repo Override:{" "}
              {inspectInfo.hasRepoOverride
                ? "Active (" + inspectInfo.repoOverridePath + ")"
                : "None"}
            </Text>
          </SettingsCard>
        ) : null}
      </SettingsSection>
    </ScrollView>
  );
}
