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
- **THEN** 第一个 Agent 挂载 `PASEO_HARNESS_ROLE="review"` 且模型路由至 `"pro"`（`deep` 档 + `thinking: "high"`）
- **AND** 第二个 Agent 挂载 `PASEO_HARNESS_ROLE="backend"`，不会残留第一个 Agent 的 `"review"` 角色

### Requirement: 单维度四档复杂度与预算阶梯 (`fast · standard · deep · max`) (4-Tier Complexity & Budget Ladder)

系统 SHALL 将模型路由收敛为单一复杂度/成本维度四档阶梯（`fast` · `standard` · `deep` · `max`），同时通过 `providerThinkingMappings` 为每档独立配置目标推理深度（`thinkingOptionId`）：

- `fast`（`0.2x`）：轻量检索、调度（`orchestrator`）、探针（`scout`）与 `chore:`/`docs:`/`style:` 类微调，默认配置 `lite` / `gemini-4-hydrogen` 等轻量模型；
- `standard`（`1x`）：日常主力开发档位（`ui`、`backend`、`qa`、`general` 及常规迭代默认档），默认配置 `flash` / `gemini-4-argon`；
- `deep`（`3x`）：自动意图路由最高上限，用于架构设计、产品规划（`pm`、`architect`）与代码审查（`review`）及手动重度编码；
- `max`（手动峰值）：保留给极难疑难故障与核心算法的手工峰值推理（如 `gemini-4-neon` / `plan` + `xhigh`）。

#### Scenario: 缺失 max 模型配置时自动回退至 deep + xhigh

- **WHEN** 自定义或三模型 Provider 仅配置 `fast`、`standard`、`deep` 而未显式配置 `max`
- **THEN** `resolveTierTarget(config, provider, "max")` 返回 `deep` 档模型并将 `thinkingOptionId` 提升为 `"xhigh"`

### Requirement: 复杂度档位与执行阶段的正交解耦 (`MatrixTier` vs `HarnessPhase`) (Orthogonal Tier/Phase Decoupling)

系统 MUST 将复杂度档位（`fast | standard | deep | max`）与执行阶段（`phase`: `design | exec | review`）正交解耦：

- 是否强制进入原生只读 `plan` 模式仅由 `phase === "design"` 或 `specialist.readonly === true` 决定，不得将 `"deep"`/`"max"` 档位本身等同于只读规划模式；
- 会话创建时的初始 `modeId` 与 `thinkingOptionId` 由 `agent.create.before` 注入；
- 自动设计意图在 `phase === "design"` 经 `ExitPlanMode` 批准或确认执行指令时自动步降至 `standard` 档（`phase: "exec"`），服务端同步更新 `model` 与元数据（若运行时 `PaseoAgentHandle` 支持 `setMode` / `setThinkingOption` 则一并下发）；
- 通过 `harnessSwitchTierRpc` 手动切换至 `deep` 或 `max` 档时，除非当前角色为 `readonly` 或显式指定 `targetPhase: "design"`，否则默认切入可写 `"exec"` 阶段且在编写源码时不得自动降档；`HarnessPopover` 必须经由 `useComposers({ agentId })` 调用 `composer.setMode` 与 `composer.setThinking` 同步 `recommendedModeId` 与 `recommendedThinkingOptionId`。

#### Scenario: Deep/Max 处于可写 exec 阶段时修改源码不触发自动降档

- **WHEN** 会话处于 `currentTier: "deep"`（或 `"max"`）且 `phase: "exec"`，并在同一回合内修改 `.ts` / `.tsx` 业务源码
- **THEN** `shouldEnforceNativePlanMode` 返回 `false`
- **AND** `evaluateTurnAfterTransition` 返回 `shouldDowngrade: false`，保持当前档位与 `exec` 阶段不变

### Requirement: max 档严格手动触发边界 (Strict Manual-Only Governance for Max Tier)

系统 MUST 保证 `max` 档位仅由用户通过 `HarnessPopover` 手动点击切换或在创建会话时显式选用对应模型，严禁以下行为：

