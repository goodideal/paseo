# Agent Radar & Watchdog 态势雷达设计规范 (Design Spec)

> **设计定位**: 将原有的被动拦截型 `subagent-watchdog` 升级为集“全景路线图跟踪（Execution Roadmap）、Superpowers 语义感知、子代理状态机守护（Watchdog & Auto-propelling）与断路决策”于一体的综合态势雷达插件 **`agent-radar`**。

---

## 一、 需求与核心目标

1. **全景运行路线图 (Execution Roadmap Visualization)**:
   - 解决多 Agent 协作时“不知道执行到哪一步、不知道子代理在干什么”的黑盒问题。
   - 实时呈现任务阶段、当前执行节点、耗时及依赖关系。
2. **Superpowers 深度融合 (Native Superpowers Alignment)**:
   - 精确契合 `subagent-driven-development`（SDD）、`writing-plans` 等工程规范。
   - 自动解析工作区 Plan 与 `.superpowers/sdd/<slug>/ledger.md`，将抽象的任务转为可视化的任务流水线（Task Brief ➔ Implementer ➔ Task Reviewer ➔ Fix Rounds ➔ Breaker ➔ Branch Finish）。
3. **双模自动驱动 (Dual-Engine Ingestion)**:
   - **Superpower 语义流水线模式**: 工作区存在 SDD Plan/Ledger 时自动激活，呈现任务步骤与裁决（Rulings）；
   - **通用 Agent 拓扑模式**: 非 Superpower 场景自动降级，基于 Paseo 原生 `labels["paseo.parent-agent-id"]` 与 `lastStatus` 呈现 Agent 派生树与并发线程槽位。
4. **守卫与原位决策 (Watchdog & In-situ Interventions)**:
   - 完整继承并增强原有看门狗功能：长耗时工具调用心跳（In-flight Heartbeat）、只读安全命令自动放行（Auto-approval）、未完成意图自动续推（Auto-propel，上限 5 轮）。
   - 当触发打回超限断路器（Breaker）或并发超限时，阻断决策卡直接**原位锚定在雷达故障节点上**，提供一键重试、裁决、人工介入等动作。

---

## 二、 方案对比与架构选型

| 维度                 | 方案 1：渐进双模雷达（推荐）                                   | 方案 2：纯 Superpower 专属雷达           | 方案 3：侵入式协议上报雷达                      |
| :------------------- | :------------------------------------------------------------- | :--------------------------------------- | :---------------------------------------------- |
| **工作原理**         | 非侵入式监听 FS（Plan/Ledger）+ Paseo Agent 事件，自动识别模式 | 仅解析 Superpower 文件，不处理普通 Agent | 修改 Skill 脚本，强制 Agent 运行中调用 CLI 上报 |
| **通用性**           | 极佳（Superpower 会话与普通多 Agent 均适用）                   | 差（非 Superpower 无法使用）             | 极差（对外部/已有技能有侵入性）                 |
| **对原有看门狗复用** | 100% 复用并原位整合                                            | 仅保留断路器，丢失通用守护               | 需重写通信链路                                  |
| **维护与升级成本**   | 低，符合 Paseo 插件规范                                        | 中                                       | 高，协议耦合过紧                                |

**结论**: 采纳 **方案 1：渐进双模雷达插件**。

---

## 三、 模块与目录架构

插件由 `plugin-examples/subagent-watchdog` 升级并重组为 `plugin-examples/agent-radar`：

```text
plugin-examples/agent-radar/
├── paseo-plugin.json             # 插件元数据清单 (ID: agent-radar)
├── package.json                  # 包依赖 (@getpaseo/client, @getpaseo/plugin, etc.)
├── tsconfig.json                 # TypeScript 编译配置
├── index.server.ts               # 服务端插件入口 (生命周期事件注册、RPC 挂载、配置管理)
├── index.client.tsx              # 客户端插件入口 (Workspace Panel 注册、Timeline 渲染器)
├── server/
│   ├── radar-engine.ts           # 雷达主调控器 (聚合拓扑、状态机与看门狗状态)
│   ├── sdd-parser.ts             # Superpowers SDD 解析器 (读取 plans/*.md 与 ledger.md)
│   ├── topology-builder.ts       # Paseo Agent 层级拓扑生成器 (parent-agent-id 分析)
│   ├── stream-watcher.ts         # 工具级调用流监听器 (长耗时心跳侦测)
│   ├── managed-governor.ts       # 托管子代理调控器 (自动续推、安全权限放行)
│   ├── synthesizer.ts            # 决策卡片生成器 (提取阻断根因分析与选项)
│   └── executor.ts               # 动作下发执行器 (agent.send, respondToPermission)
├── client/
│   ├── components/
│   │   ├── radar-panel.tsx       # 工作区独立雷达主面板 (双栏/上下响应式布局)
│   │   ├── pipeline-view.tsx     # Superpower 任务流水线视图 (Task 节点、状态、轮次)
│   │   ├── topology-view.tsx     # 通用 Agent 拓扑树视图 (树状连线、节点运行状态)
│   │   ├── node-inspector.tsx    # 选中节点态势抽屉 (实时耗时、日志概览、决策操作)
│   │   ├── decision-card.tsx     # 决策卡片 (支持原位与 Timeline 双处渲染)
│   │   ├── in-flight-pill.tsx    # 长耗时工具心跳指示胶囊
│   │   └── action-buttons.tsx    # 一键决策动作按钮组 (Loading 态、防抖防重入)
│   └── hooks/
│       ├── use-radar-data.ts     # 雷达数据轮询与流式聚合 Hook
│       └── use-decision-rpc.ts   # 决策下发 RPC 封装
└── shared/
    ├── types.ts                  # 数据模型 (RadarSnapshot, PipelineStep, TopologyNode 等)
    ├── rpc.ts                    # RPC 契约定义 (radar.get_snapshot, radar.resolve_decision)
    └── settings.ts               # 配置项 (心跳阈值、自动推进轮数上限、扫描模式)
```

