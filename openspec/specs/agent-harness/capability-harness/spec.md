## Purpose

定义 `agent-harness` 插件在创建与打开 Agent 会话时的领域角色识别（Domain Role Detection）、动态能力容器环境变量注入（Capability Harness Injection）以及 Antigravity 冷备豁免的核心规范。

## Requirements

### Requirement: 领域角色识别与标签优先策略 (Domain Role Resolution)

系统 SHALL 支持根据 Agent 的 `labels.role`（或 `labels.profile`）以及任务标题/提示词文本识别所属领域角色（`ui` | `backend` | `pm` | `architect` | `qa` | `review` | `scout` | `general`）。显式标签优先级高于文本启发式匹配。

#### Scenario: 显式指定 role 标签时优先命中

- **WHEN** `labels` 包含 `{ role: "ui" }`（或 `"ui-specialist"`）
- **AND** 标题文本包含后端关键词如 `"修复 RPC 协议"`
- **THEN** `detectDomainRole` 返回角色为 `"ui"`，匹配规则为 `"label:role"`

#### Scenario: 无标签时根据 UI 关键词自动识别前端专家

- **WHEN** `labels` 为空
- **AND** 提示词或标题包含 `"重构 QuickPrompts 弹窗组件的 Unistyles 样式与 hover 交互"`
- **THEN** `detectDomainRole` 返回角色为 `"ui"`

#### Scenario: 无标签时根据后端/协议关键词自动识别系统专家

- **WHEN** `labels` 为空
- **AND** 提示词或标题包含 `"修复 daemon WebSocket RPC 协议兼容性与 sqlite 存储"`
- **THEN** `detectDomainRole` 返回角色为 `"backend"`

### Requirement: 会话打开阶段动态注入 Harness 环境变量 (Session Open Harness Env Injection)

系统 SHALL 在 `agent.open.before` 生命周期钩子中，根据识别出的领域角色向 `request.env` 注入 `PASEO_HARNESS_ROLE`、`PASEO_HARNESS_PROFILE` 以及对应的 `LAZY_TOOL_CONFIG` 切片路径，且不得修改 `request` 中除 `env`、`tools`、`mcpServers` 以外的任何字段。

#### Scenario: UI 专家会话打开时自动注入 UI 切片与画像路径

- **WHEN** `agent.open.before` 触发，且角色被识别为 `"ui"`
- **AND** `request.env` 中未预设 `LAZY_TOOL_CONFIG`
- **THEN** 返回的 `env.PASEO_HARNESS_ROLE` 为 `"ui"`
- **AND** `env.PASEO_HARNESS_PROFILE` 指向 `~/.agents/profiles/ui-specialist.json`
- **AND** `env.LAZY_TOOL_CONFIG` 指向 `~/.config/lazy-tool/profiles/ui.yaml`

#### Scenario: 保留调用方显式传入的 LAZY_TOOL_CONFIG

- **WHEN** `agent.open.before` 触发，且 `request.env.LAZY_TOOL_CONFIG` 已设置为 `"/custom/lazy.yaml"`
- **THEN** 返回的 `env.LAZY_TOOL_CONFIG` 保持为 `"/custom/lazy.yaml"` 不被覆盖

### Requirement: 显式角色标签在创建与打开阶段的消费隔离 (One-Shot Context Label Isolation)

系统 SHALL 在 `agent.create.before` 中根据显式 `labels.role` 同步路由对应模型档位，并在 `agent.open.before` 消费一次后立即清除同目录缓存，防止后续无标签 Agent 继承残留角色。

#### Scenario: 连续在同一目录创建带标签与无标签 Agent 时互不污染

- **WHEN** 第一个 Agent 携带 `labels: { role: "review" }` 创建并打开
- **AND** 第二个 Agent 在同一 `cwd` 下无标签创建（标题为 `"修复 daemon WebSocket RPC 协议兼容性"`）并打开
- **THEN** 第一个 Agent 挂载 `PASEO_HARNESS_ROLE="review"` 且模型路由至 `"review"`
- **AND** 第二个 Agent 挂载 `PASEO_HARNESS_ROLE="backend"`，不会残留第一个 Agent 的 `"review"` 角色