- 自动意图检测（`detectIntentRoute` / `detectMatrixTier`）与 L2 LLM 分类器（`classifyIntentWithLlm`）输出 `max` 档位（出现 `"max"` 时由 `coerceAutoRoutingTier` 钳位至 `"deep"`）；
- 任何内置专家默认绑定 `preferredTier: "max"`；
- 当用户主动选择 `max` 模型（如 `"gemini-4-neon"` 或 `"custom/plan"`）且启用 `overrideIfDefaultOnly` 时，`resolveMatrixModel` 判定为 `preserve_user_choice` 并保留用户选定模型。

#### Scenario: Popover 在 Max 档 active 时展示高配额消耗提示徽章

- **WHEN** `HarnessPopover` 展示 `currentTier === "max"` 的非旁路会话
- **THEN** Next Turn 状态卡片显示 `"Manual Max · High quota usage"` 提示标签

### Requirement: Antigravity 按模型粒度豁免与 Gemini 4 路由 (Antigravity Model-Level Bypass & Gemini 4 Routing)

系统 SHALL 支持按模型正则规则（`bypassModels`，默认 `["^gemini-pro-orchestrator"]`）对 Antigravity 原生 Orchestrator 会话进行全链路豁免，而对 Antigravity 其余单阶模型启用 `agent-harness` 编排路由与能力容器注入，并将 `antigravity` 默认映射至原生 Gemini 4 模型 ID 与配套 `thinkingOptionId`（`fast: "gemini-4-hydrogen"` + `"medium"`、`standard: "gemini-4-argon"` + `"high"`、`deep: "gemini-4-carbon"` + `"high"`、`max: "gemini-4-neon"` + `"xhigh"`，严禁路由至 `gemini-3*`）。

#### Scenario: Antigravity 使用 Orchestrator 模型时全链路跳过 Harness

- **WHEN** `provider` 为 `"antigravity"` 且 `currentModel` 匹配 `bypassModels`（如 `"gemini-pro-orchestrator"` 或 `"gemini-pro-orchestrator-neon"`）
- **THEN** `resolveMatrixModel` 返回原 `currentModel` 不变，`matchedRule` 为 `"bypass_orchestrator_model"`
- **AND** `agent.create.before` 写入旁路标记，后续 `agent.open.before` 与 `agent.turn.*` 跳过注入 `LAZY_TOOL_CONFIG`、不重写 `mcpServers` 且不执行跨轮模型降级

#### Scenario: Antigravity 使用非 Orchestrator 单阶模型时启用 Gemini 4 路由与切片

- **WHEN** `provider` 为 `"antigravity"` 且 `currentModel` 为 `"gemini-4-hydrogen"` 或未显式指定
- **AND** 提示词为 `"你作为 CTO 设计一套完整架构方案"`（或携带 `labels: { role: "ui" }`）
- **THEN** `resolveMatrixModel` 在规划意图下路由至 `"gemini-4-carbon"`（`tier: "deep"`, `thinkingOptionId: "high"`；或在 `labels.role="ui"` 时路由至 `standard` 档 `"gemini-4-argon"` 并注入 `ui.yaml` 切片）
- **AND** 当 `currentModel` 为用户显式锁定的非默认或手动 `max` 模型（如 `"gemini-4-neon"`）且 `overrideIfDefaultOnly` 为 `true` 时，保留原模型不被改写

### Requirement: 敏捷探针 (Scout) 角色与 Pi Canonical 模型 ID 路由 (Scout & Pi Routing)

系统 SHALL 支持将 `pi` Provider 映射至带 `headroom/` 前缀的四档规范模型 ID（`fast: "headroom/lite"`、`standard: "headroom/flash"`、`deep: "headroom/pro"`、`max: "headroom/plan"`），并识别 `scout` 角色加载对应探针画像（默认 `preferredTier: "fast"`）。

#### Scenario: 敏捷探针 (Scout) 角色与 Pi Canonical 模型 ID 路由

- **WHEN** `provider` 为 `"pi"` 且提示词包含 `"设计一套深模块架构方案"`
- **THEN** `resolveMatrixModel` 返回 `tier: "deep"`、`targetModel: "headroom/pro"`、`targetThinking: "high"`（自动附带 Pi Required 的 `headroom/` 前缀）
- **AND** 当标题或 `labels.role` 命中 `"scout"` 时，`detectDomainRole` 返回 `role: "scout"`，指向 `~/.agents/profiles/scout-specialist.json`

