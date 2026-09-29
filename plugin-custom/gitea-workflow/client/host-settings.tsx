import React, { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useSettings, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsRow,
  SettingsAction,
} from "@getpaseo/plugin/client/ui";
import { giteaSettingsDefinition } from "../shared/settings.js";
import { diagnoseProjectsRpc } from "../shared/contracts.js";
import type { GiteaHostSettings, GiteaProjectDiagnostic } from "../shared/types.js";
import { ProjectDetailSettings } from "./project-detail-settings.js";

const policyOptions = [
  { label: "完整 Superpowers (推荐)", value: "full_superpowers" },
  { label: "Issue 视为已批准设计", value: "issue_preapproved" },
  { label: "无人值守 (自动推进)", value: "unattended" },
] as const;

const intervalOptions = [
  { label: "30 秒", value: "30" },
  { label: "60 秒 (默认)", value: "60" },
  { label: "120 秒", value: "120" },
  { label: "300 秒", value: "300" },
] as const;

const retentionOptions = [
  { label: "30 天", value: "30" },
  { label: "90 天 (推荐)", value: "90" },
  { label: "180 天", value: "180" },
  { label: "365 天", value: "365" },
] as const;

export interface HostSettingsScreenProps extends PluginSurfaceProps {
  useSettingsHook?: (def: any) => any;
  useRpcHook?: typeof useRpc;
  settingsOverride?: any;
  diagnosticsOverride?: GiteaProjectDiagnostic[];
}

export function HostSettingsScreen({
  theme,
  useSettingsHook,
  useRpcHook,
  settingsOverride,
  diagnosticsOverride,
}: HostSettingsScreenProps) {
  const settings = useSettingsHook
    ? useSettingsHook(giteaSettingsDefinition)
    : (settingsOverride ?? useSettings(giteaSettingsDefinition));

  const defaultRpcCaller = useCallback(
    async () => ({ diagnostics: diagnosticsOverride ?? [] }),
    [diagnosticsOverride],
  );
  const rpcFunc = useRpcHook ? useRpcHook(diagnoseProjectsRpc) : defaultRpcCaller;
  const diagnoseProjects = diagnosticsOverride ? defaultRpcCaller : rpcFunc;

  const [diagnostics, setDiagnostics] = useState<GiteaProjectDiagnostic[]>(
    diagnosticsOverride ?? [],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const refreshDiagnostics = useCallback(async () => {
    if (diagnosticsOverride) return;
    try {
      const res = await diagnoseProjects({});
      setDiagnostics(res.diagnostics);
    } catch {
      // ignore
    }
  }, [diagnoseProjects, diagnosticsOverride]);

  React.useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const textColor = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  const mutedColor = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);

  if (settings.status === "loading") {
    return (
      <SettingsSection title="Gitea Workflow">
        <Text style={mutedColor}>正在加载配置...</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Gitea Workflow">
        <Text style={{ color: theme.colors.statusDanger }}>{settings.error || "配置加载失败"}</Text>
        <SettingsAction label="重试" actionLabel="重新加载" onPress={settings.reload} />
      </SettingsSection>
    );
  }

  const values: GiteaHostSettings = settings.values;

  const toggleGlobalEnabled = (enabled: boolean) => {
    void settings.save({ ...values, enabled }, settings.revision);
  };

  const changePolicy = (policy: string) => {
    void settings.save({ ...values, workflowPolicy: policy as any }, settings.revision);
  };

  const changeInterval = (secondsStr: string) => {
    void settings.save(
      { ...values, pollIntervalSeconds: parseInt(secondsStr, 10) },
      settings.revision,
    );
  };

  const changeRetention = (daysStr: string) => {
    void settings.save(
      { ...values, evidenceRetentionDays: parseInt(daysStr, 10) },
      settings.revision,
    );
  };

  const toggleProject = (projectId: string, currentEnabled: boolean) => {
    const existing = values.projects[projectId] ?? {
      enabled: false,
      readyLabel: "agent-ready",
    };
    const updatedProjects = {
      ...values.projects,
      [projectId]: {
        ...existing,
        enabled: !currentEnabled,
      },
    };
    void settings.save({ ...values, projects: updatedProjects }, settings.revision);
  };

  if (selectedProjectId) {
    const projDiag = diagnostics.find((d) => d.projectId === selectedProjectId);
    return (
      <ProjectDetailSettings
        projectId={selectedProjectId}
        diagnostic={projDiag}
        settings={settings}
        theme={theme}
        onBack={() => setSelectedProjectId(null)}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SettingsSection title="自动化 (Automation)">
        <SettingsCard>
          <Pressable
            testID="global-enabled-switch"
            onPress={() => toggleGlobalEnabled(!values.enabled)}
          >
            <SettingsSwitch
              label="自动处理 Issue"
              hint="开启后，仅处理已授权项目中带有启动标签的 Issue"
              value={values.enabled}
              onValueChange={toggleGlobalEnabled}
              disabled={settings.saving}
            />
          </Pressable>
          <SettingsSelect
            label="默认工作流策略"
            value={values.workflowPolicy}
            options={policyOptions as any}
            disabled={settings.saving}
            onValueChange={changePolicy}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="调度与资源 (Scheduling)">
        <SettingsCard>
          <SettingsSelect
            label="轮询间隔"
            value={String(values.pollIntervalSeconds)}
            options={intervalOptions as any}
            disabled={settings.saving}
            onValueChange={changeInterval}
          />
          <SettingsSelect
            label="证据保留周期"
            value={String(values.evidenceRetentionDays)}
            options={retentionOptions as any}
            disabled={settings.saving}
            onValueChange={changeRetention}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="已发现项目 (Discovered Projects)">
        <SettingsCard>
          {diagnostics.length === 0 ? (
            <SettingsRow label="未检测到 Git 项目">
              <Text style={mutedColor}>Paseo 当前未注册任何 Git 项目</Text>
            </SettingsRow>
          ) : (
            diagnostics.map((proj) => {
              const authorized = values.projects[proj.projectId]?.enabled ?? false;
              const statusText =
                proj.connectionStatus === "connected"
                  ? `已连接 (${proj.authSource}) · ${proj.pendingIssueCount ?? 0} 个待办`
                  : proj.connectionStatus === "unauthorized"
                    ? "未找到 Gitea Token"
                    : "非 Gitea 远端";

              return (
                <SettingsRow
                  key={proj.projectId}
                  label={proj.projectName || proj.projectId}
                  hint={statusText}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <SettingsSwitch
                      label=""
                      value={authorized}
                      disabled={settings.saving || proj.connectionStatus !== "connected"}
                      onValueChange={() => toggleProject(proj.projectId, authorized)}
                    />
                    <SettingsAction
                      label=""
                      actionLabel="详情"
                      onPress={() => setSelectedProjectId(proj.projectId)}
                    />
                  </View>
                </SettingsRow>
              );
            })
          )}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
