## 1. Plugin System Slot Extensions

- [x] 1.1 在 `packages/plugin/src/client/contracts.ts` 与 `index.ts` 中定义 `PluginComposerAccessoryContribution`、`PluginTurnActionContribution` 以及 `addComposerAccessory`、`addTurnAction` 接口，并使用 `npm run build:plugin` 验证构建通过。
- [x] 1.2 在 `packages/app/src/plugins/client-runtime.ts` 与 `evaluate.ts` 中实现插槽贡献收集与 disposable 清理管理，并通过单元测试验证注册与销毁机制。
- [x] 1.3 在 `packages/app/src/plugins/` 下实现 `<PluginComposerAccessories />`、`<PluginTurnActions />` 容器组件及 `useComposerApi`、`useTurnState` 响应式状态 Hooks。

## 2. Decouple Core Invasive Features

- [x] 2.1 重构 `packages/app/src/composer/index.tsx`，使用通用 `<PluginComposerAccessories />` 插槽挂载，解耦快速提示条与弹窗的直接代码侵入，运行 `npx vitest run packages/app/src/composer/quick-prompts/bar.test.tsx` 验证通过。
- [x] 2.2 重构 `packages/app/src/components/message.tsx` 与 `turn-footer.tsx`，使用通用 `<PluginTurnActions />` 插槽挂载，解耦 Audio Brief 按钮与卡片直接侵入，运行 `npx vitest run packages/app/src/components/turn-audio-brief-button.test.tsx` 验证通过。
- [x] 2.3 从 `packages/app/src/data/acp-provider-catalog.ts`、`provider-icons.ts`、`provider-icon-names.ts` 移除硬编码 `antigravity`，并通过 `npm run typecheck --workspace=@getpaseo/app` 验证。

## 3. Verification & Standalone Plugin Integrity

- [x] 3.1 验证 `plugin-examples/gitea-workflow` 与 `plugin-examples/visual-crawler-auto-fix` 的独立依赖与契约完整性。
- [x] 3.2 运行全量 `npm run typecheck`、`npm run lint` 与相关单元测试，确保无类型报错、无多余依赖遗留。
