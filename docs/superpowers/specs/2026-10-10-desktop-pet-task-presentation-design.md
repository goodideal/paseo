# Desktop Pet 任务呈现与优先级系统设计规范 (Design Spec)

- **创建日期**: 2026-10-10
- **所属模块**: `plugins/desktop-pet`
- **状态**: Approved (待实施)
- **目标**: 重塑 Paseo 桌面挂件宠物的任务呈现机制，引入三级优先级分层、灵动微交互与原地轻量审批（Inline HITL），实现兼具高信息密度与情绪共鸣的赛博开发伴侣体验。

---

## 1. 背景与重构动机 (Context & Motivation)

### 1.1 现状与痛点诊断

目前 `desktop-pet` 插件已具备基础的 Agent 状态订阅、XP 经验计算与伴侣浮窗服务（`CompanionService`）。但在桌面悬浮端，目前的任务呈现存在严重的可用性与审美缺陷：

1. **纯后台 Debug 风格的无情排版**：展开面板（Flyout）仅为黑色方框内堆叠 `<div><b>${taskTitle}</b> [${state}]</div>`，信息冷淡死板，缺乏桌面挂件的美感。
2. **扁平无序，缺乏优先级视觉重心（Flat Hierarchy）**：后台的长期运行任务与即将超时的紧急权限审批（`WAITING_DECISION`）并列显示，无法在一秒内识别阻断性事件。
3. **缺乏即时操作闭环（No Inline Actionable HITL）**：用户看到倒计时却无法在桌面挂件原地“放行”或“拒绝”，必须手动切回 Paseo 主控制台，丧失了桌面悬浮窗“轻量快速干预”的核心价值。
4. **与桌宠的生命力割裂**：多任务执行时宠物没有伴生肢体动作（如专注打字、抱头呼救、撒花庆祝），等级与 XP 数据在桌面端未做可视化落地。

### 1.2 预期成果 (Expected Outcome)

- 引入清晰的 **P0（阻断审批） > P1（运行中） > P2（待命/已完成）** 三级优先级模型；
- 打造 **常态（灵动药丸） + 紧急态（P0 倒计时警报胶囊） + 展开态（赛博毛玻璃 HUD）** 的三级渐进式交互架构；
- 支持在桌面挂件上**一键原地放行/拒绝权限**，以及**一键在 Paseo 主界面聚焦对应 Agent**；
- 建立宠物主情绪、动作拟态、XP 收益与提示音效的端到端联动。

---

## 2. 任务三级优先级模型 (Priority Hierarchy)

所有处于桌面挂件监测范围内的任务，根据其当前状态与风险属性自动映射为以下三级优先级：

| 级别                                    | 业务场景                                                          | 对应 Agent 状态              | 视觉与宠物行为表现                                                                                                          | 处置时限与交互要求                                                                         |
| :-------------------------------------- | :---------------------------------------------------------------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **P0 紧急阻塞**<br>_(Urgent Attention)_ | Agent 触发高危操作，等待人类权限审批（如高危 Bash、敏感文件覆盖） | `WAITING_DECISION`           | 🔴 **最高优先级**<br>• 宠物头顶冒出跳动红色警报或感叹号<br>• 灵动胶囊自动凸显为高亮卡片<br>• 伴随提示音，显示**剩余秒数环** | **必须支持原地极速干预**<br>直接内嵌 `[✓ 放行]` 与 `[✗ 拒绝]` 按钮，倒计时结束前持续预警。 |
| **P1 活跃推进**<br>_(Active Pulse)_     | Agent 正在自主推理、阅读代码、运行构建或执行工具                  | `RUNNING` / `STARTING`       | 🟡 **中优先级**<br>• 宠物进入“专注打字/搬砖”拟态，伴随青绿色荧光环<br>• 灵动药丸显示简写（如 `⚡ auth.ts (02:45)`）         | **感知为主，支持聚焦**<br>显示已运行时长与最近活动，支持一键在 Paseo 主界面定位。          |
| **P2 静默与战果**<br>_(Ambient & Done)_ | Agent 处于空闲、任务已完成或异常结束                              | `IDLE` / `STOPPED` / `ERROR` | ⚪ **低优先级**<br>• 任务完成时触发瞬间庆祝（撒花/+XP飘字）<br>• 常态收纳折叠，仅以统计角标呈现                             | **收拢归档**<br>展开面板中以灰底轻量展示，不主动侵占屏幕焦点。                             |

