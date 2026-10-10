# Desktop Pet 任务呈现与优先级系统实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 `desktop-pet` 插件的任务呈现体系，引入 P0/P1/P2 三级优先级分类、常态灵动药丸、P0 原地审批胶囊以及毛玻璃 Micro-HUD 展开面板，打通原地快速放行/拒绝与一键聚焦 Agent 的双向链路。

**Architecture:** 基于 Zod Schema 扩展任务优先级契约；通过 `DesktopPetAgentProjection` 进行确定性优先级排序与宏观情绪裁决；通过 WebSocket 双向扩展让悬浮端直接上行 `decision.respond` 并由 `CompanionService` 直调 Agent 权限接口；在悬浮端通过动态 SVG 倒计时环与 Glassmorphism 卡片实现高信息密度、极低干扰的桌面体验。

**Tech Stack:** TypeScript, Zod, Web Audio API, Canvas 2D, WebSocket, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-desktop-pet-task-presentation-design.md`

## Global Constraints

- **No Breakage of Protocol:** 不破坏既存 Paseo Daemon 协议，所有跨域/跨端通信通过插件独立伴侣 WebSocket 隧道传输。
- **Strict Sanitization:** 所有由 Agent 动态生成的任务标题、命令行参数均必须严格转义或使用 `textContent` 绑定，杜绝 XSS 风险。
- **Idempotent Actions:** 原地审批按键点击后立即进入不可用态（Disabled），防止并发重击。
- **No Unused Fallbacks:** 状态机采用确定性决策树，不添加冗余防御分支。

## Review Focus

1. **多 P0 竞态排序**：当多个 Agent 同时等待审批时，必须将剩余倒计时最短的 P0 任务置顶。
2. **倒计时超时优雅降级**：当倒计时归零时，原地按钮立即失效，卡片平滑淡出，不阻断正常工作。
3. **断网本地保护**：WebSocket 断开时，本地倒计时立即冻结，避免误触。
4. **长文本与特殊字符截断**：长命令行在胶囊内优雅截断（`text-overflow: ellipsis`），展开 HUD 中提供完整 tooltip/滚动查看。
5. **XP 增长即时反馈**：审批通过后立即触发音效和 +XP 经验动画。

---

### Task 1: 共享类型契约与优先级计算 (Shared Types & Priority Classification)

**Files:**

- Modify: `plugins/desktop-pet/shared/types.ts`
- Test: `plugins/desktop-pet/tests/contracts.test.ts`

**Interfaces:**

- Consumes: `zod`
- Produces: `PetPrioritySchema`, `computeTaskPriority(task: TrackedTask): PetPriority`, `CompanionActionSchema`, `PetDashboardSnapshotSchema` (包含 `xpToNextLevel` 与已计算 `priority` 的 `TrackedTask`)

- [ ] **Step 1: Write the failing test**

在 `plugins/desktop-pet/tests/contracts.test.ts` 中增加优先级判定与动作契约测试：

```typescript
it("computes task priority correctly and validates companion actions", () => {
  const p0Task = {
    agentId: "agent-1",
    taskTitle: "Refactor",
    state: "WAITING_DECISION",
    startedAt: Date.now(),
    activeDurationMs: 1000,
    pendingDecision: {
      requestId: "req-1",
      requestedAt: Date.now(),
      riskHint: "high",
    },
  };
  expect(computeTaskPriority(p0Task as any)).toBe("P0");

  const p1Task = {
    agentId: "agent-2",
    taskTitle: "Running build",
    state: "RUNNING",
    startedAt: Date.now(),
    activeDurationMs: 2000,
  };
  expect(computeTaskPriority(p1Task as any)).toBe("P1");

  const p2Task = {
    agentId: "agent-3",
    taskTitle: "Idle task",
    state: "IDLE",
    startedAt: null,
    activeDurationMs: null,
  };
  expect(computeTaskPriority(p2Task as any)).toBe("P2");

  const validAction = {
    type: "decision.respond",
    agentId: "agent-1",
    requestId: "req-1",
    behavior: "ALLOW",
  };
  expect(CompanionActionSchema.parse(validAction)).toEqual(validAction);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/desktop-pet/tests/contracts.test.ts --bail=1`
Expected: FAIL with `computeTaskPriority is not defined` or schema mismatch.

- [ ] **Step 3: Write minimal implementation**

在 `plugins/desktop-pet/shared/types.ts` 中实现：

```typescript
export const PetPrioritySchema = z.enum(["P0", "P1", "P2"]);
export type PetPriority = z.infer<typeof PetPrioritySchema>;

export function computeTaskPriority(task: {
  state: string;
  pendingDecision?: unknown;
}): PetPriority {
  if (task.state === "WAITING_DECISION" || task.pendingDecision) {
    return "P0";
  }
  if (task.state === "RUNNING" || task.state === "STARTING") {
    return "P1";
  }
  return "P2";
}

export const CompanionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("decision.respond"),
    agentId: z.string(),
    requestId: z.string(),
    behavior: z.enum(["ALLOW", "DENY"]),
  }),
  z.object({
    type: z.literal("agent.focus"),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("pet.interact"),
  }),
]);
export type CompanionAction = z.infer<typeof CompanionActionSchema>;
```

并在 `TrackedTaskSchema` 中追加 `priority: PetPrioritySchema.default("P2")`，在 `PetDashboardSnapshotSchema` 中追加 `xpToNextLevel: z.number().int().default(500)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/desktop-pet/tests/contracts.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/desktop-pet/shared/types.ts plugins/desktop-pet/tests/contracts.test.ts
git commit -m "feat(desktop-pet): add priority computation and companion action schemas"
```

---

### Task 2: 状态机投影与优先级智能排序 (Agent Projection Priority & Mood Arbitration)

**Files:**

- Modify: `plugins/desktop-pet/server/agent-projection.ts`
- Test: `plugins/desktop-pet/tests/agent-tracker.test.ts`

**Interfaces:**

- Consumes: `computeTaskPriority`, `TrackedTask`, `PetDashboardSnapshot`
- Produces: `DesktopPetAgentProjection.getSnapshot()`（自动将 P0 任务置顶并按剩余时间排序，计算宏观主情绪）

- [ ] **Step 1: Write the failing test**

在 `plugins/desktop-pet/tests/agent-tracker.test.ts` 中添加排序与情绪判定测试：

```typescript
it("sorts tasks by priority (P0 > P1 > P2) and determines pet mood", () => {
  const projection = new DesktopPetAgentProjection();
  projection.handleSnapshot([
    {
      id: "agent-idle",
      title: "Idle Agent",
      status: "idle",
      pendingPermissions: [],
      activeTurn: null,
      createdAt: "",
      updatedAt: "",
      cwd: "",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    },
    {
      id: "agent-running",
      title: "Running Agent",
      status: "running",
      activeTurn: { turnId: "turn-1", startedAt: new Date(Date.now() - 5000).toISOString() },
      pendingPermissions: [],
      createdAt: "",
      updatedAt: "",
      cwd: "",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    },
    {
      id: "agent-waiting",
      title: "Waiting Agent",
      status: "running",
      activeTurn: { turnId: "turn-2", startedAt: new Date(Date.now() - 10000).toISOString() },
      pendingPermissions: [
        {
          id: "req-1",
          kind: "shell",
          command: "rm -rf cache",
          requestedAt: new Date().toISOString(),
        },
      ],
      createdAt: "",
      updatedAt: "",
      cwd: "",
      lastUserMessageAt: null,
      capabilities: {} as any,
      availableModes: [],
      currentModeId: null,
      persistence: null,
    },
  ]);

  const snapshot = projection.getSnapshot();
  expect(snapshot.tasks.length).toBe(3);
  expect(snapshot.tasks[0].agentId).toBe("agent-waiting");
  expect(snapshot.tasks[0].priority).toBe("P0");
  expect(snapshot.tasks[1].agentId).toBe("agent-running");
  expect(snapshot.tasks[1].priority).toBe("P1");
  expect(snapshot.tasks[2].agentId).toBe("agent-idle");
  expect(snapshot.tasks[2].priority).toBe("P2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/desktop-pet/tests/agent-tracker.test.ts --bail=1`
Expected: FAIL with task ordering mismatch or missing priority field.

- [ ] **Step 3: Write minimal implementation**

在 `plugins/desktop-pet/server/agent-projection.ts` 中：

- 在映射每个 Agent 为 `TrackedTask` 时，计算 `priority = computeTaskPriority(task)`；
- 对快照中的 `tasks` 数组进行稳定排序：
  ```typescript
  const priorityWeight: Record<PetPriority, number> = { P0: 0, P1: 1, P2: 2 };
  tasks.sort((a, b) => {
    const diff = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (diff !== 0) return diff;
    // P0 内部按剩余时间升序
    if (a.priority === "P0" && a.pendingDecision && b.pendingDecision) {
      return (a.pendingDecision.expiresAt || 0) - (b.pendingDecision.expiresAt || 0);
    }
    // P1 内部按已运行时长降序
    return (b.activeDurationMs || 0) - (a.activeDurationMs || 0);
  });
  ```
- 返回的 `PetDashboardSnapshot` 中携带当前等级所需的 `xpToNextLevel = 500`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/desktop-pet/tests/agent-tracker.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/desktop-pet/server/agent-projection.ts plugins/desktop-pet/tests/agent-tracker.test.ts
git commit -m "feat(desktop-pet): sort tasks by priority and compute snapshot weights"
```

---

### Task 3: 伴侣服务端双向 Action 闭环 (Companion Service Action Routing)

**Files:**

- Modify: `plugins/desktop-pet/server/companion-service.ts`
- Modify: `plugins/desktop-pet/index.server.ts`
- Test: `plugins/desktop-pet/tests/companion-service.test.ts`

**Interfaces:**

- Consumes: `CompanionService`, `CompanionActionSchema`
- Produces: `companion.setActionHandler((action) => Promise<void>)` 处理 `decision.respond` 并直调 Agent 权限放行与经验累加

- [ ] **Step 1: Write the failing test**

在 `plugins/desktop-pet/tests/companion-service.test.ts` 中添加接收 WebSocket action 的测试：

```typescript
it("routes decision.respond action to actionHandler correctly", async () => {
  const service = new CompanionService(0);
  const actionMock = vi.fn().mockResolvedValue(undefined);
  service.setActionHandler(actionMock);
  const port = await service.start();

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((res) => ws.on("open", res));

  ws.send(
    JSON.stringify({
      type: "decision.respond",
      agentId: "agent-123",
      requestId: "req-1",
      behavior: "ALLOW",
    }),
  );

  await vi.waitFor(() => {
    expect(actionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decision.respond",
        agentId: "agent-123",
        requestId: "req-1",
        behavior: "ALLOW",
      }),
    );
  });

  ws.close();
  await service.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/desktop-pet/tests/companion-service.test.ts --bail=1`
Expected: FAIL with `setActionHandler is not a function` or action not called.

- [ ] **Step 3: Write minimal implementation**

在 `plugins/desktop-pet/server/companion-service.ts` 中添加 `setActionHandler` 方法：

```typescript
public setActionHandler(handler: (command: any) => Promise<void>): void {
  this.actionHandler = handler;
}
```

并在 `plugins/desktop-pet/index.server.ts` 中注册处理函数：

```typescript
companion.setActionHandler(async (command) => {
  if (command.type === "decision.respond") {
    const agentRef = (server as any)?.paseo?.agents?.ref(command.agentId);
    if (agentRef) {
      await agentRef.respondToPermission({
        requestId: command.requestId,
        response: { behavior: command.behavior.toLowerCase() },
      });
      xpManager.awardManualPrompt();
      projection.setXpAndLevel(xpManager.getXp(), xpManager.getLevel());
      companion.broadcastSnapshot(projection.getSnapshot());
    }
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/desktop-pet/tests/companion-service.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/desktop-pet/server/companion-service.ts plugins/desktop-pet/index.server.ts plugins/desktop-pet/tests/companion-service.test.ts
git commit -m "feat(desktop-pet): wire companion actionHandler for inline permissions"
```

---

### Task 4: 桌面悬浮端 Micro-HUD 与 P0 原地审批 UI (Companion Desktop UI & Micro-HUD)

**Files:**

- Modify: `plugins/desktop-pet/companion-desktop/src/index.html` & `companion-client.ts`
- Modify: `plugins/desktop-pet/server/companion-service.ts`（同步更新内置的 `COMPANION_HTML` 与 `COMPANION_JS`）
- Test: `plugins/desktop-pet/tests/sound-synthesizer.test.ts`

**Interfaces:**

- Consumes: WebSocket `state_update` 广播（含等级、XP、P0/P1/P2 排序任务）
- Produces: 动态灵动药丸（常态简写/紧急态警报胶囊）、SVG 倒计时环、原地 `[✓ 放行]` / `[✗ 拒绝]` 按钮、Glassmorphism HUD 面板

- [ ] **Step 1: Write the failing test**

在 `plugins/desktop-pet/tests/sound-synthesizer.test.ts` 中验证新增的音效类型（`playUrgent`、`playApproved`、`playLevelUp`）保持完备。

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run plugins/desktop-pet/tests/sound-synthesizer.test.ts --bail=1`
Expected: PASS

- [ ] **Step 3: Write minimal implementation**

在 `companion-desktop/src/index.html` 与 `companion-service.ts` 的 `COMPANION_HTML` / `COMPANION_JS` 中：

1. **重构 CSS**：
   - 移除原先僵硬的 `#flyout`，引入 `.micro-hud`：深色毛玻璃背景（`background: rgba(22, 27, 34, 0.88); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;`）；
   - 引入灵动药丸 `.dynamic-pill`：带呼吸微光和拟态图标；
   - 引入 P0 紧急高亮样式 `.urgent-card`：红色呼吸光圈、内嵌倒计时指示与微型按键；
2. **重构渲染逻辑 (`companion-client.ts` / `COMPANION_JS`)**：
   - 顶部渲染等级徽章、XP 经验条（`currentXp / nextXp`）与统计指示器；
   - 当存在 P0 任务时，在宠物上方展开紧急胶囊，显示高危操作简述与倒计时环；
   - P0 卡片内嵌 `[✓ 放行]` 与 `[✗ 拒绝]`，点击后通过 `ws.send(JSON.stringify({ type: "decision.respond", ... }))` 上行，并立即将按钮置为 `disabled` 显示 `处理中...`；
   - P1 区域展示运行中任务与时长；P2 区域折叠展示已归档任务；
   - 对所有动态文本使用 `escapeHtml` 彻底防止 XSS。

- [ ] **Step 4: Verify syntax & build**

Run: `npm run lint -- plugins/desktop-pet/index.server.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/desktop-pet/companion-desktop/ plugins/desktop-pet/server/companion-service.ts
git commit -m "feat(desktop-pet): implement dynamic capsule and micro-hud in companion client"
```

---

### Task 5: 综合集成测试与质量门禁 (End-to-End Integration & Quality Gates)

**Files:**

- Modify: `plugins/desktop-pet/tests/server-integration.test.ts`
- Verify: 全部测试套件与类型检查

**Interfaces:**

- Consumes: 全部 `desktop-pet` 服务与客户端契约
- Produces: 验证多 Agent 混合状态下的端到端优先级排序、原地审批触发、XP 累加与快照广播

- [ ] **Step 1: Write integration test**

在 `plugins/desktop-pet/tests/server-integration.test.ts` 中增加完整端到端流转测试：

- 注册 observer 注入混合 Agent（1 个 WAITING_DECISION，1 个 RUNNING，1 个 IDLE）；
- 验证 `pet.get_dashboard` 返回的数据中 P0 任务置顶；
- 模拟伴侣端发送 `decision.respond`，验证 `respondToPermission` 成功触发且 XP 累加。

- [ ] **Step 2: Run targeted test**

Run: `npx vitest run plugins/desktop-pet/tests/server-integration.test.ts --bail=1`
Expected: PASS

- [ ] **Step 3: Run full plugin tests**

Run: `npx vitest run plugins/desktop-pet/tests/contracts.test.ts plugins/desktop-pet/tests/agent-tracker.test.ts plugins/desktop-pet/tests/companion-service.test.ts plugins/desktop-pet/tests/server-integration.test.ts --bail=1`
Expected: ALL PASS

- [ ] **Step 4: Monorepo Typecheck and Format**

Run: `npm run typecheck && npm run format:check`
Expected: Clean with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add plugins/desktop-pet/tests/server-integration.test.ts
git commit -m "test(desktop-pet): add end-to-end integration test for priority presentation"
```
