# Spec Delta

## ADDED Requirements

### Requirement: 工作区 agent-team.json 动态 N 角色装载与绑定保留 (Workspace Dynamic Team & Bindings)

系统 SHALL 从当前 `cwd`（或 Git Worktree 对应主检出目录）的 `.agents/agent-team.json` 动态装载当前仓库启用的 N 个角色作为生效专家列表（替换全局默认 8 角色），支持通过可选 `bindings` 指定各角色的 `provider`、`tier`、`model`、`modeId` 与 `lazyToolSlice`，且 `agent-team apply`/`set` SHALL 保留既有 `bindings`。

#### Scenario: 从工作区清单与 Worktree 主仓回溯加载动态角色

- **WHEN** `cwd` 位于包含 `.agents/agent-team.json`（含 5 个角色及 `bindings`）的仓库或其缺失本地清单的 Git Worktree
- **THEN** 生效配置 `specialists` 精确包含该 5 个角色，并标记 `agentTeam.projectSlug` 与 `agentTeam.roles`
- **AND** `be-developer` 继承 `bindings["be-developer"]` 指定的客户端与档位，未绑定角色默认继承调用方客户端并依据目录元数据分配默认档位

#### Scenario: 仓库不存在 agent-team.json 时回退至全局专家矩阵

- **WHEN** `cwd` 及其 Git 主检出目录均不存在 `.agents/agent-team.json`
- **THEN** 生效配置沿用插件设置中的内置/自定义全局 `specialists` 且 `agentTeam` 为空

### Requirement: Antigravity 协同模式环境变量避让与轻量桥接提示 (Federation Mode Avoidance & Bridge)

系统 MUST 仅在当前检出目录实际存在 `.agents/plugins/team-*/mcp_config.json` 且运行非 Orchestrator 的单阶 `antigravity` 会话时，跳过 `LAZY_TOOL_CONFIG` 注入与 `mcpServers` 过滤，并为根会话注入 3 行 `[Agent Harness — Federation Bridge]` 引导。

#### Scenario: 本地存在 team 插件时 Antigravity 单阶会话保留本地 MCP 切片

- **WHEN** `provider` 为 `"antigravity"`、非 `bypassModels`，且当前检出目录物理存在 `.agents/plugins/team-demo/mcp_config.json`
- **THEN** `agent.open.before` 不覆盖 `env.LAZY_TOOL_CONFIG` 且保留原 `mcpServers`
- **AND** 根会话 `systemPrompt` 注入精简 3 行 `[Agent Harness — Federation Bridge]` 而非完整 `[Capability Harness Active Profile]`

#### Scenario: Codex/Claude 会话或缺少本地插件的 Worktree 保留 Paseo 切片

- **WHEN** 会话运行在 `codex`、`claude`，或当前 Worktree 未生成 `.agents/plugins/team-*/mcp_config.json`
- **THEN** `agent.open.before` 按专家配置正常注入 `env.LAZY_TOOL_CONFIG`

### Requirement: 跨客户端角色正文注入、只读锁定与叶子防套娃 (Role Prompt Injection, Read-Only & Leaf Guard)

系统 SHALL 在跨客户端派生 `agent-team` 专家时提取对应 `<role>.md` 正文（剥离 YAML Frontmatter 并展开模板占位符）注入 `systemPrompt`，对 `readonly: true` 角色强制施加只读护栏与兼容原生 `plan` 模式，并为 `harness_handoff` 派生的子会话注入 `PASEO_HARNESS_LEAF=1` 隐藏递归交接工具。

#### Scenario: 派生只读后端审查角色时锁定 plan 模式并隐藏 harness_handoff

- **WHEN** 父会话通过 `harness_handoff` 派发 `targetRole: "be-reviewer"`（`readonly: true`，绑定 `"claude"`）
- **THEN** 子会话创建时获注入 `be-reviewer.md` 正文与只读禁写约束，`modeId` 设为 `"plan"`，标签包含 `paseo.harness-leaf: "1"`
- **AND** 子会话执行 `agent.open.before` 时 `env.PASEO_HARNESS_LEAF` 为 `"1"` 且 `tools` 不包含 `harness_handoff`

### Requirement: HarnessPopover 动态 N 角色滚动呈现 (Workspace-Scoped Scrollable Popover)

`HarnessPopover` SHALL 通过 `harnessEffectiveConfigRpc` 按工作区 `cwd` 获取实时专家列表，在滚动网格中完整渲染启用的 N 个角色，并清晰标识只读（`RO`）与绑定目标（`provider · tier/model`）。

#### Scenario: Popover 动态渲染工作区 5 个专家及 RO 标记

- **WHEN** `HarnessPopover` 挂载于配置了 5 个 `agent-team` 角色的工作区会话
- **THEN** 面板渲染全部 5 个角色卡片，其中只读角色展示 `RO` 标记且副标题展示其绑定的客户端与档位
