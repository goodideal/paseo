export function getAgentChangeModeOptions(provider?: string, isOverride = false) {
  const p = (provider || "claude").toLowerCase();
  const options = [];
  if (isOverride) {
    options.push({ label: "继承全局默认", value: "" });
  }

  if (p.includes("codex")) {
    options.push(
      { label: "默认权限 (Default Permissions)", value: "auto" },
      { label: "自动审查 (Auto-review)", value: "auto-review" },
      { label: "完全访问 (Full Access - 免确认)", value: "full-access" },
    );
  } else if (p.includes("claude")) {
    options.push(
      { label: "自动模式 (Auto mode)", value: "auto" },
      { label: "默认权限 (Default Permissions)", value: "default" },
      { label: "接受文件修改 (Accept File Edits)", value: "acceptEdits" },
      { label: "跳过权限确认 (Bypass Permissions)", value: "bypassPermissions" },
      { label: "计划模式 (Plan Mode)", value: "plan" },
    );
  } else if (p.includes("opencode")) {
    options.push(
      { label: "构建与执行模式 (Build)", value: "build" },
      { label: "完全访问 (Full Access - 自动映射为 Build)", value: "full-access" },
      { label: "计划模式 (Plan Mode)", value: "plan" },
    );
  } else if (p === "pi" || p.startsWith("pi/") || p.startsWith("pi-") || p.startsWith("pi_")) {
    options.push(
      { label: "默认模式 (Default)", value: "auto" },
      { label: "完全访问 (Full Access)", value: "full-access" },
      { label: "计划模式 (Plan Mode)", value: "plan" },
    );
  } else {
    options.push(
      { label: "默认模式 (Default)", value: "auto" },
      { label: "完全访问 (Full Access)", value: "full-access" },
      { label: "计划模式 (Plan Mode)", value: "plan" },
    );
  }
  return options;
}

import React, { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useSettings, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  SettingsSelect,
  SettingsInput,
  SettingsRow,
  SettingsAction,
} from "@getpaseo/plugin/client/ui";
import { giteaSettingsDefinition } from "../shared/settings.js";
import { diagnoseProjectsRpc, syncGiteaIdentitiesRpc } from "../shared/contracts.js";
import type {
  GiteaHostSettings,
  GiteaIdentitySummary,
  GiteaProjectDiagnostic,
} from "../shared/types.js";
import { ProjectDetailSettings } from "./project-detail-settings.js";
import { PromptEditorField } from "./prompt-editor-field.js";
import {
  DEFAULT_AGENT_AUTO_PROMPT,
  DEFAULT_AGENT_PLAN_PROMPT,
  DEFAULT_AGENT_REVIEW_PROMPT,
  PROMPT_PLACEHOLDERS,
} from "../shared/prompts.js";

const LEGACY_WORKFLOW_POLICIES = new Set(["full_superpowers", "issue_preapproved", "unattended"]);

export function isLegacyWorkflowPolicy(value?: string): boolean {
  return Boolean(value && LEGACY_WORKFLOW_POLICIES.has(value));
}

