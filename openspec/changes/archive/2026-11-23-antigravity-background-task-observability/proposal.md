## Why

当 Antigravity Provider 在 Paseo 中执行长耗时后台命令（例如 `ocr review`、测试或构建）时，由于 `antigravity-provider` 通过 `deferTurnOnRunningTools` 将回合保持在 `running` 态而 ACP v1 不会流式回传后台进程增量输出，Paseo 前端输入栏既不显示 `BackgroundWorkTrack` 后台任务胶囊，时间线上的 `Shell` 卡片在工具结束前也无任何增量日志，导致用户无法区分「后台正常执行」与「进程挂起」，进而在界面发送继续指令引发中断并强杀后台任务。同时，`ocr review` 门禁缺乏单次单组、禁全缓冲参数与超时止损约束，也放大了静默等待窗口。

## What Changes

- **插件协议扩展（`@getpaseo/plugin`）**：在 `packages/plugin/src/server/provider.ts` 新增 `ProviderBackgroundWorkItem` 与 `ProviderEvent` 的 `session.background_work` 事件及 Zod 校验 Schema，零改动 `@getpaseo/protocol` 与 `packages/app`。
- **服务端桥接（`packages/server`）**：在 `packages/server/src/server/agent/plugin-provider.ts` 将 `session.background_work` 翻译为标准 `AgentStreamEvent`（`background_work`），并在会话关闭或运行失败时清理后台任务列表，接入既有的 `AgentBackgroundWorkStore` 与原生 `BackgroundWorkTrack` UI。
- **ACP 运行时统一映射与工具观测钩子（`packages/plugin/src/server/acp.ts` 与 `acp-internal/connection.ts`）**：在启用 `deferTurnOnRunningTools` 时将运行中阻塞工具自动同步为 `session.background_work`（`canStop: false`）；同时在 `AcpTransformer` 预留 `observeToolCall` 生命周期钩子，允许 Provider 向运行中工具推送节流的 `detail` 与 `backgroundDescription` 更新并在工具结束或会话销毁时清理观察器。
- **Antigravity 后台日志实时 Tail 与静默检测（`plugins/antigravity-provider`）**：新增 `background-log-tailer.ts`，在 `run_command`（非 `IsDaemon`）运行超过 2s 后，从当前会话 `transcript.jsonl` 末尾 `RUNNING` 记录按 `CommandLine` 绑定对应的 `.system_generated/tasks/task-<step>.log`（严格校验路径 containment 防穿越），每 2s 通过 `stat` 检查增长，仅在字节增长或静默分档切换时读取尾部最多 16 KB / 120 行并附带单行状态头（`活跃` / `静默 90s+`）更新 `Shell` 卡片 `detail.output` 与低频胶囊描述，工具终态时停止轮询并由 ACP 最终 `rawOutput` 覆盖。
- **OCR 门禁工作流治理（工作区外全局规范）**：同步更新 `~/.agents/rules/capability-harness.md` 与 `~/.agents/skills/gitea/namespaces/gitea-qa/SKILL.md`，禁止单条后台命令串行多组 `ocr review`、禁止后台附加 `--audience agent` 全缓冲输出、规范 `--effort low --timeout 20 --concurrency 2` 与缩容止损边界。

## Capabilities

### New Capabilities

- 无独立新建能力域，全部归入 `provider-management` 规格域。

### Modified Capabilities

- `provider-management`：新增插件 Provider 后台任务上报（`session.background_work`）、ACP Deferred Tool 后台状态映射与运行中工具观测钩子、以及 Antigravity 本地后台任务日志 Tail 与静默状态提示规范。

## Non-Goals

- 不修改 `@getpaseo/protocol` 消息协议与 `packages/app` 前端组件，完全复用既有的 `BackgroundWorkTrack` 与 `ShellDetailSection`。
- 不在 Paseo Stop 按钮或输入框新增二次确认弹窗，也不绕过 ACP 协议单独强杀 Antigravity 后台进程（保持 `canStop: false`）。

## Impact

- 影响范围：`packages/plugin/src/server/{provider,acp}.ts`、`packages/plugin/src/server/acp-internal/connection.ts`、`packages/server/src/server/agent/plugin-provider.ts`、`plugins/antigravity-provider/server/{provider,background-log-tailer}.ts` 及对应单元测试；工作区外同步更新 `~/.agents/rules/capability-harness.md` 与 `~/.agents/skills/gitea/namespaces/gitea-qa/SKILL.md`。
