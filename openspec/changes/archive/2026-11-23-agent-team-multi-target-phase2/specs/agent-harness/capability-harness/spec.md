# Spec Delta

## ADDED Requirements

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
