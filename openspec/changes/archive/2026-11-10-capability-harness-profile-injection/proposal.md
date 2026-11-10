## Why

在设计完成「双轨研发（Track A Superpowers vs Track B Matt Pocock）+ 动态能力容器（Capability Harness）+ OpenSpec SSOT」后，我们对当前 Paseo 运行环境进行了全链路实机核查，发现存在 **4 处规范与物理实现断层（Gaps）**：

1. **`agent.open.before` 动态能力注入未落地**：
   - 虽然 `~/.config/lazy-tool/profiles/` 下已存在 `ui.yaml`、`backend.yaml`、`codex.yaml`，但 `plugin-custom/agent-harness` 插件仅注册了 `workspace.create.before` 和 `agent.create.before`（只做了 `plan` / `review` / `flash` 模型档位路由），**完全没有实现 `agent.open.before` 钩子**。
   - 导致 Paseo 派发 UI 或 Backend 专家 Agent 时，子进程并未收到 `LAZY_TOOL_CONFIG`、`PASEO_HARNESS_ROLE` 或 `PASEO_SKILLS_ROOT` 环境变量，动态 MCP 与技能容器停留在纸面。
2. **领域专家画像（Domain Profiles）与 lazy-tool 切片缺失**：
   - `~/.agents/profiles/` 仅有 `ui-specialist.json` 与 `product-specialist.json`，缺少 SDLC 矩阵中的 `backend-specialist`、`architect`、`qa-gatekeeper`、`security-review`、`release-devops` 画像。
   - `~/.config/lazy-tool/profiles/ui.yaml` 尚未构建本地 SQLite 索引（缺少 `ui.db`），且缺少 `pm.yaml` 轻量切片。
3. **Antigravity 仍在被自动路由**：
   - `agent-harness/shared/intent-detector.ts` 中仍然保留了 `antigravity` 的默认映射，违反了“Antigravity 仅作为离线冷备兜底、不参与编排路由”的架构约束；同时缺少 `pi` 的模型映射。
4. **Claude Code 全局技能软链接缺失**：
   - 新安装的 `ui-ux-pro-max` 与 `pm-*` 技能此前仅软链到了 `~/.agents/skills/` 和 `~/.codex/skills/`，遗漏了 `~/.claude/skills/`，导致 Claude Code 作为 Orchestrator / UI Specialist 时无法在 Skill 列表中直接感知。

## What Changes

- **扩展 `agent-harness` 为「模型矩阵 + 领域能力容器（Capability Harness）」双核路由器**：
  - 新增领域画像识别器 `detectDomainProfile(text, labels)`，支持通过显式标签（`labels.role` / `labels.profile`）或标题/Prompt 意图识别 `ui`、`backend`、`pm`、`architect`、`qa`、`review`、`devops`、`general` 角色。
  - 在 `index.server.ts` 中新增 `agent.open.before` 生命周期钩子，在 Agent 会话打开时自动注入：
    - `PASEO_HARNESS_ROLE`: 识别出的专家角色
    - `PASEO_HARNESS_PROFILE`: 对应的 `~/.agents/profiles/<role>.json` 路径
    - `LAZY_TOOL_CONFIG`: 对应的 `~/.config/lazy-tool/profiles/<slice>.yaml` 路径（若调用方尚未显式指定 `LAZY_TOOL_CONFIG`）
  - 从自动路由矩阵中移除 `antigravity`（当 `provider === "antigravity"` 时原样透传，不做自动模型改写），并补充 `pi` 的映射支持。
- **补齐 SDLC 全角色画像与 lazy-tool 索引**：
  - 在 `~/.agents/profiles/` 下补齐 `backend-specialist.json`、`architect.json`、`qa-gatekeeper.json`、`security-review.json`。
  - 在 `~/.config/lazy-tool/profiles/` 下补齐 `pm.yaml`，并预热生成 `ui.db` 与 `pm.db` 索引。
  - 将 `ui-ux-pro-max` 与 `pm-*` 同步链接至 `~/.claude/skills/`。

## Capabilities

### New Capabilities

- `agent-harness/capability-harness`: 在 Paseo 创建与打开 Agent 会话时，根据 `labels.role` 或任务意图动态识别专家角色，并在 `agent.open.before` 阶段注入 `LAZY_TOOL_CONFIG` 与 `PASEO_HARNESS_*` 环境变量，同时豁免 `antigravity` 冷备通道。

### Modified Capabilities

<!-- 无破坏性变更 -->

## Impact

- `plugin-custom/agent-harness`:
  - `shared/types.ts`: 新增 `DomainRole`、`HarnessDecision` 类型定义。
  - `shared/intent-detector.ts`: 新增 `detectDomainRole`、`resolveHarnessEnv` 纯函数；豁免 `antigravity` 自动模型改写。
  - `index.server.ts`: 注册 `agent.open.before` 钩子，缓存创建期角色判定并注入环境变量。
  - `tests/`: 新增针对 `detectDomainRole`、`antigravity` 豁免及 `agent.open.before` 环境变量注入的完整单元测试。
