## Why

Phase 1 与 Phase 2 已建立基于 `.agents/agent-team.json` 的四端编译器（`antigravity` / `claude` / `opencode` / `codex`）及 Paseo `agent-harness` 跨客户端联邦路由，但目前调整工作区团队组成、目标客户端与逐角色模型绑定（`bindings`）仍需手动编辑 JSON 或在终端执行 CLI，且在关联 Git Worktree 下也缺乏直观的状态识别与一键物化编译入口。

## What Changes

- 新增純逻辑层 `shared/team-editor-utils.ts` 与点分命名 RPC 契约（`shared/contracts.ts`）：支持 `agent_harness.team.{inspect,detect,save,doctor,clean}.request` 五组协议及前端依赖联动计算（`requires_mcp` / `requires_guards` / `implies_guards` / `enables_flow`）与缺失建议依赖提示。
- 新增服务端 `server/team-editor-service.ts` 并集成至 `server/rpc-handlers.ts` 与 `index.server.ts`：基于 `workspaceId` 从已注册 Paseo 工作区解析 `checkoutRoot`、按检出目录维护进程内互斥锁（`withCheckoutLock`）、调用本机 `agent_team.py` 合成器同步重编译启用目标（缺失编译器时降级为原子写入 `.agents/agent-team.json`），支持区分 Worktree 继承态（`inherited_from_main`）并严格隔离主仓目录；保存或清理后失效缓存、按需同步 Daemon Profiles，并支持 `doctor` 体检与二次确认 `clean`。
- 新增工作区级可视化编辑器 `client/team-editor-panel.tsx` 与轻量事件总线 `client/team-events.ts`，并集成至 `index.client.tsx`、`client/harness-popover.tsx` 与 `client/settings-screen.tsx`：注册 `WorkspacePanel`（`agent-team-panel`）、`agent-team.json` 专属 `FilePanel` 与工作区 `Command Center` 命令（不增加顶栏常驻按钮）；支持 `tab.setModified` 脏状态提醒、保存失败保留草稿与内联诊断，并在保存后实时刷新 `HarnessPopover` 专家卡片（不中断存量运行中会话）。

## Capabilities

### New Capabilities

- 无新增独立能力域（全部扩展收口于既有的 `agent-harness/capability-harness`）。

### Modified Capabilities

- `agent-harness/capability-harness`：新增工作区 Agent Team 可视化编排面板（`WorkspacePanel` + `FilePanel`）、已注册工作区 `agent_harness.team.*` 服务端 RPC 闭环外围隔离校验与同步多端重编译能力。

## Impact

- 影响文件：
  - `plugin-custom/agent-harness/shared/{contracts,team-editor-utils}.ts`
  - `plugin-custom/agent-harness/server/{agent-team-loader,rpc-handlers,team-editor-service}.ts`
  - `plugin-custom/agent-harness/index.server.ts`
  - `plugin-custom/agent-harness/client/{team-events,team-editor-panel,harness-popover,settings-screen}.tsx`（`team-events.ts`）
  - `plugin-custom/agent-harness/index.client.tsx`
  - `plugin-custom/agent-harness/tests/{config-resolver,server,client}.test.ts`
- 协议兼容性：5 个新增 RPC 均使用点分命名规范，不破坏现有 RPC 与配置 Schema。
