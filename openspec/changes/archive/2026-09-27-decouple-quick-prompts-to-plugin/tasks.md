## 1. 独立插件工程建设 (Plugin Implementation)

- [x] 1.1 创建 `plugin-examples/quick-prompts` 基础脚手架 (`paseo-plugin.json`, `package.json`, `tsconfig.json`) 并验证配置有效
- [x] 1.2 在 `shared/contracts.ts` 中基于 `@getpaseo/plugin` 的 `defineRpc` 定义 Quick Prompts 4 个 typed RPC 协议与数据 Schema
- [x] 1.3 在 `server/` 实现 `QuickPromptsStore` 与 `index.server.ts` 注册 RPC Handler，并编写单测验证全局与项目提示词持久化
- [x] 1.4 在 `client/` 实现动态规则匹配引擎、临时选项提取器与 `useQuickPrompts` 状态 hook
- [x] 1.5 在 `client/` 迁移并实现 `QuickPromptBar`、`QuickPromptsModal` 及 `QuickPromptsAccessory`，在 `index.client.tsx` 中调用 `client.addComposerAccessory` 注册输入框插槽
- [x] 1.6 编写插件端单元测试并运行 `npx vitest run plugin-examples/quick-prompts/tests/` 确保 100% 通过
- [x] 1.7 实现旧数据自动迁移（将 `$PASEO_HOME/quick-prompts.json` 与 `$PASEO_HOME/projects/project-quick-prompts.json` 自动平滑迁移至插件存储目录 `plugin-data/quick-prompts/`）并在单测中覆盖
- [x] 1.8 补充斜杠命令注册（通过 `client.addSlashCommand` 重新提供 `/continue`、`/review`、`/fix` 等命令）与专属设置页面（`client.addSettingsScreen` + `defineSettings` 独立控制 AI 临时建议）

## 2. Core 核心仓库解耦与清理 (Core Decoupling)

- [x] 2.1 从 `packages/protocol` 移除 `quick-prompts.ts` 以及 `messages.ts` 中的 `quick_prompts.*` 消息与类型分支
- [x] 2.2 从 `packages/server` 移除 `src/server/quick-prompts/`，清理 `session.ts` 中的 `quickPromptsSession`/`quickPromptsService` 及 `operation-permissions.ts` 权限映射
- [x] 2.3 从 `packages/client` 移除 `daemon-client.ts` 中的 `quickPromptsGlobalGet`、`quickPromptsGlobalSet`、`quickPromptsProjectGet`、`quickPromptsProjectSet`
- [x] 2.4 从 `packages/app` 移除 `src/composer/quick-prompts/`、`stores/quick-prompts-store.ts`、`hooks/use-quick-prompts.ts`、`utils/quick-prompt-*.ts`
- [x] 2.5 重构 `packages/app/src/plugins/composer-accessories/view.tsx`：移除 `<QuickPromptsAccessory />` fallback，在无配件时纯净返回 `null`
- [x] 2.6 清理 `packages/app/src/hooks/use-agent-autocomplete.ts` 中的 `quick_prompt` 硬编码逻辑，清理 `editor-section.tsx` 中的弹窗与管理入口

## 3. 全局构建、E2E 测试与验证 (Verification & Quality Assurance)

- [x] 3.1 执行跨包编译与全局类型检查 (`npm run build:client` -> `npm run build:server` -> `npm run typecheck`) 确保零类型报错
- [x] 3.2 编写 Core Server E2E 测试 `packages/server/src/server/plugins/quick-prompts-plugin.e2e.test.ts`，验证隔离 Daemon 下加载 `plugin-examples/quick-prompts` 并成功跨进程执行 RPC
- [x] 3.3 运行全量 Lint 与格式化 (`npm run lint` 和 `npm run format:files`) 确保代码风格合规
