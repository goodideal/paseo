# Paseo Custom Plugins 兼容性与运行指南

本目录包含定制与解耦的 Paseo 本地插件。本文档记录各插件在 **Paseo 官方标准版（Official Baseline）** 与 **Custom 特性版（Custom-Features）** 客户端上的兼容支持矩阵与降级行为。

## 客户端兼容性矩阵 (Client Compatibility Matrix)

| 插件目录 (`id`)               | 官方标准版客户端 (Baseline) | Custom 特性版客户端 (Custom) | 核心扩展点 (Extension Points)                                                                           | 降级行为与机制说明                                                                                                                                                               |
| :---------------------------- | :-------------------------: | :--------------------------: | :------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`agent-radar`**             |       ✅ **完全可用**       |       ✅ **完全可用**        | `addWorkspacePanel`<br>`addTimelineRenderer`<br>`addSettingsScreen`<br>`addCommandCenterItem`           | 基于官方标准 API。提供工作区执行雷达、时间线决策卡片及图形化设置界面（配置自动推进、安全权限自动审批、连续轮数上限与心跳探测）。Custom 客户端额外提供移动端和顶层 Tab 快捷入口。 |
| **`gitea-workflow`**          |       ✅ **完全可用**       |       ✅ **完全可用**        | `addWorkspacePanel`                                                                                     | 基于官方标准 API，在工作区与资源管理器（Explorer）面板中均完全一致。                                                                                                             |
| **`visual-crawler-auto-fix`** |       ✅ **完全可用**       |       ✅ **完全可用**        | `addWorkspacePanel`                                                                                     | 基于官方标准 API，工作区面板操作两端完全一致。                                                                                                                                   |
| **`web-inspector`**           |       ✅ **完全可用**       |       ✅ **完全可用**        | `addWorkspacePanel`<br>`addSlashCommand`<br>`addAttachmentSource`<br>`addSettingsScreen`                | 基于官方标准 API，诊断面板、附件源和认证设置页两端完全一致。                                                                                                                     |
| **`quick-prompts`**           |       🟡 **部分可用**       |       ✅ **完全可用**        | `addComposerAccessory` _(Custom)_<br>`addSettingsScreen`<br>`addCommandCenterItem`<br>`addSlashCommand` | **标准版**：支持设置页、命令中心与 Slash 命令（如 `/continue`、`/fix`）。<br>**Custom 专享**：输入框上方实时快捷推荐胶囊栏（依赖 `Composer Accessory` 插槽）。                   |
| **`audio-brief`**             |  ⚪ **静默降级**（不可见）  |       ✅ **完全可用**        | `addTurnAction` _(Custom)_                                                                              | 依赖 Custom 客户端特有的 `Turn Action` 插槽。标准版客户端带有运行时类型守卫，不报错但 UI 上不展示语音播放按钮与卡片。                                                            |

---

## 插件详细扩展与特性说明 (Plugin Details)

### 1. `agent-radar` (Agent 拓扑与执行雷达及 Watchdog 守护)

- **标准版**：
  - 通过面板菜单或命令中心打开工作区面板（`agent-radar-panel`），查看多 Agent 拓扑与 SDD 执行计划。
  - 时间线中正常渲染 `watchdog-blocker` 与 `radar-blocker` 决策卡片（提供 Retry/Pause 等一键操作）。
  - 支持在设置（Settings -> Agent Radar）中图形化配置 Watchdog 守护引擎：开关“自动推进执行（Auto Continue）”、开关“安全只读权限自动审批”、调整“最大连续自动轮数（Max Auto Turns）”与“工具调用心跳探测阈值（Heartbeat Threshold）”。
  - 支持通过命令中心（Command Center，Cmd/Ctrl+K）快速打开配置界面。
- **Custom 版**：享受移动端与侧边栏的专属入口及快捷状态指示。

### 2. `gitea-workflow` (Gitea 任务与双阶段审核)

- **标准版 / Custom 版**：完全一致。工作区面板集成 Gitea PR 检查、分支状态同步与交互式截图画廊。

### 3. `visual-crawler-auto-fix` (UI 视觉爬虫与多 Worktree 自愈)

- **标准版 / Custom 版**：完全一致。工作区面板提供 50~100 步深度的自主爬取、视觉差异检视与跨分支修复看板。

### 4. `web-inspector` (Web 诊断与 CDP 检查器)

- **标准版 / Custom 版**：完全一致。支持 `/inspect` 快捷命令、消息输入框中的网页诊断附件源拾取、以及独立认证配置页。

### 5. `quick-prompts` (层级化快捷提示词引擎)

- **标准版**：
  - 支持在设置（Settings -> Quick Prompts）中配置全局提示词规则。
  - 支持在命令中心（Command Center）检索并打开配置。
  - 支持在输入框中通过全局斜杠命令（如 `/c`、`/test`）快速提交。
- **Custom 版**：
  - 完整呈现输入框上方的实时快捷建议栏（`QuickPromptBar`），支持动态条件匹配（按 Agent 角色、上下文状态高频推荐）与快捷弹窗。

### 6. `audio-brief` (智能回合语音摘要)

- **标准版**：代码中包含 `if (typeof client.addTurnAction === "function")` 检查，旧客户端跳过注册，保持静默，不会导致插件报错。
- **Custom 版**：Assistant 消息气泡底栏展示语音播报按钮（`TurnAudioBriefButton`）及摘要展开卡片（`AudioBriefCard`）。

---

## 开发与维护规则 (Development Rules)

1. **组件传递函数化包装 (Component Wrapping)**：
   插件导出给 Paseo 扩展槽的组件（`Component`）应统一使用标准函数包裹（如 `(props) => <MyComponent {...props} />`），避免旧版本客户端因类型仅允许 `function` 而将 `React.memo` / `React.forwardRef` 误判为非组件。
2. **渐进增强守卫 (Progressive Enhancement)**：
   若使用非官方基线扩展槽（如 `addComposerAccessory`、`addTurnAction`），必须添加 `typeof client.<method> === "function"` 判断，确保插件在标准版客户端上优雅降级而不崩溃。
