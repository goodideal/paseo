## Purpose

为 Paseo 客户端与守护进程提供非侵入式的子代理看门狗能力，破除多代理长耗时调用的假死黑盒，并在安全边界内自动推进执行与结构化呈现阻断决策。

## ADDED Requirements

### Requirement: 长耗时工具调用心跳侦测 (In-flight Tool-Call Heartbeat)

当代理处于工具调用执行状态（如 `wait_agent`、耗时测试或编译）超过 15 秒时，系统 SHALL 向客户端推送运行时进度状态事件，并在界面呈现耗时动态。

#### Scenario: 耗时工具调用触发心跳呈现

- **WHEN** 代理的工具调用耗时达到 15 秒且未返回
- **THEN** 系统分发实时进度事件，客户端 Timeline 呈现带耗时计数的动态运行状态胶囊

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

### Requirement: 阻断决策卡片与交互式操作 (Blocker Escalation & Actionable Card)

当子代理发生真实报错、并发线程超限、连续两轮相同错误或达到自动续跑上限时，系统 SHALL 截停自动推进，生成结构化决策卡片并在客户端提供快捷动作按钮。

#### Scenario: 并发线程超限结构化上报

- **WHEN** 代理派生触发 `agent thread limit reached` 报错
- **THEN** 系统生成包含阻断根因分析与清理重试选项（A/B/C）的决策卡片，客户端提供一键操作按钮

#### Scenario: 用户一键执行决策动作

- **WHEN** 用户点击决策卡片上的操作按钮（如“执行选项 A”）
- **THEN** 客户端通过 RPC 将选定决策下发至服务端，服务端注入对应指令并恢复代理推进
