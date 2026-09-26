# Agent Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原有的 `subagent-watchdog` 升级为具备可视化执行路线图跟踪（Execution Roadmap）、Superpowers 语义感知、通用 Agent 拓扑扫描以及看门狗守卫与原位决策卡的全功能态势雷达插件 `agent-radar`。

**Architecture:** 采用渐进式双模驱动架构。服务端由 `RadarEngine` 统一调度：自动嗅探 `.superpowers/sdd/` 及 `docs/superpowers/plans/` 生成 SDD 任务流水线状态；同时拉取 Paseo 原生 Agent 派生标签生成树状拓扑，并与现有的 `StreamWatcher` 心跳和 `ManagedGovernor` 自动推进逻辑深度整合。客户端在工作区注册独立的 `Agent Radar` 面板，提供流水线与拓扑双视图及原位决策抽屉。

**Tech Stack:** TypeScript, React, React Native, Zod, Vitest, Paseo Plugin API (`@getpaseo/plugin`, `@getpaseo/client`, `@getpaseo/protocol`).

**Spec:** `docs/superpowers/specs/2026-09-26-agent-radar-design.md`

## Global Constraints

- **Naming & ID:** 插件 ID 为 `agent-radar`，npm 包名为 `@getpaseo/agent-radar-plugin`，面板 ID 为 `agent-radar-panel`，面板图标使用 PascalCase `Compass`。
- **Cross-Platform & Styling:** 客户端严禁使用 `useUnistyles()`，使用原生 StyleSheet 或 UniStyles 规范；Hover 交互严格遵循 `isHovered || isNative || isCompact`。
- **Safety Envelope:** 仅自动放行只读命令（`git status`、`test`、`cat`、`ls` 等），任何写操作/未审阅代码必须拦截；断路器上限为 5 轮。
- **No Mocking Internal Types:** 复用 Paseo 原生协议和插件 API，不臆造虚假协议。

---

### Task 1: 迁移与重命名插件骨架 (Plugin Scaffolding & Manifest Migration)

**Files:**

- Rename/Move: `plugin-examples/subagent-watchdog` -> `plugin-examples/agent-radar`
- Modify: `plugin-examples/agent-radar/package.json`
- Modify: `plugin-examples/agent-radar/paseo-plugin.json`
- Modify: `packages/app/src/plugins/evaluate.test.ts:460-480`

**Interfaces:**

- Consumes: None
- Produces: 规范的 `agent-radar` 插件结构与清单描述

- [ ] **Step 1: 重命名目录与更新插件清单**

将目录从 `subagent-watchdog` 迁移为 `agent-radar`，并将 `package.json` 的 `name` 更新为 `@getpaseo/agent-radar-plugin`，`paseo-plugin.json` 更新为：

```json
{
  "id": "agent-radar",
  "description": "Visual execution roadmap, Superpowers SDD pipeline tracker, subagent watchdog, and in-situ blocker decision card",
  "requirements": {
    "paseo": ">=0.8.0"
  }
}
```

- [ ] **Step 2: 更新 evaluate.test.ts 验证用例**

在 `packages/app/src/plugins/evaluate.test.ts` 中同步断言 `agent-radar` 插件的注册。

- [ ] **Step 3: 运行 evaluate 测试确保加载器兼容**

运行: `npx vitest run packages/app/src/plugins/evaluate.test.ts`
Expected: PASS

- [ ] **Step 4: 提交变更**

```bash
git add plugin-examples/ packages/app/src/plugins/evaluate.test.ts
git commit -m "refactor(radar): rename plugin to agent-radar and update manifests"
```

---

### Task 2: 共享数据模型与 RPC 契约 (Shared Types & RPC Contracts)

**Files:**

- Modify: `plugin-examples/agent-radar/shared/types.ts`
- Modify: `plugin-examples/agent-radar/shared/rpc.ts`
- Test: `plugin-examples/agent-radar/tests/types.test.ts`

**Interfaces:**

- Consumes: `BlockerReportSchema`, `InFlightHeartbeatSchema`
- Produces: `RadarSnapshotSchema`, `SuperpowerTaskStepSchema`, `AgentTopologyNodeSchema`, `radarGetSnapshotRpc`, `radarResolveDecisionRpc`

- [ ] **Step 1: 编写数据模型契约单测**

创建 `plugin-examples/agent-radar/tests/types.test.ts`，验证 `RadarSnapshotSchema` 对 Superpower 模式与 Generic 拓扑模式的校验与默认值解析。

- [ ] **Step 2: 运行测试验证失败**

运行: `npx vitest run plugin-examples/agent-radar/tests/types.test.ts`
Expected: FAIL (缺少相关 Schema 定义)

- [ ] **Step 3: 实现 shared/types.ts 与 shared/rpc.ts**

