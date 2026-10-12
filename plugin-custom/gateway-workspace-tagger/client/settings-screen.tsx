import React, { useCallback, useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { ScrollView, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { gatewayTaggerSettings, type GatewayTaggerSettings } from "../shared/settings.js";
import { GATEWAY_SPEC_MARKDOWN } from "./gateway-snippets.js";

export function GatewayTaggerSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(gatewayTaggerSettings);
  const toast = useToast();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          paddingBottom: 40,
        },
        descriptionText: {
          fontSize: 13,
          lineHeight: 20,
          color: theme.colors.foregroundMuted,
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        loadingText: {
          color: theme.colors.foregroundMuted,
          padding: 16,
        },
      }),
    [theme],
  );

  const updateSetting = useCallback(
    (patch: Partial<GatewayTaggerSettings>) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, ...patch }, settings.revision);
      }
    },
    [settings],
  );

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      try {
        await copyText(text);
        toast.show(`${label}已复制到剪贴板`, { variant: "success" });
      } catch {
        toast.error("复制失败");
      }
    },
    [toast],
  );

  if (settings.status === "loading") {
    return <Text style={styles.loadingText}>加载网关打标设置中…</Text>;
  }

  const values: GatewayTaggerSettings =
    settings.status === "ready"
      ? settings.values
      : {
          enabled: true,
          source: "paseo",
          enableQueryString: false,
          defaultAnthropicBaseUrl: "https://llm.ezcloud.cc/anthropic",
          defaultOpenAiBaseUrl: "https://llm.ezcloud.cc/v1",
          workspaceParamName: "workspace_id",
          sourceParamName: "source",
          includeAgentId: true,
          agentParamName: "agent_id",
          includeWorkspaceName: true,
          workspaceNameParamName: "workspace_name",
          targetHosts: [],
          extraEnvKeys: [],
        };

  return (
    <ScrollView style={styles.container}>
      {/* 1. 参数与行为配置 */}
      <SettingsSection title="参数与打标配置">
        <SettingsCard>
          <SettingsSwitch
            label="启用网关打标"
            hint="在向大模型网关发起请求时自动注入 Workspace 与 Agent 元数据"
            value={values.enabled}
            disabled={settings.saving}
            onValueChange={(val) => updateSetting({ enabled: val })}
          />
          <SettingsSwitch
            label="允许 Query 参数注入（已弃用/默认禁用）"
            hint="默认禁用。大模型客户端（Claude/Codex）会直接追加端点路径，开启 Query 将破坏 URL 导致 404 报错"
            value={values.enableQueryString ?? false}
            disabled={settings.saving}
            onValueChange={(val) => updateSetting({ enableQueryString: val })}
          />
          <SettingsInput
            label="Anthropic 网关基地址"
            hint="默认值: https://llm.ezcloud.cc/anthropic"
            initialValue={values.defaultAnthropicBaseUrl}
            disabled={settings.saving}
            onChangeText={(val) => updateSetting({ defaultAnthropicBaseUrl: val })}
          />
          <SettingsInput
            label="OpenAI / Codex 网关基地址"
            hint="默认值: https://llm.ezcloud.cc/v1"
            initialValue={values.defaultOpenAiBaseUrl}
            disabled={settings.saving}
            onChangeText={(val) => updateSetting({ defaultOpenAiBaseUrl: val })}
          />
          <SettingsInput
            label="来源参数标识 (Source)"
            hint="默认值: paseo"
            initialValue={values.source}
            disabled={settings.saving}
            onChangeText={(val) => updateSetting({ source: val })}
          />
          <SettingsInput
            label="工作区参数名 (Workspace Param)"
            hint="默认值: workspace_id"
            initialValue={values.workspaceParamName}
            disabled={settings.saving}
            onChangeText={(val) => updateSetting({ workspaceParamName: val })}
          />
          <SettingsSwitch
            label="级联注入 Agent ID"
            hint="在 URL 中同时携带当前 Agent ID，便于网关实现两级树状汇总"
            value={values.includeAgentId}
            disabled={settings.saving}
            onValueChange={(val) => updateSetting({ includeAgentId: val })}
          />
          <SettingsInput
            label="Agent 参数名 (Agent Param)"
            hint="默认值: agent_id"
            initialValue={values.agentParamName}
            disabled={settings.saving}
            onChangeText={(val) => updateSetting({ agentParamName: val })}
          />
          <SettingsSwitch
            label="注入 Workspace 名称"
            hint="在 URL 中携带工作区名称/标题（若未生成则回退为目录名/分支名）"
            value={values.includeWorkspaceName}
            disabled={settings.saving}
            onValueChange={(val) => updateSetting({ includeWorkspaceName: val })}
          />
          <SettingsInput
            label="Workspace 名称参数名"
            hint="默认值: workspace_name"
            initialValue={values.workspaceNameParamName}
            disabled={settings.saving}
            onChangeText={(val) => updateSetting({ workspaceNameParamName: val })}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 2. 支持方式、格式与内容规范文档 */}
      <SettingsSection title="网关协议规范 (方式、格式与内容)">
        <SettingsCard>
          <Text style={styles.descriptionText}>{GATEWAY_SPEC_MARKDOWN}</Text>
          <SettingsAction
            label="协议规范文档"
            hint="复制支持的传输方式、字段定义与样例 URL"
            actionLabel="复制规范文档"
            onPress={() => handleCopy(GATEWAY_SPEC_MARKDOWN, "网关协议规范文档")}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
