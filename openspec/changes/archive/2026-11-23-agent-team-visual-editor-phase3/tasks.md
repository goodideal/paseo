# Tasks

## 1. OpenSpec 与核心契约定义

- [x] 1.1 创建并严格校验 `agent-team-visual-editor-phase3` OpenSpec 变更包
- [x] 1.2 实现 `shared/team-editor-utils.ts` 纯依赖联动工具，并在 `shared/contracts.ts` 新增 5 组 `agent_harness.team.*` 点分命名 RPC 契约

## 2. 服务端编排服务与缓存刷新 (`plugin-custom/agent-harness/server/`)

- [x] 2.1 实现 `server/team-editor-service.ts`（工作区路径解析、每检出目录 FIFO 互斥锁、catalog/preset 加载、detect/save/doctor/clean 与无编译器原子写盘降级）
- [x] 2.2 更新 `server/agent-team-loader.ts`、`server/rpc-handlers.ts` 与 `index.server.ts` 注册 `team.*` RPC 并联动失效缓存与 Daemon Profiles 同步

## 3. 客户端可视化编辑器与入口集成 (`plugin-custom/agent-harness/client/`)

- [x] 3.1 实现 `client/team-events.ts` 与 `client/team-editor-panel.tsx`（含缺失初始化引导、Worktree 继承态提示、双区拓扑/绑定编辑、1 主+1 次操作条、Doctor 结果、Clean 确认框与 FilePanel 原始 JSON 预览）
- [x] 3.2 更新 `client/harness-popover.tsx`、`client/settings-screen.tsx` 与 `index.client.tsx` 挂载 WorkspacePanel、FilePanel、Command Center 命令与保存后实时刷新

## 4. 单元测试、双重质量门禁与归档

- [x] 4.1 扩展 `tests/config-resolver.test.ts`、`tests/server.test.ts` 与 `tests/client.test.ts` 覆盖纯依赖计算、Worktree 隔离、真机 Python 编译/清理 fallback、互斥锁与 UI 交互
- [x] 4.2 运行全部 Vitest、`tsc`、全仓 `typecheck`、`oxlint`、`paseo plugin reload`，完成 `code-reviewer` 与 `ocr review` 双重门禁审查并归档 OpenSpec
