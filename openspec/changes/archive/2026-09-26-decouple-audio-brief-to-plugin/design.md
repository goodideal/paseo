## Context

参见 `proposal.md`。当前 `packages/app/src/plugins/turn-actions/view.tsx` 对 `AudioBriefCard` 和 `TurnAudioBriefButton` 有硬编码回退；`packages/server/src/server/session.ts` 中维护了 `AudioBriefService` 与 `agent.message.synthesize_brief.request` 分发逻辑；协议与客户端 SDK 均存在定制消息契约。

## Goals / Non-Goals

**Goals:**

- 将 Audio Brief 完整抽取为独立标准插件 `plugin-examples/audio-brief`。
- 插件端到端使用 `defineRpc` 注册 `audio_brief.synthesize.request`，通过 `PluginTurnActionContribution`（`button` 与 `card`）挂载到 Turn 消息底部。
- 将 `<PluginTurnActions />` 重构为纯净容器，无插件时返回 `null`。
- 清除 Core 中与 Audio Brief 相关的所有冗余文件和协议定义。

**Non-Goals:**

- 不在此次变更中重构 Quick Prompts（Quick Prompts 作为后续独立步骤处理）。
- 不修改 Paseo 核心的 WebSocket 通信底座与插件子系统。

## Decisions

### 1. 采用插件专用命名空间 RPC (defineRpc) 替代全局 Protocol 消息

- **决策**: 在 `plugin-examples/audio-brief/shared/contracts.ts` 中使用 `@getpaseo/plugin` 的 `defineRpc` 定义 `audio_brief.synthesize.request`。
- **原因**: 插件必须具备独立的 RPC 契约定义，不能依赖 Core 协议中的特定业务消息；利用插件运行时的 `server.handle` 和客户端 `usePluginClient().call` 实现透明的跨进程调用。
- **备选方案**: 继续沿用 `agent.message.synthesize_brief.request` 全局协议消息。此方案未解耦核心协议，被否决。

### 2. 双重摘要提炼与本地缓存迁移

- **决策**: 将 `AudioBriefService` 及其智能提炼、启发式摘要降级（`extractFallbackBrief`）以及 SHA256 磁盘缓存完整迁移到插件工程内部。
- **原因**: 保持 Audio Brief 自包含的容错能力与响应速度，即使外部 TTS 未配置也能在 UI 上呈现高可读性的结构化语音简报文本。

### 3. 彻底清除核心 Fallback 兜底

- **决策**: 修改 `packages/app/src/plugins/turn-actions/view.tsx`，当 `actions.length === 0` 时直接返回 `null`，不再引入任何业务组件。
- **原因**: 这是实现微内核与插件化隔离的决定性步骤。核心容器仅负责调度已注册插件，严禁内嵌特定业务的兜底组件。

## Risks / Trade-offs

- [风险: 未安装 audio-brief 插件时，用户将不再看到语音简报按钮] → [缓解: 符合插件化预期，用户可通过 `paseo plugin install plugin-examples/audio-brief` 一键加载，或者在桌面端默认预装]。
- [风险: 插件客户端音频播放跨平台支持] → [缓解: 插件客户端复用统一的 Web Audio / AudioContext / Base64 数据 URI 规范，保持与原组件一致的跨平台兼容性]。