### Requirement: 专家角色与 Provider 模型映射可视化配置与 v5 迁移 (Streamlined Settings Matrix UI & v5 Migration)

系统 SHALL 在插件设置界面为四档（`Fast / Standard / Deep / Max`）提供简洁的单下拉模型选择（仅选择 `Custom Model ID...` 时按需展开自定义输入框）+ 推理深度（`Thinking`）下拉与 `Reset Provider Mappings` 一键恢复推荐配置操作、模型旁路正则配置、以及各专家角色（`specialists`）的 `preferredProvider`、`preferredTier`、`modelOverride`、`lazyToolSlice` 控件；在配置版本 `SETTINGS_SCHEMA_VERSION = 5` 下自动执行 `v1–v4 -> v5` 迁移，通过 `normalizeTierAlias`（`lite->fast`, `flash->standard`, `plan|review->deep`）升级未改动的内置映射同时保留用户自定义模型与自定义档位，并在 Composer Popover 单行展示 `Fast | Standard | Deep | Max` 切换按钮、活跃交接专家与原生 Orchestrator 状态。

#### Scenario: 设置界面修改 Antigravity 档位模型与 Thinking、按需展示 Custom 输入并支持重置默认值

- **WHEN** 用户在 `HarnessSettingsScreen` 修改 `Standard Model` 为 `"gemini-4-neon"`、修改 `Standard Thinking` 为 `"xhigh"`，或在 `Fast Model` 选择 `"Custom Model ID..."` 并最终点击 `Reset Provider Mappings`
- **THEN** `Standard Model`/`Standard Thinking` 即时持久化至 `providerMappings` 与 `providerThinkingMappings`
- **AND** `Fast Custom Model ID` 输入框仅在选定 `"__custom__"` 或存在目录外自定义模型时显示；点击 `Reset defaults` 恢复对应客户端推荐的四档模型与 Thinking 映射

#### Scenario: 从 v4 配置升级至 v5 时保留用户自定义模型与自定义档位

- **WHEN** `agentHarnessSettings.migrate` 接收到含自定义 `claude` 映射及自定义档位（如 `"ultra"`）和未改动 `codex` v4 默认映射的 v4 配置
- **THEN** `claude` 自定义模型被映射到对应规范档位且 `"ultra"` 档位保留，未改动的 `codex` 映射与内置专家 `preferredTier` 自动升级至四档默认值，同时补全 `providerThinkingMappings`

#### Scenario: Popover 动态展示交接专家与原生 Orchestrator 状态

- **WHEN** `HarnessPopover` 挂载于使用 `gemini-pro-orchestrator` 且无 `agentHarness` 元数据的会话时
- **THEN** 顶部徽章显示 `"NATIVE ORCHESTRATOR"`，单行展示 `Fast | Standard | Deep | Max` 四个锁定按钮
- **AND** Specialist Handoff 区域按 `handoffPriority` 动态渲染 `enabled && handoffEnabled` 的专家卡片

### Requirement: Daemon Agent Profiles 真实模型同步与磁盘隔离 (Accurate Profile Sync & Isolation)

系统 SHALL 在同步 Paseo 原生 `agentProfiles` 时经由 `modelOverride` 或 `providerMappings` 解析真实可执行模型 ID 与 `thinkingOptionId`，并将图标转换为 kebab-case、按角色去重就地更新既有配置；同时 `general` 专家 MUST 使用独立的 `general.json` 磁盘画像，不得覆盖 `architect.json`。

#### Scenario: 同步 Daemon Agent Profiles 时解析真实模型、Thinking 并避免重复

- **WHEN** 调用 `syncDaemonAgentProfiles` 同步包含 `pi`（`scout`, `fast`）、`antigravity`（`ui`, `standard`）与既有的 `profile_ui_specialist`（`notes` 含 `role: ui |`）在内的专家列表
- **THEN** `pi` 专家解析出 `"headroom/lite"`（`thinkingOptionId: "low"`），`antigravity` `ui` 专家解析出 `"gemini-4-argon"`（`thinkingOptionId: "high"`），`CheckCircle` 图标转为 `"check-circle"`
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