---

## 四、 核心数据模型 (Shared Contracts)

```typescript
// 1. 节点运行状态
export type RadarNodeStatus =
  | "pending"
  | "running"
  | "reviewing"
  | "fixing"
  | "completed"
  | "blocked"
  | "error";

// 2. Superpower 任务步骤
export interface SuperpowerTaskStep {
  id: string; // e.g. "task-1"
  title: string; // e.g. "Hook installation script"
  status: RadarNodeStatus;
  currentRound?: number; // e.g. 2 (Fix round 2 of 5)
  maxRounds?: number; // default 5
  agentId?: string; // 当前绑定执行的 subagentId
  commits?: string[]; // 产出的 commit hashes
  rulings?: string[]; // 记录在 ledger 中的 rulings
  durationMs?: number; // 累计耗时
}

// 3. 通用 Agent 拓扑节点
export interface AgentTopologyNode {
  agentId: string;
  parentAgentId?: string;
  title: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  runningTool?: string;
  durationMs: number;
  childAgentIds: string[];
}

// 4. 统一雷达快照 (RadarSnapshot)
export interface RadarSnapshot {
  mode: "superpower" | "generic";
  superpower?: {
    planSlug: string;
    planPath: string;
    tasks: SuperpowerTaskStep[];
    currentTaskId?: string;
  };
  topology: {
    rootAgentId: string;
    nodes: Record<string, AgentTopologyNode>;
  };
  watchdog: {
    activeHeartbeat?: InFlightHeartbeat;
    activeBlocker?: BlockerReport;
    autoTurnCount: number;
    maxAutoTurns: number;
  };
}
```

---

## 五、 数据流与运作生命周期

1. **自动感知与状态构建**:
   - `RadarEngine` 收到快照查询请求（`radar.get_snapshot`）：
     1. 检查当前工作区 `cwd`：查找是否存在 `.superpowers/sdd/*/` 或 `docs/superpowers/plans/*.md`；
     2. 若存在，读取最新的 Plan 与 `ledger.md`，构建 `superpower.tasks` 流水线；
     3. 无论何种模式，同时拉取当前 Agent 及其子孙代理的 Paseo Agent 实体，构建 `topology.nodes`；
     4. 关联 `ManagedGovernor` 与 `StreamWatcher` 的实时数据，注入当前的 `activeHeartbeat` 或 `activeBlocker`。
2. **客户端呈现与交互**:
   - 用户打开工作区 `Agent Radar` 面板：
     - 若为 Superpower 会话：默认展示任务流水线（支持折叠/展开各任务内部的 Implementer ➔ Reviewer ➔ Fix 循环）；
     - 若为通用会话：默认展示拓扑树状图；
     - 任何发生超时的节点，显示脉冲心跳动画；发生阻断的节点，原位高亮并渲染决策卡。
   - 用户在节点上点击决策选项（如“执行裁决继续推进”或“重试子任务”）：
     - 客户端通过 `radar.resolve_decision` RPC 下发；
     - 服务端通过 `Executor` 注入裁决指令或继续提示词，推动下一轮执行。

---

## 六、 规范约束与安全准则

1. **跨端与样式准则 (Paseo Frontend Standards)**:
   - 严禁使用 `useUnistyles()`，使用原生 StyleSheet 或 UniStyles 规范导出；
   - 跨端交互遵守 `docs/hover.md`，Hover 态使用 `isHovered || isNative || isCompact` 守卫，确保 iOS/Android 原生与 Web/Desktop 体验一致；
   - 注册 Workspace Panel 图标必须使用 PascalCase Lucide 图标名（如 `Compass`、`Activity`）。
2. **安全防护准则 (Security Envelope)**:
   - 自动放行机制仅限只读类命令白名单（如 `git status`、`git diff`、`npm test`、`ls`、`cat`）；
   - 任何涉及代码写操作（未审阅提交）、环境破坏、外部网络推流等一律触发阻断上报，人工确认。

---

## 七、 实施与测试验收计划

1. **Phase 1: 契约与解析层 (Contracts & Parsers)**
   - 重构 `shared/types.ts` 与 `shared/rpc.ts`，定义快照规范；
   - 编写 `sdd-parser.ts` 与 `topology-builder.ts`，并通过针对实际 Plan 与 Ledger 的单元测试。
2. **Phase 2: 服务端引擎整合 (Server Radar Engine)**
   - 实现 `radar-engine.ts`，将 Parser、Governor 与 StreamWatcher 融合成统一快照；
   - 挂载 `radar.get_snapshot` 与 `radar.resolve_decision` RPC；
   - 编写单测与集成测试验证双模自动切换与快照生成。
3. **Phase 3: 客户端雷达面板 (Client Radar Panel)**
   - 构建 `pipeline-view.tsx`、`topology-view.tsx` 与 `node-inspector.tsx`；
   - 在 `index.client.tsx` 中注册 `Agent Radar` 工作区面板；
   - 编写 React Native / Web 渲染单元测试。
4. **Phase 4: 全流程端到端验证 (E2E Verification)**
   - 验证在 Superpower SDD 执行场景下：路线图流水线精准跟随、看门狗心跳正常显示、断路器原位决策并恢复执行；
   - 运行类型检查、代码格式化与测试套件。
