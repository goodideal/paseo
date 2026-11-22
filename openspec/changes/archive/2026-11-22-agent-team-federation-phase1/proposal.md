## Why

当仓库已通过 Antigravity `agent-team` 初始化 `.agents/agent-team.json` 与本地插件 `.agents/plugins/team-<slug>/` 时，在 Paseo 中选择 Antigravity 普通单阶模型（如 `gemini-4-hydrogen-high`）运行会触发 `agent-harness` 注入全局 `LAZY_TOOL_CONFIG` 环境变量与完整 `[Capability Harness Active Profile]` 横幅，通过 [lazy-tool-runner](file:///Users/jerry/.local/bin/lazy-tool-runner) 强行覆盖项目专属 `<slug>-lazy-tool` 数据源并制造双套角色引导。同时 Paseo 内置的 8 个粗粒度专家并未消费仓库中由用户按需派生的 N 个细粒度角色，缺少角色 Markdown 正文跨客户端注入、只读强约束及叶子防递归交接守卫。

## What Changes

- 将 `.agents/agent-team.json` 提升为工作区团队角色与客户端绑定声明的单一事实源，支持可选 `bindings` 字段（`provider` / `tier` / `model` / `modeId` / `lazyToolSlice`），并更新 `agent-team` Python 脚本在 `apply` / `set` 时保留 `bindings`。
- 新增纯服务端 `agent-team-loader.ts`，支持 Git Checkout 与 Worktree 主仓溯源、Mtime 缓存、`catalog.json` 元数据及角色 Markdown 正文提取（剥离 YAML Frontmatter 并展开占位符）。
- 当仓库在当前 Checkout 物理存在 `.agents/plugins/team-*/mcp_config.json` 时，为非 Orchestrator 单阶 Antigravity 根会话启用协同模式（Federation Mode）：保留 Gemini 4 档位路由与 `harness_handoff`，跳过注入 `LAZY_TOOL_CONFIG` 与 `mcpServers` 过滤，并改为注入 3 行 `[Agent Harness — Federation Bridge]`。
- 当 Paseo 按 `harness_handoff` 或显式角色标签派生工作区动态角色时，按 `N` 替换默认专家名单，注入 `<role>.md` 正文、对 `readonly: true` 角色强制锁定 `plan` 模式/禁写护栏，并在子会话设置 `PASEO_HARNESS_LEAF=1` 隐藏 `harness_handoff` 防止跨进程递归裂变。
- 升级 `HarnessPopover` 与环境巡检反馈：按工作区 `cwd` 拉取有效专家清单并滚动渲染全部 N 个角色卡片及 `RO` / 绑定 Provider 徽标。

## Capabilities

### New Capabilities

- 无新增独立能力域（全部扩展收口于既有的 `agent-harness/capability-harness`）。

### Modified Capabilities

- `agent-harness/capability-harness`：新增 `.agents/agent-team.json` 动态 N 角色装载与 Worktree 回溯、Antigravity Federation 避让与 3 行桥接提示、跨客户端 `<role>.md` 灵魂注入与 `readonly`/`PASEO_HARNESS_LEAF=1` 边界，以及 `HarnessPopover` 工作区动态 N 角色渲染。

## Impact

- 影响文件：
  - `/Users/jerry/.agents/skills/gitea/agent-team/scripts/runtime_env.py`、`agent_team.py` 与 `references/manifest-schema.md`
  - `plugin-custom/agent-harness/server/{agent-team-loader.ts,handoff-tool.ts,rpc-handlers.ts}`
  - `plugin-custom/agent-harness/shared/{types.ts,lifecycle-state.ts,contracts.ts,config-resolver.ts,intent-detector.ts}`
  - `plugin-custom/agent-harness/index.server.ts`
  - `plugin-custom/agent-harness/client/{metadata-utils.ts,harness-popover.tsx,settings-screen.tsx}`
- 对话协议向后兼容：`harnessInspectEnvironmentRpc` 新增的 `agentTeam` 字段为可选。
