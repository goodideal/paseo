## 1. Standalone Audio Brief Plugin Package

- [ ] 1.1 创建 `plugin-examples/audio-brief/` 目录结构及基础配置（`paseo-plugin.json`、`package.json`、`tsconfig.json`），并验证配置就绪。
- [ ] 1.2 在 `plugin-examples/audio-brief/shared/` 中使用 `defineRpc` 定义 `audio_brief.synthesize.request` RPC 契约与返回类型。
- [ ] 1.3 在 `plugin-examples/audio-brief/server/` 中迁移智能摘要、启发式降级与音频合成逻辑，并在 `index.server.ts` 中注册 RPC Handler。
- [ ] 1.4 在 `plugin-examples/audio-brief/client/` 中实现 `TurnAudioBriefButton` 与 `AudioBriefCard`，并在 `index.client.tsx` 中注册 `button` 与 `card` 插槽贡献。

## 2. Core Decoupling and Pure Turn Actions

- [ ] 2.1 重构 `packages/app/src/plugins/turn-actions/view.tsx`，移除 `AudioBriefCard` 与 `TurnAudioBriefButton` 的硬编码 fallback 兜底（当无插件时直接返回 `null`）。
- [ ] 2.2 从 `packages/app` 中移除 `components/turn-audio-brief-button.tsx`、`components/turn-audio-brief-button.test.tsx` 及 `src/audio-brief/` 目录。
- [ ] 2.3 从 `packages/server/src/server/session.ts` 移除 `audioBriefService` 字段、初始化与 RPC 处理；移除 `packages/server/src/server/agent/audio-brief-service.ts` 及相关测试；清理 `operation-permissions.ts`。
- [ ] 2.4 从 `packages/protocol/src/messages.ts` 移除 `agent.message.synthesize_brief.*`，删除 `packages/protocol/src/audio-brief.ts`；从 `packages/client/src/daemon-client.ts` 移除调用封装。

## 3. Verification & Build Consistency

- [ ] 3.1 运行 `npm run build:server` 与 `npm run build:client` 重新构建声明文件。
- [ ] 3.2 运行全量 `npm run typecheck` 与 `npm run lint`，确保全仓类型通过且无遗留死代码。
