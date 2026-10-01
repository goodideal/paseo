# Quick Prompts 主题修复与目标模型执行实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Quick Prompts 在浅色主题下的按钮文本与边框对比度，并为快捷提示词提供可选的目标模型配置与执行时切换能力。

**Architecture:** 在 `@getpaseo/client` 的 Agent Handle 上公开受控的 `setModel` 方法，并在 `PluginTheme` 中补齐 `surface3`；在 `QuickPromptItem` 中增加可选 `targetModelId`；在插件端提取独立的执行协调模块，保证有目标模型时先切换模型再发送消息，失败时终止发送；同时在 Bar 中移除浅底下的白色前景文字，在 Modal 中提供可用模型下拉配置。

**Tech Stack:** TypeScript, React Native, Vitest, Zod, React Testing Library, Paseo Client SDK.

**Spec:** `docs/superpowers/specs/2026-10-01-quick-prompts-theme-and-model-design.md`

## Global Constraints

- 不新增 Daemon RPC，不破坏向后兼容性；所有历史存储的 Quick Prompt 继续正常运行。
- 长按仅将内容插入 Composer，不触发模型切换。
- 浅色主题下规则与动态 Chip 禁止使用 `accentForeground`，统一使用 `accent`。
- 目标模型无效或切换失败时，严禁向 Agent 发送 Prompt。
- 所有变更需通过 `npm run typecheck` 与相关单元测试。

## Review Focus

- **历史数据缺省 `targetModelId`**：旧版 JSON / RPC 载荷解析后 `targetModelId` 为 `undefined`，必须无缝通过且不报错。
- **空白目标模型保存**：用户选择“使用当前模型”或留空时，保存结果中不应包含多余的空白字符串。
- **不可用模型防御**：全局 Prompt 配置了模型 A，但在不支持模型 A 的 Provider Agent 下触发时，必须拦截发送并弹出明确 Toast。
- **切换模型失败容错**：`setModel` 调用被拒绝或抛出异常时，错误被捕获且不调用 `composerApi.submitText`。
- **并发双击防重**：在模型切换的网络请求中，Quick Prompt Bar 应处于不可重复点击状态。

---

### Task 1: 核心合约扩展与公开 Agent API

**Files:**

- Modify: `packages/client/src/index.ts:343-385`
- Modify: `packages/client/src/index.ts:892-1020`
- Modify: `packages/plugin/src/contracts.ts:6-21`
- Modify: `packages/app/src/plugins/theme.ts:4-20`
- Modify: `plugin-custom/quick-prompts/shared/contracts.ts:18-35`
- Test: `plugin-custom/quick-prompts/tests/contracts.test.ts`
- Test: `packages/client/src/index.test.ts`

**Interfaces:**

- Consumes: `DaemonClient.setAgentModel(agentId: string, modelId: string | null): Promise<void>`
- Produces: `PaseoAgentHandle.setModel(modelId: string | null): Promise<void>`
- Produces: `QuickPromptItem.targetModelId?: string`
- Produces: `PluginTheme.colors.surface3: string`

- [ ] **Step 1: 编写合约与 Client SDK 失败测试**
      在 `plugin-custom/quick-prompts/tests/contracts.test.ts` 中添加包含 `targetModelId` 的有效性验证与无该字段时的兼容性测试；在 `packages/client/src/index.test.ts` 中添加 `agentHandle.setModel(modelId)` 调用委托测试。

- [ ] **Step 2: 运行测试确认失败**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/contracts.test.ts --bail=1`
      Expected: FAIL (缺少 targetModelId 定义)

- [ ] **Step 3: 实现合约字段与 SDK 接口**
  1. 在 `packages/client/src/index.ts` 的 `PaseoAgentHandle` 接口中增加 `setModel(modelId: string | null): Promise<void>`，并在 `createAgentHandleFactory` 实现中委托调用 `daemonClient.setAgentModel(id, modelId)`。
  2. 在 `packages/plugin/src/contracts.ts` 的 `PluginTheme.colors` 中增加 `surface3: string`，并在 `packages/app/src/plugins/theme.ts` 的 `toPluginTheme` 中映射 `theme.colors.surface3`。
  3. 在 `plugin-custom/quick-prompts/shared/contracts.ts` 的 `QuickPromptItemSchema` 中增加 `targetModelId: z.string().optional()`。

- [ ] **Step 4: 运行测试验证通过**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/contracts.test.ts --bail=1`
      Expected: PASS

---

### Task 2: Quick Prompt Bar 浅色主题色彩与对比度修复

**Files:**

- Modify: `plugin-custom/quick-prompts/client/bar.tsx:28-100`
- Create: `plugin-custom/quick-prompts/tests/bar.test.tsx`

**Interfaces:**

- Consumes: `PluginTheme` (含 `surface3`)
- Produces: `<QuickPromptBar />` 组件，在浅色与深色主题下具备合规对比度

- [ ] **Step 1: 编写 Bar 主题色彩渲染测试**
      创建 `plugin-custom/quick-prompts/tests/bar.test.tsx`，使用 React Native Testing Library 分别用深色主题和浅色主题参数渲染规则型 Chip，断言其文字颜色为 `theme.colors.accent`，而不是 `accentForeground`（`#ffffff`），断言 hover 背景色使用 `surface3`。

