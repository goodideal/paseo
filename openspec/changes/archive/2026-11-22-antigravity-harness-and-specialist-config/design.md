# Design

## Context

`agent-harness` 当前通过 `bypassProviders: ["antigravity"]` 对 Antigravity 采取全量旁路；同时后端虽在 `AgentHarnessSettingsSchema` 与 `harnessInspectEnvironmentRpc` 中定义了 `specialists[].preferredProvider`、`modelOverride`、`providerMappings` 与可用模型列表，但前端 `settings-screen.tsx` 未渲染对应配置 UI。详见 `proposal.md` 的问题定位与影响范围。

## Goals / Non-Goals

**Goals:**

- 以模型正则 `bypassModels`（默认 `^gemini-pro-orchestrator`）精确区分 Antigravity 原生双阶会话与单阶专家会话，实现跨 Hook 生命周期的零遗漏豁免传播。
- 补齐 `settings-screen.tsx` 与 `harness-popover.tsx` 的专家角色、Provider 模型映射、L2 Fallback 与旁路规则配置能力。
- 修复 `general.profileFilename` 写盘覆盖、`syncDaemonAgentProfiles` 模型未映射与重复条目、`pm`/`architect` 后台只读死锁、`orchestrator` 硬编码 `--provider claude` 及 `llmFallbackApplyRole` 空转等缺陷。

**Non-Goals:**

- 不修改 `plugins/antigravity-provider` 核心 ACP 协议实现或 Paseo Daemon 核心框架。
- 不将 `gemini-3*` 系列模型纳入任何默认推荐或预设映射。
- 不将默认各专家的 `preferredProvider` 强行改写（保留在设置 UI 中自由切换，仅修正 `general`/`pm`/`architect`/`orchestrator` 缺陷项）。

## Decisions

### Decision 1: 跨 Hook 传递模型豁免状态

- **问题**：`agent.open.before` 的 `PluginSessionOpenRequest` 中仅携带 `provider`、`metadata`、`labels` 等字段，不包含 `model`。若仅在 `agent.open.before` 判断 `bypassProviders`，无法感知当前会话选用了 `gemini-pro-orchestrator`。
- **方案**：在 `agent.create.before` 命中 `isModelBypassed(config.model, effectiveConfig.bypassModels)` 或 `bypassProviders` 时，向 `metadata` 写入 `agentHarnessBypassed: true`（同时不写入 `agentHarness` 状态键），并同步记录到 `recentCreationContext`（按 `cwd`）与内存集合 `bypassedAgentIds`；后续 `agent.open.before` 与 `agent.turn.*` 任一路径命中该标记即直接原样放行。
- **备选方案与取舍**：曾考虑在 Paseo 主核心 `PluginSessionOpenRequest` 协议中新增 `model` 字段，但会跨包改动 `@getpaseo/plugin` 公共契约，侵入面过大；通过插件自有 `metadata` 与短效上下文缓存传递完全内聚在 `agent-harness` 内即可闭环。

### Decision 2: Settings Schema v2 -> v3 兼容迁移

- **方案**：将 `SETTINGS_SCHEMA_VERSION` 升至 `3`。`migrate` 对旧版配置自动剔除 `bypassProviders` 中的 `"antigravity"`、补全 `bypassModels: ["^gemini-pro-orchestrator"]`、`providerMappings.antigravity` 与 `providerModes.antigravity`、修复 `general.profileFilename === "architect.json"` 冲突及 `pm`/`architect` 的 `defaultModeId: "plan"` 残留、移除旧 `orchestrator` 模板中的 `--provider claude` 硬编码，并在 `llmFallbackEndpoint` 为空时关闭空转的 `llmFallbackEnabled`。
- **考量**：既保持已有用户的自定义配置项不丢失，又确保升级插件后历史存量配置自动自愈。

### Decision 3: Daemon Profile 就地去重同步

- **方案**：`syncDaemonAgentProfiles` 接收 `effectiveConfig`，按 `modelOverride || resolveTargetModelForTier(effectiveConfig, provider, tier)` 计算真实模型，将图标转为 kebab-case，并通过正则 `\brole:\s*<id>\b` 识别既有 `profile_*` 条目就地更新，消除 `profile_*` 与 `harness-*` 双份重复；在 `index.server.ts` 监听 settings 变更且 `autoSyncDaemonAgentProfiles` 为真时触发同步。

### Decision 4: Shared Bundle 纯净化约束

- **约束**：`plugin-custom/agent-harness/shared/*` 会被同时打包进前端 Client Bundle 与后端 Server Bundle，严禁导入任何 `node:*` 原生模块。`isModelBypassed` 复用 `config-resolver.ts` 的纯 JS `compileSafeRegex`。

## Risks / Trade-offs

- **[Risk] Settings v3 迁移可能覆盖用户刻意保留 `antigravity` 到 `bypassProviders` 的偏好** → 仅针对从 `< 3` 版本的首次自动迁移剔除内置默认残留 `"antigravity"`；迁移后用户在 v3 界面中显式重新加入 `"antigravity"` 到 `bypassProviders` 将原样生效。
- **[Risk] Paseo 运行时 `@getpaseo/plugin/client/ui` 组件支持边界** → 本次仅复用已存在于 `@getpaseo/plugin/client/ui` 的 `SettingsSection` / `SettingsCard` / `SettingsRow` / `SettingsSwitch` / `SettingsSelect` / `SettingsInput` / `SettingsAction` / `Icon`，并在 `tests/client.test.ts` 补齐 `SettingsInput` mock 防止测试假绿。
- **[Risk] 热重载前历史 `architect.json` 污染残留** → 在本地实施完成与热重载 `agent-harness` 后，验证 `~/.agents/profiles/architect.json` 与 `general.json` 内容已自动覆写为正确角色。
