## Context

参见 `proposal.md` 与已完成审查的设计文档 `docs/superpowers/specs/2026-09-26-subagent-watchdog-plugin-design.md`。
Paseo 拥有基于 `@getpaseo/plugin` 的插件体系，服务端运行在隔离子进程中，客户端运行在 React Native / Web 环境。插件可通过 `PluginServerContext` 监听生命周期与底层事件，并通过 `PluginClientContribution` 在 Timeline 和面板中注入 UI。

## Goals / Non-Goals

**Goals:**

- 实现纯非侵入式的 `plugins/subagent-watchdog` 插件，零改动 Paseo 核心代码；
- 提供长耗时 Tool-call（如 `wait_agent`）超过 15 秒时的动态心跳与运行时感知，消除假死黑盒；
- 对 Paseo 托管子代理提供安全的只读命令自动放行及未完结意图（`- [ ]`）自动续推，默认上限 5 轮；
- 当检测到真实报错、并发线程超限（`thread limit reached`）或连续两轮相同错误时，生成结构化决策卡片并在前端提供一键快捷操作按钮；
- 严格遵循 Paseo UI 规范（严禁 `useUnistyles()`，遵循 `docs/hover.md` 跨端交互规范）。

**Non-Goals:**

- 不尝试在 Paseo 插件层物理干预或强杀 Provider（如 Codex/Claude）内部原生的线程/协程；
- 不在初版引入昂贵的外挂 AI 大模型进行文本判定，采用高确定性结构化特征与模式匹配。

## Decisions

### 1. 双轨分层治理 (Dual-Track Governance)

- **决策**：将子代理清晰划分为 Paseo Managed Subagent 与 Provider Native Subagent。
- **理由**：审查表明 Paseo 无法直接操作 Provider 内部线程。对托管子代理采用原生 API 调控；对 Provider 原生子代理采用 Stream 级状态监控 + 注入提示词/决策卡片引导。
- **替代方案**：尝试直接从 Daemon 外部 kill 线程，被证实架构上不可行且极具破坏性。

### 2. Stream 级而非 Turn 级监听 (Stream-Level Observation)

- **决策**：废弃单纯依赖 `agent.turn_ended`，改为订阅 `observeEvents(["agent_stream", "agent.provider_subagents.update"])`。
- **理由**：当代理调用长耗时工具（如 `wait_agent` 300s）时，当前 Turn 并未结束。只有 Stream 级监听才能捕获 `tool_call` 的真实耗时并向前端推送进度心跳。

### 3. 严格遵循 Paseo UI 架构规范

- **决策**：卡片样式采用 `StyleSheet.create` 配合主题 tokens，悬停交互采用 `isHovered || isNative || isCompact`。
- **理由**：`docs/unistyles.md` 严禁 `useUnistyles()`；`docs/hover.md` 规定 iOS 原生不支持 pointer 事件，必须使用标准规范防崩溃。

## Risks / Trade-offs

- [Risk: 自动续跑陷入死循环消耗 Token] → **Mitigation**: 引入双重熔断器：单任务连续自动续跑限制为 5 轮；防震荡算法比对最近两轮输出指纹，相同即刻熔断。
- [Risk: 客户端离线期间错过状态同步] → **Mitigation**: 核心调控器全部运行在 Node.js 服务端，决策卡片作为持久化消息写入 Timeline，客户端重新连接后自动全量对齐。