export function getWorkflowPolicyOptions(currentValue?: string) {
  const options: Array<{ label: string; value: string }> = [
    { label: "直通 PR (0 卡点 · 推荐)", value: "direct_pr" },
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

const repairCycleOptions = [
  { label: "0 次 (不自动返修)", value: "0" },
  { label: "1 次", value: "1" },
  { label: "2 次 (默认)", value: "2" },
  { label: "3 次", value: "3" },
  { label: "4 次", value: "4" },
  { label: "5 次", value: "5" },
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

function formatHarnessStatusHint(harnessStatus: {
  available: boolean;
  enabled: boolean;
  specialistsCount?: number;
}): string {
  if (harnessStatus.available && harnessStatus.enabled) {
    return `已连接 · ${harnessStatus.specialistsCount ?? 0} 个专家角色就绪`;
  }
  return "未启用 · 自动回退静态引擎配置";
}

export function formatIdentityOptionLabel(item: GiteaIdentitySummary): string {
  const sourceTag = item.source === "team-collab" ? "Team Collab" : "tea";
  const usernameTag = item.giteaUsername ? `@${item.giteaUsername}` : `@${item.id}`;
  let credStatus = "未配凭据";
  if (item.hasToken && item.hasSshKey) {
    credStatus = "Token + SSH";
  } else if (item.hasToken) {
    credStatus = "Token 就绪";
  } else if (item.hasSshKey) {
    credStatus = "仅 SSH (缺 API Token)";
  }
  return `${item.name} (${usernameTag} · ${sourceTag} · ${credStatus})`;
}

export type SelectOption = React.ComponentProps<typeof SettingsSelect>["options"][number];

export function buildGiteaIdentityOptions(
  identities: readonly GiteaIdentitySummary[],
  currentValue?: string,
  isProjectOverride = false,
): SelectOption[] {
  const defaultLabel = isProjectOverride
    ? "继承全局默认身份"
    : "自动匹配 (优先 Team Collab / tea 默认)";
  const options: SelectOption[] = [{ label: defaultLabel, value: "" }];
  for (const item of identities) {
    options.push({
      label: formatIdentityOptionLabel(item),
      value: item.id,
    });
  }
  if (currentValue && !identities.some((i) => i.id === currentValue)) {
    options.push({
      label: `当前已选 (${currentValue})`,
      value: currentValue,
    });
  }
  return options;
}

export function formatIdentityRosterHint(
  identities: readonly GiteaIdentitySummary[],
  teamCollabStatus: { available: boolean; membersCount: number } | null,
): string {
  if (teamCollabStatus?.available) {
    return `Team Collab 已连接 · 共 ${identities.length} 个可选 Gitea 身份`;
  }
  return `本机探测到 ${identities.length} 个 tea 登录身份`;
}

export const formatTeamCollabHint = formatIdentityRosterHint;

export function formatProjectDiagnosticHint(proj: GiteaProjectDiagnostic): string {
  if (proj.connectionStatus === "connected") {
    const authLabel = proj.activeIdentity
      ? `@${proj.activeIdentity.giteaUsername || proj.activeIdentity.id} · ${proj.authSource}`
      : proj.authSource;
    let baseText = `已连接 (${authLabel}) · ${proj.pendingIssueCount ?? 0} 个待办`;
    if (proj.agentTeam && proj.agentTeam.rolesCount > 0) {
      baseText += ` · Team: ${proj.agentTeam.preset} (${proj.agentTeam.rolesCount})`;
    }
    return baseText;
  }
  if (proj.connectionStatus === "unauthorized") {
    return proj.errorMessage || "未找到 Gitea Token";
  }
  return "非 Gitea 远端";
}

function useOptionalPluginRpc<TInput, TOutput>(
  rpcDef: any,
  useRpcHook: typeof useRpc | undefined,
  fallbackCaller: (input: TInput) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  const hook = useRpcHook ?? useRpc;
  try {
    return hook(rpcDef) as (input: TInput) => Promise<TOutput>;
  } catch {
    return fallbackCaller;
  }
}

export interface HostSettingsScreenProps extends PluginSurfaceProps {
  useSettingsHook?: (def: any) => any;
  useRpcHook?: typeof useRpc;
  settingsOverride?: any;
  diagnosticsOverride?: GiteaProjectDiagnostic[];
  identitiesOverride?: GiteaIdentitySummary[];
}

export function HostSettingsScreen({
  theme,
  useSettingsHook,
  useRpcHook,
  settingsOverride,
  diagnosticsOverride,
  identitiesOverride,
}: HostSettingsScreenProps) {
  const settings = useSettingsHook
    ? useSettingsHook(giteaSettingsDefinition)
    : (settingsOverride ?? useSettings(giteaSettingsDefinition));

  const defaultRpcCaller = useCallback(
    async (
      _input: Record<string, never> = {},
    ): Promise<{
      diagnostics: GiteaProjectDiagnostic[];
      identities?: GiteaIdentitySummary[];
      teamCollabStatus?: { available: boolean; membersCount: number };
      harnessStatus?: { available: boolean; enabled: boolean; specialistsCount?: number };
    }> => ({
      diagnostics: diagnosticsOverride ?? [],
      identities: identitiesOverride,
    }),
    [diagnosticsOverride, identitiesOverride],
  );
  const rpcFunc = useOptionalPluginRpc(diagnoseProjectsRpc, useRpcHook, defaultRpcCaller);
  const diagnoseProjects = diagnosticsOverride ? defaultRpcCaller : rpcFunc;

  const defaultSyncRpcCaller = useCallback(
    async (
      _input: Record<string, never> = {},
    ): Promise<{
      syncedCount: number;
      identities: GiteaIdentitySummary[];
    }> => ({
      syncedCount: (identitiesOverride ?? []).length,
      identities: identitiesOverride ?? [],
    }),
    [identitiesOverride],
  );
  const syncIdentities = useOptionalPluginRpc(
    syncGiteaIdentitiesRpc,
    useRpcHook,
    defaultSyncRpcCaller,
  );

  const [diagnostics, setDiagnostics] = useState<GiteaProjectDiagnostic[]>(
    diagnosticsOverride ?? [],
  );
  const [identities, setIdentities] = useState<GiteaIdentitySummary[]>(identitiesOverride ?? []);
  const [teamCollabStatus, setTeamCollabStatus] = useState<{
    available: boolean;
    membersCount: number;
  } | null>(null);
  const [syncingIdentities, setSyncingIdentities] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [harnessStatus, setHarnessStatus] = useState<{
    available: boolean;
    enabled: boolean;
    specialistsCount?: number;
  } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(null as string | null);

  const refreshDiagnostics = useCallback(async () => {
    if (diagnosticsOverride) return;
    try {
      const res = await diagnoseProjects({});
      setDiagnostics(res?.diagnostics ?? []);
      if (res?.identities) {
        setIdentities(res.identities);
      } else if (identitiesOverride) {
        setIdentities(identitiesOverride);
      }
      setTeamCollabStatus(res?.teamCollabStatus ?? null);
      setHarnessStatus(res?.harnessStatus ?? null);
    } catch {
      // ignore
    }
  }, [diagnoseProjects, diagnosticsOverride, identitiesOverride]);

  const handleSyncIdentities = useCallback(async () => {
    setSyncingIdentities(true);
    setSyncError(null);
    try {
      const res = await syncIdentities({});
      if (res?.identities) {
        setIdentities(res.identities);
      }
      await refreshDiagnostics();
    } catch (err) {
      setSyncError((err as Error)?.message || "同步本机账号失败");
    } finally {
      setSyncingIdentities(false);
    }
  }, [syncIdentities, refreshDiagnostics]);

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
    if (enabled && typeof globalThis !== "undefined") {
      const g = globalThis as unknown as { confirm?: (msg: string) => boolean };
      if (typeof g.confirm === "function") {
        const ok = g.confirm(
          "开启后将自动处理授权项目中有触发标签 (Agent Auto / Agent Plan) 的 Issue 并创建工作树。是否确认开启？",
        );
        if (!ok) return;
      }
    }
    void settings.save({ ...values, enabled }, settings.revision);
  };

  const changePolicy = (policy: string) => {
    void settings.save({ ...values, workflowPolicy: policy as any }, settings.revision);
  };

  const changeMaxRepairCycles = (cyclesStr: string) => {
    void settings.save(
      { ...values, maxAutomaticRepairCycles: parseInt(cyclesStr, 10) },
      settings.revision,
    );
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
    if (!currentEnabled && typeof globalThis !== "undefined") {
      const g = globalThis as unknown as { confirm?: (msg: string) => boolean };
      if (typeof g.confirm === "function") {
        const ok = g.confirm(`是否确认授权项目 ${projectId} 自动执行匹配的 Issue？`);
        if (!ok) return;
      }
    }
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
        identities={identities}
        settings={settings}
        theme={theme}
        onBack={() => setSelectedProjectId(null)}
        onIdentityChanged={() => void refreshDiagnostics()}
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
              hint="开启后，仅处理已授权项目中带有 Agent Auto 或 Agent Plan 标签的 Issue"
              value={values.enabled}
              onValueChange={toggleGlobalEnabled}
              disabled={settings.saving}
            />
          </Pressable>
          <SettingsSelect
            label="默认工作流策略"
            hint="Issue 未附带 agent-auto / agent-plan 标签时的默认流程控制"
            value={values.workflowPolicy}
            options={getWorkflowPolicyOptions(values.workflowPolicy) as any}
            disabled={settings.saving}
            onValueChange={changePolicy}
          />
          <SettingsSelect
            label="自动返修轮数上限"
            hint="测试失败或独立审查未通过时，同会话自动返修上限；超限后创建 [WIP] PR"
            value={String(values.maxAutomaticRepairCycles ?? 2)}
            options={repairCycleOptions as any}
            disabled={settings.saving}
            onValueChange={changeMaxRepairCycles}
          />
          <SettingsInput
            label="全局默认基准分支 (Base Branch)"
            hint="未配置项目级分支时回落使用，如 main、develop。留空则自动探测远端 HEAD"
            initialValue={values.defaultBaseBranch || ""}
            disabled={settings.saving}
            onChangeText={(val: string) => {
              void settings.save(
                {
                  ...values,
                  defaultBaseBranch: val.trim() || undefined,
                },
                settings.revision,
              );
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Gitea 身份与归属 (Gitea Identity)">
        <SettingsCard>
          <SettingsSelect
            label="默认 Gitea 执行身份"
            hint="用于拉取 Issue、写入 Worktree Git 提交作者、推送分支及创建 PR；凭据统一复用 Team Collab 名录与本机 tea 登录项"
            value={values.giteaIdentityId || ""}
            options={buildGiteaIdentityOptions(identities, values.giteaIdentityId, false)}
            disabled={settings.saving}
            onValueChange={(val: string) => {
              void Promise.resolve(
                settings.save({ ...values, giteaIdentityId: val || undefined }, settings.revision),
              ).then(() => {
                void refreshDiagnostics();
              });
            }}
          />
          <SettingsSwitch
            label="优先匹配 Issue 指派人 (Assignee)"
            hint="开启后，若 Issue 指派人匹配本机已启用且具备有效 Token 的成员身份，自动以该成员身份认领、提交与提 PR；未指派或未匹配时回退至默认身份"
            value={values.preferIssueAssignee ?? true}
            disabled={settings.saving}
            onValueChange={(preferIssueAssignee: boolean) => {
              void Promise.resolve(
                settings.save({ ...values, preferIssueAssignee }, settings.revision),
              ).then(() => {
                void refreshDiagnostics();
              });
            }}
          />
          <SettingsAction
            label="成员名录同步"
            hint={formatIdentityRosterHint(identities, teamCollabStatus)}
            actionLabel={syncingIdentities ? "同步中..." : "同步本机账号"}
            disabled={settings.saving || syncingIdentities}
            onPress={() => void handleSyncIdentities()}
          />
          {syncError ? <Text style={{ color: theme.colors.statusDanger }}>{syncError}</Text> : null}
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

      <SettingsSection title="执行引擎与模型 (Agent & Model)">
        <SettingsCard>
          <SettingsSelect
            label="Agent Harness 编排模式"
            value={values.harnessMode || "auto"}
            options={
              [
                { label: "自动托管 (按阶段路由角色、引擎与切片)", value: "auto" },
                { label: "锁定引擎 (仅由 Harness 路由档位与切片)", value: "provider_locked" },
                { label: "停用联动 (仅使用静态配置)", value: "disabled" },
              ] as any
            }
            disabled={settings.saving}
            onValueChange={(harnessMode: string) =>
              void settings.save(
                { ...values, harnessMode: harnessMode as GiteaHostSettings["harnessMode"] },
                settings.revision,
              )
            }
          />
          {harnessStatus ? (
            <SettingsRow label="Agent Harness 状态" hint={formatHarnessStatusHint(harnessStatus)} />
          ) : null}
          <SettingsSelect
            label="Agent 引擎"
            hint="执行自动化开发任务的代码智能代理"
            value={values.agentProvider || "claude"}
            options={
              [
                { label: "Claude Code (推荐)", value: "claude" },
                { label: "Codex", value: "codex" },
                { label: "Google Antigravity", value: "antigravity" },
                { label: "OpenCode", value: "opencode" },
                { label: "Pi", value: "pi" },
              ] as any
            }
            disabled={settings.saving}
            onValueChange={(agentProvider) => {
              const currentMode = values.agentChangeMode || "auto";
              let nextMode = currentMode;
              if (agentProvider === "claude" && currentMode === "full-access") {
                nextMode = "bypassPermissions";
              } else if (
                (agentProvider === "codex" || agentProvider === "pi") &&
                (currentMode === "bypassPermissions" || currentMode === "acceptEdits")
              ) {
                nextMode = "full-access";
              }
              void settings.save(
                { ...values, agentProvider, agentChangeMode: nextMode },
                settings.revision,
              );
            }}
          />
          <SettingsInput
            label="指定模型 (可选)"
            hint="留空时按 Agent Harness 四档矩阵自动匹配（如 pro、flash、gemini-4-argon）"
            initialValue={values.agentModel || ""}
            disabled={settings.saving}
            onChangeText={(agentModel) =>
              settings.save({ ...values, agentModel }, settings.revision)
            }
          />
          <SettingsSelect
            label="Agent 运行模式 (Change Mode)"
            hint="配置 Agent 的执行与审批模式，如 Codex 的 Full Access 等"
            value={values.agentChangeMode || "auto"}
            options={getAgentChangeModeOptions(values.agentProvider, false) as any}
            disabled={settings.saving}
            onValueChange={(agentChangeMode: string) =>
              settings.save({ ...values, agentChangeMode }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="提示词自定义 (Custom Prompts)">
        <SettingsCard>
          <SettingsRow
            label="可用插值变量"
            hint={PROMPT_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(", ")}
          />
          <PromptEditorField
            label="Agent Auto 提示词模板"
            hint="全自动模式下的系统 Prompt 模板，留空使用内置默认。支持变量插值。"
            value={values.agentAutoPrompt ?? ""}
            actionLabel="恢复内置 Auto 模板"
            disabled={settings.saving}
            theme={theme}
            placeholder="留空使用内置默认模板..."
            onAction={() => {
              void settings.save(
                { ...values, agentAutoPrompt: DEFAULT_AGENT_AUTO_PROMPT },
                settings.revision,
              );
            }}
            onChangeText={(agentAutoPrompt) => {
              void settings.save(
                { ...values, agentAutoPrompt: agentAutoPrompt || undefined },
                settings.revision,
              );
            }}
          />
          <PromptEditorField
            label="Agent Plan 提示词模板"
            hint="规划审查模式下的系统 Prompt 模板，留空使用内置默认。支持变量插值。"
            value={values.agentPlanPrompt ?? ""}
            actionLabel="恢复内置 Plan 模板"
            disabled={settings.saving}
            theme={theme}
            placeholder="留空使用内置默认模板..."
            onAction={() => {
              void settings.save(
                { ...values, agentPlanPrompt: DEFAULT_AGENT_PLAN_PROMPT },
                settings.revision,
              );
            }}
            onChangeText={(agentPlanPrompt) => {
              void settings.save(
                { ...values, agentPlanPrompt: agentPlanPrompt || undefined },
                settings.revision,
              );
            }}
          />
          <PromptEditorField
            label="Agent Review 独立审查提示词模板"
            hint="代码审查阶段（independent-review）的系统 Prompt 模板，留空使用内置默认。支持变量插值。"
            value={values.agentReviewPrompt ?? ""}
            actionLabel="恢复内置 Review 模板"
            disabled={settings.saving}
            theme={theme}
            placeholder="留空使用内置默认模板..."
            onAction={() => {
              void settings.save(
                { ...values, agentReviewPrompt: DEFAULT_AGENT_REVIEW_PROMPT },
                settings.revision,
              );
            }}
            onChangeText={(agentReviewPrompt) => {
              void settings.save(
                { ...values, agentReviewPrompt: agentReviewPrompt || undefined },
                settings.revision,
              );
            }}
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
              const statusText = formatProjectDiagnosticHint(proj);

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
