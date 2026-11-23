## 架构与数据流

```
AcpRuntime (deferTurnOnRunningTools)
  ├── liveOpenToolIds + observeToolCall() ──▶ antigravity-provider/background-log-tailer.ts
  │                                               │ (每 2s stat, 读取 <=16KB/120行 + 状态头)
  │                                               ▼
  ├── updateLiveToolCall(toolCallId, patch) ◀─────┘
  │     ├── patch.detail ──▶ ProviderEvent(timeline.item) ──▶ ShellDetailSection (detail.output)
  │     └── patch.backgroundDescription + liveOpenToolIds
  │            └──▶ ProviderEvent(session.background_work)
  │                   └──▶ PluginAgentSession.translate()
  │                          └──▶ AgentStreamEvent(background_work)
  │                                 └──▶ AgentBackgroundWorkStore ──▶ BackgroundWorkTrack
  └── 工具进入 completed/failed 或会话退出 ──▶ stopToolObservers() + 发射 items: [] / null
```

## 核心设计决策

### 1. 插件边界扩展：`session.background_work`

- 在 `packages/plugin/src/server/provider.ts` 定义 `ProviderBackgroundWorkItem`（`id`, `kind`, `description`, `command?`, `canStop?`），并在 `ProviderEvent` 与 `ProviderEventSchema` 增加 `session.background_work`（`items: ProviderBackgroundWorkItem[] | null`）。
- 不新增单独的 `ProviderCapability` 门槛，复用既有 `AgentBackgroundWorkStore` 通道；`PluginAgentSession` 在 `translate()` 透传该事件，并在 `session.closed`、`session.runtime_failed` 与 `close()` 时向管理器发射 `items: null` 确保清理残留。

### 2. ACP Deferred Tool 与 `observeToolCall` 钩子

- 在 `AcpRuntime` 中由 `liveOpenToolIds` 与 `toolKeepsTurnOpen` 维护唯一状态真理源：仅当配置了 `deferTurnOnRunningTools` 且存在 deferred 回合或活动工具附带了 `toolBackgroundDescriptions`（或此前发过非空列表需要清空）时，发射 `session.background_work`（`canStop: false`），避免普通短命令在 `end_turn` 前闪现胶囊。
- 当 `reduceToolCall` 首次观察到非 replay 窗口内的运行中工具时，调用 `transformer.observeToolCall(snapshot, context)` 并登记清理函数；在工具转为 `completed` / `failed`、回合取消或 `settlePendingWork` 时统一执行清理。
- `updateLiveToolCall` 仅在 `liveOpenToolIds.has(toolCallId)` 且当前工具仍处于 `pending` / `in_progress` 时生效，杜绝终态回写覆盖 ACP 最终 `rawOutput`。

### 3. Antigravity 后台日志安全绑定与节流刷新

- **触发阈值**：仅对 `name === "run_command"` 且 `IsDaemon !== true` 的运行中工具，在持续运行超过 `initialDelayMs`（默认 `2_000` ms）后启动 2s 轮询。
- **日志定位与安全边界**：校验 `nativeSessionId` 为合法标识符（`/^[a-zA-Z0-9_-]+$/`），读取 `<brainRootDir>/<nativeSessionId>/.system_generated/logs/transcript.jsonl` 尾部最多 64 KB，从底向上匹配处于 `RUNNING` 态（或提示运行为后台任务）且 `Task Description` 匹配目标 `CommandLine` 的 `GENERIC` 记录，提取 `task-<step>.log` 路径后执行 `path.resolve` containment 校验，确保目标严格位于 `<brainRootDir>/<nativeSessionId>/.system_generated/tasks/` 目录内且扩展名为 `.log`；未命中或文件未落盘时静默降级，仅维持耗时与描述更新。
- **节流与静默分档**：每 2s 仅执行轻量 `stat`；仅当文件 `size` 增长或静默分档（`< 90s` 为 `活跃`，`>= 90s` 为 `静默 90s+`、`静默 2m+` 等整分钟档位）发生切换时，读取尾部最多 16 KB / 120 行并拼接单行中文状态头刷新 `detail.output`，避免高频 IPC 与 WebSocket 广播。

### 4. OCR 门禁治理

- 通过全局规则与 Gitea QA 技能明确：`ocr review` 禁止在单条后台命令中用 `;` / `&&` 串行多组；后台运行时禁止传入全缓冲 stdout 的 `--audience agent`；默认采用 `--effort low --timeout 20 --concurrency 2`，每组聚焦核心源码 ≤ 5 个文件，超时或上下文超限立即缩容或汇报阻塞。
