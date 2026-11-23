## Context

Phase 3 为 Paseo `agent-harness` 插件补齐工作区级 `.agents/agent-team.json` 可视化编排面板与服务端同步编译通道，使桌面端与移动端用户均可在 UI 中完成预设初始化、四端目标切换、角色/能力/MCP/守卫裁剪、`bindings` 模型路由定制、`doctor` 体检与产物清理。

## Goals / Non-Goals

- **Goals**:
  1. 以 `WorkspacePanel`（`agent-team-panel`）+ `agent-team.json` `FilePanel` 作为工作区主编辑载体，保持全局 `HarnessSettingsScreen` 通过工作区选择器联动跳转；遵循 `docs/design.md` 与 `unslop`（1 主按钮 + 1 次按钮、Semantic Tokens、零顶栏常驻噪音）。
  2. 保存即通过 `@getpaseo/plugin/server` `execCommand` 调用本机 `synthesizer.synthesize_project` 原子写盘并同步重编译启用的多端产物；缺失编译器时降级为纯 JSON 原子写入并返回明确告警。
  3. 仅作用于当前 `workspaceId` 解析出的 `checkoutRoot`；当关联 Git Worktree 继承主仓清单时显式提示 `inherited_from_main` 并支持一键在当前 Worktree 物化编译，绝不静默改写 `mainRepoRoot`。
  4. 开启角色/能力/MCP 时自动勾选关联依赖，同时尊重用户后续手动取消；保存后实时刷新 `HarnessPopover` 列表但不中断运行中会话。
  5. 通过 `workspaceId` 权限校验、按检出目录排队的进程内互斥锁与保存失败草稿保留保证并发与故障安全性。

- **Non-Goals**:
  1. 不在 UI 内提供任意宿主机路径选择器或手写编辑 `.claude/` / `.codex/` 生成模板正文。
  2. 不修改存量正在运行中或空闲会话的模型与进程环境变量。

## Decisions

- **Workspace-Authorized Directory Resolution**: 所有 `agent_harness.team.*` 服务端 RPC 均通过 `context.paseo.workspaces` 解析已注册工作区目录，经 `resolveWorkspaceRepoRoots` 得到活跃 `checkoutRoot` 与 `mainRepoRoot`，拒绝未注册工作区访问。
- **Exact Form Persistence with Client Auto-Deps**: 自动依赖推导（`requires_mcp` / `requires_guards` / `implies_guards` / `enables_flow`）在前端交互勾选时即时触发并记录提示；保存调用服务端 `synthesize_project` 时按表单最终列表精确合成，确保用户手动裁减不会被强制覆写。
- **Dual-Mode Synthesis Engine**: 优先复用本机 `python3` + `synthesizer.py` 执行完整多端生成、`.git/info/exclude` 维护与 SQLite MCP 缓存索引；无 Python/技能源码环境时以临时文件+重命名原子写入 `.agents/agent-team.json`。

## Risks / Trade-offs

- **客户端长列表渲染与窄屏适配**：角色、能力与 `bindings` 矩阵条目较多时，桌面端采用双区对齐布局，移动端（`layout.compact`）自动折叠为纵向单列与紧凑选择器以保证触控可用性。
