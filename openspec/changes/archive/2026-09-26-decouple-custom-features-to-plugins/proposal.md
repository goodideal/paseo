## Why

Paseo 主代码当前直接侵入了 Quick Prompts（快速提示词条与规则）、Audio Brief（Turn 语音简报与卡片）以及 Antigravity CLI ACP 目录项等定制业务逻辑，严重修改了 `packages/app/src/composer/index.tsx`、`packages/app/src/components/message.tsx`、`packages/server/src/server/session.ts` 等核心代码。每次与官方 `upstream/main` 同步时均产生剧烈的 Git 合并冲突，维护负担极重。
通过将架构演进为“微内核 + 通用插件槽位”，在 `@getpaseo/plugin` 与 App 核心开放通用扩展插槽，将定制功能完整解耦为标准插件，从根源上将核心冲突代码量降至最低，实现零侵入、高内聚的扩展体系。

## What Changes

- **Core Plugin Slots**:
  - 新增 `addComposerAccessory`: 在输入框上方开放通用的 Accessory 插槽，采用 Hook/Selector 订阅状态模式，解耦 Quick Prompts 栏。
  - 新增 `addTurnAction`: 在 Assistant Turn 底部开放通用 Action 插槽（支持 `button` 按钮与 `card` 交互卡片），解耦 Audio Brief 简报栏。
- **Decouple Custom Provider**:
  - 从 `packages/app/src/data/acp-provider-catalog.ts`、`provider-icons.ts`、`provider-icon-names.ts` 中移除硬编码的 `antigravity`，恢复为与上游一致的标准目录；指引用户使用 `config.json` (`extends: "acp"`) 或插件扩展。
- **Plugin Decoupling Preparation**:
  - 在 `@getpaseo/plugin` 客户端提供 `useComposerApi` 与 `useTurnState` 响应式钩子，保障高频输入的渲染性能。
  - 确保解耦后的组件不侵入 `packages/app/src/composer/index.tsx` 和 `packages/app/src/components/message.tsx` 的业务流程。

## Capabilities

### New Capabilities

- `plugin-extension/composer-accessory`: 允许客户端插件在 Composer 输入框上方注册通用的辅助视图（如快捷提示条、模板选择器）。
- `plugin-extension/turn-action`: 允许客户端插件在消息回合（Turn）底部注册操作按钮或嵌入式交互卡片（如语音播放卡片）。
- `provider-management/acp-catalog-decoupling`: 解耦核心硬编码 ACP Catalog，保持核心目录与上游完全一致，依赖标准配置扩展。

### Modified Capabilities

## Impact

- `packages/plugin`: 在 Client Runtime 中增加 `addComposerAccessory`、`addTurnAction` 接口定义与类型导出。
- `packages/app`:
  - `packages/app/src/plugins/`: 实现插槽注册、管理及容器组件 `<PluginComposerAccessories />` 与 `<PluginTurnActions />`。
  - `packages/app/src/composer/index.tsx`: 移除 Quick Prompts 强耦合代码，替换为通用插槽挂载。
  - `packages/app/src/components/message.tsx`: 移除 Audio Brief 强耦合代码，替换为通用插槽挂载。
  - `packages/app/src/data/acp-provider-catalog.ts`: 移除 `antigravity`。
- 架构收益：主代码恢复轻量纯净，与 upstream Paseo 后续 rebase/merge 冲突率降为接近 0。
