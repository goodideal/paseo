## Why

Phase 1 已打通 Antigravity `agent-team`（`.agents/agent-team.json` + `.agents/plugins/team-<slug>/`）与 Paseo `agent-harness` 跨进程委派，但在终端直连 Claude Code、OpenCode 或 Codex CLI 时，仓库尚无对应客户端原生的本地子代理、项目级只读/守卫拦截与隔离 MCP 入口；同时在 Paseo 中启动非 Antigravity 客户端（`claude` / `opencode` / `codex`）时，若仓库已编译出该端原生产物，`agent-harness` 仍会强制注入全局 `LAZY_TOOL_CONFIG` 并覆盖项目专属 `<slug>-lazy-tool` 索引。

## What Changes

- 扩展 `.agents/agent-team.json` 与 `agent-team` CLI（`runtime_env.py`、`agent_team.py`、`synthesizer.py`、`doctor.py`、`guard_template.py`、`gitea-team.js`），新增 `targets` 多端声明（`antigravity`、`claude`、`opencode`、`codex`）与 `--targets` / `--git-mode tracked-all`。
- 为启用的非 Antigravity 目标生成带 `generated_by: agent-team:<slug>` 指纹与各端方言重绑定的原生子代理：`.claude/agents/<role>.md`、`.opencode/agents/<role>.md`、`.codex/agents/<role>.toml` 与 `.codex/config.toml` 受管段，不覆盖用户手写 Agent 并支持精确清理。
- 将 `readonly: true` 落地为各端静态权限锁（Claude `disallowedTools`、OpenCode `permission` deny、Codex `sandbox_mode = "read-only"`），扩展共享 `.agents/scripts/team-guard.sh` 支持 `--client antigravity|claude` 与 `--readonly`，并将 `<slug>-lazy-tool` 以免疫 `LAZY_TOOL_CONFIG` 的直连 `--config` 形态非破坏性合入各端项目级 MCP 配置。
- 扩展 Paseo `agent-harness`（`server/agent-team-loader.ts`、`shared/{types,contracts,config-resolver}.ts`、`index.server.ts`、`client/settings-screen.tsx`）探测当前检出目录实际存在的 `localFederatedTargets`，并将 Federation Mode（跳过 `LAZY_TOOL_CONFIG`、`mcpServers` 过滤并改用精简桥接提示）泛化至所有已编译本地产物的客户端。

## Capabilities

### New Capabilities

- 无新增独立能力域（全部扩展收口于既有的 `agent-harness/capability-harness`）。

### Modified Capabilities

- `agent-harness/capability-harness`：新增多端本地编译目标探测（`localFederatedTargets`）与跨客户端（`antigravity`/`claude`/`opencode`/`codex`）通用 Federation 避让及桥接引导。

## Impact

- 影响文件：
  - `/Users/jerry/.agents/skills/gitea/agent-team/{SKILL.md,references/manifest-schema.md}`
  - `/Users/jerry/.agents/skills/gitea/agent-team/scripts/{runtime_env.py,guard_template.py,synthesizer.py,agent_team.py,doctor.py}`
  - `/Users/jerry/.agents/skills/gitea/scripts/gitea-team.js`
  - `/Users/jerry/.agents/skills/gitea/tests/agent-team-integration.test.js`
  - `plugin-custom/agent-harness/{index.server.ts,server/agent-team-loader.ts,shared/types.ts,shared/contracts.ts,shared/config-resolver.ts,client/settings-screen.tsx,tests/config-resolver.test.ts,tests/server.test.ts}`
- 协议兼容性：`AgentTeamSummarySchema` 新增的 `targets` 与 `localFederatedTargets` 均为可选字段。