### 2.1 宠物“主情绪”裁决决策树 (Pet Mood Arbitration)

当多个 Agent 同时存在时，宠物根据以下确定性规则计算当前的宏观情绪：

1. **只要存在任一 P0 任务** $\rightarrow$ 情绪设为 `waiting` 或 `urgent`，气泡与警报强制锚定至**剩余倒计时最短**的 P0 任务；
2. **无 P0 但存在 P1 任务** $\rightarrow$ 情绪设为 `running`（专注搬砖打工态）；
3. **无 P0/P1 但存在 ERROR 任务** $\rightarrow$ 情绪设为 `dizzy`（眩晕/困惑态），提示任务异常；
4. **全为空闲或已停止** $\rightarrow$ 情绪设为 `idle`（伸懒腰或打盹巡逻态）。

---

## 3. 视觉与桌面微交互架构 (Visual & Micro-Interaction Architecture)

悬浮界面采用三级渐进展开结构，保持桌面清爽的同时实现快速操作：

### 3.1 常态：桌面拟态宠物与灵动药丸 (Ambient State)

- **透明无边框窗口**：保持无边框轻巧透明挂件（默认 120×120 画布区，支持向外自然延展）；
- **行为拟态动效**：
  - `running`：宠物桌前出现微缩全息屏，手部快速打字；
  - `idle`：宠物偶尔眨眼、伸懒腰、呼吸微动；
- **灵动药丸 (Dynamic Status Pill)**：
  - 位于宠物上方，深色磨砂亚克力玻璃质感（`rgba(15, 23, 42, 0.85)` + 细微发光边框）；
  - 紧凑展示活跃任务状态，带有呼吸式微光点。

### 3.2 紧急态：P0 原地审批胶囊 (Inline HITL Capsule)

当任意 Agent 触发 `WAITING_DECISION` 时，灵动药丸无需用户点击，主动展开为紧急干预胶囊：

- **倒计时指示**：左侧展示动态 SVG 环形进度条，随剩余秒数递减由黄变红（如 `⏳ 45s`）；
- **操作摘要**：中间清晰展示请求动作与危险评级标签（如 `[Bash] rm -rf dist/`、`HIGH RISK`）；
- **原地双操作按键**：
  - **`[✓ 放行]`（快捷放行）**：绿色微按钮，点击即刻通过 WebSocket 触发审批通过；
  - **`[✗ 拒绝]`（安全拦截）**：红色微按钮，点击即刻拒绝并中止高危动作；
- **声效联动**：伴随 Web Audio 合成器生成的柔和警示提示音，放行成功后播放清脆的愉悦确认音。

### 3.3 展开态：赛博微型毛玻璃 HUD 看板 (Micro-HUD Flyout)

用户点击宠物或药丸时，右侧平滑滑出毛玻璃面板（支持 `-webkit-app-region: no-drag` 正常点击）：

1. **顶栏 (Header)**：
   - 宠物形象与等级徽章（`Lv.X`），当前等级 XP 进度条（如 `340 / 500 XP`）；
   - 快速统计指示器：`1 🚨 阻塞 · 2 ⚒️ 运行中 · 5 🏆 今日完成`；
2. **P0 紧急阻塞区 (Urgent Decisions)**：
   - 红色呼吸边框高亮置顶，展示详细的 Agent 名称、工作区、风险分析（`aiReason`）及原地审批按钮；
3. **P1 活跃任务区 (Active Quests)**：
   - 卡片式排列，展示任务标题、已执行秒数计时器，以及 `[🎯 在 Paseo 中打开]` 快速跳转按钮；
4. **P2 已完成/归档区 (Settled Logs - 默认折叠)**：
   - 折叠展示“今日已完成 X 项”，展开后可查阅最近完成任务及获得的经验奖励（如 `+50 XP`）；
