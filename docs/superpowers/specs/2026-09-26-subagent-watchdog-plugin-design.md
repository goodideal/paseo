# Subagent Watchdog Plugin 设计规范 (Design Spec - v2 Reviewed)

> **Revision Note**: 本规范已通过 `codex/gemini-pro` 架构与技术深度审查，修正了 Provider 原生代理与 Paseo 托管代理的物理边界、Tool 级阻塞流监听、以及严格遵循 Paseo UI 开发红线（禁止 `useUnistyles()`、遵守 `docs/hover.md` 跨端交互规范）。

---

## 一、 背景与根因剖析 (Root Cause Analysis)

在多代理协作开发（Multi-agent Orchestration / SDD）中，代理停滞与黑盒体验的四大物理根因：

1. **Tool-Call 级假死黑盒 (In-flight Tool-Call Silence)**：
   主代理在调用长耗时工具（如 `wait_agent` 或运行大型测试/搜索）时，整个会话处于阻塞状态，**主代理的 Turn 根本没有结束**。传统的 `turn_ended` 钩子在长达数分钟内处于完全失明状态，用户界面无任何心跳与进度。
2. **两类 Subagent 的物理割裂 (Managed vs Provider Native Subagents)**：
   - **Paseo Managed Subagents**：由 `mcp__paseo__create_agent` 创建，注册在 Paseo SQLite `agents` 表中，Paseo 拥有完全的 `archive`/`detach` 生命周期控制权；
   - **Provider Native Subagents**：由底层引擎（如 Codex/Claude 的 `spawn_agent`）自行派生，其并发线程槽位归 Provider 进程所有，Paseo 无法在 Server 层物理强杀其内部线程。
3. **并发撞墙与释放滞后 (Thread Limit Collision)**：
   当 Provider 原生子代理未被显式调用 `close_agent` 时，会遭遇 `collab spawn failed: agent thread limit reached`。
4. **决策分流缺失与频繁点继续 (Unassisted Idle Interruption)**：
   子代理在执行安全命令后交还控制权，或遇到真实阻断时缺乏结构化上下文与可执行动作。

---

## 二、 方案架构：双轨分层守护 (Dual-Track Architecture)

插件命名为 **`subagent-watchdog`**，以非侵入式 Paseo Plugin 方式接入：

```text
subagent-watchdog/
├── paseo-plugin.json             # 插件清单声明 (ID: subagent-watchdog, paseo >= 0.8.0)
├── package.json                  # 模块元数据与依赖
├── tsconfig.json                 # TypeScript 严格配置
├── index.server.ts               # 服务端入口 (生命周期注册、RPC 挂载、配置管理)
├── index.client.tsx               # 客户端入口 (Timeline 卡片渲染器、Composer 快捷动作)
├── server/
│   ├── stream-watcher.ts         # Stream 级监听器 (捕获 in-flight tool_call 与超时心跳)
│   ├── managed-governor.ts       # Paseo 托管子代理调控器 (自动继续、权限放行、自动归档)
│   ├── provider-advisor.ts       # Provider 原生代理注入助手 (动态 MCP 状态汇报与 GC 提示)
│   ├── synthesizer.ts            # 决策卡片生成器 (提取阻断根因并生成结构化选项)
│   └── executor.ts               # 动作下发器 (agent.send, respondToPermission)
├── client/
│   ├── components/
│   │   ├── decision-card.tsx     # 高保真 Timeline 决策卡片 (严格规避 useUnistyles)
│   │   ├── in-flight-pill.tsx    # 长耗时 Tool-call 浮动心跳指示胶囊
│   │   └── action-buttons.tsx    # 决策动作按钮组 (Loading 态、防重入、触感反馈)
│   └── hooks/
│       └── use-decision-rpc.ts   # 封装与插件服务端 RPC 的单向数据流交互
└── shared/
    ├── types.ts                  # 意图枚举、卡片结构与状态模型
    └── rpc.ts                    # watchdog.resolve_decision RPC 契约 (Zod Schema)
```

---

## 三、 双轨治理策略 (Dual-Track Governance Strategy)

### 轨道 A：针对 Paseo 托管子代理 (Managed Subagents)

- **生命周期完全掌控**：利用 `server.on("agent.turn_ended")` 和 `server.on("agent.permission_requested")`；
- **自动继续与配额**：单任务连续自动推进限制在 5 轮（可配置），安全命令（`git status`、`test`）自动放行；
- **原生生命周期 GC**：监测到闲置已完成的托管子代理时，通过 `context.paseo.agents.ref(id).archive()` 自动释放资源。

### 轨道 B：针对 Provider 原生子代理 (Provider Native Subagents，如 Codex `spawn_agent`)

- **注入轻量级报告工具**：插件向 Agent 环境提供/注入 `mcp__watchdog__report_blocker` 工具，使大模型在遇到困难时能够主动生成强类型阻断结构，规避脆弱的 NLP 纯文本猜词；
- **In-flight Stream 监听 (破除假死黑盒)**：
  - 订阅 `observeEvents(["agent_stream", "agent.provider_subagents.update"])`；
  - 只要主代理处于 Tool-call 状态超过 **15 秒**（如正在执行 `wait_agent`），插件立即向前端推送实时心跳数据，客户端渲染虚拟状态条：`⏳ Subagent [Parfit] 正在执行文件检索与测试，已耗时 42s...`；
  - 提供 `[强制中断等待]` 快捷按钮，打通 Paseo 协议的中断通道。