在 `types.ts` 中定义 `RadarNodeStatus`、`SuperpowerTaskStep`、`AgentTopologyNode`、`RadarSnapshot` 及其 Zod Schema；在 `rpc.ts` 中注册 `radar.get_snapshot` 与 `radar.resolve_decision` RPC 定义。

- [ ] **Step 4: 运行测试验证通过**

运行: `npx vitest run plugin-examples/agent-radar/tests/types.test.ts`
Expected: PASS

- [ ] **Step 5: 提交变更**

```bash
git add plugin-examples/agent-radar/shared/ plugin-examples/agent-radar/tests/types.test.ts
git commit -m "feat(radar): define radar snapshot schemas and rpc contracts"
```

---

### Task 3: Superpowers SDD 解析器 (Superpowers SDD Parser)

**Files:**

- Create: `plugin-examples/agent-radar/server/sdd-parser.ts`
- Test: `plugin-examples/agent-radar/tests/sdd-parser.test.ts`

**Interfaces:**

- Consumes: 工作区文件系统（`docs/superpowers/plans/`, `.superpowers/sdd/`）
- Produces: `parseSuperpowerStatus(workspaceCwd: string): Promise<SuperpowerPlanStatus | null>`

- [ ] **Step 1: 编写针对真实 Plan 与 Ledger 格式的单测**

在 `tests/sdd-parser.test.ts` 中构造临时测试目录，包含标准的 plan markdown 任务列表（`- [ ] Task 1: ...`、`- [x] Task 2: ...`）与 `ledger.md`（包含 fix rounds、commits 与 rulings），验证解析器能否提取任务、当前正在执行的步骤、轮次以及裁决信息。

- [ ] **Step 2: 运行测试验证失败**

运行: `npx vitest run plugin-examples/agent-radar/tests/sdd-parser.test.ts`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现 server/sdd-parser.ts**

实现 `parseSuperpowerStatus`：

1. 查找 `.superpowers/sdd/*/` 下最近修改的 slug 目录；若无，降级查找 `docs/superpowers/plans/`；
2. 解析 Plan 文件中的任务清单与标题；
3. 解析 `ledger.md`，提取完成标记、当前 Fix round（如 `fix round 2/5`）、关联 commit 与 `Ruling:` 记录；
4. 容错处理：文件不存在或格式不合规时返回 `null`。

- [ ] **Step 4: 运行测试验证通过**

运行: `npx vitest run plugin-examples/agent-radar/tests/sdd-parser.test.ts`
Expected: PASS

- [ ] **Step 5: 提交变更**

```bash
git add plugin-examples/agent-radar/server/sdd-parser.ts plugin-examples/agent-radar/tests/sdd-parser.test.ts
git commit -m "feat(radar): implement superpowers sdd plan and ledger parser"
```

---

### Task 4: 通用 Agent 拓扑构建器 (Agent Topology Builder)

**Files:**

- Create: `plugin-examples/agent-radar/server/topology-builder.ts`
- Test: `plugin-examples/agent-radar/tests/topology-builder.test.ts`

**Interfaces:**

- Consumes: Paseo Agent 实体列表（`labels["paseo.parent-agent-id"]`, `lastStatus`）
- Produces: `buildAgentTopology(rootAgentId: string, agents: AgentRecord[]): AgentTopology`

- [ ] **Step 1: 编写拓扑生成单测**

在 `tests/topology-builder.test.ts` 中构造带有父子关系、嵌套子孙（Grandchild）、不同状态（running / idle / error）的 Mock Agent 列表，验证拓扑树的正确收敛。

- [ ] **Step 2: 运行测试验证失败**

运行: `npx vitest run plugin-examples/agent-radar/tests/topology-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 server/topology-builder.ts**

实现拓扑算法：递归或迭代索引 `parent-agent-id`，解析当前正在运行的工具名称与耗时，输出根节点与节点字典。

- [ ] **Step 4: 运行测试验证通过**

运行: `npx vitest run plugin-examples/agent-radar/tests/topology-builder.test.ts`
Expected: PASS

- [ ] **Step 5: 提交变更**

```bash
git add plugin-examples/agent-radar/server/topology-builder.ts plugin-examples/agent-radar/tests/topology-builder.test.ts
git commit -m "feat(radar): implement hierarchical agent topology builder"
```

---

### Task 5: 雷达主引擎整合与服务端入口 (Radar Engine & Server Entrypoint)

**Files:**

- Create: `plugin-examples/agent-radar/server/radar-engine.ts`
- Modify: `plugin-examples/agent-radar/index.server.ts`
- Modify: `plugin-examples/agent-radar/tests/server.test.ts`

**Interfaces:**

- Consumes: `parseSuperpowerStatus`, `buildAgentTopology`, `StreamWatcher`, `ManagedGovernor`
- Produces: `getRadarSnapshot(agentId: string)`, 挂载 `radar.get_snapshot` 与 `radar.resolve_decision` RPC

- [ ] **Step 1: 编写 RadarEngine 聚合单测**

在 `tests/server.test.ts` 中增加测试用例：

1. 验证在存在 SDD Plan 时输出 `mode: "superpower"` 且包含步骤列表与看门狗状态；
2. 验证普通多 Agent 时回退至 `mode: "generic"` 拓扑；
3. 验证阻断发生时 `activeBlocker` 绑定到快照中。

- [ ] **Step 2: 运行测试验证失败**

运行: `npx vitest run plugin-examples/agent-radar/tests/server.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 server/radar-engine.ts 与 index.server.ts**

