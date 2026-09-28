# Evolution Timeline & Subagents Observability Specification & Design

## 1. Executive Summary & Problem Statement

在 Paseo 的 Agent Radar（演进大盘 / Workspace Reader）中，**任务与演进脉络流（Evolution Timeline）** 是开发者纵览工作区中各智能体接力演进与协作全景的核心视窗。然而，当前实现存在以下显著问题：

1. **时间轴排序倒挂**：当前时间轴为正序排列（最早创建的智能体在顶部，最新的在底部）。用户进入大盘后无法第一时间获悉当前正在推进的阶段，违背了监控大盘（Radar/Dashboard）的视觉认知模型。
2. **根任务与子代理层级扁平混杂**：服务端 `WorkspaceEvolutionService` 未区分主 Agent（Root Agent）与派生的子 Agent（Subagent），导致子任务被扁平当做顶层独立阶段渲染；同时 Provider 原生子代理（如 Claude Code Sidechains、Pi 扩展子会话）未被聚合呈现。
3. **子代理运作缺乏观测与穿透**：阶段卡片内部无法获知派生了多少子任务、子任务当前的运行状态（执行中、等待授权、失败）、耗时以及底层工具调用进度，缺乏直达子会话的穿透链路。
4. **缺乏运行态就地控制动作**：面对卡死、跑偏或报错的子代理，用户无法在大盘内执行**中断（Interrupt）**、**带提示词重试（Promptable In-session Retry 1+3）** 或 **归档（Archive / Bulk Archive）**，必须进入底层控制台或手动处理。

本项目旨在重塑时间轴的视觉流向与层级架构，确立**“时间轴倒序（最新在顶）+ 卡片内响应式嵌套折叠子代理 + 运行时可控操作（中断 / 1+3 重试 / 归档）”**的一体化体验。

---

## 2. Architecture & Data Flow (混合响应式架构)

采用 **Hybrid Reactive Architecture（混合响应式架构）**：

- **服务端（Server）**：轻量化收敛为工作区主阶段（Root Milestones）的归纳与倒序排序，负责阶段级持久化快照。
- **客户端（Client）**：通过 `useSubagentsForParent` 响应式 Store 实时聚合主阶段下的所有子代理（Paseo Managed Subagents + Provider Subagents），支持零延迟状态反映与就地操作。

```text
[Daemon / Server: WorkspaceEvolutionService]
  ├─ 过滤: 仅收敛 Root Agent (!labels["paseo.parent-agent-id"])
  ├─ 倒序: 按 createdAt 降序排列 (最新在索引 0)
  └─ 持久化: ~/.paseo/cache/workspace-evolution/<wks_id>/digest.json
       ▲
       │ WebSocket RPC (`workspace.evolution.get_digest`)
       ▼
[Client / UI: EvolutionTimeline]
  └─ MilestoneCard (主阶段卡片，顶部为最新/当前阶段)
       │
       ├─ [Client Reactive Store: useSubagentsForParent]
       │    ├─ useSessionStore (Paseo Managed Subagents)
       │    └─ useProviderSubagentStore (Claude / Pi Provider Subagents)
       │
       └─ Nested Subagents Section (内联折叠子任务流)
            ├─ 观测展示: 状态、耗时、任务简述、穿透导航 (`openTab`)
            └─ 就地操作:
                 ├─ 运行中 -> [中断 (Interrupt)]: client.cancelAgent()
                 ├─ 失败/异常 -> [重试 (Promptable Retry)]: 弹出内联输入条 -> client.sendMessage()
                 └─ 已完成 -> [单行归档 / 批量归档]: client.archiveAgent()
```

---

## 3. Detailed Specifications

### 3.1 时间轴流向与节点呈现 (`EvolutionTimeline`)

1. **排序规则**：
   - 服务端在 `rebuildDigest` 中对 `workspaceAgents` 采用降序排列：
     ```ts
     workspaceAgents.sort(
       (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
     );
     ```
   - 过滤条件：排除包含父级引用的 Agent，确保仅根 Agent 进入主脉络流：
     ```ts
     const isRoot = !agent.labels?.[PARENT_AGENT_ID_LABEL] && !agent.parentAgentId;
     ```
