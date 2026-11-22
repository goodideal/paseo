## Context

Phase 2 将 `.agents/agent-team.json` 从「Antigravity 插件清单 + Paseo 联邦源」升级为「四端统一编译源（Antigravity / Claude Code / OpenCode / Codex CLI）」，并让 Paseo `agent-harness` 对所有已编译本地产物的客户端一视同仁启用 Federation 避让。

## Goals / Non-Goals

- **Goals**:
  1. 支持 `targets`（默认 `["antigravity"]` 与 `bindings[*].provider` 并集，CLI `--targets` 支持 `all`、逗号替换与 `+t/-t` 增量）。
  2. 为 `claude` / `opencode` / `codex` 生成带 `generated_by: agent-team:<slug>` 指纹的原名子代理与 MCP 入口，且重编译/清理不误伤用户手写 Agent 与 MCP 条目。
  3. 对只读角色施加各端静态禁写锁 + 统一 `team-guard.sh`（支持 `--client claude` `hookSpecificOutput` 与 `--readonly`），并在项目级 `<slug>-lazy-tool` 免疫全局 `LAZY_TOOL_CONFIG` 环境变量覆盖。
  4. `tracked-manifest` 模式将多端本机绝对路径生成物统一记入仓库 `.git/info/exclude` 受管块，保留 `.agents/agent-team.json` 作为跨机 SSOT（支持 `--git-mode tracked-all` 提交全量生成物）。
  5. Paseo `agent-harness` 按 `checkoutRoot` 物理文件探测 `localFederatedTargets`，仅当活跃会话的客户端出现在 `localFederatedTargets` 时启用 Federation 避让。

- **Non-Goals**:
  1. 本阶段不在 `settings-screen.tsx` 构建交互式 `agent-team.json` 编辑器（留待 Phase 3）。
  2. 不修改各客户端全局用户目录（`~/.claude/`、`~/.codex/`、`~/.config/opencode/`），所有产出严格限定在目标项目目录内。

## Decisions

- **Fingerprint-Scoped Reconciliation**：Markdown 使用前置评论 `<!-- generated_by: agent-team:<slug> -->`，TOML 首行使用 `# generated_by: agent-team:<slug>`，`.codex/config.toml` 与 `.git/info/exclude` 使用独立边界注释块，确保与手写文件共存零冲突。
- **Direct `lazy-tool --config` Isolation**：Claude / OpenCode / Codex 项目级 `<slug>-lazy-tool` 直接指向 `lazy-tool --config <yaml>`（Antigravity `mcp_config.json` 保留 `lazy-tool-runner --default-config <yaml>` 并置空 `env.LAZY_TOOL_CONFIG`），防止 Paseo 或宿主环境全局 `LAZY_TOOL_CONFIG` 覆盖项目级索引。
- **Per-Checkout Federated Target Check**：`detectLocalFederatedTargets(checkoutRoot, projectSlug)` 只检查当前检出根目录自身，绝不回溯至 Git Worktree 主仓，从而保证未同步多端生成物的 Worktree 仍安全获得 Paseo `LAZY_TOOL_CONFIG` 切片兜底。

## Risks / Trade-offs

- **TOML 解析兼容性**：Codex `.codex/config.toml` 读写必须使用 Python 3.11+ 标准库 `tomllib.loads` 校验生成结果并保留非受管表段，避免引入第三方 TOML 写入依赖。