### Requirement: 工作区 Agent Team 可视化编辑器与多端同步编译 (Workspace Team Visual Editor & Sync Synthesis)

系统 SHALL 在 `agent-harness` 插件注册工作区面板 `agent-team-panel`、`.agents/agent-team.json` 专属 `FilePanel` 及工作区 `Command Center` 入口（不在工作区顶栏新增常驻按钮），并在全局 `HarnessSettingsScreen` 提供工作区选择与跳转入口；保存变更时服务端 SHALL 通过 `agent_harness.team.*` RPC 对当前工作区 `checkoutRoot` 原子写入 `.agents/agent-team.json`（含逐角色 `bindings`）并同步调用 `synthesizer` 编译启用目标（无宿主机编译器时降级为纯 JSON 写入并提示告警），成功后即时刷新 `HarnessPopover` 专家列表且不中断运行中会话。

#### Scenario: Worktree 继承主仓清单时显式提示并仅在当前 Worktree 物化编译

- **WHEN** 关联 Git Worktree 的活跃 `checkoutRoot` 缺失 `.agents/agent-team.json` 而 `mainRepoRoot` 存在该清单
- **THEN** `agent_harness.team.inspect.request` 返回 `manifestState: "inherited_from_main"`
- **AND** 用户在面板修改 `bindings` 或点击保存编译后，仅写入 `<checkoutRoot>/.agents/agent-team.json` 与该 Worktree 本地目标产物，`mainRepoRoot` 保持未修改

#### Scenario: 编辑器按需启用角色自动勾选依赖并保留手动裁剪与未保存草稿

- **WHEN** 用户在编辑器新启用 `be-developer` 或 `data-pg-redis`
- **THEN** 界面自动勾选声明的 `requires_mcp` / `requires_guards` 并展示联动提示
- **AND** 若用户随后手动取消某项依赖，保存按表单最终勾选落盘；若编译返回错误，面板内联展示错误且保持 `tab.setModified(true)` 不清空草稿

### Requirement: 已注册工作区团队 RPC 隔离与互斥保护 (Registered-Workspace AuthZ & Per-Checkout Mutex)

所有工作区团队读写、探测、体检与清理 RPC MUST 仅操作根据已注册 `workspaceId` 解析得到的真实工作区路径（拒绝未知 `workspaceId`），并以 `checkoutRoot` 为粒度串行化并发变更操作；执行 `clean` 操作 MUST 经确认并在默认情况下仅清理受管生成产物而保留 `.agents/agent-team.json`。

#### Scenario: 拒绝未注册 workspaceId 并串行化同一检出目录并发保存

- **WHEN** 客户端传入未在 Paseo 注册的 `workspaceId` 请求 `team.save` 或 `team.clean`
- **THEN** RPC 拒绝请求并抛出明确错误，不访问或修改磁盘文件系统
- **AND** 对同一工作区的并发 `team.save` 请求按检出目录互斥串行执行，避免 `.agents/agent-team.json` 与生成目录竞争损坏

### Requirement: 内置审查专家默认绑定 Antigravity 与 ocr delegate 规则门禁 (Antigravity + OCR Delegate Review Gate & Schema Migration)

系统 SHALL 将内置 `review` 专家角色（`Reviewer & Security Audit Gate`）的默认 `preferredProvider` 设为 `"antigravity"`，`primarySkills` 注入 `["mattpocock-skills:code-review", "open-code-review-delegate", "gitea"]`，`qualityGates` 设为 `["dual-axis-semantic-review", "open-code-review-delegate-gate"]`，并在 `phase=exec` 与 `phase=review` 阶段规则中指示采用宿主审查代理配合 LLM-Free `ocr delegate`（`ocr delegate preview` + `ocr delegate rule`）取代独立外部 LLM `ocr review`；同时当插件配置版本低于 `v4` 时，系统 SHALL 自动将内置 `review` 专家的遗留 `"claude"` / `"claude-code"` Provider、`"security-review"` 技能、`"open-code-review-cli-gate"` 门禁及遗留 `phaseRules` 平滑迁移至 `v4` 契约。

#### Scenario: 跨客户端交接 review 角色时默认路由至 Antigravity 审查模型并挂载委托门禁技能

