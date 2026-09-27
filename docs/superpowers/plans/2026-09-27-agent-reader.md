# Workspace Agent Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建工作区级智能体全景演进阅读器（Workspace Agent Reader），以演进脉络流呈现工作区生命周期中所有 Agent 的意图、关键技术决策、文件改动与交付成果，并提供不可变增量本地缓存与秒开体验。

**Architecture:**

1. `packages/protocol`: 定义 `AgentMilestoneRecord`、`WorkspaceEvolutionDigest` 及 WebSocket 协议（`workspace.evolution.get_digest.*`）。
2. `packages/server`: 实现 `WorkspaceEvolutionService`，管理 `$PASEO_HOME/cache/workspace-evolution/` 持久化，监听 Agent 运行结束事件，执行轻量提炼与增量快照生成。
3. `packages/app`: 扩展工作区 Tab 支持 `{ kind: "reader"; workspaceId: string }`，开发基于 Unistyles 原生样式的 `WorkspaceReaderScreen`、脉络节点、Executive Summary 卡片及下钻交互。

**Tech Stack:** TypeScript, Node.js (fs/promises, crypto), Zod, React Native / Expo, react-native-unistyles v3, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-agent-reader-design.md`

## Global Constraints

- **Strict Protocol Contract:** Wire schemas stay pure — no `.transform()`, `.catch()`, or `.preprocess()`. New fields must be optional.
- **Unistyles Rules:** NEVER use `useUnistyles()`. All dynamic and theme-aware styling must use `StyleSheet.create((theme) => ...)`.
- **Platform Rules:** Default is cross-platform. Use Metro extensions or constant guards (`isWeb`, `isNative`) where necessary.
- **RPC Naming:** Use dotted namespace with direction suffix (`workspace.evolution.get_digest.request` / `.response`).
- **Test Discipline:** TDD workflow. Run only the targeted test file with `--bail=1`. Do not run broad test suites.

---

### Task 1: Protocol Schema and RPC Message Definitions

**Files:**

- Create: `packages/protocol/src/evolution.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/messages.ts`
- Test: `packages/protocol/src/evolution.test.ts`

**Interfaces:**

- Produces:
  - `AgentMilestoneRecord`: Schema & TypeScript interface
  - `WorkspaceEvolutionDigest`: Schema & TypeScript interface
  - `WorkspaceEvolutionGetDigestRequestSchema` / `ResponseSchema`
  - Inbound & outbound message variants in `SessionInboundMessage` / `SessionOutboundMessage`

- [ ] **Step 1: Write the failing test for Evolution schemas and RPC messages**

```typescript
// packages/protocol/src/evolution.test.ts
import { describe, expect, it } from "vitest";
import {
  AgentMilestoneRecordSchema,
  WorkspaceEvolutionDigestSchema,
  WorkspaceEvolutionGetDigestRequestSchema,
  WorkspaceEvolutionGetDigestResponseSchema,
} from "./evolution.js";

