import React, { useMemo } from "react";
import { View, Text } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
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

const projectPermissionScopeOptions = [
  { label: "继承全局默认", value: "" },
  { label: "受控执行 (修改代码与测试，推送需审批)", value: "workspace_controlled" },
  { label: "只读分析 (仅出方案与评论，禁止修改代码)", value: "read_only" },
  { label: "全自动交付 (允许自动推送分支并创建 PR)", value: "full_delivery" },
] as const;

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

  return (
    <View style={{ flex: 1 }}>
      <SettingsSection title={`项目配置: ${diagnostic?.projectName || projectId}`}>
        <SettingsCard>
          <SettingsSwitch
            label="允许自动执行任务"
            hint="仅当开启且 Issue 包含触发标签 (Agent Auto / Agent Plan) 时自动派发 Agent"
            value={projectSettings.enabled}
            disabled={settings.saving || diagnostic?.connectionStatus !== "connected"}
            onValueChange={toggleEnabled}
          />
          <SettingsSelect
            label="执行引擎覆盖 (可选)"
            hint="留空继承全局配置"
            value={projectSettings.agentProviderOverride || ""}
            options={
              [
                { label: "继承全局默认", value: "" },
                { label: "Claude Code", value: "claude" },
                { label: "Codex", value: "codex" },
                { label: "Google Antigravity", value: "antigravity" },
                { label: "OpenCode", value: "opencode" },
              ] as any
            }
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentProviderOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsSelect
            label="项目授权范围覆盖 (可选)"
            hint="可单独限制此项目的 Agent 操作权限"
            value={projectSettings.agentPermissionScopeOverride || ""}
            options={projectPermissionScopeOptions as any}
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentPermissionScopeOverride: (val || undefined) as any,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsInput
            label="模型覆盖 (可选)"
            hint="留空继承全局配置，如 gemini-flash[1M]、claude-3-7-sonnet"
            initialValue={projectSettings.agentModelOverride || ""}
            disabled={settings.saving}
            onChangeText={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentModelOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="触发标签与模式 (Trigger Labels & Modes)">
        <SettingsCard>
          <SettingsRow
            label="Agent Auto (全自动模式)"
            hint="在 Issue 添加标签 agent-auto 或 agent:auto。认领后无人值守自动推进方案规划、代码编写、动态测试与 PR 提交，全流程无需干预。"
          />
          <SettingsRow
            label="Agent Plan (规划审查模式)"
            hint="在 Issue 添加标签 agent-plan 或 agent:plan。Agent 仅产出架构设计与实施计划，在 Review 面板等待人工审批通过后才开始执行编码。"
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