- **WHEN** 父会话（如运行在 `"claude"`）调用 `harness_handoff` 且 `targetRole` 为 `"review"`（未覆盖内置 `review` 配置）
- **THEN** 新建子会话的 `provider/model` 路由至 `"antigravity/gemini-4-carbon"`（`targetTier: "deep"`, `thinkingOptionId: "high"`）
- **AND** 系统提示词中的 `Primary Skills` 包含 `"open-code-review-delegate"`，且 `phase=review` 规则明确使用 `ocr delegate preview` 与 `ocr delegate rule`

#### Scenario: 从 v3 旧版配置自动升级内置 review 专家与阶段规则至 v4

- **WHEN** 加载 `fromVersion < 4` 的持久化配置，其中内置 `review` 专家的 `preferredProvider` 为 `"claude"`（或 `"claude-code"`）、`primarySkills` 含 `"security-review"`、`qualityGates` 含 `"open-code-review-cli-gate"`
- **THEN** `agentHarnessSettings.migrate` 将 `review.preferredProvider` 升级为 `"antigravity"`，将技能与门禁替换为 `"open-code-review-delegate"` 与 `"open-code-review-delegate-gate"`，并将未自定义修改的 `phaseRules.exec` 与 `phaseRules.review` 同步更新为 `agy + ocr delegate` 规则

### Requirement: 运行时外部模型切换与遗留档位自动校准 (Runtime External Model Sync & Legacy Tier Reconciliation)

系统 SHALL 在 `agent.turn.before` 与 `agent.turn.after` 中读取会话运行时快照模型及 `thinkingOptionId`，当用户通过 Paseo 原生选择器切换模型或恢复带有遗留 v4 档位名（`flash | plan | review | lite`）的会话时，经 `inferTierFromModel` 与 `reconcileRuntimeHarnessMetadata` 自动同步 `currentTier`、`currentModel`、`currentThinking`、`lastBilled*` 及 `userModelLocked` 状态；当快照模型不可用时 MUST 保持原元数据不变。

#### Scenario: 用户在原生选择器将模型从 gemini-4-neon 切换为 gemini-4-hydrogen 后自动校准为 fast 档

- **WHEN** 会话元数据记录 `currentModel: "gemini-4-neon"`、`currentTier: "flash"`、`userModelLocked: true`，且运行时快照模型变更为 `"gemini-4-hydrogen"`（`thinkingOptionId: "high"`）
- **THEN** `agent.turn.before` 与 `agent.turn.after` 将 `currentTier` 与 `lastBilledTier` 同步更新为 `"fast"`、`currentModel` 与 `lastBilledModel` 更新为 `"gemini-4-hydrogen"`、`currentThinking` 与 `lastBilledThinking` 更新为 `"high"`
- **AND** `userModelLocked` 重置为 `false`，`tierMatchedRule` 记录为 `"runtime_sync:external_model_change"`

### Requirement: 共享工作树并发可写交接互斥与上下文注入 (Concurrent Writable Handoff Guard & Parent Context Injection)

系统 MUST 在父会话处于 `status === "running"` 时保护共享工作树：服务端 `harnessHandoffRpc` 与客户端 `HarnessPopover` SHALL 禁用并拒绝派发非只读可写专家，仅放行只读专家（`readonly: true` 或 `review`）；未提供 `summaryOverride` 时，服务端 SHALL 自动注入父会话任务标题与最近时间线摘要及共享工作区暂存约束（`[Parent Session Context]`）；同时在 `supportsNativePaseoTools=false` 的 Antigravity 非叶子会话中，系统 SHALL 注入使用 `mcp_paseo_create_agent` 派生专家子代理的规范指引。

#### Scenario: 父会话运行中时阻止可写专家派发并放行只读 review 专家与上下文注入

- **WHEN** 父会话处于 `status === "running"`，用户或客户端调用 `agent_harness.specialist.handoff.request`
- **THEN** 派发可写专家（如 `qa`、`ui`）被拒绝并抛出明确错误，且 `HarnessPopover` 将可写专家卡片置为禁用态
- **AND** 派发只读 `review` 专家正常放行；当未传入 `summaryOverride` 时，子会话提示词自动附带 `[Parent Session Context]`（含 `Parent Task`、最近时间线摘要及禁止盲目 `git add -A` 约束）
