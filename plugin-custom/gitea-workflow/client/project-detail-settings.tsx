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
import type { GiteaIdentitySummary, GiteaProjectDiagnostic } from "../shared/types.js";
import {
  buildGiteaIdentityOptions,
  getAgentChangeModeOptions,
  isLegacyWorkflowPolicy,
  type SelectOption,
} from "./host-settings.js";
import { PromptEditorField } from "./prompt-editor-field.js";
import {
  DEFAULT_AGENT_AUTO_PROMPT,
  DEFAULT_AGENT_PLAN_PROMPT,
  DEFAULT_AGENT_REVIEW_PROMPT,
  PROMPT_PLACEHOLDERS,
} from "../shared/prompts.js";

function getProjectWorkflowPolicyOptions(currentValue?: string) {
  const options: Array<{ label: string; value: string }> = [
    { label: "继承全局默认", value: "" },
    { label: "直通 PR (0 卡点)", value: "direct_pr" },
    { label: "质询方案确认 (1 卡点 · Grilling)", value: "grill_plan" },
  ];
  if (currentValue && isLegacyWorkflowPolicy(currentValue)) {
    options.push({
      label: `旧版兼容策略 (${currentValue})`,
      value: currentValue,
    });
  }
  return options;
}

const preferIssueAssigneeOverrideOptions: SelectOption[] = [
  { label: "继承全局默认", value: "" },
  { label: "开启 (优先按 Issue 指派人切换身份)", value: "true" },
  { label: "关闭 (严格固定使用项目/全局所选身份)", value: "false" },
];

function getPreferIssueAssigneeOverrideValue(override?: boolean): string {
  if (override === true) return "true";
  if (override === false) return "false";
  return "";
}

function parsePreferIssueAssigneeOverrideValue(val: string): boolean | undefined {
  if (val === "true") return true;
  if (val === "false") return false;
  return undefined;
}

export interface ProjectDetailSettingsProps {
  projectId: string;
  diagnostic?: GiteaProjectDiagnostic;
  identities?: GiteaIdentitySummary[];
  settings: any;
  theme: PluginSurfaceProps["theme"];
  onBack: () => void;
  onIdentityChanged?: () => void;
}