describe("Evolution schemas", () => {
  it("validates a valid AgentMilestoneRecord", () => {
    const record = {
      agentId: "agent-123",
      provider: "codex",
      model: "gemini-flash",
      startedAt: "2026-09-27T01:00:00.000Z",
      completedAt: "2026-09-27T01:30:00.000Z",
      durationMs: 1800000,
      status: "completed",
      intentPrompt: "调研 DocDB 集群部署方式",
      executiveSummary: "完成集群方案调研，推荐 Raft + S3",
      keyDecisions: ["使用 S3 共享存储", "对外提供 MongoDB 4.2 wire 协议"],
      modifiedFiles: ["docs/arch/docdb.md"],
      commits: [{ hash: "abc1234", message: "docs: add cluster spec" }],
    };
    expect(AgentMilestoneRecordSchema.parse(record)).toEqual(record);
  });

  it("validates WorkspaceEvolutionDigest", () => {
    const digest = {
      workspaceId: "wks_test_1",
      workspaceTitle: "glorious-eagle",
      branch: "feat/cluster",
      executiveSummary: "完成架构调研与核心代码改造",
      currentStage: "质量评审中",
      overallStatus: "in_progress",
      updatedAt: "2026-09-27T02:00:00.000Z",
      milestones: [],
    };
    expect(WorkspaceEvolutionDigestSchema.parse(digest)).toEqual(digest);
  });

  it("validates RPC request and response payloads", () => {
    const req = {
      type: "workspace.evolution.get_digest.request",
      requestId: "req_1",
      workspaceId: "wks_test_1",
      forceRefresh: false,
    };
    expect(WorkspaceEvolutionGetDigestRequestSchema.parse(req)).toEqual(req);

    const res = {
      type: "workspace.evolution.get_digest.response",
      requestId: "req_1",
      workspaceId: "wks_test_1",
      digest: null,
      isAnalyzing: false,
    };
    expect(WorkspaceEvolutionGetDigestResponseSchema.parse(res)).toEqual(res);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol/src/evolution.test.ts --bail=1`
Expected: FAIL with "Cannot find module ./evolution.js"

- [ ] **Step 3: Write minimal implementation in `packages/protocol`**

```typescript
// packages/protocol/src/evolution.ts
import { z } from "zod";

export const AgentMilestoneStatusSchema = z.enum(["running", "completed", "error", "cancelled"]);
export type AgentMilestoneStatus = z.infer<typeof AgentMilestoneStatusSchema>;

export const MilestoneCommitSchema = z.object({
  hash: z.string(),
  message: z.string(),
});
export type MilestoneCommit = z.infer<typeof MilestoneCommitSchema>;

export const AgentMilestoneRecordSchema = z.object({
  agentId: z.string(),
  provider: z.string(),
  model: z.string().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  durationMs: z.number(),
  status: AgentMilestoneStatusSchema,
  intentPrompt: z.string(),
  executiveSummary: z.string(),
  keyDecisions: z.array(z.string()),
  blockersResolved: z.array(z.string()).optional(),
  modifiedFiles: z.array(z.string()),
  createdArtifacts: z.array(z.string()).optional(),
  commits: z.array(MilestoneCommitSchema).optional(),
});
export type AgentMilestoneRecord = z.infer<typeof AgentMilestoneRecordSchema>;

export const OverallEvolutionStatusSchema = z.enum([
  "in_progress",
  "ready_for_review",
  "blocked",
  "completed",
]);
export type OverallEvolutionStatus = z.infer<typeof OverallEvolutionStatusSchema>;

export const WorkspaceEvolutionDigestSchema = z.object({
  workspaceId: z.string(),
  workspaceTitle: z.string(),
  branch: z.string(),
  executiveSummary: z.string(),
  currentStage: z.string(),
  overallStatus: OverallEvolutionStatusSchema,
  updatedAt: z.string(),
  milestones: z.array(AgentMilestoneRecordSchema),
});
export type WorkspaceEvolutionDigest = z.infer<typeof WorkspaceEvolutionDigestSchema>;

export const WorkspaceEvolutionGetDigestRequestSchema = z.object({
  type: z.literal("workspace.evolution.get_digest.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  forceRefresh: z.boolean().optional(),
});
export type WorkspaceEvolutionGetDigestRequest = z.infer<
  typeof WorkspaceEvolutionGetDigestRequestSchema
>;

export const WorkspaceEvolutionGetDigestResponseSchema = z.object({
  type: z.literal("workspace.evolution.get_digest.response"),
  requestId: z.string(),
  workspaceId: z.string(),
  digest: WorkspaceEvolutionDigestSchema.nullable(),
  isAnalyzing: z.boolean().optional(),
  error: z.string().optional(),
});
export type WorkspaceEvolutionGetDigestResponse = z.infer<
  typeof WorkspaceEvolutionGetDigestResponseSchema
>;
```

- [ ] **Step 4: Register exports in `packages/protocol/src/index.ts` and `packages/protocol/src/messages.ts`**
- Export all evolution schemas from `packages/protocol/src/index.ts`.
- Add `WorkspaceEvolutionGetDigestRequestSchema` to `SessionInboundMessageSchema`.
- Add `WorkspaceEvolutionGetDigestResponseSchema` to `SessionOutboundMessageSchema`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run packages/protocol/src/evolution.test.ts --bail=1`
Run: `npm run build:client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/
git commit -m "feat(protocol): add workspace evolution and agent milestone schemas and RPCs"
```

---

### Task 2: Server-Side Workspace Evolution Service & Caching

**Files:**

- Create: `packages/server/src/server/evolution/workspace-evolution-service.ts`
- Create: `packages/server/src/server/evolution/agent-milestone-summarizer.ts`
- Test: `packages/server/src/server/evolution/workspace-evolution-service.test.ts`
- Modify: `packages/server/src/server/session.ts`

**Interfaces:**

- Consumes:
  - `AgentManager`, `AgentStorage`, `WorkspaceRegistry`
  - `AgentMilestoneRecord`, `WorkspaceEvolutionDigest` from `@getpaseo/protocol`
- Produces:
  - `WorkspaceEvolutionService.getDigest(workspaceId, forceRefresh)`
  - `WorkspaceEvolutionService.recordAgentCompletion(agentId)`
  - Handling of `workspace.evolution.get_digest.request` in `Session`

- [ ] **Step 1: Write unit tests for `WorkspaceEvolutionService`**

```typescript
// packages/server/src/server/evolution/workspace-evolution-service.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceEvolutionService } from "./workspace-evolution-service.js";

describe("WorkspaceEvolutionService", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-evo-test-"));
  });

  it("reads existing cached digest if present", async () => {
    const service = new WorkspaceEvolutionService({
      cacheRoot: tmpDir,
      agentStorage: {} as any,
      workspaceRegistry: {
        getWorkspace: vi.fn().mockResolvedValue({
          workspaceId: "wks_1",
          displayName: "glorious-eagle",
          branch: "feat/cluster",
        }),
      } as any,
    });

    const cachedData = {
      workspaceId: "wks_1",
      workspaceTitle: "glorious-eagle",
      branch: "feat/cluster",
      executiveSummary: "已完成架构调研",
      currentStage: "已完成",
      overallStatus: "completed",
      updatedAt: new Date().toISOString(),
      milestones: [],
    };

    const wksDir = path.join(tmpDir, "wks_1");
    await fs.mkdir(wksDir, { recursive: true });
    await fs.writeFile(path.join(wksDir, "digest.json"), JSON.stringify(cachedData));

    const result = await service.getDigest("wks_1");
    expect(result.digest?.executiveSummary).toBe("已完成架构调研");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/src/server/evolution/workspace-evolution-service.test.ts --bail=1`
Expected: FAIL with "Cannot find module ./workspace-evolution-service.js"

- [ ] **Step 3: Implement `AgentMilestoneSummarizer` and `WorkspaceEvolutionService`**
- `AgentMilestoneSummarizer`: 从 Agent 的初始输入（Prompt）、Timeline Tool Calls（提取编辑过的文件列表与 Git 提交）以及最终文本输出中提取结构化信息；在无外部模型可用时支持确定性规则抽取回退。
- `WorkspaceEvolutionService`:
  - 维护 `$PASEO_HOME/cache/workspace-evolution/<workspaceId>/`
  - 使用 `writeJsonFileAtomic` 保证多 Agent 并发写入安全性。
  - 提供 `getDigest(workspaceId: string, options?: { forceRefresh?: boolean })`。
- [ ] **Step 4: Integrate into `packages/server/src/server/session.ts`**
- 在 `Session` 构造时挂载 `WorkspaceEvolutionService`。
- 在 `handleMessage` 中路由 `workspace.evolution.get_digest.request`。
- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run packages/server/src/server/evolution/workspace-evolution-service.test.ts --bail=1`
Run: `npm run build:server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server/evolution/ packages/server/src/server/session.ts
git commit -m "feat(server): implement WorkspaceEvolutionService with local atomic cache"
```

---

### Task 3: App Workspace Tab Integration & State Hook

**Files:**

- Modify: `packages/app/src/workspace-tabs/model.ts`
- Modify: `packages/app/src/workspace-tabs/identity.ts`
- Create: `packages/app/src/hooks/use-workspace-evolution.ts`
- Test: `packages/app/src/hooks/use-workspace-evolution.test.ts`

**Interfaces:**

- Consumes:
  - `DaemonClient` (`client.send`, `client.on`)
  - `workspace.evolution.get_digest.request`
- Produces:
  - `WorkspaceTabTarget` containing `{ kind: "reader"; workspaceId: string }`
  - `useWorkspaceEvolution(workspaceId)` hook returning `{ digest, isLoading, isAnalyzing, refresh }`

- [ ] **Step 1: Write test for `useWorkspaceEvolution` hook**

```typescript
// packages/app/src/hooks/use-workspace-evolution.test.ts
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react-hooks";
import { useWorkspaceEvolution } from "./use-workspace-evolution";

describe("useWorkspaceEvolution", () => {
  it("fetches digest on mount and sets data", async () => {
    const mockClient = {
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    };
    // Test hook loading and successful response state
  });
});
```

- [ ] **Step 2: Add `reader` kind to `WorkspaceTabTarget` in `packages/app/src/workspace-tabs/model.ts`**
- [ ] **Step 3: Implement `useWorkspaceEvolution` hook with RPC lifecycle handling**
- [ ] **Step 4: Run tests and verify tab target identity**

Run: `npx vitest run packages/app/src/workspace-tabs/identity.test.ts --bail=1`
Run: `npx vitest run packages/app/src/hooks/use-workspace-evolution.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/workspace-tabs/ packages/app/src/hooks/
git commit -m "feat(app): support reader tab target and add useWorkspaceEvolution hook"
```

---

### Task 4: UI Components for Agent Reader

**Files:**

- Create: `packages/app/src/screens/workspace/reader/workspace-reader-screen.tsx`
- Create: `packages/app/src/screens/workspace/reader/reader-header.tsx`
- Create: `packages/app/src/screens/workspace/reader/executive-summary-card.tsx`
- Create: `packages/app/src/screens/workspace/reader/evolution-timeline.tsx`
- Create: `packages/app/src/screens/workspace/reader/milestone-card.tsx`
- Test: `packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx` (挂载渲染)

**Interfaces:**

- Consumes:
  - `WorkspaceEvolutionDigest`, `AgentMilestoneRecord`
  - `useWorkspaceEvolution`
- Follows:
  - `docs/unistyles.md`: `StyleSheet.create((theme) => ...)` only. No `useUnistyles()`.
  - `docs/hover.md`: Web hover actions with native fallback.

- [ ] **Step 1: Write UI render tests for `WorkspaceReaderScreen`**

```typescript
// packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react-native";
import { WorkspaceReaderScreen } from "./workspace-reader-screen";

describe("WorkspaceReaderScreen", () => {
  it("renders empty state when no milestones exist", () => {
    // Assert empty placeholder
  });

  it("renders executive summary and milestones", () => {
    // Assert executive summary and timeline cards
  });
});
```

- [ ] **Step 2: Implement UI components conforming strictly to design**
- `ReaderHeader`: 展示工作区名称、当前分支、总耗时与重新提炼操作。
- `ExecutiveSummaryCard`: 展示整体演进状态胶囊、关键成果概览与修改文件总计。
- `EvolutionTimeline` & `MilestoneCard`: 垂直演进轴、阶段序号、Agent 元数据、目标 Prompt、关键技术决策列表（Bullets）、触碰文件胶囊与下钻按钮（“查看原始对话”）。
- [ ] **Step 3: Connect reader tab in `WorkspaceDesktopTabsRow` and render host**
- [ ] **Step 4: Run component tests and lint**

Run: `npx vitest run packages/app/src/screens/workspace/reader/workspace-reader-screen.test.tsx --bail=1`
Run: `npm run lint -- packages/app/src/screens/workspace/reader/`
Run: `npm run format:files -- packages/app/src/screens/workspace/reader/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/screens/workspace/reader/
git commit -m "feat(app): add WorkspaceReaderScreen and evolution timeline components"
```

---

### Task 5: End-to-End Real Project Verification (`glorious-eagle`)

**Files:**

- Create: `packages/server/src/server/evolution/glorious-eagle-verification.test.ts`

- [ ] **Step 1: Write verification script to load `/Users/jerry/.paseo/worktrees/01v9kkez/glorious-eagle` history**
- 读取其实际 4 个历史 Agent 运行数据（`0466a94c...`, `acabe4aa...`, `e974fb9c...`, `8371a586...`）。
- 运行 `WorkspaceEvolutionService` 进行增量解析并生成快照。
- 断言：成功提取 4 个阶段里程碑，正确识别出“架构调研”、“集群与 Standalone 切换改造”、“服务启动调试”和“代码审查”。
- [ ] **Step 2: Run verification test**

Run: `npx vitest run packages/server/src/server/evolution/glorious-eagle-verification.test.ts --bail=1`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/server/evolution/glorious-eagle-verification.test.ts
git commit -m "test(evolution): add real-world verification on glorious-eagle workspace"
```
