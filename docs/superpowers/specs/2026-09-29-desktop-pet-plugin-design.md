# Paseo Desktop Pet Plugin (桌面小宠物插件) 架构与设计规范

- **日期**：2026-09-29
- **状态**：Draft / Spec Review
- **作者**：Paseo Core Team & Jerry
- **目标组件**：`plugins/desktop-pet/` 及独立跨平台桌面端伴侣程序

---

## 1. 概述与背景 (Overview & Goals)

Paseo 用户通常在本地机器（如 macOS / Windows 笔记本）监控和控制跑在远端（或后台）的多个 AI Coding Agent。在多任务并发场景下，用户经常离开工位、开会或专注于其他编码工作，导致以下痛点：

1. **任务卡死在权限审批处**：Agent 需要读取文件或执行命令，等待人工确认超时，导致流水线长时间闲置；
2. **缺乏直观生动的多任务状态监控**：用户无法一眼得知当前有几个任务在跑、分别跑了多久、哪些已停止；
3. **缺乏陪伴感与正向反馈**：长流程任务体验枯燥，缺少游戏化趣味性。

### 核心目标 (Core Requirements)

1. **多任务状态与运行耗时监控**：实时展示当前有多少个任务在运行、多少个已停止、哪些正在等待决策，并精确显示每个任务的已运行耗时（如 `14m 20s`）。
2. **多并发任务独立倒计时**：多个任务并发等待审批时，支持各自独立的倒计时器与独立操作，不相互干扰。
3. **超时 AI 智能决策与提醒**：用户长时间未处理权限申请时，触发内置小模型根据安全与风险策略自动研判并代为做出决策（批准/拒绝），并伴随提示音与动画提醒。
4. **多级审计追踪 (Audit Trail)**：每次自动决策的理由、风险级别、输入输出均持久化存储在服务端，并提供 Paseo 客户端专用的审计日志面板供随时查阅与复核。
5. **视听与动画系统**：像素复古风小宠物（Tamagotchi 风格），包含丰富的情绪动画状态，结合 Web Audio 8-bit 自合成趣味音效（支持一键静音、免打扰）。
6. **经验值与成长体系 (XP Gamification)**：任务完成、专注工作、高效决策均获得经验值，解锁小宠物等级称号与外观变化。
7. **客户端独立跨平台架构**：将服务端核心大脑（Daemon 状态监听与决策）与物理展示端（本地桌面置顶透明浮窗、移动端小组件扩展）彻底解耦，每台客户端可独立配置小宠物形象与偏好。

---

## 2. 总体架构与跨平台分层 (Architecture & Topology)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   远端服务器 (Remote Server / Daemon Host)             │
│                                                                        │
│   Paseo Daemon                                                         │
│   └── plugins/desktop-pet/ (服务端核心大脑 - Node.js 子进程)           │
│       ├── TaskTracker: 追踪任务生命周期、启动时间与精确活跃耗时         │
│       ├── AIDecisionEngine: 超时自动风险审查与小模型代管决策            │
│       ├── AuditStore: 本地持久化审计记录库 (audit-log.json)            │
│       └── CompanionServer: 暴露标准化 Companion HTTP / WebSocket 协议 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Companion Protocol (WS/JSON-RPC)
         ┌─────────────────────────┼─────────────────────────┐
         ▼                                                   ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│  桌面端：Paseo Pet (独立桌面程序)  │       │  移动端：Paseo Mobile & Widgets  │
│                                 │       │                                 │
│  • macOS / Windows / Linux      │       │  • iOS Widget / Android 小组件   │
│  • 独立透明置顶悬浮窗 (无边框)   │       │  • iOS 灵动岛 & 实时活动 (Live) │
│  • 像素动画帧引擎 + 8-bit 音效   │       │  • 锁屏状态伴侣卡片             │
│  • 悬浮展开看板 (任务时长/一键) │       │  • 触觉反馈 (Haptics)           │
│  • 本地独立配置 (皮肤/静音/位置)│       │  • 本地独立配置 (移动端偏好)     │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

### 职责分工原则 (Single Source of Truth)

- **服务端拥有事实源与决策权**：
  - 任务状态、活跃耗时、计时器均由服务端插件维护；哪怕所有客户端离线，服务端的超时倒计时依然精准触发 AI 自动决策并入库审计。
- **客户端拥有呈现权与本地偏好**：
  - 桌面浮窗直接渲染在用户本地物理屏幕上，音效通过本地设备播放；
  - 用户的皮肤喜好、音量大小、是否静音均保存在本地客户端，多台设备（Mac、Windows、手机）各具特色、互不冲突。

