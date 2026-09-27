import React, { useCallback, useMemo } from "react";
import { Text, View, StyleSheet } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsSection,
  SettingsCard,
  SettingsSwitch,
  SettingsSelect,
  SettingsAction,
  SettingsRow,
} from "@getpaseo/plugin/client/ui";
import { watchdogSettings } from "../../shared/settings.js";

const TURN_OPTIONS = [
  { label: "1 轮 (单步执行)", value: "1" },
  { label: "3 轮", value: "3" },
  { label: "5 轮 (默认推荐)", value: "5" },
  { label: "10 轮", value: "10" },
  { label: "15 轮", value: "15" },
  { label: "20 轮 (上限)", value: "20" },
] as const;

const HEARTBEAT_OPTIONS = [
  { label: "5 秒 (快速灵敏)", value: "5" },
  { label: "10 秒", value: "10" },
  { label: "15 秒 (默认推荐)", value: "15" },
  { label: "30 秒", value: "30" },
  { label: "60 秒 (宽松长耗时)", value: "60" },
] as const;

export function RadarSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(watchdogSettings);
  const textColor = useMemo(
    () => ({ color: theme?.colors?.foreground ?? "#11181C" }),
    [theme?.colors?.foreground],
  );

  const handleToggleAutoContinue = useCallback(
    (value: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, autoContinue: value }, settings.revision);
      }
    },
    [settings],
  );

  const handleToggleAutoApprove = useCallback(
    (value: boolean) => {
      if (settings.status === "ready") {
        void settings.save(
          { ...settings.values, autoApprovePermissions: value },
          settings.revision,
        );
      }
    },
    [settings],
  );

  const handleChangeMaxAutoTurns = useCallback(
    (value: string) => {
      if (settings.status === "ready") {
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
          void settings.save({ ...settings.values, maxAutoTurns: num }, settings.revision);
        }
      }
    },
    [settings],
  );

  const handleChangeHeartbeatThreshold = useCallback(
    (value: string) => {
      if (settings.status === "ready") {
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
          void settings.save(
            { ...settings.values, heartbeatThresholdSeconds: num },
            settings.revision,
          );
        }
      }
    },
    [settings],
  );

  if (settings.status === "loading") {
    return (
      <View style={styles.container}>
        <Text style={textColor}>加载 Agent Radar 配置中…</Text>
      </View>
    );
  }

  if (settings.status !== "ready") {
    return (
      <View style={styles.container}>
        <SettingsSection title="Agent Radar & Watchdog 设置">
          <Text style={textColor}>{settings.error || "配置加载失败"}</Text>
          <SettingsAction label="重新加载" actionLabel="重试" onPress={settings.reload} />
          {settings.status === "invalid" && (
            <SettingsAction label="恢复默认" actionLabel="重置" onPress={settings.reset} />
          )}
        </SettingsSection>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SettingsSection
        title="自动化执行与守护 (Automation & Watchdog)"
        info="配置 Agent 在后台自动推进、命令审批及死循环守护策略"
      >
        <SettingsCard>
          <SettingsSwitch
            label="自动推进任务 (Auto Continue)"
            hint="检测到未勾选 Markdown 任务 [- ] 或继续提示词时，自动发送推进指令"
            value={settings.values.autoContinue}
            disabled={settings.saving}
            onValueChange={handleToggleAutoContinue}
          />
          <SettingsSwitch
            label="安全只读权限自动审批 (Safe Permission Auto-Approve)"
            hint="自动放行 git status/diff、cat、ls、npm test 等安全只读指令的权限申请"
            value={settings.values.autoApprovePermissions}
            disabled={settings.saving}
            onValueChange={handleToggleAutoApprove}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="阈值与限制 (Thresholds & Limits)"
        info="防止 Agent 陷入死循环及失联的长耗时探测控制"
      >
        <SettingsCard>
          <SettingsSelect
            label="最大连续自动轮数 (Max Auto Turns)"
            hint="连续自动推进的最大回合数，达到限制将挂起并弹出卡片交由人工决策"
            value={String(settings.values.maxAutoTurns)}
            options={TURN_OPTIONS}
            disabled={settings.saving}
            onValueChange={handleChangeMaxAutoTurns}
          />
          <SettingsSelect
            label="工具调用心跳探测阈值 (Heartbeat Threshold)"
            hint="长耗时工具执行的心跳监测判定周期"
            value={String(settings.values.heartbeatThresholdSeconds)}
            options={HEARTBEAT_OPTIONS}
            disabled={settings.saving}
            onValueChange={handleChangeHeartbeatThreshold}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="重置与维护 (Maintenance)">
        <SettingsCard>
          <SettingsAction
            label="恢复默认配置"
            hint="将所有自动化与守护参数重置为出厂预设值"
            actionLabel="重置默认设置"
            disabled={settings.saving}
            onPress={settings.reset}
          />
        </SettingsCard>
        {settings.saveError && (
          <SettingsRow label="保存错误" error={settings.saveError}>
            <Text style={styles.errorText}>{settings.saveError}</Text>
          </SettingsRow>
        )}
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  errorText: {
    color: "#E5484D",
    fontSize: 13,
  },
});
