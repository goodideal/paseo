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

### Requirement: Antigravity 冷备通道豁免编排路由 (Antigravity Safety-Net Bypass)

系统 SHALL 将 `antigravity` 视为离线容灾冷备通道，在 `resolveMatrixModel` 中不做自动模型档位改写，原样保留其当前模型。

#### Scenario: Antigravity 传入规划类提示词时保持原模型不变

- **WHEN** `provider` 为 `"antigravity"` 且 `currentModel` 为 `"gemini-3.8-flash-high"`
- **AND** 提示词为 `"你作为 CTO 设计一套完整架构方案"`
- **THEN** `resolveMatrixModel` 返回 `targetModel` 仍为 `"gemini-3.8-flash-high"`，`matchedRule` 为 `"bypass_safety_net"`

#### Scenario: 敏捷探针 (Scout) 角色与 Pi Canonical 模型 ID 路由

- **WHEN** `provider` 为 `"pi"` 且提示词包含 `"设计一套深模块架构方案"`
- **THEN** `resolveMatrixModel` 返回 `targetModel` 为 `"headroom/plan"`（自动附带 Pi Required 的 `headroom/` 前缀）
- **AND** 当标题或 `labels.role` 命中 `"scout"` 时，`detectDomainRole` 返回 `role: "scout"`，指向 `~/.agents/profiles/scout-specialist.json`

### Requirement: 显式角色标签在创建与打开阶段的消费隔离 (One-Shot Context Label Isolation)

系统 SHALL 在 `agent.create.before` 中根据显式 `labels.role` 同步路由对应模型档位，并在 `agent.open.before` 消费一次后立即清除同目录缓存，防止后续无标签 Agent 继承残留角色。

#### Scenario: 连续在同一目录创建带标签与无标签 Agent 时互不污染

- **WHEN** 第一个 Agent 携带 `labels: { role: "review" }` 创建并打开
- **AND** 第二个 Agent 在同一 `cwd` 下无标签创建（标题为 `"修复 daemon WebSocket RPC 协议兼容性"`）并打开
- **THEN** 第一个 Agent 挂载 `PASEO_HARNESS_ROLE="review"` 且模型路由至 `"review"`
- **AND** 第二个 Agent 挂载 `PASEO_HARNESS_ROLE="backend"`，不会残留第一个 Agent 的 `"review"` 角色
