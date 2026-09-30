# Gitea Workflow 标签驱动双模架构与双向审批网关实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `gitea-workflow` 升级为基于 `agent-auto` 和 `agent-plan` 二元标签驱动的自动化工作流，废除 `agent-ready` 隐式触发，并支持 Issue 评论与 Paseo UI 的双向审批网关。

**Architecture:** Poller 调度器联合检索 `agent-auto` 与 `agent-plan`，通过 `resolveIssueWorkflowPreset` 路由至全自动预设（`gitea.issue-to-pr.auto`）或严格计划预设（`gitea.issue-to-pr.plan`）。在 Auto 模式下要求 Agent 在 Issue 评论区输出架构选型简报；在 Plan 模式下通过 `gitea.dual_approval_gate` 适配器挂起等待，双向监听 Gitea Issue 评论指令（如 `/approve`）与 Paseo UI 操作。

**Tech Stack:** TypeScript, Node.js, Vitest, Zod, Gitea REST API, Paseo Plugin API / Workflow Engine.

**Spec:** `docs/superpowers/specs/2026-09-30-gitea-workflow-tag-driven-modes-design.md`

## Global Constraints

- 废除 `agent-ready` 默认触发，无明确模式标签时 Poller 彻底忽略。
- Auto 模式必须在编码前向 Issue 评论区发布包含备选方案与决策理由的设计报告。
- 标签变更必须保持原子性：认领时移除触发标并添加 `agent-in-progress`；等待审批时添加 `agent-waiting-approval`；交付后替换为 `agent-delivered`。
- 冲突策略：同时存在 `agent-auto` 与 `agent-plan` 时，强制降级为 `agent-plan` 并在 Issue 回帖警告。

## Review Focus

1. **大小写与冒号变体**：`Agent-Auto`、`AGENT-PLAN`、`agent:auto`、`agent:plan` 均需正确识别归一化。
2. **防误触审批过滤**：Issue 评论若是引用内容（如 `> /approve`）或代码块，不应误判为审批指令。
3. **网关轮询网络抖动**：双向审批适配器轮询 Gitea 评论时遇到网络瞬断需静默重试，不得直接造成任务崩溃。
4. **用户反馈迭代循环**：在审批门禁处如果用户输入非审批指令（提出修改建议），需将反馈透传并回到上一 Agent 步骤。
5. **并发防重检查**：同一个 Issue 在上一次 Run 尚未结束时，不能因二次打标产生并发工作流。

---

### Task 1: 标签与触发模式类型定义 (`shared/types.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/shared/types.ts`
- Test: `plugin-custom/gitea-workflow/tests/schema.test.ts`

**Interfaces:**

- Produces:
  - `GiteaTriggerModeSchema: z.ZodEnum<["auto", "plan"]>`
  - `GiteaTriggerMode: "auto" | "plan"`
  - `TRIGGER_LABELS: { AUTO: string[]; PLAN: string[] }`
  - `LIFECYCLE_LABELS: { IN_PROGRESS: string; WAITING_APPROVAL: string; DELIVERED: string; FAILED: string }`

- [ ] **Step 1: 编写测试验证标签常数与模式 Schema**

在 `plugin-custom/gitea-workflow/tests/schema.test.ts` 添加：

```typescript
import { describe, it, expect } from "vitest";
import { GiteaTriggerModeSchema, TRIGGER_LABELS, LIFECYCLE_LABELS } from "../shared/types.js";

describe("Trigger Mode and Label Schemas", () => {
  it("validates valid trigger modes", () => {
    expect(GiteaTriggerModeSchema.parse("auto")).toBe("auto");
    expect(GiteaTriggerModeSchema.parse("plan")).toBe("plan");
    expect(() => GiteaTriggerModeSchema.parse("ready")).toThrow();
  });

  it("exports expected trigger and lifecycle labels", () => {
    expect(TRIGGER_LABELS.AUTO).toContain("agent-auto");
    expect(TRIGGER_LABELS.AUTO).toContain("agent:auto");
    expect(TRIGGER_LABELS.PLAN).toContain("agent-plan");
    expect(TRIGGER_LABELS.PLAN).toContain("agent:plan");
    expect(LIFECYCLE_LABELS.IN_PROGRESS).toBe("agent-in-progress");
    expect(LIFECYCLE_LABELS.WAITING_APPROVAL).toBe("agent-waiting-approval");
    expect(LIFECYCLE_LABELS.DELIVERED).toBe("agent-delivered");
    expect(LIFECYCLE_LABELS.FAILED).toBe("agent-failed");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/schema.test.ts --bail=1`  
