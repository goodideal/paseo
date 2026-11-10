## Context

参见 `proposal.md`。Paseo Daemon 在打开 Agent 会话（`buildLaunchContext`）时会调用插件系统的 `agent.open.before` 钩子。根据 `packages/server/src/server/plugins/lifecycle/index.ts` 的校验规则，`agent.open.before` 允许且仅允许修改 `env`、`tools` 和 `mcpServers`。

这是将「专家画像（Domain Profile）+ `lazy-tool` 动态 MCP 切片」落入真实子进程环境的最佳控制点（Seam）。

## Goals / Non-Goals

**Goals:**

- **深模块抽象（Deep Module）**：在 `shared/intent-detector.ts` 中提供纯函数 `detectDomainRole({ text, labels })` 与 `resolveHarnessEnv({ role, existingEnv, homeDir })`，对外暴露极简签名，内部封装标签优先、关键词启发式匹配、路径拼接与已有环境变量保护。
- **生命周期贯通**：在 `workspace.create.before` -> `agent.create.before` -> `agent.open.before` 三阶段传递上下文，确保即使 `agent.open.before` 仅收到 `title` 与 `labels`，也能准确拿到创建时的 Prompt 意图并注入 `LAZY_TOOL_CONFIG`、`PASEO_HARNESS_ROLE`、`PASEO_HARNESS_PROFILE`。
- **冷备安全网隔离**：当 `provider === "antigravity"` 时，`resolveMatrixModel` 直接返回原 `currentModel`（`matchedRule: "bypass_safety_net"`），不参与编排路由。
- **遵循 `agent.open.before` 契约**：严格只修改 `request.env`，不触碰不可变属性（如 `agentId`、`provider`、`cwd`、`title`、`labels`），避免触发 Paseo Daemon 的 Schema 校验异常。

**Non-Goals:**

- 不更改客户端内置的 `mcpServers` 结构（因为 Claude Code / Codex 在启动配置中通过 `lazy-tool` 读取环境变量 `LAZY_TOOL_CONFIG` 即可自动切换配置切片）。

## Decisions

### Decision 1: 显式标签优先于文本启发式（Label-First, Heuristic-Fallback）

- **决策**：`detectDomainRole` 首先检查 `labels.role` 或 `labels.profile`（如 `role: "ui"`、`role: "backend"`、`role: "pm"`）；若未指定标签，再通过 `title` / `prompt` 中的高置信度特征词识别（如包含 `UI`、`组件`、`样式`、`弹窗`、`unistyles`、`playwright` 识别为 `ui`；包含 `PRD`、`用户故事`、`痛点`、`proposal` 识别为 `pm`；包含 `协议`、`数据库`、`RPC`、`daemon`、`worker` 识别为 `backend`）。
- **原因**：既支持 Lead Agent 派发专家时显式打标（100% 确定性），也支持用户在 Paseo App 随手新建 Workspace 输入自然语言时自动装配对应容器。

### Decision 2: `LAZY_TOOL_CONFIG` 非破坏性注入

- **决策**：若 `request.env.LAZY_TOOL_CONFIG` 已经被调用方显式指定，则保留原值；否则根据识别出的 `DomainRole` 映射至 `/Users/jerry/.config/lazy-tool/profiles/{ui|backend|pm|codex}.yaml`。
- **原因**：保证手动覆盖优先级最高，同时默认实现按角色隔离 MCP 视野。

### Decision 3: Antigravity 冷备豁免

- **决策**：在 `resolveMatrixModel` 入口处检测 `provider === "antigravity"`，立即返回 `targetModel: currentModel ?? ""` 且不执行任何档位替换。
- **原因**：严格落实“Antigravity 作为离线保底 Agent，不参与日常编排路由”的架构决议。