---

## 3. 插件目录与模块划分 (Directory Structure)

```text
plugins/desktop-pet/
├── paseo-plugin.json               # 插件清单声明 (id: "desktop-pet", requirements: { paseo: ">=0.8.0" })
├── package.json                    # 依赖定义 (@getpaseo/plugin, zod, etc.)
├── tsconfig.json
├── index.server.ts                 # 服务端主入口 (生命周期挂钩、Companion 服务暴露、RPC 注册)
├── index.client.tsx                # Paseo 客户端主入口 (审计面板注册、设置页注册、顶部按钮)
├── shared/
│   ├── contracts.ts                # RPC 契约与 WebSocket 消息结构
│   └── types.ts                    # 任务状态、审计记录、宠物动作类型定义
├── server/
│   ├── agent-tracker.ts            # 任务状态感知与执行耗时计时器
│   ├── decision-engine.ts          # AI 超时自动决策器 (Prompt、风险规则、模型调用)
│   ├── audit-logger.ts             # 审计日志持久化与分页查询
│   ├── xp-manager.ts               # 经验值计算与成长等级系统
│   └── companion-service.ts        # 面向桌面浮窗/移动端的小宠物长连接服务
├── client/
│   ├── audit-panel.tsx             # Paseo 内置的完整决策审计明细看板
│   ├── pet-settings.tsx            # 超时阈值、声音音量、AI 策略配置面板
│   └── status-button.tsx           # Paseo 顶部导航栏的桌宠状态指示器与呼出开关
└── companion-desktop/              # 独立桌面端透明浮窗伴侣程序
    ├── package.json
    ├── src/
    │   ├── main.js                 # 极轻量透明置顶窗口创建器 (Electron / Webview)
    │   ├── renderer.html           # 透明视口与 DOM 挂载点
    │   ├── animation-engine.ts     # 像素切片帧动画状态机
    │   ├── sound-synthesizer.ts    # Web Audio 8-bit 音效生成器 (纯代码合成无外置音频)
    │   ├── flyout-dashboard.tsx    # 点击/悬停展开的多任务时长与独立倒计时面板
    │   └── assets/                 # 默认像素宠物帧切片与自定义资源插槽
```

---

## 4. 详细模块设计 (Component Details)

### 4.1 任务多维状态机与耗时追踪 (TaskTracker)

#### 1. 状态定义

```typescript
export type PetTaskState =
  | "RUNNING" // 执行中 (思考、运行命令、读写文件)
  | "WAITING_DECISION" // 阻塞等待人工审批 (权限申请、确认等)
  | "STOPPED" // 已停止/结束 (完成、报错终止或人工取消)
  | "IDLE"; // 无任何活跃任务
```

#### 2. 耗时数据模型

```typescript
export interface TrackedTask {
  agentId: string;
  taskTitle: string;
  state: PetTaskState;
  startedAt: number; // 启动毫秒时间戳
  activeDurationMs: number; // 累计活跃运行耗时
  pendingDecision?: {
    requestId: string;
    actionRequested: string; // 例如: "npm test -- --coverage"
    riskHint: "low" | "medium" | "high";
    requestedAt: number; // 请求发生时间戳
    timeoutSeconds: number; // 该任务超时时长
    expiresAt: number; // 超时截止时间戳 (requestedAt + timeoutSeconds * 1000)
  };
}
```

#### 3. 聚合大盘 (PetDashboardSnapshot)

服务端每次状态发生变化时向伴侣端推送快照：

- `runningCount`: 处于 `RUNNING` 状态的任务总数；
- `waitingCount`: 处于 `WAITING_DECISION` 状态的任务总数；
- `stoppedCount`: 处于 `STOPPED` 状态的最近任务计数；
- `tasks`: 当前所有活跃和刚完成的任务清单；
- `petXp`: 当前累积经验值与等级。

---

### 4.2 AI 超时自动决策与多级审计 (DecisionEngine & AuditLogger)

#### 1. 独立超时控制流程

- 每次监听到 `agent.permission_requested`，为该任务分配专属定时器：
  ```
  expiresAt = requestedAt + config.timeoutSeconds * 1000
  ```
- 客户端接收到后，启动本地每秒刷新的倒计时器：`remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))`。
- 若有多个任务等待审批，每一个任务都有专属的 `expiresAt`，倒计时独立进行。
- 若倒计时先归零，且未收到人工干预事件，服务端触发 `DecisionEngine.evaluateAndExecute(task, request)`。