预期：FAIL，找不到 `GiteaTriggerModeSchema` 或 `TRIGGER_LABELS`。

- [ ] **Step 3: 在 `shared/types.ts` 中实现类型与常量**

在 `plugin-custom/gitea-workflow/shared/types.ts` 中导出：

```typescript
export const GiteaTriggerModeSchema = z.enum(["auto", "plan"]);
export type GiteaTriggerMode = z.infer<typeof GiteaTriggerModeSchema>;

export const TRIGGER_LABELS = {
  AUTO: ["agent-auto", "agent:auto"],
  PLAN: ["agent-plan", "agent:plan"],
} as const;

export const LIFECYCLE_LABELS = {
  IN_PROGRESS: "agent-in-progress",
  WAITING_APPROVAL: "agent-waiting-approval",
  DELIVERED: "agent-delivered",
  FAILED: "agent-failed",
} as const;
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/schema.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add plugin-custom/gitea-workflow/shared/types.ts plugin-custom/gitea-workflow/tests/schema.test.ts
git commit -m "feat(gitea-workflow): define trigger modes and lifecycle labels

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 实现标签解析器与模式分流器 (`server/preset-resolver.ts`)

**Files:**

- Create: `plugin-custom/gitea-workflow/server/preset-resolver.ts`
- Test: `plugin-custom/gitea-workflow/tests/preset-resolver.test.ts`

**Interfaces:**

- Consumes: `TRIGGER_LABELS`, `GiteaTriggerMode` from `shared/types.js`
- Produces:

  ```typescript
  export interface ResolvedWorkflowTarget {
    presetId: string;
    mode: GiteaTriggerMode;
    conflictWarning: boolean;
    matchedTriggerLabel: string;
  }
  export function resolveIssueWorkflowPreset(
    labels: Array<{ name: string }>,
  ): ResolvedWorkflowTarget | null;
  ```

- [ ] **Step 1: 编写测试验证解析规则与边界用例**

创建 `plugin-custom/gitea-workflow/tests/preset-resolver.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { resolveIssueWorkflowPreset } from "../server/preset-resolver.js";

