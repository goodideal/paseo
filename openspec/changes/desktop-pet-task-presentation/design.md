# Design: Desktop Pet 任务呈现与优先级系统

> 完整设计规范见 `docs/superpowers/specs/2026-10-10-desktop-pet-task-presentation-design.md`。

## 1. 优先级分类

- **P0 紧急阻塞 (Urgent Attention)**：`WAITING_DECISION` 状态，置顶展示、倒计时环闪烁、内嵌原地 `[✓ 放行]` / `[✗ 拒绝]` 按钮。
- **P1 活跃推进 (Active Pulse)**：`RUNNING` / `STARTING` 状态，宠物专注打工拟态，微型胶囊指示当前动作，支持一键在 Paseo 中聚焦。
- **P2 静默与战果 (Ambient & Done)**：`IDLE` / `STOPPED` / `ERROR` 状态，折叠为今日完成数，任务结束时触发撒花与经验奖励。

## 2. 界面与交互层级

- **常态 (Ambient)**：透明无边框窗口，桌面桌宠伴随微动，身侧附带灵动状态药丸。
- **紧急态 (Urgent)**：有 P0 任务时，药丸自动变异为紧急干预胶囊，左侧倒计时环、中间高危命令预览、右侧原地审批按钮。
- **展开态 (Flyout HUD)**：点击呼出高密度赛博毛玻璃看板，顶栏等级与 XP 进度条，分区列出 P0 / P1 / P2 任务。

## 3. 双向通信与数据流

- 服务端广播增强快照：包含 `petMood`、`petLevel`、`petXp`、`xpToNextLevel`、任务 `priority` 及 `pendingDecision` 完整时效字段。
- 客户端上行发送 `decision.respond` 与 `agent.focus`，服务端 `actionHandler` 直调对应 Agent 接口并奖励经验。