#### 2. 风险判定规则与安全基准

AI 决策器遵循保守原则，采用结构化提示词（Structured Output）：

| 操作类别            | 典型示例                              | 判定倾向  | 决策逻辑                          |
| :------------------ | :------------------------------------ | :-------- | :-------------------------------- |
| **安全读取**        | `ls`, `cat`, `git status`, `git diff` | **ALLOW** | 纯信息查询，无修改副作用          |
| **标准测试构建**    | `npm test`, `cargo check`, 隔离编译   | **ALLOW** | 验证流程，在工作区沙箱内          |
| **受管文件编辑**    | 在当前分支内修改项目源码              | **ALLOW** | 处于 git 版本控制之下，可随时回滚 |
| **破坏性删除**      | `rm -rf`, 清空全局缓存, 递归移除      | **DENY**  | 破坏性高，自动拦截并挂起通知      |
| **跨系统/越界行为** | 访问系统关键目录 (`/etc`, `~/.ssh`)   | **DENY**  | 严禁跨越安全边界                  |
| **外部通信/推送**   | `git push -f`, curl 上传凭证          | **DENY**  | 防止泄露与覆盖主仓库              |

#### 3. 结构化审计记录格式 (Audit Record)

```typescript
export interface AuditRecord {
  id: string; // UUID
  timestamp: string; // ISO 字符串
  agentId: string;
  taskTitle: string;
  triggerType: "TIMEOUT_AUTO_DECISION" | "MANUAL_DECISION";
  requestedAction: string; // 被拦截的具体指令或文件行为
  decision: "ALLOW" | "DENY";
  riskLevel: "low" | "medium" | "high";
  aiReason: string; // 模型做出的完整理由阐述
  reviewedByHuman: boolean; // 用户是否已在审计面板中标记复核
}
```

持久化保存于 `$PASEO_HOME/plugins/desktop-pet/audit-log.json`，并支持在 Paseo 客户端 `AuditPanel` 进行一键检索、按风险级别筛选、标为已阅与导出。

---

### 4.3 桌面浮窗与交互表现层 (Companion Desktop)

#### 1. 窗口特性

- **无边框透明置顶 (Frameless, Transparent, Always-on-top)**：尺寸约 140x140 像素（迷你状态），悬浮于屏幕右下角或停靠边缘，支持自由拖动与屏幕边缘吸附。
- **展开工作台 (Flyout Panel)**：
  - 点击或悬停桌宠时，向左/向右滑出半透明工作台卡片；
  - 展开卡片列出所有正在运行的任务，分别展示其运行耗时（如 `已运行 12m 30s`）；
  - 对处于 `WAITING_DECISION` 的每个任务展示独立的倒计时进度条、风险评级建议，以及 `[一键批准]` 与 `[拒绝]` 按钮。

#### 2. 像素动画引擎 (Sprite Animation States)

桌宠基于 Canvas / Sprite Sheet 播放 8 种核心动画：

- `idle`: 摸鱼打盹、摇尾巴、冒泡泡；
- `running`: 疯狂敲击键盘、屏幕反光、代码粒子飞出；
- `waiting`: 冒汗、举小旗子求助、头顶大黄色感叹号；
- `urgent`: 倒计时剩余 < 30 秒时，小宠急促跺脚、红色警报微闪；
- `auto_decided`: 头顶出现 AI 机械光环，双手比耶或竖大拇指；
- `level_up`: 原地翻跟斗、抛洒金币与彩带；
- `error`: 晕倒转圈圈、头顶小鸟盘旋；
- `poked`: 鼠标点击抚摸时晃动并微笑。

#### 3. 8-bit 自合成趣味音效 (Web Audio Synthesizer)

完全使用 Web Audio API 原生振荡器实时调频合成，零外部 MP3/WAV 资源依赖，零加载延迟：

- `snd_ping`: 任务需要决策时的清脆提示声 (双音和弦 440Hz -> 880Hz)；
- `snd_urgent`: 倒计时紧迫时的急促短促滴声 (1200Hz 方波)；
- `snd_approved`: AI 或人工批准后的舒缓回馈音 (温和正弦波和弦)；
- `snd_levelup`: 升级经典琶音 (C5 -> E5 -> G5 -> C6 上行和弦)；
- `snd_poke`: 点击互动时的软萌 "啵" 音 (频率快速滑降)。
- **控制开关**：提供全局静音（Mute）、音量滑块与免打扰时间段配置。

---

### 4.4 经验值与等级成长模型 (Gamification Model)

