# Tasks

## 1. OpenSpec 与插件协议层扩展

- [x] 1.1 创建 `antigravity-background-task-observability` OpenSpec 变更工件并校验格式
- [x] 1.2 在 `packages/plugin/src/server/provider.ts` 新增 `ProviderBackgroundWorkItem`、`session.background_work` 事件类型与 `ProviderEventSchema` 校验分支
- [x] 1.3 在 `packages/server/src/server/agent/plugin-provider.ts` 桥接 `session.background_work` 并在会话关闭/失败时清空后台任务状态

## 2. ACP 运行时映射与 Antigravity 日志 Tail 实现

- [x] 2.1 在 `packages/plugin/src/server/acp.ts` 与 `acp-internal/connection.ts` 实现 `deferTurnOnRunningTools` 后台任务同步与 `observeToolCall` / `updateLiveToolCall` 生命周期管理
- [x] 2.2 新增 `plugins/antigravity-provider/server/background-log-tailer.ts` 并在 `provider.ts` 接入（含路径 containment 校验、2s 节流 `stat`/tail 与 90s 静默分档提示）

## 3. 工作流规范治理与测试验证归档

- [x] 3.1 更新 `~/.agents/rules/capability-harness.md` 与 `~/.agents/skills/gitea/namespaces/gitea-qa/SKILL.md` 中的 `ocr review` 执行约束
- [x] 3.2 补齐 `acp.test.ts`、`plugin-provider.test.ts` 与 `plugins/antigravity-provider/server/provider.test.ts` 单元测试并执行 `npm run build:server`、受影响 Vitest、`typecheck`、`lint`、`format` 与 OpenSpec 归档
