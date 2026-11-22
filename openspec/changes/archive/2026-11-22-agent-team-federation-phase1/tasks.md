# Tasks

## 1. Python 清单与服务端装载层实现

- [x] 1.1 更新 `agent-team` Python 脚本 `runtime_env.py`、`agent_team.py` 与文档 `manifest-schema.md`，支持 `bindings` 透传保留并通过校验脚本验证
- [x] 1.2 新增服务端 `plugin-custom/agent-harness/server/agent-team-loader.ts`，实现 Git Checkout / Worktree 主仓溯源、Mtime 缓存、`catalog.json` 读取与 `<role>.md` Frontmatter 剥离及占位符展开

## 2. 共享契约、协同避让与防递归边界

- [x] 2.1 更新 `shared/{types.ts,lifecycle-state.ts,contracts.ts,config-resolver.ts,intent-detector.ts}`：增加 `AgentTeamSummary`、`readonly` 与 `HARNESS_LEAF_*` 常量、Worktree N 角色替换、Antigravity 3 行 Federation Bridge 与 `LAZY_TOOL_CONFIG` 条件跳过
- [x] 2.2 更新 `index.server.ts`、`server/handoff-tool.ts` 与 `server/rpc-handlers.ts`：透传 `cwd` 到有效配置、为 `harness_handoff` 子会话写入叶子标记并隐藏 `harness_handoff` 工具、强化只读 `modeId="plan"` 并在环境巡检 RPC 返回 `agentTeam` 摘要

## 3. 客户端动态 Popover 与设置状态适配

- [x] 3.1 更新 `client/{metadata-utils.ts,harness-popover.tsx,settings-screen.tsx}`：实现基于 `harnessEffectiveConfigRpc` 的工作区 N 角色可滚动卡片（含 `RO` 标记与绑定目标显示），并在设置环境卡片展示激活的 Workspace Agent Team 状态

## 4. 测试覆盖、双审查门禁与 OpenSpec 归档

- [x] 4.1 补充 `tests/{config-resolver,server,client}.test.ts` 单测与集成测试，运行全套插件测试、`tsc`、工作区 `typecheck`、`lint` 与 `paseo plugin reload agent-harness` 验证全绿
- [x] 4.2 导出 `phase1.patch`，完成 `code-reviewer`（`Model: "pro"`）双轴审批与本地 `ocr` 扫描无阻塞缺陷，并同步 `openspec/specs/agent-harness/capability-harness/spec.md` 后归档本变更
