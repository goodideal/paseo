import React, { useCallback, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsSection,
  SettingsCard,
  SettingsSwitch,
  SettingsInput,
  SettingsSelect,
  SettingsAction,
} from "@getpaseo/plugin/client/ui";
import { audioBriefSettings, DEFAULT_AUDIO_BRIEF_INSTRUCTIONS } from "../shared/settings.js";

const TIMEOUT_OPTIONS = [
  { label: "15 秒", value: "15" },
  { label: "30 秒", value: "30" },
  { label: "60 秒 (推荐 - 支持长文本)", value: "60" },
  { label: "90 秒", value: "90" },
  { label: "120 秒", value: "120" },
] as const;

const TIMEOUT_LLM_OPTIONS = [
  { label: "10 秒", value: "10" },
  { label: "20 秒", value: "20" },
  { label: "30 秒 (推荐)", value: "30" },
  { label: "60 秒", value: "60" },
] as const;

export function AudioBriefSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(audioBriefSettings);
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null);

  const isReady = settings.status === "ready";
  const values = isReady ? settings.values : audioBriefSettings.schema.parse({});

  const activeInstructions = instructionsDraft !== null ? instructionsDraft : values.instructions;

  const handleToggleLlmSummary = useCallback(
    (enabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, enableLlmSummary: enabled }, settings.revision);
      }
    },
    [settings],
  );

  const handleUpdateLlmBaseUrl = useCallback(
    (url: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, llmBaseUrl: url.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleUpdateLlmApiKey = useCallback(
    (key: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, llmApiKey: key.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleUpdateLlmModel = useCallback(
    (model: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, llmModel: model.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleSelectLlmTimeout = useCallback(
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && settings.status === "ready") {
        void settings.save({ ...settings.values, llmTimeoutSeconds: parsed }, settings.revision);
      }
    },
    [settings],
  );

  const handleToggleBackendTts = useCallback(
    (enabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, enableBackendTts: enabled }, settings.revision);
      }
    },
    [settings],
  );

  const handleToggleMacOsSay = useCallback(
    (enabled: boolean) => {
      if (settings.status === "ready") {
        void settings.save(
          { ...settings.values, enableMacOsSayFallback: enabled },
          settings.revision,
        );
      }
    },
    [settings],
  );

  const handleUpdateBaseUrl = useCallback(
    (url: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, ttsBaseUrl: url.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleUpdateApiKey = useCallback(
    (key: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, ttsApiKey: key.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleUpdateModel = useCallback(
    (model: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, ttsModel: model.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleUpdateVoice = useCallback(
    (voice: string) => {
      if (settings.status === "ready") {
        void settings.save({ ...settings.values, ttsVoice: voice.trim() }, settings.revision);
      }
    },
    [settings],
  );

  const handleSelectTimeout = useCallback(
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && settings.status === "ready") {
        void settings.save({ ...settings.values, ttsTimeoutSeconds: parsed }, settings.revision);
      }
    },
    [settings],
  );

  const handleSaveInstructions = useCallback(() => {
    if (settings.status === "ready" && instructionsDraft !== null) {
      void settings
        .save({ ...settings.values, instructions: instructionsDraft.trim() }, settings.revision)
        .then(() => {
          setInstructionsDraft(null);
        });
    }
  }, [settings, instructionsDraft]);

  const handleResetInstructionsToDefault = useCallback(() => {
    setInstructionsDraft(DEFAULT_AUDIO_BRIEF_INSTRUCTIONS);
  }, []);

  const hasInstructionChanges =
    instructionsDraft !== null && instructionsDraft.trim() !== values.instructions.trim();

  if (settings.status === "loading") {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>正在加载语音简报设置…</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection
        title="大模型总结服务 (LLM Summarization)"
        info="配置用于理解和提炼消息内容的大模型服务（兼容 OpenAI Chat 接口）。开启后将按照自定义提示词指令生成结构化简报；未开启或调用失败时，自动降级为纯文本快速提取。"
      >
        <SettingsCard>
          <SettingsSwitch
            label="启用大模型智能提炼 (Enable LLM Summary)"
            hint="根据自定义 Prompt 生成高可读性口语简报"
            value={values.enableLlmSummary}
            disabled={settings.saving}
            onValueChange={handleToggleLlmSummary}
          />
          {values.enableLlmSummary ? (
            <>
              <SettingsInput
                label="服务地址 (Base URL)"
                hint="例如 https://llm.ezcloud.cc/v1 或 http://127.0.0.1:8317/v1"
                initialValue={values.llmBaseUrl}
                disabled={settings.saving}
                onChangeText={handleUpdateLlmBaseUrl}
              />
              <SettingsInput
                label="API Key"
                hint="访问令牌，例如 sk-ant-..."
                initialValue={values.llmApiKey}
                disabled={settings.saving}
                secureTextEntry
                onChangeText={handleUpdateLlmApiKey}
              />
              <SettingsInput
                label="模型标识 (Model)"
                hint="例如 gemini-flash, deepseek-ai/DeepSeek-V3 等"
                initialValue={values.llmModel}
                disabled={settings.saving}
                onChangeText={handleUpdateLlmModel}
              />
              <SettingsSelect
                label="生成超时时间 (Timeout)"
                hint="请求大模型生成简报的超时时间限制"
                value={String(values.llmTimeoutSeconds)}
                options={TIMEOUT_LLM_OPTIONS}
                disabled={settings.saving}
                onValueChange={handleSelectLlmTimeout}
              />
            </>
          ) : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="语音合成服务 (TTS Service)"
        info="配置用于语音简报的高品质后端神经网络语音合成服务。未开启或服务不可用时，自动降级为 macOS 系统语音朗读或浏览器原生语音朗读。"
      >
        <SettingsCard>
          <SettingsSwitch
            label="启用后端高品质语音 (Backend Neural TTS)"
            hint="使用本地或远程 OpenAI 兼容语音模型生成自然音色"
            value={values.enableBackendTts}
            disabled={settings.saving}
            onValueChange={handleToggleBackendTts}
          />
          {values.enableBackendTts ? (
            <>
              <SettingsInput
                label="服务地址 (Base URL)"
                hint="例如本地 Apple Silicon MLX TTS: http://127.0.0.1:8001/v1"
                initialValue={values.ttsBaseUrl}
                disabled={settings.saving}
                onChangeText={handleUpdateBaseUrl}
              />
              <SettingsInput
                label="API Key"
                hint="本地服务填写 sk-local 或留空，远程服务填写对应的访问令牌"
                initialValue={values.ttsApiKey}
                disabled={settings.saving}
                secureTextEntry
                onChangeText={handleUpdateApiKey}
              />
              <SettingsInput
                label="语音模型 (Model)"
                hint="OpenAI 兼容模型标识（例如 tts-1, f5-tts-mlx 等）"
                initialValue={values.ttsModel}
                disabled={settings.saving}
                onChangeText={handleUpdateModel}
              />
              <SettingsInput
                label="音色名称 (Voice)"
                hint="音色标识（例如 alloy, echo, fable, onyx, nova, shimmer）"
                initialValue={values.ttsVoice}
                disabled={settings.saving}
                onChangeText={handleUpdateVoice}
              />
              <SettingsSelect
                label="合成超时时间 (Timeout)"
                hint="本地神经网络生成大段音频时推荐 60 秒以上，避免因超时降级"
                value={String(values.ttsTimeoutSeconds)}
                options={TIMEOUT_OPTIONS}
                disabled={settings.saving}
                onValueChange={handleSelectTimeout}
              />
            </>
          ) : null}
          <SettingsSwitch
            label="启用 macOS 系统本地语音降级 (macOS Say Fallback)"
            hint="当后端 TTS 不可用或未启动时，在 Mac 上使用原生发音引擎生成高质量 WAV"
            value={values.enableMacOsSayFallback}
            disabled={settings.saving}
            onValueChange={handleToggleMacOsSay}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="简报总结提示词 (Prompt Instructions)"
        info="自定义用于提炼和压缩长消息的系统提示词指令。支持自适应长短文策略、过滤代码及发音规则。"
      >
        <SettingsCard>
          <View style={{ padding: 12 }}>
            <TextInput
              multiline
              numberOfLines={10}
              value={activeInstructions}
              onChangeText={setInstructionsDraft}
              placeholder="输入简报生成指令..."
              placeholderTextColor="#888"
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 18,
                color: theme.colors.foreground,
                backgroundColor: theme.colors.surface0 ?? "#18181b",
                borderWidth: 1,
                borderColor: theme.colors.border ?? "#27272a",
                borderRadius: 8,
                padding: 12,
                minHeight: 180,
                textAlignVertical: "top",
              }}
            />
          </View>
          {hasInstructionChanges ? (
            <SettingsAction
              label="保存提示词变更"
              hint="将新的提示词指令保存至插件配置"
              actionLabel={settings.saving ? "保存中..." : "保存"}
              disabled={settings.saving}
              onPress={handleSaveInstructions}
            />
          ) : null}
          <SettingsAction
            label="恢复默认系统模板"
            hint="重置为 Paseo 推荐的自适应中英双语语音简报指令"
            actionLabel="恢复默认"
            disabled={settings.saving}
            onPress={handleResetInstructionsToDefault}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
