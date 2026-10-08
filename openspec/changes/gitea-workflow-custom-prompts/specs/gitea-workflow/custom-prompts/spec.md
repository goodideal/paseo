## Purpose

定义 Gitea 工作流插件中关于 `agent-auto` 与 `agent-plan` 提示词模板自定义、变量插值、多层级继承以及设置端用户界面的核心规范与行为契约。

## ADDED Requirements

### Requirement: 双层级提示词继承与解析 (Cascading Prompt Resolution)

系统 SHALL 按照「项目级覆盖（Project Override） > 全局主机配置（Host Setting） > 内置默认模板（Built-in Default）」的优先级顺序解析 `agent-auto` 与 `agent-plan` 的有效提示词模板。当上级或本级未设置（或仅包含空白字符）时，平滑回退到下一优先级，确保始终返回有效的提示词模板。

#### Scenario: 项目级自定义优先于全局配置

- **WHEN** 项目级设置了 `agentAutoPromptOverride="Custom Project Auto Prompt"`
- **AND** 全局配置设置了 `agentAutoPrompt="Global Auto Prompt"`
- **THEN** 为该项目执行 `agent-auto` 时使用的提示词模板为 "Custom Project Auto Prompt"

#### Scenario: 未配置项目覆盖时继承全局配置

- **WHEN** 项目级未设置 `agentPlanPromptOverride`（或设置为空字符串）
- **AND** 全局配置设置了 `agentPlanPrompt="Global Plan Prompt"`
- **THEN** 为该项目执行 `agent-plan` 时使用的提示词模板为 "Global Plan Prompt"

#### Scenario: 全局未配置时回退至系统内置默认模板

- **WHEN** 项目级与全局主机配置均未设置 `agentAutoPrompt`
- **THEN** 系统解析得到的提示词模板为系统内置的 `DEFAULT_AGENT_AUTO_PROMPT`

### Requirement: 提示词模板变量安全插值 (Safe Prompt Interpolation)

系统 SHALL 支持使用双花括号语法（`{{variable}}` 或 `{{ variable }}`）对提示词模板进行上下文变量替换。支持的内置变量包括：`issueNumber`、`issueTitle`、`issueBody`、`repoOwner`、`repoName`、`branchName`、`projectId`。对于模板中未定义的占位符，系统 SHALL 保留原文本而不报错或崩溃。

#### Scenario: 成功替换所有已知上下文变量

- **WHEN** 模板包含 `Issue #{{issueNumber}}: {{issueTitle}} (repo: {{repoOwner}}/{{repoName}})`
- **AND** 上下文中 issueNumber 为 101，issueTitle 为 "fix bug"，repoOwner 为 "org"，repoName 为 "repo"
- **THEN** 插值输出结果为 `Issue #101: fix bug (repo: org/repo)`

#### Scenario: 容错保留未知占位符

- **WHEN** 模板包含 `Hello {{unknownField}}, Issue #{{issueNumber}}`
- **THEN** 插值输出结果保留未知的 `{{unknownField}}`，仅替换 `{{issueNumber}}`

### Requirement: 设置端提示词管理与内置模板重置 (Settings UI & Template Reset)

系统 SHALL 在全局主机设置页与项目详情设置页提供对应的多行文本编辑界面。全局设置页提供「恢复内置默认」操作，项目详情页提供「填充默认模板」与「清除覆盖（恢复继承）」操作，并在界面中注明可用变量列表。

#### Scenario: 全局设置页一键恢复内置默认模板

- **WHEN** 用户在全局主机设置页点击恢复内置默认模板
- **THEN** 输入框被填充为官方标准的内置提示词模板内容

#### Scenario: 项目详情页清除覆盖恢复继承

- **WHEN** 用户在项目详情页清除覆盖内容并保存
- **THEN** 项目级配置中的覆盖字段被置空，项目自动恢复继承全局提示词
