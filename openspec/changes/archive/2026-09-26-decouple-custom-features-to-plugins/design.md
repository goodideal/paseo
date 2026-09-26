## Context

参见 `proposal.md`。当前 `packages/app/src/composer/index.tsx` 和 `packages/app/src/components/message.tsx` 存在大量 custom 业务代码侵入，使得 upstream 同步维护成本居高不下。

## Goals / Non-Goals

**Goals:**

- 在 `@getpaseo/plugin` 和 `packages/app` 建立标准化通用插槽体系（`addComposerAccessory` 和 `addTurnAction`）。
- 将 Composer 输入控制与 Turn 内容订阅通过 Context/Hooks 抽象出来，保证插件热加载与组件生命周期规范，避免高频输入导致的不必要重渲染。
- 将核心代码中关于 Quick Prompts 和 Audio Brief 的硬编码迁移到插件插槽消费模式，核心仅保留插槽挂载入口（小于 10 行）。
- 从核心 ACP 目录移除内部 `antigravity` 代码，保持与 upstream 完全一致。

**Non-Goals:**

- 不重写大模型消息流式渲染底层架构。
- 不修改声明式工作流引擎（Declarative Workflow Engine）等基础子系统。

## Decisions

### 1. 采用 Context/Hooks 模式解耦 Composer 高频输入状态

- **决策**: 插槽只向下传递稳定标识（`workspaceId`, `agentId`），输入控制（`insertText`, `submitText`, `isSubmitDisabled`）通过 `useComposerApi()` hook 暴露给插件。
- **原因**: 避免每次键盘击键导致整个 Accessory 容器或插件组件深度重渲染（防键盘卡顿与性能退化）。

### 2. TurnAction 区分形态（Button 与 Card）

- **决策**: `PluginTurnActionContribution` 明确区分 `type: 'button' | 'card'`。
- **原因**: Button 放置在 AssistantTurnFooter 内部动作排版行，固定高度且风格统一；Card 放置在 Turn 消息下方，可折叠伸缩，防止虚拟滚动列表高度跳动。

### 3. 音频核心服务桥接

- **决策**: Audio Brief 需要的音频播放能力由 App 核心继续作为桥接 Provider 提供，插件通过客户端上下文调用，避免在未编译原生模块的纯 JS 插件中引入私有原生依赖。

## Risks / Trade-offs

- [风险: 插件未卸载导致的组件幽灵监听] → [缓解: 所有 `add*` 接口均返回 standard disposable `() => void`，在插件生命周期终止时统一清理]。
- [风险: 样式与深浅色模式撕裂] → [缓解: 插件插槽强制采用 Paseo 设计系统规范 token，不硬编码背景和前景色]。
