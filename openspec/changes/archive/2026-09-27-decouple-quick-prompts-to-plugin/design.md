## Context

Paseo 正在推行“微内核 + 通用插槽”架构，将历史直接侵入 Core 仓库的定制功能解耦为独立标准插件（见 `proposal.md`）。
在 Stage 1 中，Audio Brief 已成功迁移至 `plugin-examples/audio-brief` 并从 Core 中完全移除。
Stage 2 的目标是将分层快速提示词引擎（Quick Prompts）从 Core 剥离到 `plugin-examples/quick-prompts`，使 Core 仓库中不再包含任何特定于 Quick Prompts 的协议消息、服务端会话处理及前端硬编码兜底组件。

## Goals / Non-Goals

**Goals:**

- 将 Quick Prompts 完整封装在 `plugin-examples/quick-prompts` 标准插件中（服务端 RPC + 客户端 Accessory UI + 规则与临时选项提取引擎）。
- 从 `packages/protocol`、`packages/server`、`packages/client` 和 `packages/app` 中彻底删除 Quick Prompts 相关代码。
- `<PluginComposerAccessories />` 容器变为纯净的插槽渲染容器，在没有安装任何 Accessory 插件时返回 `null`。
- 保持用户已有的快速提示词持久化数据（`~/.paseo/quick-prompts.json` 等）100% 兼容。
- 确保测试全覆盖：插件单元测试 + Server 端动态端口隔离 E2E 验证。

**Non-Goals:**

- 不修改 Quick Prompts 核心匹配算法或 UI 交互逻辑，保持原有良好体验。
- 不引入外部第三方数据库或复杂配置中心，保持轻量原子文件存储。

## Decisions

### 1. 独立插件工程结构 (`plugin-examples/quick-prompts`)

- `paseo-plugin.json`:
  声明 `id: "quick-prompts"`，`requirements: { "paseo": ">=0.9.1-custom" }`。
- `shared/contracts.ts`:
  使用 `@getpaseo/plugin` 的 `defineRpc` 定义 4 个基础 RPC：
  - `quick_prompts.global.get.request`
  - `quick_prompts.global.set.request`
  - `quick_prompts.project.get.request`
  - `quick_prompts.project.set.request`
- `server/`:
  - `quick-prompts-store.ts`: 负责读写 `~/.paseo/quick-prompts.json` 与 `projects/project-quick-prompts.json`。
  - `index.server.ts`: 注册 4 个 RPC 处理函数，原子写入文件。
- `client/`:
  - 迁移原 `packages/app/src/composer/quick-prompts/`（`bar.tsx`, `modal.tsx`）及 `utils/quick-prompt-*.ts`、`ephemeral-option-extractor.ts`。
  - `index.client.tsx`: 调用 `client.addComposerAccessory` 注册 `QuickPromptsAccessory`。

### 2. 零侵入交互接口 (`useComposerApi`)

- 客户端 Accessory 组件通过 `@getpaseo/plugin/client` 导出的 `useComposerApi()` 获取 `submitText`、`insertText`、`isSubmitDisabled`。
- 点击提示词 chip 时调用 `submitText(content)`，点击编辑时调用 `insertText(content)`，无需与 Core 的状态树产生任何紧耦合。

### 3. Core 仓库的彻底瘦身与解耦

- **Protocol**: 删除 `packages/protocol/src/quick-prompts.ts`，从 `packages/protocol/src/messages.ts` 中移除全部 8 个 `quick_prompts.*` 请求/响应 Schema 及联合类型。
- **Server**: 删除 `packages/server/src/server/quick-prompts/` 目录；从 `packages/server/src/server/session.ts` 中移除 `quickPromptsSession`、`quickPromptsService`；从 `packages/server/src/server/authorization/operation-permissions.ts` 移除 `quick_prompts.*`。
- **Client**: 从 `packages/client/src/daemon-client.ts` 移除 4 个 `quickPrompts*` 请求封装方法。
- **App**:
  - `packages/app/src/plugins/composer-accessories/view.tsx`: 移除 `<QuickPromptsAccessory />` fallback，无配件时返回 `null`。
  - 删除 `packages/app/src/composer/quick-prompts/`、`packages/app/src/stores/quick-prompts-store.ts`、`packages/app/src/hooks/use-quick-prompts.ts`。
  - `use-agent-autocomplete.ts`: 移除对 `quickPrompts` 的硬编码参数与过滤，依靠通用的 `pluginClientSlashCommands`。
  - `editor-section.tsx`: 移除硬编码的快速提示词管理入口。

## Risks / Trade-offs

- **[Risk]** 旧客户端/旧插件通信协议不一致。
  → **Mitigation**: 客户端通过插件自带的 `useRpc` 直接调用插件服务端注册的 `defineRpc`，协议版本完全在插件内部自闭环，不依赖 Core 协议版本。
- **[Risk]** 跨 Workspace 编译类型检查破坏。
  → **Mitigation**: 每次修改 protocol/client 后按规范严格执行 `npm run build:client` 与 `npm run build:server` 刷新 `dist/*.d.ts`，确保 `npm run typecheck` 100% 通过。
- **[Risk]** 守护进程端口冲突与中断。
  → **Mitigation**: 恪守安全红线，严禁触碰 `6767` 端口；E2E 测试必须使用 `createTestPaseoDaemon` 动态分配端口。

## Migration Plan

1. 创建 `plugin-examples/quick-prompts/` 标准插件工程及全套源码与单测。
2. 清理 `packages/protocol`、`packages/server`、`packages/client`、`packages/app`。
3. 执行跨包编译与全局类型检查 (`build:client` -> `build:server` -> `typecheck`)。
4. 编写并运行 E2E 测试 `packages/server/src/server/plugins/quick-prompts-plugin.e2e.test.ts`。
5. 运行代码检查与格式化 (`npm run lint`, `npm run format`)。