- **经验获取途径**：
  - 每顺利跑完一个完整任务：**+50 XP**
  - 任务持续健康运行每累计 10 分钟：**+10 XP**
  - 主人在超时前及时人工决策：**+15 XP**
  - AI 成功安全代管一次决策：**+5 XP**
- **等级阶梯**：
  - **Lv.1 终端萌新** (0 XP): 基础像素猫咪/小精灵，发呆与敲键盘。
  - **Lv.2 实习助手** (200 XP): 解锁随身咖啡杯与挂脖工牌。
  - **Lv.3 资深码农** (600 XP): 打字带有残影粒子特效。
  - **Lv.4 架构宗师** (1500 XP): 佩戴极客墨镜，多任务并发时有分身幻影。
  - **Lv.5+ 赛博守护神** (3000+ XP): 自带环绕能量光环。

---

## 5. 通信协议与数据契约 (Companion Protocol & RPC)

### 5.1 服务端与伴侣端 WebSocket 消息格式

```typescript
// 1. 服务端下发的全量快照与状态更新
export interface CompanionStateUpdateMessage {
  type: "state_update";
  runningCount: number;
  waitingCount: number;
  stoppedCount: number;
  xp: number;
  level: number;
  tasks: Array<{
    agentId: string;
    taskTitle: string;
    state: PetTaskState;
    startedAt: number;
    activeDurationMs: number;
    pendingDecision?: {
      requestId: string;
      actionRequested: string;
      riskHint: "low" | "medium" | "high";
      requestedAt: number;
      expiresAt: number;
    };
  }>;
}

// 2. 客户端向服务端发起的操作指令
export interface CompanionActionCommand {
  type: "respond_permission";
  agentId: string;
  requestId: string;
  behavior: "allow" | "deny";
}
```

### 5.2 Paseo 插件设置存储契约 (Plugin Settings Schema)

```typescript
export interface DesktopPetSettings {
  autoDecisionEnabled: boolean; // 是否开启超时自动决策 (默认: true)
  defaultTimeoutSeconds: number; // 默认超时等待时间 (秒, 默认: 180)
  soundEnabled: boolean; // 是否开启音效 (默认: true)
  soundVolume: number; // 音量 (0.0 ~ 1.0, 默认: 0.7)
  riskThreshold: "conservative" | "balanced" | "liberal"; // 风险控制模式
  skinTheme: "pixel_cat" | "cyber_bot" | "shiba_inu"; // 桌宠皮肤
}
```

---

## 6. 异常边界与错误处理 (Resilience & Edge Cases)

1. **客户端网络中断或合上电脑盖子**：
   - 服务端状态机与计时器由 Daemon 守护进程常驻运行，不受客户端离线影响；超时后 AI 决策照常执行并落库审计；
   - 客户端重新连接后，立即同步最新状态快照和最新审计列表，补弹“离线期间小宠替您完成了 X 笔决策”小通知。
2. **多任务决策同时触发**：
   - 采用并发任务队列（Mutex / Concurrent Queue）保证各 Agent 的审批操作隔离，防止并发竞争死锁。
3. **AI 模型调用偶发超时或失败**：
   - 若模型调用因网络或 Token 超限失败，执行**安全降级策略 (Fail-safe)**：默认不批准破坏性行为，保持挂起，并在小宠物端播放错误警报，等待人工干预。
4. **浏览器/操作系统自动静音限制 (Autoplay Policy)**：
   - 针对初次启动没有用户手势可能导致 Web Audio 无法播放的问题，桌宠会在用户首次鼠标悬停或点击时自动解锁音频上下文（`audioCtx.resume()`）。

---

## 7. 测试与验证策略 (Testing Strategy)

1. **单元测试 (Unit Tests)**：
   - `agent-tracker.test.ts`：验证任务启动、状态转换、活跃耗时累加、多任务并发计时的准确性。
   - `decision-engine.test.ts`：模拟高危命令（`rm -rf /`）与安全命令（`git status`），验证风险识别与决策分支是否 100% 严谨。
   - `audit-logger.test.ts`：验证审计记录的持久化写入、格式合规性与分页回溯。
2. **集成测试 (Integration Tests)**：
   - 通过本地模拟 Daemon 事件发射 `agent.permission_requested`，验证倒计时过期后自动触发决策与消息广播的全链路。
3. **客户端视听与渲染验证**：
   - 验证透明浮窗在 macOS / Windows 上的置顶、拖拽及边缘吸附；
   - 验证 Web Audio 振荡器在不同事件下的波形发声与一键静音有效性。