describe("resolveIssueWorkflowPreset", () => {
  it("resolves agent-auto to auto preset", () => {
    const res = resolveIssueWorkflowPreset([{ name: "bug" }, { name: "agent-auto" }]);
    expect(res).toEqual({
      presetId: "gitea.issue-to-pr.auto",
      mode: "auto",
      conflictWarning: false,
      matchedTriggerLabel: "agent-auto",
    });
  });

  it("resolves agent:plan to plan preset with case insensitivity", () => {
    const res = resolveIssueWorkflowPreset([{ name: "AGENT:PLAN" }]);
    expect(res).toEqual({
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: false,
      matchedTriggerLabel: "AGENT:PLAN",
    });
  });

  it("safely demotes to plan preset when both auto and plan tags coexist", () => {
    const res = resolveIssueWorkflowPreset([{ name: "agent-auto" }, { name: "agent-plan" }]);
    expect(res).toEqual({
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: true,
      matchedTriggerLabel: "agent-plan",
    });
  });

  it("returns null when no trigger tags are present", () => {
    const res = resolveIssueWorkflowPreset([{ name: "agent-ready" }, { name: "feature" }]);
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/preset-resolver.test.ts --bail=1`  
预期：FAIL，模块未找到。

- [ ] **Step 3: 实现 `server/preset-resolver.ts`**

编写 `plugin-custom/gitea-workflow/server/preset-resolver.ts`：

```typescript
import { TRIGGER_LABELS, type GiteaTriggerMode } from "../shared/types.js";

export interface ResolvedWorkflowTarget {
  presetId: string;
  mode: GiteaTriggerMode;
  conflictWarning: boolean;
  matchedTriggerLabel: string;
}

export function resolveIssueWorkflowPreset(
  labels: Array<{ name: string }>,
): ResolvedWorkflowTarget | null {
  const autoTag = labels.find((l) =>
    (TRIGGER_LABELS.AUTO as readonly string[]).includes(l.name.trim().toLowerCase()),
  );
  const planTag = labels.find((l) =>
    (TRIGGER_LABELS.PLAN as readonly string[]).includes(l.name.trim().toLowerCase()),
  );

  if (autoTag && planTag) {
    return {
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: true,
      matchedTriggerLabel: planTag.name,
    };
  }

  if (autoTag) {
    return {
      presetId: "gitea.issue-to-pr.auto",
      mode: "auto",
      conflictWarning: false,
      matchedTriggerLabel: autoTag.name,
    };
  }

  if (planTag) {
    return {
      presetId: "gitea.issue-to-pr.plan",
      mode: "plan",
      conflictWarning: false,
      matchedTriggerLabel: planTag.name,
    };
  }

  return null;
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/preset-resolver.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add plugin-custom/gitea-workflow/server/preset-resolver.ts plugin-custom/gitea-workflow/tests/preset-resolver.test.ts
git commit -m "feat(gitea-workflow): add resolveIssueWorkflowPreset logic

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 升级预设 DAG (`server/presets/issue-to-pr.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/presets/issue-to-pr.ts`
- Modify: `plugin-custom/gitea-workflow/tests/preset.test.ts`

**Interfaces:**

- Produces:
  - `buildAutoWorkflowDefinition(): { steps: StepDefinition[] }`
  - `buildPlanWorkflowDefinition(): { steps: StepDefinition[] }`
  - Presets registered: `gitea.issue-to-pr.auto` and `gitea.issue-to-pr.plan`

- [ ] **Step 1: 编写测试验证 Auto 与 Plan 预设的 DAG 拓扑**

更新 `plugin-custom/gitea-workflow/tests/preset.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import {
  buildAutoWorkflowDefinition,
  buildPlanWorkflowDefinition,
} from "../server/presets/issue-to-pr.js";

describe("Gitea Workflow Presets (Auto & Plan)", () => {
  it("builds auto workflow without intermediate approval gates but with auto-design", () => {
    const def = buildAutoWorkflowDefinition();
    const ids = def.steps.map((s) => s.id);

    expect(ids).toContain("claim-issue");
    expect(ids).toContain("worktree-create");
    expect(ids).toContain("auto-design");
    expect(ids).toContain("implement-agent");
    expect(ids).toContain("verify-command");
    expect(ids).toContain("independent-review");
    expect(ids).toContain("resolve-delivery");
    expect(ids).toContain("git-push");
    expect(ids).toContain("git-create-pr");

    // No approval gates in auto mode
    expect(ids).not.toContain("gate-brainstorm");
    expect(ids).not.toContain("gate-spec");
    expect(ids).not.toContain("gate-plan");
    expect(ids).not.toContain("gate-delivery");
  });

  it("builds plan workflow with dual approval gates at each stage", () => {
    const def = buildPlanWorkflowDefinition();
    const ids = def.steps.map((s) => s.id);

    expect(ids).toContain("brainstorm-agent");
    expect(ids).toContain("gate-brainstorm");
    expect(ids).toContain("spec-agent");
    expect(ids).toContain("gate-spec");
    expect(ids).toContain("plan-agent");
    expect(ids).toContain("gate-plan");
    expect(ids).toContain("implement-agent");
    expect(ids).toContain("gate-delivery");
    expect(ids).toContain("git-create-pr");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/preset.test.ts --bail=1`  
预期：FAIL，缺少新导出函数。

- [ ] **Step 3: 在 `server/presets/issue-to-pr.ts` 中实现两个预设**

重构 `plugin-custom/gitea-workflow/server/presets/issue-to-pr.ts`：

- 导出 `buildAutoWorkflowDefinition()`：构建包含 `auto-design`（`gitea.agent_execute` 且 `phase: "auto_design"`）的流畅 DAG。
- 导出 `buildPlanWorkflowDefinition()`：构建包含各个 `gitea.dual_approval_gate` 门禁节点的严格 DAG。
- 导出预设对象 `giteaIssueToPrAutoPreset` 与 `giteaIssueToPrPlanPreset` 供插件索引注册。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/preset.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add plugin-custom/gitea-workflow/server/presets/issue-to-pr.ts plugin-custom/gitea-workflow/tests/preset.test.ts
git commit -m "feat(gitea-workflow): add auto and plan workflow DAG definitions

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 升级认领适配器支持动态剥标 (`server/adapters/claim-issue.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/adapters/claim-issue.ts`
- Modify: `plugin-custom/gitea-workflow/tests/step-adapters.test.ts`

**Interfaces:**

- Consumes: `TRIGGER_LABELS`, `LIFECYCLE_LABELS` from `shared/types.js`
- Produces: `gitea.claim_issue` step execution that atomically removes `agent-auto` / `agent-plan` and attaches `agent-in-progress`.

- [ ] **Step 1: 编写测试验证触发标剥除与 `in-progress` 替换**

在 `plugin-custom/gitea-workflow/tests/step-adapters.test.ts` 添加：

```typescript
it("claims issue with agent-auto and transitions to agent-in-progress", async () => {
  const mockClient = {
    getIssue: vi.fn().mockResolvedValue({
      number: 88,
      labels: [{ name: "agent-auto", id: 201 }],
    }),
    claimIssue: vi.fn().mockResolvedValue(undefined),
  };
  const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };
  const adapter = createClaimIssueAdapter(mockPool as any);

  const res = await adapter.execute(
    {
      baseUrl: "https://git.example.com",
      token: "tok",
      repoOwner: "org",
      repoName: "repo",
      issueNumber: 88,
    },
    { paseo: {} as any, run: { runId: "r88" } } as any,
  );

  expect(res.claimed).toBe(true);
  expect(mockClient.claimIssue).toHaveBeenCalledWith(88, 201);
});
```

- [ ] **Step 2: 运行测试验证现有行为与预期**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/step-adapters.test.ts --bail=1`

- [ ] **Step 3: 修改 `claim-issue.ts` 识别全量触发标**

在 `plugin-custom/gitea-workflow/server/adapters/claim-issue.ts` 中：
检查 `issue.labels`，只要命中 `TRIGGER_LABELS.AUTO` 或 `TRIGGER_LABELS.PLAN`（以及传入的 `listenLabel`），提取该标签的 ID，调用 `client.claimIssue(issueNumber, matchedLabel.id)`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/step-adapters.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add plugin-custom/gitea-workflow/server/adapters/claim-issue.ts plugin-custom/gitea-workflow/tests/step-adapters.test.ts
git commit -m "feat(gitea-workflow): support multi-trigger label stripping in claim_issue

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 实现双向审批网关适配器 (`server/adapters/dual-approval-gate.ts`)

**Files:**

- Create: `plugin-custom/gitea-workflow/server/adapters/dual-approval-gate.ts`
- Test: `plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts`
- Modify: `plugin-custom/gitea-workflow/server/adapters/index.ts`

**Interfaces:**

- Produces: `createDualApprovalGateAdapter(clientPool: GiteaClientPool): PluginWorkflowStepAdapterRegistration`
- Command matching regex: `/^\/(approve|lgtm|proceed|yes)\b|^(同意|确认|批准|通过)$|^方案?\s*([a-c])$/i`

- [ ] **Step 1: 编写测试验证指令解析与双向审批状态机**

创建 `plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { isApprovalComment, isOptionSelection } from "../server/adapters/dual-approval-gate.js";

describe("Dual Approval Gate Comment Parsing", () => {
  it("recognizes approval commands in multiple formats", () => {
    expect(isApprovalComment("/approve")).toBe(true);
    expect(isApprovalComment("同意")).toBe(true);
    expect(isApprovalComment("lgtm")).toBe(true);
    expect(isApprovalComment("确认通过")).toBe(true);
    expect(isApprovalComment("方案A")).toBe(true);
    expect(isApprovalComment("A")).toBe(true);
  });

  it("ignores markdown quotes and casual discussion", () => {
    expect(isApprovalComment("> /approve")).toBe(false);
    expect(isApprovalComment("这个方案我觉得不太行")).toBe(false);
  });

  it("extracts option selection correctly", () => {
    expect(isOptionSelection("选方案 B")).toBe("B");
    expect(isOptionSelection("方案 A")).toBe("A");
    expect(isOptionSelection("C")).toBe("C");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts --bail=1`  
预期：FAIL，模块未找到。

- [ ] **Step 3: 实现 `dual-approval-gate.ts`**

创建 `plugin-custom/gitea-workflow/server/adapters/dual-approval-gate.ts`：

- 导出 `isApprovalComment` 与 `isOptionSelection` 工具函数；
- 实现 `createDualApprovalGateAdapter`：
  - 启动阶段：在 Gitea Issue 发布阶段方案评论并挂上 `agent-waiting-approval` 标签；
  - 轮询阶段：监听自挂起时间以后的新评论；检测到审批命令后，清理 `agent-waiting-approval` 并放行；
  - 支持 Paseo UI 原生审批结束事件触发标签清理。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 在 `server/adapters/index.ts` 中注册并提交更改**

```bash
git add plugin-custom/gitea-workflow/server/adapters/dual-approval-gate.ts plugin-custom/gitea-workflow/server/adapters/index.ts plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts
git commit -m "feat(gitea-workflow): implement dual approval gate adapter

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 改造 Poller 调度器 (`server/poller.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/poller.ts`
- Modify: `plugin-custom/gitea-workflow/tests/poller.test.ts`

**Interfaces:**

- Consumes: `resolveIssueWorkflowPreset` from `./preset-resolver.js`
- Connects: Poller fetches issues matching `agent-auto` or `agent-plan`, selects preset, and dispatches.

- [ ] **Step 1: 编写测试验证多模式分发与冲突降级**

更新 `plugin-custom/gitea-workflow/tests/poller.test.ts`：

```typescript
it("dispatches to gitea.issue-to-pr.auto for agent-auto tag", async () => {
  // Mock client returns issue with agent-auto
  // Verify workflows.runCreate receives workflowId: 'gitea.issue-to-pr.auto'
});

it("dispatches to gitea.issue-to-pr.plan for agent-plan tag", async () => {
  // Mock client returns issue with agent-plan
  // Verify workflows.runCreate receives workflowId: 'gitea.issue-to-pr.plan'
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`

- [ ] **Step 3: 改造 `server/poller.ts` 调度分流逻辑**

在 `plugin-custom/gitea-workflow/server/poller.ts` 中：

- `clientPool` 获取 issues 时查询包含 `agent-auto` 或 `agent-plan` 的 Issue；
- 对每个 Issue 调用 `resolveIssueWorkflowPreset(issue.labels)`；
- 若解析为 `null`，直接跳过；
- 根据解析返回的 `presetId` 调用 `workflows.runCreate`，并在 input 中传递 `mode` 与 `conflictWarning`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add plugin-custom/gitea-workflow/server/poller.ts plugin-custom/gitea-workflow/tests/poller.test.ts
git commit -m "feat(gitea-workflow): upgrade poller with tag-driven dispatch

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 完整端到端与代码规范验证

**Files:**

- Test: `plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts`
- All modified codebase files

- [ ] **Step 1: 编写端到端双模执行集成测试**

在 `plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts` 中覆盖：

- 完整 Auto 流程跑通测试（验证设计评论产出与非阻塞 PR 创建）；
- 完整 Plan 流程跑通测试（验证 `agent-waiting-approval` 上标与 Issue 评论 `/approve` 解锁）。

- [ ] **Step 2: 运行相关测试套件**

运行：
`npx vitest run plugin-custom/gitea-workflow/tests/preset-resolver.test.ts plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts plugin-custom/gitea-workflow/tests/poller.test.ts plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts --bail=1`  
预期：所有测试 PASS。

- [ ] **Step 3: 运行全项目类型与 Lint 校验**

运行：`npm run typecheck`  
运行：`npm run lint`  
运行：`npm run format:check`

- [ ] **Step 4: 最终提交**

```bash
git add .
git commit -m "feat(gitea-workflow): complete tag-driven modes and dual approval gate integration

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
