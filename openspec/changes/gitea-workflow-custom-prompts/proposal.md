## Why

Paseo 的 `gitea-workflow` 插件为基于 Issue 驱动的 Agent 自动化流程提供了 `agent-auto`（全自动无人值守）与 `agent-plan`（规划审查与人机协同）二元触发机制。然而，当前派发给 Agent 的 Prompt 为硬编码文本：

1. 开发者无法根据团队的技术栈、研发规范或业务约束调整 Agent 的执行指引与行为模式；
2. 缺乏针对 `agent-auto`（需要方案简报与决策留痕）和 `agent-plan`（需要多方案架构推导与阶段性确认）的独立提示词定制入口；
3. 缺少灵活的上下文变量插值（如 Issue 编号、标题、描述、仓库信息等），导致 Agent 难以在第一轮对话中直接获得格式化好的完整上下文。

支持全局与项目级二元 Prompt 自定义，并内置可一键恢复的生产级默认模板，是提高 Agent 交付质量与适配异构仓库的核心要求。

## What Changes

- **双层配置体系 (Dual-Tier Configuration)**：
  - 在全局主机配置（`GiteaHostSettingsSchema`）中增加 `agentAutoPrompt` 与 `agentPlanPrompt`，为所有纳管项目提供基线提示词。
  - 在项目详情配置（`GiteaProjectSettingsSchema`）中增加 `agentAutoPromptOverride` 与 `agentPlanPromptOverride`，允许针对特定项目进行个性化覆盖。
- **内置标准提示词常量与一键恢复 (Built-in Prompts & Reset)**：
  - 提供官方规范的 `DEFAULT_AGENT_AUTO_PROMPT`（指导 Issue 架构留痕、TDD 与免审批自动交付）与 `DEFAULT_AGENT_PLAN_PROMPT`（指导 `superpowers:brainstorming` 方案对比与阶段门禁挂起）。
  - UI 提供“加载/恢复默认模板”操作，并清晰说明可用占位符。
- **模板变量安全插值引擎 (Safe Template Interpolation)**：
  - 支持 `{{issueNumber}}`、`{{issueTitle}}`、`{{issueBody}}`、`{{repoOwner}}`、`{{repoName}}`、`{{branchName}}` 等动态占位符。
  - 遇到未知占位符安全保留原样，避免插值异常。
- **优先级解析与平滑回退 (Cascading Precedence)**：
  - 提示词解析遵循：**项目级覆盖（Project Override） > 全局设置（Host Setting） > 内置默认模板（Built-in Default）**。
- **UI 交互增强 (Settings UI)**：
  - 在全局设置页（`HostSettingsScreen`）提供独立的提示词自定义卡片与多行编辑框。
  - 在项目详情页（`ProjectDetailSettings`）提供项目级覆盖编辑与一键清除覆盖（继承全局）功能。

## Capabilities

### New Capabilities

- `gitea-workflow/custom-prompts`: 支持 `agent-auto` 与 `agent-plan` 模式下的双层提示词模板自定义、变量插值、内置模板重置与项目级覆盖继承。

### Modified Capabilities

<!-- 无现有核心 Living Specs 需求发生变更（插件专属能力） -->

## Impact

- `plugin-custom/gitea-workflow`:
  - `shared/types.ts`: 扩展 `GiteaHostSettingsSchema` 与 `GiteaProjectSettingsSchema`。
  - `shared/prompts.ts`: 新增内置默认提示词常量及说明。
  - `server/prompt-interpolator.ts`: 实现模板变量插值引擎及单元测试。
  - `server/settings-manager.ts`: 新增 `getAgentAutoPrompt(projectId)` 与 `getAgentPlanPrompt(projectId)` 解析逻辑。
  - `server/adapters/agent-execute.ts`: 在创建并启动 Agent 时动态提取上下文并插值生成 Prompt。
  - `client/host-settings.tsx`: 增加全局提示词自定义配置卡片及模板加载功能。
  - `client/project-detail-settings.tsx`: 增加项目级提示词覆盖配置卡片及继承切换能力。
