import React, { useMemo } from "react";
import { View, Text } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsInput,
  SettingsRow,
  SettingsAction,
} from "@getpaseo/plugin/client/ui";
import type { GiteaProjectDiagnostic } from "../shared/types.js";

export interface ProjectDetailSettingsProps {
  projectId: string;
  diagnostic?: GiteaProjectDiagnostic;
  settings: any;
  theme: PluginSurfaceProps["theme"];
  onBack: () => void;
}

export function ProjectDetailSettings({
  projectId,
  diagnostic,
  settings,
  theme,
  onBack,
}: ProjectDetailSettingsProps) {
  const values = settings.values;
  const projectSettings = values.projects[projectId] ?? {
    enabled: false,
    readyLabel: "agent-ready",
  };

  const mutedColor = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);

  const toggleEnabled = (enabled: boolean) => {
    const updated = {
      ...values.projects,
      [projectId]: {
        ...projectSettings,
        enabled,
      },
    };
    void settings.save({ ...values, projects: updated }, settings.revision);
  };

  const changeReadyLabel = (readyLabel: string) => {
    const updated = {
      ...values.projects,
      [projectId]: {
        ...projectSettings,
        readyLabel,
      },
    };
    void settings.save({ ...values, projects: updated }, settings.revision);
  };

  return (
    <View style={{ flex: 1 }}>
      <SettingsSection title={`项目配置: ${diagnostic?.projectName || projectId}`}>
        <SettingsCard>
          <SettingsSwitch
            label="允许自动执行任务"
            hint="仅当开启且具备启动标签时自动派发 Agent"
            value={projectSettings.enabled}
            disabled={settings.saving || diagnostic?.connectionStatus !== "connected"}
            onValueChange={toggleEnabled}
          />
          <SettingsInput
            label="启动标签"
            hint="匹配此标签的开放 Issue 将被认领执行"
            initialValue={projectSettings.readyLabel}
            onChangeText={changeReadyLabel}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="诊断信息 (Read-Only)">
        <SettingsCard>
          <SettingsRow label="Gitea 地址">
            <Text style={mutedColor}>{diagnostic?.baseUrl || "未知"}</Text>
          </SettingsRow>
          <SettingsRow label="仓库坐标">
            <Text style={mutedColor}>
              {diagnostic?.repoOwner ? `${diagnostic.repoOwner}/${diagnostic.repoName}` : "未解析"}
            </Text>
          </SettingsRow>
          <SettingsRow label="认证来源">
            <Text style={mutedColor}>{diagnostic?.authSource || "none"}</Text>
          </SettingsRow>
          <SettingsRow label="连通状态">
            <Text
              style={{
                color:
                  diagnostic?.connectionStatus === "connected"
                    ? theme.colors.statusSuccess
                    : theme.colors.statusDanger,
              }}
            >
              {diagnostic?.connectionStatus || "unknown"}
            </Text>
          </SettingsRow>
          <SettingsAction label="" actionLabel="返回项目列表" onPress={onBack} />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