2. **视觉主干 (Visual Stem)**：
   - 顶部节点为**最新阶段（Stage N）**。若处于 `running` 状态，节点展示脉冲呼吸蓝光动画，卡片标头高亮“🎯 当前推进阶段”。
   - 垂直连接线从顶部向下延伸至历史阶段（Stage N-1 $\to$ Stage 1）。
   - 卡片右上角展示相对时间标识（如 `刚刚`、`3 分钟前`、`昨天 17:20`）。

### 3.2 子代理嵌套与运行态观测 (`MilestoneCard`)

1. **数据接入与响应式监听**：
   - 在卡片内调用 `useSubagentsForParent({ serverId, parentAgentId: milestone.agentId })`，实时合并返回 `SubagentRow[]`。
2. **智能折叠控制 (Smart Expand/Collapse)**：
   - 初始折叠状态策略：
     - 若存在 `running`、`requiresAttention` 或 `failed/error` 的子代理，**默认自动展开**，暴露运行态与风险。
     - 若子代理列表全部为 `completed` 或 `idle`，**默认收起**，卡片保持紧凑。
   - 折叠头部展示状态汇总徽章：
     - `子任务流 (N) · X 执行中 · Y 异常 · Z 已完成`。
3. **子代理卡片行指标**：
   - **Provider 图标**：展示对应 Provider 专有图标（Claude / Codex / OpenCode / Pi 等）。
   - **任务描述**：展示分配的子任务意图（`description` 或 `title`）。
   - **运行状态指示器**：
     - `running`：蓝色 Loader + 动态耗时（如 `32s`）。
     - `requiresAttention`：黄色感叹号预警，提示等待确认。
     - `error / failed`：红色错误标签。
     - `completed / idle`：绿色对勾标签与总耗时。
   - **穿透直达**：点击整行，根据子代理类型（`paseo` 或 `provider`）调用 `openTab` 打开独立对话面板。

### 3.3 子代理交互控制动作 (Actions & Operations)

1. **中断操作 (Interrupt / Cancel)**：
   - 仅对 `running` 状态的子代理展现红色停止按钮。
   - 触发时调用 `client.cancelAgent(subagentId)`，阻断子任务继续消耗 Token 与系统资源。
2. **1+3 带提示词重试 (Promptable In-session Retry)**：
   - 仅对 `error` / `failed` 状态的子代理展现蓝色重试按钮。
   - **交互行为**：
     1. 点击重试按钮后，子代理行下方展开内联输入条（Inline Input Bar）。
     2. 默认填充引导词：`"请分析刚才执行失败的原因，调整方案并重新尝试完成任务。"`。
     3. 用户可直接回车确认，或编辑自定义排错提示词。
     4. 点击发送后调用 `client.sendMessage(subagentId, customPrompt)` 唤醒原子代理会话继续推进，输入条平滑收起。
3. **归档与批量清理 (Archive & Bulk Archive)**：
   - **单行归档**：在已结束的子代理行右侧提供归档按钮，弹出确认提示后调用 `client.archiveAgent(subagentId)`。
   - **批量归档**：在子任务折叠栏头部右侧提供“一键清理已结束子代理”，批量清理该主阶段下所有已完结子任务。

---

## 4. Error Handling & Edge Cases

1. **子代理会话已销毁/离线**：重试或中断时若客户端连接断开或会话不存在，通过全局 Toast 友好提示错误原因，不破坏大盘状态。
2. **跨平台兼容**：内联输入框在移动端（iOS / Android）收起键盘时保持页面滚动位置稳定，避免跳屏。
3. **无子代理阶段**：对于纯单轮次或未派生子代理的阶段，完全隐藏子任务区块，卡片自然紧凑。

---

## 5. Verification Plan

1. **排序与过滤单元测试**：验证 `WorkspaceEvolutionService` 过滤子代理仅保留根 Agent，且 `milestones` 按创建时间降序排列。
2. **组件渲染与状态测试**：
   - 验证 `EvolutionTimeline` 顶部节点样式与时间标签。
   - 验证 `MilestoneCard` 在存在 `running` 子代理时默认展开，全完成时默认收起。
3. **交互操作端到端验证**：
   - 点击子代理中断按钮，验证 `client.cancelAgent` 成功触发且状态同步切为停止。
   - 点击失败子代理的重试按钮，验证内联提示词输入框展开、输入编辑与 `client.sendMessage` 发送。
   - 验证单行归档与批量归档执行及列表刷新。