### Requirement: Antigravity 按模型粒度豁免与 Gemini 4 路由 (Antigravity Model-Level Bypass & Gemini 4 Routing)

系统 SHALL 支持按模型正则规则（`bypassModels`，默认 `["^gemini-pro-orchestrator"]`）对 Antigravity 原生 Orchestrator 会话进行全链路豁免，而对 Antigravity 其余单阶模型启用 `agent-harness` 编排路由与能力容器注入，并将 `antigravity` 默认映射至 Gemini 4 三档位模型（`plan: "gemini-4-carbon-high"`、`flash: "gemini-4-hydrogen-high"`、`review: "gemini-4-argon-high"`，严禁路由至 `gemini-3*`）。

#### Scenario: Antigravity 使用 Orchestrator 模型时全链路跳过 Harness

- **WHEN** `provider` 为 `"antigravity"` 且 `currentModel` 匹配 `bypassModels`（如 `"gemini-pro-orchestrator"` 或 `"gemini-pro-orchestrator-neon"`）
- **THEN** `resolveMatrixModel` 返回原 `currentModel` 不变，`matchedRule` 为 `"bypass_orchestrator_model"`
- **AND** `agent.create.before` 写入旁路标记，后续 `agent.open.before` 与 `agent.turn.*` 跳过注入 `LAZY_TOOL_CONFIG`、不重写 `mcpServers` 且不执行跨轮模型降级

#### Scenario: Antigravity 使用非 Orchestrator 单阶模型时启用 Gemini 4 路由与切片

- **WHEN** `provider` 为 `"antigravity"` 且 `currentModel` 为 `"gemini-4-hydrogen-high"` 或未显式指定
- **AND** 提示词为 `"你作为 CTO 设计一套完整架构方案"`（或携带 `labels: { role: "ui" }`）
- **THEN** `resolveMatrixModel` 在规划意图下路由至 `"gemini-4-carbon-high"`（或在 `labels.role="ui"` 时路由至 `gemini-4-hydrogen-high` 并注入 `ui.yaml` 切片）
- **AND** 当 `currentModel` 为用户显式锁定的非默认模型（如 `"gemini-4-neon-high"`）且 `overrideIfDefaultOnly` 为 `true` 时，保留原模型不被改写

### Requirement: 敏捷探针 (Scout) 角色与 Pi Canonical 模型 ID 路由 (Scout & Pi Routing)

系统 SHALL 支持将 `pi` Provider 映射至带 `headroom/` 前缀的规范模型 ID，并识别 `scout` 角色加载对应探针画像。

#### Scenario: 敏捷探针 (Scout) 角色与 Pi Canonical 模型 ID 路由

- **WHEN** `provider` 为 `"pi"` 且提示词包含 `"设计一套深模块架构方案"`
- **THEN** `resolveMatrixModel` 返回 `targetModel` 为 `"headroom/plan"`（自动附带 Pi Required 的 `headroom/` 前缀）
- **AND** 当标题或 `labels.role` 命中 `"scout"` 时，`detectDomainRole` 返回 `role: "scout"`，指向 `~/.agents/profiles/scout-specialist.json`

### Requirement: 专家角色与 Provider 模型映射可视化配置 (Specialist & Provider Matrix UI)

系统 SHALL 在插件设置界面提供 Provider 模型档位映射编辑器（含 `antigravity` 及动态探测到的已安装 Provider）、模型旁路正则配置、以及各专家角色（`specialists`）的 `preferredProvider`、`preferredTier`、`modelOverride`、`lazyToolSlice` 等独立配置控件，并在 Composer Popover 动态展示启用的交接专家与原生 Orchestrator 豁免状态。

#### Scenario: 设置界面修改 UI 专家绑定至 Antigravity 并保存