- **并发超限感知与上下文注入**：
  - 当 Stream 捕获到 `collab spawn failed: agent thread limit reached` 时，插件自动向主代理注入系统级干预提示：“检测到子代理并发槽位已满，请优先对已完成的 task-1 / task-2 调用 `close_agent` 释放槽位后再重试派生”。

---

## 四、 核心状态机与流转 (State Machine)

```text
               ┌──────────────────────┐
               │   IDLE_MONITORING    │ (监听 agent_stream / turn_ended)
               └──────────┬───────────┘
                          │ 监听到 tool_call_started (如 wait_agent)
                          ▼
               ┌──────────────────────┐
               │  IN_FLIGHT_TRACKING  │ (超过 15s 渲染虚拟心跳胶囊，展示耗时与状态)
               └──────────┬───────────┘
                          │
         ┌────────────────┴────────────────────────┐
         │ 工具执行完毕 / turn_ended                │ 工具超时 / 抛出 Thread Limit / 报错
         ▼                                         ▼
┌──────────────────────┐                  ┌──────────────────────┐
│  CHECKING_GOVERNOR   │                  │  ESCALATED_BLOCKER   │
│ (检查配额 & 震荡检测)  │                  │ (生成结构化决策卡片)   │
└────────┬─────────────┘                  └──────────┬───────────┘
         │                                           │
  ┌──────┴────────────────┐                          │ 用户点击卡片按钮 / 文本回复
  │ 通过配额 & 无震荡      │ 超限 / 震荡              ▼
  ▼                       ▼               ┌──────────────────────┐
┌──────────────────┐  ┌────────────────┐  │   USER_INTERVENED    │
│ AUTO_PROPELLING  │  │ TRIP_CIRCUIT   │  │ (注入决策参数并恢复)   │
│ (自动下发续跑/放行)│  │ (熔断升级阻断) │  └──────────┬───────────┘
└────────┬─────────┘  └───────┬────────┘             │
         │                    │                      │
         └────────────────────┴──────────────────────┘
                              │
                              ▼
                     回到 IDLE_MONITORING
```

---

## 五、 UI 交互与 Paseo 规范红线对齐 (UI/UX Compliance)

必须严格遵守 Paseo 核心规范：

1. **绝对禁止 `useUnistyles()` (Per `docs/unistyles.md`)**：
   - 样式一律采用 Paseo 现有的 `StyleSheet.create` 配合传入的主题 tokens 或静态安全样式类；
   - 杜绝运行时动态 hook 导致的性能损耗或 Native 渲染崩溃。
2. **跨端 Hover 与微动效规范 (Per `docs/hover.md`)**：
   - 禁止在 Native 端使用 `onPointerEnter` / `onPointerLeave`；
   - 使用标准判定式：`isHovered || isNative || isCompact`；
   - 结构上遵循 Canonical Pattern：外层纯 `View` 处理容器与间距，内层独立 `Pressable` 捕获点击，杜绝触控事件穿透。
3. **单向数据流 (Single Direction Data Flow)**：
   - 客户端点击决策卡片按钮后，通过 `use-decision-rpc.ts` 调用服务端的 `watchdog.resolve_decision`；
   - 服务端修改 Agent 状态并广播更新，客户端依据服务端权威事件更新 UI，禁止本地脏修改。

---

## 六、 决策卡片视觉与排版 (Visual Presentation)

```text
┌───────────────────────────────────────────────────────────────┐
│ ⚡ WATCHDOG · 任务推进遇阻决策                          [待决策] │
├───────────────────────────────────────────────────────────────┤
│ 📌 当前进展：Task 3 (NodeDriver 凭据同步) 已完成并审查通过       │
│                                                               │
│ ⚠️ 阻断原因：Task 4 派生时遭遇并发线程超限 (Thread Limit)      │
│    `collab spawn failed: agent thread limit reached`          │
├───────────────────────────────────────────────────────────────┤
│ 💡 建议决策选项：                                             │
│  [A] 自动清理前序空闲子代理并重试 (推荐)                         │
│      向当前主会话注入提示，优先执行 close_agent 释放槽位        │
│                                                               │
│  [B] 降级为单线程串行模式                                     │
│      不派生新 Subagent，由当前主代理直接在本地上下文推进 Task 4 │
│                                                               │
│  [C] 暂停任务，等待我手动排查                                 │
├───────────────────────────────────────────────────────────────┤
│ 快捷操作:  [ ⚡ 执行选项 A ]  [ 切换单线程 B ]  [ 🛑 暂停并接管 ] │
└───────────────────────────────────────────────────────────────┘
```

---

## 七、 实施与测试验证矩阵 (Test & Verification Matrix)

1. **Unit Test (Vitest)**：
   - `stream-watcher.test.ts`：验证 In-flight 超时检测与心跳事件分发；
   - `managed-governor.test.ts`：验证自动推进轮数上限熔断（5 轮截断）、防震荡（Flapping）检测；
   - `synthesizer.test.ts`：验证结构化决策卡片 Markdown 模板生成与选项提取。
2. **Contract & UI Test**：
   - 验证 `watchdog.resolve_decision` 的 Zod 输入输出校验；
   - 组件测试验证在 iOS/Android/Web 平台开关下的渲染一致性，确保零 `useUnistyles()` 侵入。
3. **E2E 真实复测**：
   - 在测试 Worktree 中派生带多个子任务的会话，验证遇到 `thread limit reached` 时能否立刻捕获并弹出卡片，且用户点击 A 后能正常自愈恢复。
