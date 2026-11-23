# Paseo Custom Plugins 兼容性与运行指南

本目录仅保留 3 个正交的本地定制插件，避免功能重叠与后台子进程开销。

## 插件清单与扩展点 (Active Custom Plugins)

| 插件目录 (`id`)      | 核心职责                                                | 核心扩展点 (Extension Points)                                                                                                                                                                                                                              | 说明                                                                                                                                                       |
| :------------------- | :------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`agent-harness`**  | 角色路由、模型矩阵、Team 编排与只读命令自动审批         | `addWorkspacePanel`<br>`addFilePanel`<br>`addTimelineRenderer`<br>`addComposerPill`<br>`addSettingsScreen`<br>`addCommandCenterItem`<br>`addHook` (`workspace.create.before`, `agent.create.*`, `agent.open.before`, `agent.permission.*`, `agent.turn.*`) | 动态按任务领域切换模型档位与 `LAZY_TOOL_CONFIG` 切片，并提供 `.agents/agent-team.json` 可视化配置与角色交接工具 `harness_handoff`。                        |
| **`quick-tools`**    | 快捷提示词、快捷操作、快捷查看与工作区自动标签          | `addComposerPill`<br>`addComposerItem`<br>`addSettingsScreen`<br>`addCommandCenterItem`<br>`addSlashCommand`<br>`addHook` (`workspace.create.after`)                                                                                                       | 聚合日常高频快捷能力：在运行中与草稿输入框中提供快捷提示词搜索、AI 推荐与 `/shortcut` 快速下发，并自动为 Local / Worktree 工作区维护 `Local` / `WT` 标签。 |
| **`gitea-workflow`** | Gitea Issue 自动接单、进程内 DAG 编排与双阶段审批工作台 | `addWorkspacePanel`<br>`addCommandCenterItem`<br>`addSettingsScreen`<br>内嵌 `workflow-engine` 运行时                                                                                                                                                      | 集成原 `workflow-runs` 的 DAG 调度与状态机至单进程内，提供统一工作台面板切换「DAG 工作流」与「审查卡片」。                                                 |

## 开发与维护规则 (Development Rules)

1. **组件传递函数化包装 (Component Wrapping)**：插件导出给 Paseo 扩展槽的组件（`Component`）统一使用函数包裹（如 `(props) => <MyComponent {...props} />`），避免部分客户端将 `React.memo` / `React.forwardRef` 误判为非组件。
2. **移动端与运行时边界**：客户端代码仅使用 React Native 原语与 `theme.colors.*`，严禁导入 `server/` 或 Node 内置模块；服务端与共享契约保持纯正边界。
3. **热重载生效**：修改本地插件后运行 `npm run typecheck` 并执行 `paseo plugin reload <id>`，禁止直接重启 `6767` 端口主 Daemon。