- **WHEN** 用户在 `HarnessSettingsScreen` 的专家矩阵中选择 `"ui"` 并将其 `Preferred Provider` 切换为 `"antigravity"`
- **THEN** 界面触发 `settings.save` 将 `specialists` 中 `ui` 项的 `preferredProvider` 持久化为 `"antigravity"`
- **AND** `Model Override` 选择器联动展示 `antigravity` 的可用模型列表

#### Scenario: Popover 动态展示交接专家与原生 Orchestrator 状态

- **WHEN** `HarnessPopover` 挂载于使用 `gemini-pro-orchestrator` 且无 `agentHarness` 元数据的会话时
- **THEN** 顶部徽章显示 `"NATIVE ORCHESTRATOR"`
- **AND** Specialist Handoff 区域按 `handoffPriority` 动态渲染 `enabled && handoffEnabled` 的专家卡片

### Requirement: Daemon Agent Profiles 真实模型同步与磁盘隔离 (Accurate Profile Sync & Isolation)

系统 SHALL 在同步 Paseo 原生 `agentProfiles` 时经由 `modelOverride` 或 `providerMappings` 解析真实可执行模型 ID，并将图标转换为 kebab-case、按角色去重就地更新既有配置；同时 `general` 专家 MUST 使用独立的 `general.json` 磁盘画像，不得覆盖 `architect.json`。

#### Scenario: 同步 Daemon Agent Profiles 时解析真实模型并避免重复

- **WHEN** 调用 `syncDaemonAgentProfiles` 同步包含 `pi`、`antigravity` 与既有的 `profile_ui_specialist`（`notes` 含 `role: ui |`）在内的专家列表
- **THEN** `pi` 专家解析出 `"headroom/flash"`，`antigravity` 专家解析出 `"gemini-4-hydrogen-high"`，`CheckCircle` 图标转为 `"check-circle"`
- **AND** 复用既有 `profile_ui_specialist` 的 `id` 就地更新，不生成额外的 `harness-ui` 重复条目

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

#### Scenario: 当前检出目录尚未编译对应客户端本地产物时保留 Paseo 切片

- **WHEN** 当前检出目录（含独立 Git Worktree）未生成当前会话 `provider` 对应的 `agent-team` 本地编译产物
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

### Requirement: 多端本地联邦产物探测与通用避让桥接 (Multi-Target Local Federation Detection & Bridge)

系统 SHALL 在工作区活跃检出目录（`checkoutRoot`，不回溯 Worktree 主仓）物理探测已编译的 `agent-team` 多端原生目标（`localFederatedTargets`：`antigravity`、`.claude/agents/`、`opencode` `.opencode/agents/`、`codex` `.codex/agents/`），并在会话 `provider` 命中当前检出目录 `localFederatedTargets` 且非 `bypassModels` 时统一启用 Federation Mode（跳过 `LAZY_TOOL_CONFIG` 注入与 `mcpServers` 过滤，并为根会话注入精简 `[Agent Harness — Federation Bridge]` 引导）。

#### Scenario: Claude 或 Codex 会话命中本地多端编译产物时启用 Federation 避让

- **WHEN** 当前检出目录物理存在带有 `generated_by: agent-team:` 指纹的 `.claude/agents/*.md`（或 `.codex/agents/*.toml`）
- **AND** 会话 `provider` 为 `"claude"`（或 `"codex"`）且非 `isLeaf`
- **THEN** `loadWorkspaceAgentTeam` 在 `summary.localFederatedTargets` 中包含对应目标客户端
- **AND** `agent.open.before` 跳过覆盖 `env.LAZY_TOOL_CONFIG` 与 `mcpServers`，并向根会话注入精简 `[Agent Harness — Federation Bridge]`

#### Scenario: Worktree 尚未编译该客户端本地产物时保留 Paseo 全局切片

- **WHEN** 仅 Git 主仓存在 `.claude/agents/*.md` 而当前 Worktree 的 `.claude/agents/` 不存在，且会话运行在 `"claude"`
- **THEN** 当前 Worktree 的 `localFederatedTargets` 不包含 `"claude"`
- **AND** `agent.open.before` 按专家配置正常注入 `env.LAZY_TOOL_CONFIG` 与标准 `[Capability Harness Active Profile]`
