## Context

Paseo 的 `agent-harness`（Agent Honeycomb）定位为**跨客户端联邦控制面与单阶模型调度器**，而 Antigravity `agent-team` 承担**仓库内同构专家团队声明与本地化隔离编译**。本 Phase 1 聚焦在两者共存时打通动态角色派生、环境隔离避让、只读安全与防递归交接，不改变现有 Multi-Target 编译架构（Phase 2）及独立设置表单重度编辑器（Phase 3）。

## Goals / Non-Goals

- **Goals**:
  1. 当工作区存在 `.agents/agent-team.json` 时，以其中用户实际选配的 N 个角色覆盖 Paseo 默认 8 角色，并在 Git Worktree 缺失本地清单时回溯主仓 `.agents/` 读取。
  2. 为 `.agents/agent-team.json` 增加可选 `bindings` 映射且保持 `agent-team apply/set` 幂等保留，使同一批工作区角色可按角色绑定到 Antigravity / Claude / Codex / OpenCode。
  3. 仅当非 Orchestrator Antigravity 会话运行在物理包含 `.agents/plugins/team-*/mcp_config.json` 的当前检出目录时，跳过 `LAZY_TOOL_CONFIG` 与 `mcpServers` 覆盖并精简主会话 Prompt 为 3 行 `[Agent Harness — Federation Bridge]`。
  4. 跨客户端派生子专家时自动剥离 frontmatter 注入 `<role>.md` 正文，强制实施 `readonly: true` 模式锁与 `PASEO_HARNESS_LEAF=1` 防递归裂变。
  5. `HarnessPopover` 基于工作区生效配置动态渲染 N 个角色（带滚动容器与只读标注）。

- **Non-Goals**:
  1. 本阶段不在 `agent-team` CLI 中实现 `.claude/agents/*.md`、`.opencode/agent/*.md` 等多端编译器（留待 Phase 2）。
  2. 本阶段不在 `settings-screen.tsx` 中构建完整的 `agent-team.json` 编辑保存器（留待 Phase 3）。

## Decisions

- **纯 FS 解析 Git Worktree**：`agent-team-loader.ts` 仅读取 `.git` 文件 `gitdir:` 及 `<gitdir>/commondir` 查找 `mainRepoRoot`，避免引入 `git` 子进程延迟；且 `hasLocalAntigravityPlugin` 严格只检查当前 `checkoutRoot` 自身是否存在 `.agents/plugins/team-*/mcp_config.json`，避免 Worktree 未同步插件时误跳过 Paseo `LAZY_TOOL_CONFIG`。
- **通用动态专家替换与粗别名保底**：`resolveEffectiveHarnessConfig` 接收可选 `agentTeamContext` 后，直接使用动态 N 角色数组作为 `specialists`，同时将首匹配的开发者/架构/审查/QA/PM 角色挂载对应粗粒度 `aliases`（如 `fe-developer` 附带 `ui`、`be-developer` 附带 `backend`），保证既有标题启发式或 `role=ui` 调用仍可平稳着陆。
- **双通道只读与防套娃标识**：叶子标识同时写入子 Agent 标签 `paseo.harness-leaf: "1"`、元数据 `agentHarnessLeaf: true` 及环境 `PASEO_HARNESS_LEAF=1`，确保从 `agent.create.before` 到 `agent.open.before` 均可靠隐藏 `harness_handoff`；只读约束则在允许原生 `plan` 模式的客户端锁定 `modeId="plan"` 并在系统 Prompt 追加不可绕过的只读规范。

## Risks / Trade-offs

- **风险 1：`catalog.json` 外部文件在轻量单测中不可见** -> 在 `agent-team-loader.ts` 内置常见 11 个标准角色的最小元数据兜底表（title/team/readonly/recommended_model），磁盘 `catalog.json` 存在时优先读取真实文件。
- **风险 2：`EffectiveHarnessConfig` 按 `cwd` 动态切换角色表后，`shared/` 不能引入 `node:*`** -> 保持所有文件 I/O 在 `server/agent-team-loader.ts` 完成，通过纯数据结构 `{ summary, specialists }` 注入 `shared/config-resolver.ts`。