export function ProjectDetailSettings({
  projectId,
  diagnostic,
  identities,
  settings,
  theme,
  onBack,
  onIdentityChanged,
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
          <SettingsInput
            label="默认基准分支 (Base Branch)"
            hint="切出任务工作区的源分支以及 PR 交付的目标分支，如 develop、main。留空则继承全局或探测远端"
            initialValue={projectSettings.baseBranch || ""}
            disabled={settings.saving}
            onChangeText={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  baseBranch: val.trim() || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsSelect
            label="项目 Gitea 身份覆盖 (可选)"
            hint="留空继承全局默认 Gitea 执行身份；指定后该项目固定优先使用此账号拉取与交付"
            value={projectSettings.giteaIdentityOverride || ""}
            options={buildGiteaIdentityOptions(
              identities ?? [],
              projectSettings.giteaIdentityOverride,
              true,
            )}
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  giteaIdentityOverride: val || undefined,
                },
              };
              void Promise.resolve(
                settings.save({ ...values, projects: updated }, settings.revision),
              ).then(() => {
                onIdentityChanged?.();
              });
            }}
          />
          <SettingsSelect
            label="指派人动态匹配覆盖 (可选)"
            hint="留空继承全局“优先匹配 Issue 指派人”开关"
            value={getPreferIssueAssigneeOverrideValue(projectSettings.preferIssueAssigneeOverride)}
            options={preferIssueAssigneeOverrideOptions}
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  preferIssueAssigneeOverride: parsePreferIssueAssigneeOverrideValue(val),
                },
              };
              void Promise.resolve(
                settings.save({ ...values, projects: updated }, settings.revision),
              ).then(() => {
                onIdentityChanged?.();
              });
            }}
          />
          <SettingsSelect
            label="工作流策略覆盖 (可选)"
            hint="留空继承全局默认工作流策略"
            value={projectSettings.workflowPolicyOverride || ""}
            options={getProjectWorkflowPolicyOptions(projectSettings.workflowPolicyOverride) as any}
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  workflowPolicyOverride: (val || undefined) as any,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsSelect
            label="Harness 模式覆盖 (可选)"
            hint="留空继承全局配置"
            value={projectSettings.harnessModeOverride || ""}
            options={
              [
                { label: "继承全局默认", value: "" },
                { label: "自动托管 (角色 + 引擎 + 切片)", value: "auto" },
                { label: "锁定引擎 (仅路由档位与切片)", value: "provider_locked" },
                { label: "停用联动 (静态配置)", value: "disabled" },
              ] as any
            }
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  harnessModeOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
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
                { label: "Pi", value: "pi" },
              ] as any
            }
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const currentMode = projectSettings.agentChangeModeOverride;
              let nextMode = currentMode;
              if (val === "claude" && currentMode === "full-access") {
                nextMode = "bypassPermissions";
              } else if (
                (val === "codex" || val === "pi") &&
                (currentMode === "bypassPermissions" || currentMode === "acceptEdits")
              ) {
                nextMode = "full-access";
              }
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentProviderOverride: val || undefined,
                  agentChangeModeOverride: nextMode || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsSelect
            label="独立审查引擎覆盖 (可选)"
            hint="留空时保持 Agent Harness 审查专家异构引擎（默认 Antigravity）"
            value={projectSettings.reviewProviderOverride || ""}
            options={
              [
                { label: "继承全局默认", value: "" },
                { label: "Claude Code", value: "claude" },
                { label: "Codex", value: "codex" },
                { label: "Google Antigravity", value: "antigravity" },
                { label: "OpenCode", value: "opencode" },
                { label: "Pi", value: "pi" },
              ] as any
            }
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  reviewProviderOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsSelect
            label="模式覆盖 (Change Mode)"
            hint="留空继承全局配置，如覆盖为 Codex 的 Full Access 等"
            value={projectSettings.agentChangeModeOverride || ""}
            options={
              getAgentChangeModeOptions(
                projectSettings.agentProviderOverride || values.agentProvider,
                true,
              ) as any
            }
            disabled={settings.saving}
            onValueChange={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentChangeModeOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsInput
            label="模型覆盖 (可选)"
            hint="留空时继承全局配置或按 Agent Harness 四档矩阵自动匹配（如 pro、flash、gemini-4-argon）"
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

      <SettingsSection title="提示词覆盖 (Prompt Overrides)">
        <SettingsCard>
          <SettingsRow
            label="可用插值变量"
            hint={PROMPT_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(", ")}
          />
          <PromptEditorField
            label="Agent Auto 提示词覆盖 (可选)"
            hint="留空继承全局配置。若需完全重置为继承全局，可点击下方清除覆盖"
            value={projectSettings.agentAutoPromptOverride ?? ""}
            actionLabel="填充默认 Auto 模板"
            disabled={settings.saving}
            theme={theme}
            placeholder="留空继承全局配置..."
            onAction={() => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentAutoPromptOverride: DEFAULT_AGENT_AUTO_PROMPT,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
            onChangeText={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentAutoPromptOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <PromptEditorField
            label="Agent Plan 提示词覆盖 (可选)"
            hint="留空继承全局配置。若需完全重置为继承全局，可点击下方清除覆盖"
            value={projectSettings.agentPlanPromptOverride ?? ""}
            actionLabel="填充默认 Plan 模板"
            disabled={settings.saving}
            theme={theme}
            placeholder="留空继承全局配置..."
            onAction={() => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentPlanPromptOverride: DEFAULT_AGENT_PLAN_PROMPT,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
            onChangeText={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentPlanPromptOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <PromptEditorField
            label="Agent Review 提示词覆盖 (可选)"
            hint="留空继承全局配置。若需完全重置为继承全局，可点击下方清除覆盖"
            value={projectSettings.agentReviewPromptOverride ?? ""}
            actionLabel="填充默认 Review 模板"
            disabled={settings.saving}
            theme={theme}
            placeholder="留空继承全局配置..."
            onAction={() => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentReviewPromptOverride: DEFAULT_AGENT_REVIEW_PROMPT,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
            onChangeText={(val: string) => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentReviewPromptOverride: val || undefined,
                },
              };
              void settings.save({ ...values, projects: updated }, settings.revision);
            }}
          />
          <SettingsAction
            label=""
            actionLabel="清除覆盖（恢复继承）"
            disabled={settings.saving}
            onPress={() => {
              const updated = {
                ...values.projects,
                [projectId]: {
                  ...projectSettings,
                  agentAutoPromptOverride: undefined,
                  agentPlanPromptOverride: undefined,
                  agentReviewPromptOverride: undefined,
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
            hint="添加 Issue 标签 agent-auto 或 agent:auto。认领后按 TDD 完成编码、测试校验、独立双轴审查（含自动返修）并创建 PR，全程 0 人工卡点。"
          />
          <SettingsRow
            label="Agent Plan (规划审查模式)"
            hint="添加 Issue 标签 agent-plan 或 agent:plan。先输出 Grilling 关键决策质询与模块方案，经单次人工确认后自动完成编码、独立审查与 PR 交付。"
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
          {diagnostic?.activeIdentity ? (
            <SettingsRow label="当前生效身份">
              <Text style={mutedColor}>
                {`${diagnostic.activeIdentity.name} (@${diagnostic.activeIdentity.giteaUsername || diagnostic.activeIdentity.id} · ${diagnostic.activeIdentity.source})`}
              </Text>
            </SettingsRow>
          ) : null}
          {diagnostic?.errorMessage ? (
            <SettingsRow label="诊断详情">
              <Text style={{ color: theme.colors.statusDanger }}>{diagnostic.errorMessage}</Text>
            </SettingsRow>
          ) : null}
          {diagnostic?.agentTeam ? (
            <SettingsRow label="工作区 Agent Team">
              <Text style={mutedColor}>
                {`${diagnostic.agentTeam.projectSlug} · ${diagnostic.agentTeam.preset} (${diagnostic.agentTeam.rolesCount} 角色)`}
              </Text>
            </SettingsRow>
          ) : null}
          <SettingsAction label="" actionLabel="返回项目列表" onPress={onBack} />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
