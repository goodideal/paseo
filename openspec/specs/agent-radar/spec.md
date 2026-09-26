# agent-radar Specification

## Purpose

为 Paseo 客户端与守护进程提供非侵入式的智能体态势雷达与看门狗能力，破除多代理长耗时调用的假死黑盒，提供 Superpowers SDD 任务流水线与通用 Agent 树状运行拓扑的可视化路线图跟踪，并在安全边界内自动推进执行与原位结构化呈现阻断决策。

## Requirements

### Requirement: Superpowers SDD 任务流水线自动感知与呈现 (Superpowers SDD Pipeline Roadmap)

当工作区存在 Superpowers 规划与账本时，系统 SHALL 自动解析任务状态、修复轮次、Commit 哈希及裁决记录，并在工作区面板以流水线卡片呈现全景路线图。

#### Scenario: 自动识别 SDD Plan 与 Ledger

- **WHEN** 客户端请求雷达快照且工作区存在 `docs/superpowers/plans/*.md` 与 `.superpowers/sdd/*/ledger.md`
- **THEN** 系统解析并返回 `mode: "superpower"` 快照，包含每个 Task 的完成/进行/修复态（如 `Fix 2/5`）与裁决信息

### Requirement: 通用多 Agent 派生与运行拓扑展示 (Hierarchical Agent Topology Radar)

在非 Superpower 场景或用户切换视图时，系统 SHALL 基于父子标签自动构建主代理与子代理的多代层级树状拓扑，呈现各节点的运行状态与正在执行的工具。

#### Scenario: 呈现父子多代代理拓扑树

- **WHEN** 主代理派生多个子代理或子代理派生孙代理
- **THEN** 客户端工作区面板呈现树状连接关系，展示各节点状态点（running / idle / error）与工具运行耗时

### Requirement: 长耗时工具调用心跳侦测 (In-flight Tool-Call Heartbeat)

当代理处于工具调用执行状态（如 `wait_agent`、耗时测试或编译）超过 15 秒时，系统 SHALL 向客户端推送运行时进度状态事件，并在界面呈现耗时动态。

#### Scenario: 耗时工具调用触发心跳呈现

- **WHEN** 代理的工具调用耗时达到 15 秒且未返回
- **THEN** 系统分发实时进度事件，客户端 Timeline 与雷达节点原位呈现带耗时计数的动态运行状态胶囊

#### Scenario: 工具调用完成后自动收起心跳

- **WHEN** 耗时工具调用执行完成并返回结果
- **THEN** 客户端自动收起或平滑过渡该运行状态胶囊，恢复正常对话流

### Requirement: 托管子代理安全操作自动放行与推进 (Managed Subagent Auto-Propel)

对于由 Paseo 托管的子代理，系统 SHALL 自动放行安全的只读与验证类权限请求，并在回合正常停顿且具有未完结意图时自动发送续跑指令。

#### Scenario: 只读敏感权限自动放行

- **WHEN** 托管子代理请求执行只读命令（如 `git status`、`cat`、`npm test`）
- **THEN** 系统自动响应放行权限（`behavior: allow`），无需用户手动点击批准

#### Scenario: 未完结意图自动续跑

- **WHEN** 托管子代理回合结束且输出包含未完成待办项或继续询问
- **THEN** 系统在当前会话配额内（默认最多 5 轮）自动发送续跑消息，推动下一轮执行

### Requirement: 阻断决策卡片与交互式原位操作 (Blocker Escalation & In-situ Decision Card)

当子代理发生真实报错、并发线程超限、连续两轮相同错误或达到自动续跑上限时，系统 SHALL 截停自动推进，生成结构化决策卡片并在客户端 Timeline 及雷达故障节点原位提供快捷动作按钮。

#### Scenario: 并发线程超限结构化上报

- **WHEN** 代理派生触发 `agent thread limit reached` 报错
- **THEN** 系统生成包含阻断根因分析与清理重试选项（A/B/C）的决策卡片，客户端提供一键操作按钮并在雷达节点原位展示

#### Scenario: 用户一键执行决策动作

- **WHEN** 用户点击决策卡片上的操作按钮（如“执行选项 A”）
- **THEN** 客户端通过 RPC 将选定决策下发至服务端，服务端注入对应指令并恢复代理推进
