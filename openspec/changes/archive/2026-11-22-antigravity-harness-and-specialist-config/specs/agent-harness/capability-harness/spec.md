# Spec Delta

## REMOVED Requirements

### Requirement: Antigravity 冷备通道豁免编排路由 (Antigravity Safety-Net Bypass)

**Reason**: 由 Provider 级的 `antigravity` 全量旁路（及废弃的 `gemini-3.8-flash-high` 示例模型）升级为按模型粒度的 `bypassModels` 豁免策略，使 Antigravity 单阶 Gemini 4 模型能够参与 Harness 路由与环境切片，同时保留 `Scout & Pi` 路由行为至独立 Requirement。
**Migration**: 将 `bypassProviders` 中的 `"antigravity"` 迁移至 `bypassModels: ["^gemini-pro-orchestrator"]`，并为 `antigravity` 配置 Gemini 4 三档位映射；原有 `Scout` 与 `Pi` 路由契约由新增 Requirement `敏捷探针 (Scout) 角色与 Pi Canonical 模型 ID 路由` 承接。

## ADDED Requirements

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
