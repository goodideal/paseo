## Why

Paseo 核心仓库当前仍内置了针对消息回合（Turn）的语音简报功能（Audio Brief），包含专门的协议定义（`packages/protocol/src/audio-brief.ts`、`agent.message.synthesize_brief.*` 消息）、服务端合成服务（`packages/server/src/server/agent/audio-brief-service.ts`）、客户端状态存储及组件（`packages/app/src/audio-brief/`、`turn-audio-brief-button.tsx`），并且在通用插槽容器 `<PluginTurnActions />` 中仍保留了硬编码的 fallback 兜底。
这违反了微内核插件化架构的设计原则，在与官方上游（`upstream/main`）同步合并时持续产生维护摩擦。
通过将 Audio Brief 完整抽取为独立的标准 Paseo 插件工程 `plugin-examples/audio-brief`，并彻底清除核心协议、服务端会话与前端容器中的硬编码残留，实现真正零侵入、即插即用的 Turn Action 扩展范式。

## What Changes

- **Create Standalone Plugin**:
  - 创建独立标准插件 `plugin-examples/audio-brief`，包含完整的 `paseo-plugin.json`、`package.json`、`tsconfig.json`。
  - **Shared Contract**: 使用 `@getpaseo/plugin` 的 `defineRpc` 定义独立的 `audio_brief.synthesize.request` RPC 协议与类型。
  - **Server Service**: 在插件 `index.server.ts` 中注册 RPC Handler，承载智能文本提炼、启发式摘要降级与 TTS 音频合成逻辑。
  - **Client UI & Turn Action Slots**: 在插件 `index.client.tsx` 中注册 `client.addTurnAction({ type: "button", ... })` 与 `client.addTurnAction({ type: "card", ... })`，将 `TurnAudioBriefButton` 与 `AudioBriefCard` 纯插件化。
  - **Prompt Customization**: 将自定义提示词配置与持久化迁移至插件内部或设置（Settings Screen）。
- **Clean Up Core Monorepo**:
  - **Core Protocol**: 从 `packages/protocol/src/messages.ts` 移除 `agent.message.synthesize_brief.request` 与 `.response`，删除 `packages/protocol/src/audio-brief.ts`。
  - **Core Server**: 从 `packages/server/src/server/session.ts` 移除 `audioBriefService` 字段、初始化及 RPC 分发；删除 `packages/server/src/server/agent/audio-brief-service.ts` 与对应单元测试；清理 `operation-permissions.ts` 中的操作权限映射。
  - **Core Client**: 从 `packages/client/src/daemon-client.ts` 移除 `synthesizeAgentMessageBrief` 方法。
  - **Core App**: 从 `packages/app/src/plugins/turn-actions/view.tsx` 中彻底移除 `AudioBriefCard` / `TurnAudioBriefButton` 的 Fallback 兜底渲染（无插件时返回 `null`）；从 `packages/app/src/` 中删除 `components/turn-audio-brief-button.tsx` 及 `audio-brief/` 目录。

## Capabilities

### New Capabilities

- `plugin-extension/audio-brief-standalone`: 将 Audio Brief 完整实现为独立的 Paseo 标准插件，使用 `defineRpc` 通信并注册到 `PluginTurnActionContribution`（同时支持 `button` 与 `card` 插槽）。

### Modified Capabilities

- `plugin-extension/turn-action`: 移除容器对内置 Audio Brief 的直接依赖与 Fallback 兜底，实现插槽容器的纯净插件渲染（当未安装 TurnAction 插件时无渲染）。

## Impact

- **Affected Packages**:
  - `packages/protocol`: 协议瘦身，去除特定业务消息类型。
  - `packages/server`: 守护进程瘦身，去除特定业务服务。
  - `packages/client`: SDK 瘦身，去除定制 RPC 调用封装。
  - `packages/app`: 界面容器纯净，彻底解除对 Audio Brief 组件的直接引用。
  - `plugin-examples/audio-brief`: 新增可独立维护、测试、分发的标准插件工程。
- **Upstream Sync**: 主工程与 `upstream/main` 差异大幅缩减，消除因音频简报相关的合并冲突。
