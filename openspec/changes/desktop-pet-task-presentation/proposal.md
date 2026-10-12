# Proposal: Desktop Pet 任务呈现与优先级系统

## 1. 问题与动机 (Why)

当前 Paseo `desktop-pet` 插件在桌面伴侣端的任务呈现极为生硬呆板：

- 展开面板为纯文本方块，缺乏视觉层级；
- 阻塞性高危权限审批（`WAITING_DECISION`）与普通后台任务平级混排，无优先级区分；
- 缺乏原地轻量干预手段，用户看到倒计时无法原地放行/拒绝，必须切回主控制台；
- 任务执行与桌宠行为动作割裂，等级与 XP 缺乏桌面可视化。

## 2. 解决方案 (What)

- 确立 **P0（阻断审批） > P1（运行中） > P2（待命/已完成）** 三级优先级模型；
- 打造 **常态（灵动药丸） + 紧急态（P0 倒计时警报胶囊） + 展开态（赛博毛玻璃 HUD）** 三级微交互结构；
- 扩展双向 WebSocket 通信通道，支持原地 `decision.respond` 一键审批与 `agent.focus` 聚焦；
- 将宠物宏观情绪、动作拟态、XP 经验条与提示音效深度绑定。

## 3. 影响范围 (Scope & Blast Radius)

- `plugins/desktop-pet/shared/types.ts`
- `plugins/desktop-pet/server/agent-projection.ts`
- `plugins/desktop-pet/server/companion-service.ts`
- `plugins/desktop-pet/index.server.ts`
- `plugins/desktop-pet/companion-desktop/src/index.html` & `companion-client.ts`
- `plugins/desktop-pet/tests/` 单元测试与集成测试
