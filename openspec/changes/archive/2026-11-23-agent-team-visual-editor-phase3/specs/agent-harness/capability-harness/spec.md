# Spec Delta

## ADDED Requirements

### Requirement: 工作区 Agent Team 可视化编辑器与多端同步编译 (Workspace Team Visual Editor & Sync Synthesis)

系统 SHALL 在 `agent-harness` 插件注册工作区面板 `agent-team-panel`、`.agents/agent-team.json` 专属 `FilePanel` 及工作区 `Command Center` 入口（不在工作区顶栏新增常驻按钮），并在全局 `HarnessSettingsScreen` 提供工作区选择与跳转入口；保存变更时服务端 SHALL 通过 `agent_harness.team.*` RPC 对当前工作区 `checkoutRoot` 原子写入 `.agents/agent-team.json`（含逐角色 `bindings`）并同步调用 `synthesizer` 编译启用目标（无宿主机编译器时降级为纯 JSON 写入并提示告警），成功后即时刷新 `HarnessPopover` 专家列表且不中断运行中会话。

#### Scenario: Worktree 继承主仓清单时显式提示并仅在当前 Worktree 物化编译

- **WHEN** 关联 Git Worktree 的活跃 `checkoutRoot` 缺失 `.agents/agent-team.json` 而 `mainRepoRoot` 存在该清单
- **THEN** `agent_harness.team.inspect.request` 返回 `manifestState: "inherited_from_main"`
- **AND** 用户在面板修改 `bindings` 或点击保存编译后，仅写入 `<checkoutRoot>/.agents/agent-team.json` 与该 Worktree 本地目标产物，`mainRepoRoot` 保持未修改

#### Scenario: 编辑器按需启用角色自动勾选依赖并保留手动裁剪与未保存草稿

- **WHEN** 用户在编辑器新启用 `be-developer` 或 `data-pg-redis`
- **THEN** 界面自动勾选声明的 `requires_mcp` / `requires_guards` 并展示联动提示
- **AND** 若用户随后手动取消某项依赖，保存按表单最终勾选落盘；若编译返回错误，面板内联展示错误且保持 `tab.setModified(true)` 不清空草稿

### Requirement: 已注册工作区团队 RPC 隔离与互斥保护 (Registered-Workspace AuthZ & Per-Checkout Mutex)

所有工作区团队读写、探测、体检与清理 RPC MUST 仅操作根据已注册 `workspaceId` 解析得到的真实工作区路径（拒绝未知 `workspaceId`），并以 `checkoutRoot` 为粒度串行化并发变更操作；执行 `clean` 操作 MUST 经确认并在默认情况下仅清理受管生成产物而保留 `.agents/agent-team.json`。

#### Scenario: 拒绝未注册 workspaceId 并串行化同一检出目录并发保存

- **WHEN** 客户端传入未在 Paseo 注册的 `workspaceId` 请求 `team.save` 或 `team.clean`
- **THEN** RPC 拒绝请求并抛出明确错误，不访问或修改磁盘文件系统
- **AND** 对同一工作区的并发 `team.save` 请求按检出目录互斥串行执行，避免 `.agents/agent-team.json` 与生成目录竞争损坏
