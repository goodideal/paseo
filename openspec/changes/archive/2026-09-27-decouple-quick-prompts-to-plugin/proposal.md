## Why

Paseo 核心仓库当前内置了分层快速提示词引擎（Quick Prompts），代码分布侵入了核心协议（`packages/protocol/src/quick-prompts.ts`、`quick_prompts.*` 消息）、服务端会话（`packages/server/src/server/quick-prompts/`、`session.ts`）、客户端 SDK（`packages/client/src/daemon-client.ts`）以及前端输入框与通用插槽（`packages/app/src/composer/quick-prompts/`、`<PluginComposerAccessories />` 中的硬编码 fallback 兜底、`use-agent-autocomplete.ts` 及 `editor-section.tsx`）。
这严重违背了“微内核 + 通用插槽”架构演进原则，在持续同步官方上游（`upstream/main`）时引发代码合并冲突与维护摩擦。
继 Stage 1 成功将 Audio Brief 解耦为标准插件后，Stage 2 将 Quick Prompts 彻底解耦抽离为独立的标准插件 `plugin-examples/quick-prompts`，并清理 Core 仓库中的硬编码残留，让 `<PluginComposerAccessories />` 成为完全纯净的插件插槽容器。

## What Changes

- **Create Standalone Plugin (`plugin-examples/quick-prompts/`)**:
  - 创建符合标准规范的独立插件工程，包含 `paseo-plugin.json`（严格 schema）、`package.json`、`tsconfig.json`。
  - **Shared Contract**: 使用 `@getpaseo/plugin` 的 `defineRpc` 规范化定义 `quick_prompts.global.get.request`、`quick_prompts.global.set.request`、`quick_prompts.project.get.request`、`quick_prompts.project.set.request` 等类型安全 RPC。
  - **Server Service**: 在插件 `index.server.ts` 中注册 RPC Handler，承载全局提示词与项目提示词的文件持久化（保留原有 `~/.paseo/quick-prompts.json` 与 `projects/project-quick-prompts.json` 格式，完全向前兼容既有数据）。
  - **Client UI & Accessory Slot**: 将 `QuickPromptBar` 与 `QuickPromptsModal` 迁移到插件客户端，在 `index.client.tsx` 中调用 `client.addComposerAccessory(...)` 注册输入框附件插槽，利用 `useComposerApi` 实现无侵入的文本插入与直接提交。
  - **Prompt Matching & Rule Engine**: 插件内部集成提示词匹配算法（包含基于 Agent 状态、关键词/正则规则、Profile 匹配及助手消息临时选项提取）。
  - **Unit & E2E Tests**: 在插件工程内建立完整的单元测试套件，并在 Core Server 编写 E2E 测试验证隔离 Daemon 加载该插件及 RPC 互操作。
- **Clean Up Core Monorepo**:
  - **Core Protocol**: 从 `packages/protocol/src/messages.ts` 移除 `quick_prompts.*` 消息定义及 Discriminated Union 联合类型分支；删除 `packages/protocol/src/quick-prompts.ts`。
  - **Core Server**: 从 `packages/server/src/server/session.ts` 移除 `quickPromptsSession`、`quickPromptsService` 及 RPC 分发；删除 `packages/server/src/server/quick-prompts/` 目录；清理 `operation-permissions.ts` 中的权限映射。
  - **Core Client**: 从 `packages/client/src/daemon-client.ts` 移除 `quickPromptsGlobalGet`、`quickPromptsGlobalSet`、`quickPromptsProjectGet`、`quickPromptsProjectSet` 等定制方法。
  - **Core App**:
    - 从 `packages/app/src/plugins/composer-accessories/view.tsx` 中彻底移除 `QuickPromptsAccessory` 作为 fallback 的硬编码渲染（无插件时纯净返回 `null`）。
    - 从 `packages/app/src/` 中删除 `composer/quick-prompts/` 目录、`stores/quick-prompts-store.ts`、`hooks/use-quick-prompts.ts`、`utils/quick-prompt-*.ts` 及对应单元测试。
    - 从 `packages/app/src/hooks/use-agent-autocomplete.ts` 中移除硬编码的 quick_prompt 补全逻辑（斜杠命令由插件使用 `client.addSlashCommand` 注册）。
    - 从 `packages/app/src/screens/settings/editor-section.tsx` 中移除内置的快速提示词管理弹窗与按钮。

## Capabilities

### New Capabilities

- `plugin-extension/quick-prompts-standalone`: 将分层快速提示词引擎（Quick Prompts）作为独立的标准 Paseo 插件实现，使用 `defineRpc` 通信并在 `index.client.tsx` 中注册 `client.addComposerAccessory` 插槽。

### Modified Capabilities

- `plugin-extension/composer-accessory`: 移除输入框附件插槽容器中对内置 `QuickPromptsAccessory` 的硬编码 fallback 兜底，当未安装任何 Accessory 插件时容器纯净返回 `null`。

## Impact

- **Affected Packages**:
  - `packages/protocol`: 协议瘦身，去除 `quick_prompts.*` 业务消息模式与类型定义。
  - `packages/server`: 核心会话瘦身，移除内置的 QuickPrompts 服务、会话委托与 RPC 路由。
  - `packages/client`: SDK 接口精简，移除硬编码的 quick prompts 客户端请求方法。
  - `packages/app`: 输入框插槽容器纯净，彻底解除对内置 QuickPrompts 组件与状态库的直接耦合。
  - `plugin-examples/quick-prompts`: 新增独立、标准、可插拔的快速提示词插件工程。
- **Data Compatibility**: 插件服务端直接沿用现有的 `quick-prompts.json` 与 `project-quick-prompts.json` 文件格式，用户既有的提示词配置无感继承。
- **Upstream Sync**: 进一步消除 Core 代码与 `upstream/main` 的冲突点，加速向上游同步。