- [ ] **Step 2: 运行测试确认失败**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/bar.test.tsx --bail=1`
      Expected: FAIL

- [ ] **Step 3: 修复 `bar.tsx` 中的 Token 映射**
  1. 将文字颜色：`isEphemeral || isRule` 映射为 `theme?.colors.accent ?? "#3b82f6"`；普通文字映射为 `theme?.colors.foreground ?? "#f3f4f6"`。
  2. 将边框颜色：`isEphemeral || isRule` 映射为 `theme?.colors.accent ?? "#3b82f6"`；普通边框映射为 `theme?.colors.border ?? "#404040"`。
  3. 将背景颜色：默认状态使用 `theme?.colors.surface2 ?? "#262626"`；hover / pressed 使用 `theme?.colors.surface3 ?? theme?.colors.surface1 ?? "#333333"`。
  4. 修复 Manage（`+`）按钮的 hover 背景与边框，确保浅色模式下清晰可见。

- [ ] **Step 4: 运行测试验证通过**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/bar.test.tsx --bail=1`
      Expected: PASS

---

### Task 3: 提取执行协调器并实现模型切换逻辑

**Files:**

- Create: `plugin-custom/quick-prompts/client/prompt-executor.ts`
- Modify: `plugin-custom/quick-prompts/client/accessory.tsx:60-140`
- Create: `plugin-custom/quick-prompts/tests/executor.test.ts`

**Interfaces:**

- Produces:

  ```typescript
  export interface ExecuteQuickPromptOptions {
    item: QuickPromptItem;
    agentId: string | null;
    paseo: PaseoApi | null;
    composerApi: ComposerApi;
    availableModelIds?: readonly string[];
    onToastError?: (message: string) => void;
  }
  export function executeQuickPrompt(options: ExecuteQuickPromptOptions): Promise<boolean>;
  ```

- [ ] **Step 1: 编写执行流程的测试套件**
      在 `plugin-custom/quick-prompts/tests/executor.test.ts` 中针对以下场景编写用例：
  1. 无 `targetModelId`：直接调用 `composerApi.submitText`，返回 `true`。
  2. 包含有效 `targetModelId`：先调用 `agentHandle.setModel(targetModelId)`，成功后再调用 `composerApi.submitText`。
  3. 包含无效 `targetModelId`（不在当前可用列表中）：调用 `onToastError`，不调用 `setModel`，不调用 `submitText`，返回 `false`。
  4. `setModel` 失败抛错：调用 `onToastError`，不调用 `submitText`，返回 `false`。

- [ ] **Step 2: 运行测试确认失败**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/executor.test.ts --bail=1`
      Expected: FAIL

- [ ] **Step 3: 实现 `prompt-executor.ts` 并集成至 `accessory.tsx`**
  1. 实现 `executeQuickPrompt` 函数，严格保障执行顺序与失败拦截。
  2. 在 `accessory.tsx` 中使用 `paseo.providers.listModels(agent.provider)` 查询当前可用模型列表，并存储模型 ID 集合。
  3. 引入执行中状态 `isExecutingModelSwitch`，在模型切换期间将 `isSubmitDisabled` 传递至 `QuickPromptBar`，防止重复提交。

- [ ] **Step 4: 运行测试验证通过**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/executor.test.ts --bail=1`
      Expected: PASS

---

### Task 4: 弹窗表单支持配置目标模型

**Files:**

- Modify: `plugin-custom/quick-prompts/client/modal.tsx:40-180`
- Modify: `plugin-custom/quick-prompts/client/modal.tsx:450-580`
- Modify: `plugin-custom/quick-prompts/client/accessory.tsx:130-160`
- Modify: `plugin-custom/quick-prompts/tests/modal.test.tsx`

**Interfaces:**

- Consumes: `availableModels?: readonly { id: string; label: string }[]`
- Produces: 允许在创建/编辑表单中选择目标模型的界面交互

- [ ] **Step 1: 编写弹窗选择模型的测试**
      在 `plugin-custom/quick-prompts/tests/modal.test.tsx` 中添加测试：
  1. 打开创建表单，选择指定目标模型后保存，验证传给 `onSaveGlobalItems` 的对象携带 `targetModelId`。
  2. 打开既有携带 `targetModelId` 的条目，验证表单能正确还原已选模型；更改为默认（使用当前模型）后保存，`targetModelId` 被正确清理。

- [ ] **Step 2: 运行测试确认失败**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/modal.test.tsx --bail=1`
      Expected: FAIL

- [ ] **Step 3: 实现 Modal 中的模型选择器**
  1. 在 `PromptFormState` 中加入 `targetModelId: string`。
  2. 在表单区域增加“执行模型 / Model”配置项：若传入了 `availableModels`，渲染下拉/分段选择器，首项为“使用当前模型（默认）”；若未传入或为空，显示提示文本。
  3. 保存时若 `targetModelId` 为空字符串，则通过 `delete item.targetModelId` 保持数据精简。
  4. 在 `accessory.tsx` 中将查询到的 `availableModels` 传入 `QuickPromptsModal`。

- [ ] **Step 4: 运行测试验证通过**
      Run: `rtk npx vitest run plugin-custom/quick-prompts/tests/modal.test.tsx --bail=1`
      Expected: PASS

---

### Task 5: 整体构建、端到端集成测试与代码检查

**Files:**

- All touched files in previous tasks

- [ ] **Step 1: 构建客户端与插件类型声明**
      Run: `npm run build:client`
      Expected: 成功生成 client/protocol 类型声明，无类型报错。

- [ ] **Step 2: 运行受影响的所有单元与集成测试**
      Run:
      `rtk npx vitest run plugin-custom/quick-prompts/tests/contracts.test.ts plugin-custom/quick-prompts/tests/bar.test.tsx plugin-custom/quick-prompts/tests/executor.test.ts plugin-custom/quick-prompts/tests/modal.test.tsx --bail=1`
      Expected: 全部通过。

- [ ] **Step 3: 全局类型检查与代码检查**
      Run: `npm run typecheck && npm run lint`
      Expected: 无新增错误。

- [ ] **Step 4: 代码规范化格式化**
      Run: `npm run format`
      Expected: 文件格式化完成，代码风格符合 Biome 规范。