聚合逻辑：

1. 注入当前工作区路径与 Paseo agents 数据源；
2. 组装 `RadarSnapshot`；
3. 在 `index.server.ts` 中注册 `radar.get_snapshot` 与 `radar.resolve_decision` RPC，并保持心跳/治理器持续工作。

- [ ] **Step 4: 运行测试验证通过**

运行: `npx vitest run plugin-examples/agent-radar/tests/server.test.ts`
Expected: PASS

- [ ] **Step 5: 提交变更**

```bash
git add plugin-examples/agent-radar/server/radar-engine.ts plugin-examples/agent-radar/index.server.ts plugin-examples/agent-radar/tests/server.test.ts
git commit -m "feat(radar): integrate radar engine with dual-mode snapshot rpc"
```

---

### Task 6: 客户端雷达面板与可视化视图 (Client Radar Panel & Views)

**Files:**

- Create: `plugin-examples/agent-radar/client/components/radar-panel.tsx`
- Create: `plugin-examples/agent-radar/client/components/pipeline-view.tsx`
- Create: `plugin-examples/agent-radar/client/components/topology-view.tsx`
- Create: `plugin-examples/agent-radar/client/components/node-inspector.tsx`
- Modify: `plugin-examples/agent-radar/index.client.tsx`
- Modify: `plugin-examples/agent-radar/tests/client.test.tsx`

**Interfaces:**

- Consumes: `useRpc(radarGetSnapshotRpc)`, `useRpc(radarResolveDecisionRpc)`
- Produces: `Agent Radar` Workspace Panel 及其子视图组件

- [ ] **Step 1: 编写客户端组件渲染单测**

在 `tests/client.test.tsx` 中编写测试，模拟返回 Superpower 流水线快照与通用拓扑快照，断言 `RadarPanel` 正确渲染任务节点、心跳胶囊与阻断卡。

- [ ] **Step 2: 运行测试验证失败**

运行: `npx vitest run plugin-examples/agent-radar/tests/client.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现流水线、拓扑与态势抽屉组件**

1. `pipeline-view.tsx`：横向/纵向展示 Task 卡片，展示标题、状态图标、Fix 轮次徽章（如 `Fix 2/5`）、Commit 哈希与裁决摘要；
2. `topology-view.tsx`：树状展示主 Agent 与各 Subagent 节点、运行状态与耗时；
3. `node-inspector.tsx`：展示选中节点的具体运行时日志与挂载的阻断决策卡（`DecisionCard`）；
4. `radar-panel.tsx`：组合视图，并支持手动刷新与自动轮询（正常 3s，报警/运行中 1.5s）；
5. `index.client.tsx`：注册 `agent-radar-panel` 工作区面板（标题 `Agent Radar`，图标 `Compass`）与 Timeline 渲染器。

- [ ] **Step 4: 运行测试验证通过**

运行: `npx vitest run plugin-examples/agent-radar/tests/client.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交变更**

```bash
git add plugin-examples/agent-radar/client/ plugin-examples/agent-radar/index.client.tsx plugin-examples/agent-radar/tests/client.test.tsx
git commit -m "feat(radar): implement client radar panel, pipeline view, and node inspector"
```

---

### Task 7: 端到端集成验证与交付收尾 (E2E Integration & Verification)

**Files:**

- Modify: `plugin-examples/agent-radar/tests/integration.test.ts`
- Cleanups & Checks

- [ ] **Step 1: 编写端到端集成测试**

在 `tests/integration.test.ts` 中模拟从主 Agent 派生子代理、触发长耗时心跳、在雷达快照中实时体现节点耗时、模拟子代理阻断、并在雷达面板下发决策卡恢复执行的完整链路。

- [ ] **Step 2: 运行插件全量单元与集成测试**

运行: `npx vitest run plugin-examples/agent-radar/tests/`
Expected: ALL PASS

- [ ] **Step 3: 执行全局类型检查与代码格式化**

```bash
npm run typecheck
npm run format
npm run lint -- plugin-examples/agent-radar
```

Expected: 0 errors, 0 warnings

- [ ] **Step 4: 提交完整交付变更**

```bash
git add plugin-examples/agent-radar/ docs/superpowers/
git commit -m "feat(radar): complete agent-radar delivery with verified dual-engine tests"
```
