## Context

参见 `proposal.md`。Paseo 的 `gitea-workflow` 插件通过 `agent-auto` 和 `agent-plan` 标签自动派发 Claude Code 等 Agent 解决 Gitea Issue。目前在 `agent-execute.ts` 中，Agent 的 Prompt 为硬编码文本，缺乏自定义模板与动态变量插值能力。

## Goals / Non-Goals

**Goals:**

- 在 `shared/types.ts` 中为全局（Host）和项目（Project）两级配置增加提示词模板字段。
- 在 `shared/prompts.ts` 中维护官方标准默认模板（`DEFAULT_AGENT_AUTO_PROMPT` 与 `DEFAULT_AGENT_PLAN_PROMPT`），提供一键重置与回退兜底。
- 提供纯函数插值引擎 `interpolatePrompt(template, context)`，支持安全替换 `{{issueNumber}}`、`{{issueTitle}}`、`{{issueBody}}`、`{{repoOwner}}`、`{{repoName}}`、`{{branchName}}`、`{{projectId}}` 等变量。
- 在 `SettingsManager` 中提供三级级联解析（项目覆盖 > 全局设置 > 内置默认）。
- 在 `agent-execute.ts` 适配器中动态读取有效模板并插值后派发给 Agent。
- 在 `HostSettingsScreen` 与 `ProjectDetailSettings` 中增加美观、易用的提示词设置卡片，支持多行编辑与一键恢复。

**Non-Goals:**

- 支持复杂的模板逻辑语法（如 `{{#if}}`、循环遍历等），仅采用轻量级、健壮的占位符替换。
- 针对每一细分子步骤（如单独的 `independent-review`）开放独立配置（由模式主模板或后续细化演进控制）。

## Decisions

### Decision 1: 独立文件维护内置标准模板（`shared/prompts.ts`）

- **决策**：将 `DEFAULT_AGENT_AUTO_PROMPT` 和 `DEFAULT_AGENT_PLAN_PROMPT` 存放在 `shared/prompts.ts` 中，供服务端与客户端共享。
- **权衡与原因**：避免前端 UI 与后端执行层分别硬编码导致提示词漂移，确保用户点击“恢复内置默认”时与底层实际兜底逻辑完全一致。
- **备选方案**：通过 RPC 动态请求默认模板 —— 增加了不必要的网络开销与异步状态管理。

### Decision 2: 级联回退与空白字符串容错

- **决策**：若用户在输入框中仅输入空格或清空保存，解析逻辑将其视为未定义，自动回退到上一级。
- **权衡与原因**：防止用户误清空保存后导致 Agent 启动时收到空字符串 Prompt 从而报错或无法理解意图。

### Decision 3: 安全轻量的正则表达式插值器

- **决策**：使用 `/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g` 处理插值，未知变量原样保留。
- **权衡与原因**：极高执行效率，零外部依赖，对代码中可能出现的其他花括号语法具备极高容错性。

### Decision 4: UI 提供多行文本框与一键操作

- **决策**：在全局设置中提供多行文本框与「恢复内置默认」按钮；在项目详情页中提供「继承全局」切换与「填充默认模板」辅助操作。
- **权衡与原因**：大段 Prompt 在移动端和桌面端需要舒适的多行编辑空间，辅助按钮极大降低了从零编写提示词的门槛。

## Risks / Trade-offs

| 潜在风险 (Risk)                                                               | 缓解措施 (Mitigation)                                                                                                                                                                  |
| :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户在 Prompt 中删除了 Superpowers 或 TDD 等关键流程约束，导致 Agent 行为失控 | 1. 默认模板中清晰标注文档与关键指令；2. UI 提供显眼的一键“恢复内置默认模板”按钮；3. 即使 Prompt 修改，工作流引擎的外部物理门禁（如 delivery-approval 与 verify-command）依然强制生效。 |
| 用户填入了错误的占位符拼写（如 `{{issue_num}}`）                              | 插值器对未识别占位符进行保留原样处理，并在 UI 显眼位置列出标准变量字典说明。                                                                                                           |
