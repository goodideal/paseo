# Spec Delta

## ADDED Requirements

### Requirement: Plugin Provider Background Work Events

`@getpaseo/plugin` 的 `ProviderEvent` 与 `ProviderEventSchema` SHALL 支持 `session.background_work` 事件以传递当前会话活跃后台任务列表（或 `null` 清空状态），且 `PluginAgentSession` SHALL 将该事件桥接为 `AgentStreamEvent` 的 `background_work` 事件并在会话关闭或失败时自动清空后台任务列表。

#### Scenario: 插件会话上报与清空后台任务

- **WHEN** 插件 Provider 通过 `ProviderConnection` 发射 `session.background_work` 事件携带 `items` 列表
- **THEN** `ProviderEventSchema` 校验通过，`PluginAgentSession` 将其翻译为 `{ type: "background_work", provider, items }` 供 `AgentBackgroundWorkStore` 更新状态
- **AND** 当会话触发 `session.closed`、`session.runtime_failed` 或 `close()` 时，服务端 SHALL 发射 `items: null` 清理残余后台任务

### Requirement: ACP Deferred Tool Background Work Reporting and Live Observation

启用 `deferTurnOnRunningTools` 的 ACP Provider 运行时 SHALL 在回合进入 deferred 等待或运行中阻塞工具触发后台观测时通过 `session.background_work` 暴露当前未结束的阻塞工具清单（固定 `canStop: false`），并提供 `AcpTransformer.observeToolCall` 生命周期钩子以允许 Provider 为运行中工具推送节流的 `detail` 与 `backgroundDescription` 更新；工具进入终态或会话终止后，运行时 MUST 立即注销观察器并禁止覆盖终态输出。

#### Scenario: Deferred 工具触发后台胶囊上报并在完成后清除

- **WHEN** 启用 `deferTurnOnRunningTools` 的 ACP 会话在 `end_turn` 后仍有 qualifying tool 处于 `in_progress` 状态
- **THEN** `AcpRuntime` 发射包含该工具信息的 `session.background_work` 事件（`canStop: false`）
- **AND** 当该工具通过 `tool_call_update` 进入 `completed` 状态时，运行时停止其 `observeToolCall` 清理句柄并发射空列表清除胶囊展示

#### Scenario: 拒绝在工具进入终态后回写预览输出

- **WHEN** `observeToolCall` 持有的异步任务在工具已完成并更新 `rawOutput` 后尝试调用 `updateToolCall`
- **THEN** `AcpRuntime` 忽略该延迟补丁，不向时间线发射新的 `timeline.item` 覆盖终态输出

### Requirement: Antigravity Background Task Log Tailing and Silence Detection

`antigravity-provider` SHALL 为运行中的非 Daemon `run_command` 工具挂载本地后台任务日志观察器，在运行超过初始阈值后按会话 ID 从 `.system_generated/logs/transcript.jsonl` 定位所属 `.system_generated/tasks/task-<step>.log`，并周期性以单行状态头与尾部日志片段刷新 `Shell` 工具卡片的 `detail.output` 及低频静默分档描述；所有解析路径 MUST 严格限制在当前会话 `.system_generated/tasks/` 目录内。

#### Scenario: 绑定本地任务日志并识别静默超时

- **WHEN** Antigravity 的非 Daemon `run_command` 保持 `in_progress` 超过初始延迟且 `transcript.jsonl` 存在对应 `RUNNING` 记录
- **THEN** 观察器绑定合法路径的 `task-<step>.log` 并向 `Shell` 工具更新包含 `[后台运行中 · 已耗时 ... · 最近输出 ...前]` 状态头及尾部日志的 `detail.output`
- **AND** 当日志文件超过静默阈值未发生字节增长时，状态头与 `backgroundDescription` 切换为 `静默` 分档提示；若解析路径越界当前会话 `tasks` 目录，观察器 MUST 拒绝读取该文件