5. **底栏 (Footer)**：
   - `[打开 Paseo 主台]` 快捷入口、`[静音切换]` 与基础设置项。

---

## 4. 双向通信协议与数据流 (IPC & Protocol Design)

### 4.1 数据快照扩展 (`state_update` 广播)

服务端在快照广播中补充等级经验与倒计时信息，以便悬浮端即时渲染：

```json
{
  "type": "state_update",
  "petMood": "waiting",
  "petLevel": 3,
  "petXp": 340,
  "xpToNextLevel": 500,
  "waitingCount": 1,
  "runningCount": 2,
  "stoppedCount": 5,
  "tasks": [
    {
      "agentId": "agent-8f2a",
      "taskTitle": "Fix authentication token refresh bug",
      "state": "WAITING_DECISION",
      "startedAt": 1728555800000,
      "activeDurationMs": 142000,
      "pendingDecision": {
        "requestId": "req-991",
        "actionRequested": "execute_bash: rm -rf .cache && npm run build",
        "riskHint": "high",
        "requestedAt": 1728556000000,
        "timeoutSeconds": 60,
        "expiresAt": 1728556060000
      }
    }
  ]
}
```

### 4.2 客户端上行交互指令 (`companion -> companion-service`)

客户端通过已有建立的 WebSocket 通道回传操作：

1. **原地决策响应 (`decision.respond`)**：
   ```json
   {
     "type": "decision.respond",
     "agentId": "agent-8f2a",
     "requestId": "req-991",
     "behavior": "ALLOW" // 或 "DENY"
   }
   ```
   服务端收到后校验参数并直接调用对应 Agent 的 `respondToPermission` 接口，同时调用 `xpManager.awardManualPrompt()` 增加经验，完成闭环。
2. **在主界面聚焦 Agent (`agent.focus`)**：
   ```json
   {
     "type": "agent.focus",
     "agentId": "agent-8f2a"
   }
   ```
   服务端通过系统命令或宿主 RPC 打开 Paseo 并聚焦至指定 Agent。

---

## 5. 极端场景与容错策略 (Edge Cases & Resilience)

1. **倒计时超时与自动决策竞态 (Timeout Race Condition)**：
   - 若倒计时归零时服务端决策引擎（`DecisionEngine`）已自动裁决，客户端卡片平滑淡出，原地按钮立即变为不可用，防止网络延迟引起的重复操作；
2. **多 P0 任务堆叠 (Multiple P0 Contention)**：
   - 灵动胶囊首选显示剩余倒计时最短的 P0 任务，并带有 `🚨 1/N` 指示；展开 HUD 中 P0 区域完整列出全部待审批卡片；
3. **断网与服务重启保护 (Disconnection & Reconnection)**：
   - 挂件检测到 WebSocket 断开时，冻结本地倒计时，按钮置灰并显示断线提示；启用带指数退避的自动重连（1s $\rightarrow$ 2s $\rightarrow$ 5s）；
4. **XSS 安全防范**：
   - Agent 输出的任务标题与动作描述必须进行严格的 HTML 实体转义或使用 `textContent` 赋值，避免注入漏洞。

---

## 6. 测试与验证策略 (Testing & Verification Strategy)

1. **契约测试 (`tests/contracts.test.ts`)**：
   - 验证扩展后的 `TrackedTask`、`PendingDecision` 及双向 WebSocket 消息格式符合 Zod 架构校验。
2. **服务端动作闭环测试 (`tests/companion-service.test.ts`)**：
   - 建立虚拟 WebSocket 连接发送 `decision.respond`，验证 `actionHandler` 能够正确接收并回调给上层服务。
3. **状态投射与优先级排序测试 (`tests/agent-tracker.test.ts` & `server-integration.test.ts`)**：
   - 模拟多 Agent 混合场景（包含 P0、P1、P2 任务），验证快照中任务排序（P0 始终置顶）及宠物主情绪裁决的准确性。
4. **编译与代码质量检查**：
   - 执行 `npm run typecheck` 与 `npm run lint` 验证整套代码实现无类型漏洞及规范警告。
