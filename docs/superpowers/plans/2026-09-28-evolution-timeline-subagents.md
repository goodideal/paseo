# Evolution Timeline Subagents Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构演进大盘（Agent Radar / Workspace Reader）的时间轴流向为最新在顶部的倒序排列，并在阶段里程碑卡片中内嵌响应式折叠子代理列表，实现子任务运行态观测（耗时、注意力、工具进度）与就地控制操作（中断、1+3 带提示词重试、单行与批量归档）。

**Architecture:**

1. `packages/server`: 在 `WorkspaceEvolutionService` 中过滤排除子代理（保留 Root Agent），按 `createdAt` 倒序排序，使最新活跃阶段位于索引 0。
2. `packages/app`: 在 `EvolutionTimeline` 中更新顶部高亮发光节点与垂直向下流向；在 `MilestoneCard` 中接入 `useSubagentsForParent` 响应式 Store，开发智能折叠子任务流组件及子代理条目；开发内联重试输入条与中断/归档控制链路。

**Tech Stack:** TypeScript, Node.js, React Native / Expo, react-native-unistyles v3, Lucide Icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-evolution-timeline-subagents-design.md`

## Global Constraints

- **Strict Protocol Contract:** Wire schemas stay pure — no `.transform()`, `.catch()`, or `.preprocess()`.
- **Unistyles Rules:** NEVER use `useUnistyles()`. All dynamic and theme-aware styling must use `StyleSheet.create((theme) => ...)`.
- **Platform Rules:** Default is cross-platform. Use Metro extensions or constant guards (`isWeb`, `isNative`) where necessary.
- **Test Discipline:** TDD workflow. Run only the targeted test file with `--bail=1`. Do not run broad test suites.

---

### Task 1: Server-side Root Agent Filtering & Reverse Chronological Sorting

**Files:**

- Modify: `packages/server/src/server/evolution/agent-milestone-summarizer.ts`
- Modify: `packages/server/src/server/evolution/workspace-evolution-service.ts`
- Test: `packages/server/src/server/evolution/workspace-evolution-service.test.ts`

**Interfaces:**

- Consumes: `StoredAgentLike` from `agent-milestone-summarizer.ts`
- Produces:
  - `workspaceAgents` filtered by `!agent.parentAgentId && !agent.labels?.["paseo.parent-agent-id"]`
  - `milestones` sorted descending by `createdAt` (newest at index 0)
  - `currentStage` derived from `milestones[0]` (the latest active stage)

- [ ] **Step 1: Write the failing tests for root filtering and reverse chronological sorting**

```typescript
// Add to packages/server/src/server/evolution/workspace-evolution-service.test.ts
it("filters out subagents and sorts milestones descending by createdAt", async () => {
  const mockAgents: StoredAgentLike[] = [
    {
      id: "agent-old",
      provider: "codex",
      cwd: "/path/to/wks_1",
      workspaceId: "wks_1",
      title: "较旧的阶段任务",
      createdAt: "2026-09-27T01:00:00.000Z",
      lastStatus: "idle",
    },
    {
      id: "agent-sub",
      provider: "claude",
      cwd: "/path/to/wks_1",
      workspaceId: "wks_1",
      title: "被派生的子代理任务",
      parentAgentId: "agent-old",
      createdAt: "2026-09-27T01:10:00.000Z",
      lastStatus: "idle",
    },
    {
      id: "agent-new",
      provider: "codex",
      cwd: "/path/to/wks_1",
      workspaceId: "wks_1",
      title: "最新的当前阶段",
      createdAt: "2026-09-27T02:00:00.000Z",
      lastStatus: "running",
    },
  ];

  const service = new WorkspaceEvolutionService({
    cacheRoot: tmpDir,
    agentStorage: {
      list: vi.fn().mockResolvedValue(mockAgents),
      get: vi.fn().mockImplementation((id: string) => mockAgents.find((a) => a.id === id) ?? null),
    },
    workspaceRegistry: {
      get: vi.fn().mockResolvedValue({ workspaceId: "wks_1", displayName: "test" }),
    },
  });

  const digest = await service.getDigest("wks_1", { forceRefresh: true });
  expect(digest).not.toBeNull();
  // agent-sub must be excluded, only root agents present
  expect(digest?.milestones.length).toBe(2);
  // Newest milestone must be first
  expect(digest?.milestones[0].agentId).toBe("agent-new");
  expect(digest?.milestones[1].agentId).toBe("agent-old");
  expect(digest?.currentStage).toContain("最新的当前阶段");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/server/evolution/workspace-evolution-service.test.ts --bail=1`
Expected: FAIL due to missing `parentAgentId` in type / ascending order.

- [ ] **Step 3: Update `StoredAgentLike` and `WorkspaceEvolutionService`**

1. In `packages/server/src/server/evolution/agent-milestone-summarizer.ts`, add:

```typescript
export interface StoredAgentLike {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
  title?: string | null;
  lastStatus?: string | null;
  labels?: Record<string, string> | null;
  parentAgentId?: string | null;
  config?: {
    model?: string | null;
    systemPrompt?: string | null;
  } | null;
  runtimeInfo?: {
    model?: string | null;
  } | null;
  archivedAt?: string | null;
}
```

2. In `packages/server/src/server/evolution/workspace-evolution-service.ts`, update filtering and sorting:

```typescript
const workspaceAgents = allAgents.filter((a) => {
  const isMatchWorkspace =
    a.workspaceId === workspaceId || (workspace?.cwd && a.cwd === workspace.cwd);
  if (!isMatchWorkspace) return false;
  const isSubagent = Boolean(a.parentAgentId || a.labels?.["paseo.parent-agent-id"]);
  return !isSubagent;
});

// Sort descending by creation time (newest at index 0)
workspaceAgents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
```

And update `currentStage` derivation to reference `milestones[0]`:

```typescript
if (milestones.length > 0) {
  const hasRunning = milestones.some((m) => m.status === "running");
  const current = milestones[0];

  if (hasRunning) {
    overallStatus = "in_progress";
    currentStage = `正在推进: ${current.intentPrompt}`;
  } else if (
    current.intentPrompt.toLowerCase().includes("review") ||
    current.intentPrompt.includes("审查") ||
    current.intentPrompt.includes("审计")
  ) {
    overallStatus = "ready_for_review";
    currentStage = "代码质量评审完成，待合流";
  } else {
    overallStatus = "completed";
    currentStage = `已完成阶段: ${current.intentPrompt}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/src/server/evolution/workspace-evolution-service.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server/evolution/agent-milestone-summarizer.ts packages/server/src/server/evolution/workspace-evolution-service.ts packages/server/src/server/evolution/workspace-evolution-service.test.ts
git commit -m "feat(server): filter out subagents and sort evolution milestones descending"
```

---

### Task 2: Timeline Visual Stem & Header Inversion

**Files:**

- Modify: `packages/app/src/screens/workspace/reader/evolution-timeline.tsx`
- Modify: `packages/app/src/screens/workspace/reader/milestone-card.tsx`
- Modify: `packages/app/src/screens/workspace/reader/workspace-reader-screen.tsx`
- Test: `packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx`

**Interfaces:**

- Consumes: `milestones: AgentMilestoneRecord[]`, `serverId?: string | null`
- Produces:
  - Topmost node formatted as "当前推进阶段" (if running) or "阶段 N (最新)"
  - Pass `serverId` to `EvolutionTimeline` and `MilestoneCard`

- [ ] **Step 1: Write the failing test for inverted timeline presentation**

```typescript
// In packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx
it("renders reverse timeline with top stage highlighted as current", async () => {
  evolutionState.current = {
    digest: {
      workspaceId: "wks_1",
      workspaceTitle: "glorious-eagle",
      branch: "feat/cluster",
      executiveSummary: "完成架构调研与核心代码改造",
      currentStage: "正在推进: 调试集群节点通信",
      overallStatus: "in_progress",
      updatedAt: new Date().toISOString(),
      milestones: [
        {
          agentId: "agent-2",
          provider: "codex",
          startedAt: "2026-09-27T02:00:00.000Z",
          durationMs: 60000,
          status: "running",
          intentPrompt: "调试集群节点通信",
          executiveSummary: "正在启动 3 个容器节点并测试 Raft 握手",
          keyDecisions: [],
          modifiedFiles: [],
        },
        {
          agentId: "agent-1",
          provider: "claude",
          startedAt: "2026-09-27T01:00:00.000Z",
          durationMs: 1800000,
          status: "completed",
          intentPrompt: "调研 DocDB 集群部署方式",
          executiveSummary: "完成技术选型",
          keyDecisions: [],
          modifiedFiles: [],
        },
      ],
    },
    isLoading: false,
    isAnalyzing: false,
    error: null,
    refresh: vi.fn(),
  };

  await act(async () => {
    root.render(<WorkspaceReaderScreen serverId="test-server" workspaceId="wks_1" />);
  });

  expect(container.textContent).toContain("当前阶段 (执行中)");
  expect(container.textContent).toContain("调试集群节点通信");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx --bail=1`
Expected: FAIL

- [ ] **Step 3: Update `evolution-timeline.tsx` and `milestone-card.tsx`**

1. In `milestone-card.tsx`:
   - Accept `totalCount: number`, `displayIndex: number`, `serverId?: string | null`.
   - When `displayIndex === 0 && milestone.status === "running"`, render:
     `阶段 ${totalCount - displayIndex}: 当前推进中 (执行中)` with pulsing style.
   - For historical stages, render `阶段 ${totalCount - displayIndex}: 已完成`.
2. In `evolution-timeline.tsx`:
   - Pass `serverId`, `totalCount={milestones.length}`, `displayIndex={idx}` to `MilestoneCard`.
   - Update styles for top node dot (`activeGlowDot` with theme accent color).
3. In `workspace-reader-screen.tsx`:
   - Forward `serverId` to `EvolutionTimeline`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/screens/workspace/reader/evolution-timeline.tsx packages/app/src/screens/workspace/reader/milestone-card.tsx packages/app/src/screens/workspace/reader/workspace-reader-screen.tsx packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx
git commit -m "feat(app): support reverse visual stem and active stage highlight in evolution timeline"
```

---

### Task 3: Nested Subagents List & Runtime Observability Component

**Files:**

- Create: `packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.tsx`
- Create: `packages/app/src/screens/workspace/reader/subagents/subagent-item-row.tsx`
- Modify: `packages/app/src/screens/workspace/reader/milestone-card.tsx`
- Test: `packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.test.tsx`

**Interfaces:**

- Consumes: `useSubagentsForParent({ serverId, parentAgentId })`
- Produces:
  - Collapsible subagent section with header summary `子任务流 (N) · X 执行中 · Y 异常 · Z 已完成`
  - Subagent item with Provider Icon, description, elapsed duration, status badge, and jump-to-agent action

- [ ] **Step 1: Write failing test for `MilestoneSubagentsSection`**

```typescript
// packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.test.tsx
/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneSubagentsSection } from "./milestone-subagents-section";

const mockSubagents = vi.fn();
vi.mock("@/subagents/select", () => ({
  useSubagentsForParent: () => mockSubagents(),
}));

describe("MilestoneSubagentsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it("renders null when there are no subagents", async () => {
    mockSubagents.mockReturnValue([]);
    await act(async () => {
      root.render(<MilestoneSubagentsSection serverId="srv-1" parentAgentId="parent-1" />);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders auto-expanded list when subagents contain running task", async () => {
    mockSubagents.mockReturnValue([
      {
        kind: "paseo",
        id: "child-1",
        provider: "claude",
        title: "研究文档",
        description: null,
        status: "running",
        requiresAttention: false,
        createdAt: new Date(),
      },
    ]);

    await act(async () => {
      root.render(<MilestoneSubagentsSection serverId="srv-1" parentAgentId="parent-1" />);
    });

    expect(container.textContent).toContain("子任务流");
    expect(container.textContent).toContain("研究文档");
    expect(container.textContent).toContain("执行中");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.test.tsx --bail=1`
Expected: FAIL (file not found)

- [ ] **Step 3: Implement `SubagentItemRow` and `MilestoneSubagentsSection`**

1. Create `packages/app/src/screens/workspace/reader/subagents/subagent-item-row.tsx`:
   - Render provider icon via `getProviderIcon`.
   - Render title / description.
   - Render status pill (`running` with spinner, `requiresAttention` warning, `error` red badge, `idle/completed` green check).
   - Render duration.
   - Handle click to navigate to subagent tab.
2. Create `packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.tsx`:
   - Call `useSubagentsForParent({ serverId, parentAgentId })`.
   - Check if any running or error: `const hasActiveOrError = rows.some(r => r.status === "running" || r.requiresAttention || r.status === "error" || r.status === "failed")`.
   - Maintain `isExpanded` state initialized to `hasActiveOrError`.
   - Render collapsible header with count badges.
   - Render list of `SubagentItemRow`.
3. In `packages/app/src/screens/workspace/reader/milestone-card.tsx`:
   - Mount `<MilestoneSubagentsSection serverId={serverId} parentAgentId={milestone.agentId} onNavigateToAgent={onNavigateToAgent} />` right below the summary block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.test.tsx --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/screens/workspace/reader/subagents/ packages/app/src/screens/workspace/reader/milestone-card.tsx
git commit -m "feat(app): add nested subagent observability section to milestone card"
```

---

### Task 4: In-situ Controls: Interrupt, Promptable 1+3 Retry, and Archive

**Files:**

- Create: `packages/app/src/screens/workspace/reader/subagents/subagent-inline-retry-bar.tsx`
- Modify: `packages/app/src/screens/workspace/reader/subagents/subagent-item-row.tsx`
- Modify: `packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.tsx`
- Test: `packages/app/src/screens/workspace/reader/subagents/subagent-actions.test.tsx`

**Interfaces:**

- Consumes:
  - `client.cancelAgent(subagentId)`
  - `client.sendMessage(subagentId, text)`
  - `useArchiveSubagent({ serverId })`
- Produces:
  - Red [Stop] button when `status === "running"`
  - Blue [Retry] button when `status === "error" | "failed"`, opening `SubagentInlineRetryBar` with default prompt `"请分析刚才执行失败的原因，调整方案并重新尝试完成任务。"`
  - [Archive] button when finished/failed
  - [Bulk Archive] in section header when finished count > 1

- [ ] **Step 1: Write failing test for subagent actions and 1+3 retry flow**

```typescript
// packages/app/src/screens/workspace/reader/subagents/subagent-actions.test.tsx
/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentItemRow } from "./subagent-item-row";

const mockCancel = vi.fn();
const mockSendMessage = vi.fn();

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    cancelAgent: mockCancel,
    sendMessage: mockSendMessage,
  }),
}));

describe("SubagentItemRow actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it("triggers cancelAgent when clicking interrupt button on running subagent", async () => {
    await act(async () => {
      root.render(
        <SubagentItemRow
          serverId="srv-1"
          row={{
            kind: "paseo",
            id: "child-run",
            provider: "claude",
            title: "执行测试",
            description: null,
            status: "running",
            requiresAttention: false,
            createdAt: new Date(),
          }}
        />,
      );
    });

    const stopBtn = container.querySelector('[aria-label="中断"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    await act(async () => {
      stopBtn.click();
    });
    expect(mockCancel).toHaveBeenCalledWith("child-run");
  });

  it("opens inline retry input bar when clicking retry on failed subagent and sends message", async () => {
    await act(async () => {
      root.render(
        <SubagentItemRow
          serverId="srv-1"
          row={{
            kind: "paseo",
            id: "child-err",
            provider: "codex",
            title: "代码编译",
            description: null,
            status: "error",
            requiresAttention: false,
            createdAt: new Date(),
          }}
        />,
      );
    });

    const retryBtn = container.querySelector('[aria-label="重试"]') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    await act(async () => {
      retryBtn.click();
    });

    // Verify inline retry bar is visible
    expect(container.textContent).toContain("调整方案并重新尝试");

    // Click confirm send
    const sendBtn = container.querySelector('[aria-label="确认重试"]') as HTMLButtonElement;
    await act(async () => {
      sendBtn.click();
    });
    expect(mockSendMessage).toHaveBeenCalledWith(
      "child-err",
      expect.stringContaining("调整方案并重新尝试"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app/src/screens/workspace/reader/subagents/subagent-actions.test.tsx --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement `SubagentInlineRetryBar` and wire actions into `SubagentItemRow`**

1. Create `subagent-inline-retry-bar.tsx`:
   - TextInput with prefilled default prompt: `"请分析刚才执行失败的原因，调整方案并重新尝试完成任务。"`
   - "确认重试" and "取消" buttons.
2. In `subagent-item-row.tsx`:
   - Add state `isRetrying: boolean`.
   - When running: render interrupt button (Square / Stop icon).
   - When error/failed: render retry button (RefreshCw icon), clicking toggles `isRetrying`.
   - Render `useArchiveSubagent` button for completed/idle/error rows.
3. In `milestone-subagents-section.tsx`:
   - Add `ArchiveFinishedRow` / bulk archive button in header when finished count > 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app/src/screens/workspace/reader/subagents/subagent-actions.test.tsx --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/screens/workspace/reader/subagents/
git commit -m "feat(app): add interrupt, 1+3 promptable retry, and archive controls for subagents"
```

---

### Task 5: Agent Radar Integration & Verification

**Files:**

- Modify: `packages/app/src/panels/workflow-runs-panel.tsx`
- Modify: `packages/app/src/screens/workspace/reader/workspace-reader-screen.tsx`
- Test: Full targeted test verification & build check

**Interfaces:**

- Ensures `serverId` is cleanly propagated from `usePaneContext()` down through `WorkspaceReaderScreen` -> `EvolutionTimeline` -> `MilestoneCard` -> `MilestoneSubagentsSection`.

- [ ] **Step 1: Verify typecheck across all modified packages**

Run: `npm run typecheck`
Expected: PASS without errors.

- [ ] **Step 2: Run targeted test suite for reader and evolution services**

Run:

```bash
npx vitest run packages/server/src/server/evolution/workspace-evolution-service.test.ts --bail=1
npx vitest run packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx --bail=1
npx vitest run packages/app/src/screens/workspace/reader/subagents/milestone-subagents-section.test.tsx --bail=1
npx vitest run packages/app/src/screens/workspace/reader/subagents/subagent-actions.test.tsx --bail=1
```

Expected: ALL PASS

- [ ] **Step 3: Run linter and formatting**

Run:

```bash
npm run lint -- packages/app/src/screens/workspace/reader/ packages/server/src/server/evolution/
npm run format:check
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/panels/workflow-runs-panel.tsx packages/app/src/screens/workspace/reader/
git commit -m "feat(app): complete evolution timeline subagents observability and actions in agent radar"
```
