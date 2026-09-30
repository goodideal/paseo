# Gitea Workflow 逻辑缺陷与端到端闭环修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 彻底修复 `plugin-custom/gitea-workflow` 在标签流转、Agent 执行等待、方案产出物透传、评论去重防时钟偏差、Worktree 定位以及 PR 关联中的 7 处核心逻辑缺陷，实现稳定可靠的 Gitea Issue-to-PR 闭环。

**Architecture:**

1. 在 `MultiProjectPoller` 中补齐 `completed` 终态的 `agent-delivered` 标签原子流转；
2. 在双向审批门禁与 Poller 中基于 Gitea Comment ID（而非脆弱的时间戳）实现增量过滤，杜绝时钟漂移与历史评论误放行；
3. 改造 `gitea.agent_execute` 适配器：基于 `agentHandle.run()` 真实等待 Agent 完成并捕获输出文本，严防多 Worktree 模糊匹配串乱；
4. 将上游 Agent 的方案产出物（A/B/C 选型或设计摘要）动态注入 Gitea 门禁评论；
5. 在 `git.create_pr` 与 `resolve-delivery` 中注入 `Resolves #${issueNumber}`，确保 Gitea 强关联与自动关闭。

**Tech Stack:** TypeScript, Vitest, Zod, Gitea REST API, Paseo Plugin API / Workflow Engine.

**Spec:** `docs/superpowers/specs/2026-09-30-gitea-workflow-tag-driven-modes-design.md`

## Global Constraints

- 保持向前兼容，不破坏现有 `IssueRunIndexStore` 结构与配置契约。
- 标签变更保持原子性：认领时移除触发标并加 `agent-in-progress`；门禁时加 `agent-waiting-approval`；完成时移除 `in-progress` 并加 `agent-delivered`；失败时加 `agent-failed`。
- 去时钟偏差：禁止依赖 `new Date(comment.created_at) >= pending.createdAt - 2000` 这种毫秒窗口，必须基于 `baselineCommentId` 或 ID 增量比对。
- 工作区强隔离：Agent 执行工作区必须精确绑定当前 `runId` 的 Worktree，禁止盲目 fallback 到首个 worktree。

## Review Focus

1. **Agent 异步等待超时控制**：确保 `agentHandle.run()` 具有合理的超时与错误捕获机制，不能无限阻塞工作流步骤。
2. **多门禁连续流转防串扰**：`gate-brainstorm`、`gate-spec`、`gate-plan` 依次放行时，各门禁必须独立计算基线 Comment ID，杜绝上一门禁的 `/approve` 放行下一门禁。
3. **方案内容过长时的 Markdown 截断**：Agent 产出内容若超长，需安全缩略或结构化呈现，避免 Gitea 评论 API 拒绝或排版崩坏。
4. **工作区找不到时的安全失败**：若因意外未创建出对应 `runId` 的 Worktree，明确抛错终止，不可静默降级到宿主主工作目录。
5. **Gitea 标签不存在时的容错**：添加或删除标签时遇到 404 或无权限时做平滑降级，不得阻断整个工作流的主干执行。

---

### Task 1: 补全任务完成终态的 `agent-delivered` 标签原子流转 (`server/poller.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/poller.ts:205-240`
- Test: `plugin-custom/gitea-workflow/tests/poller.test.ts`

**Interfaces:**

- Consumes: `client.removeIssueLabel`, `client.addIssueLabel`, `LIFECYCLE_LABELS` from `../shared/types.js`
- Produces: 任务在 `status === "completed"` 时自动移除 `agent-in-progress` / `agent-waiting-approval` 并添加 `agent-delivered`。

- [x] **Step 1: 编写测试验证 completed 状态下的标签流转**

在 `plugin-custom/gitea-workflow/tests/poller.test.ts` 中添加测试：

```typescript
it("updates issue labels to agent-delivered when workflow run completes", async () => {
  // 模拟 inspected.run.status 为 completed
  // 验证 client.removeIssueLabel 被调用移除了 agent-in-progress 和 agent-waiting-approval
  // 验证 client.addIssueLabel 被调用添加了 agent-delivered
});
```

- [x] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`  
预期：FAIL（目前 completed 分支未调用 label 更新）。

- [x] **Step 3: 修改 `server/poller.ts` 终态分支**

在 `server/poller.ts` 的 `inspected?.run?.status === "completed"` 分支补充：

```typescript
if (inspected.run.status === "completed") {
  await client.removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.IN_PROGRESS).catch(() => {});
  await client
    .removeIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.WAITING_APPROVAL)
    .catch(() => {});
  await client.addIssueLabel(entry.issueNumber, LIFECYCLE_LABELS.DELIVERED).catch(() => {});
}
```

- [x] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`  
预期：PASS。

- [x] **Step 5: 提交代码**

```bash
git add plugin-custom/gitea-workflow/server/poller.ts plugin-custom/gitea-workflow/tests/poller.test.ts
git commit -m "fix(gitea-workflow): attach agent-delivered label when workflow run completes"
```

---

### Task 2: 改造审批网关消除时钟漂移与历史评论复用 (`server/poller.ts` & `dual-approval-gate.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/poller.ts`
- Modify: `plugin-custom/gitea-workflow/server/adapters/dual-approval-gate.ts`
- Test: `plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts`
- Test: `plugin-custom/gitea-workflow/tests/poller.test.ts`

**Interfaces:**

- Consumes: `client.listIssueComments(issueNumber)`
- Produces: 基于 Comment ID 的增量判据，彻底摒弃 `commentTime >= pending.createdAt - 2000` 这种毫秒脆弱判断。

- [x] **Step 1: 编写测试验证基于 Comment ID 的过滤与旧评论隔离**

在 `plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts` 中添加测试：

```typescript
it("ignores old approval comments created prior to gate creation and only accepts newer comment IDs", async () => {
  // 提供历史 /approve 评论 (id: 100) 与新 /approve 评论 (id: 105)
  // 确保只有 id > baselineCommentId 的新评论触发放行
});
```

- [x] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts --bail=1`

- [x] **Step 3: 修改 `dual-approval-gate.ts` 与 `poller.ts`**

1. 在挂起门禁初次发帖前，先获取当前该 Issue 已有的最大评论 ID 作为 `baselineCommentId`：

```typescript
const existingComments = await client.listIssueComments(issueNumber).catch(() => []);
const baselineCommentId = existingComments.reduce((max, c) => Math.max(max, c.id), 0);
```

2. 轮询时仅检查 `c.id > baselineCommentId` 的评论；
3. 命中 `isApprovalComment(c.body)` 时放行；若是自然语言修改反馈，记录至上下文备选。

- [x] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts --bail=1`  
预期：PASS。

- [x] **Step 5: 提交代码**

```bash
git add plugin-custom/gitea-workflow/server/adapters/dual-approval-gate.ts plugin-custom/gitea-workflow/server/poller.ts plugin-custom/gitea-workflow/tests/dual-approval-gate.test.ts
git commit -m "fix(gitea-workflow): use incremental comment IDs to eliminate clock skew in approval gates"
```

---

### Task 3: 改造 `agent-execute.ts` 实现真实等待与精确 Worktree 定位 (`server/adapters/agent-execute.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/adapters/agent-execute.ts`
- Create: `plugin-custom/gitea-workflow/tests/agent-execute.test.ts`

**Interfaces:**

- Consumes: `paseo.agents.create`, `agentHandle.run` or `agentHandle.waitForFinish`
- Produces: `{ agentId, status: "succeeded", outcome: string, summary: string }`

- [x] **Step 1: 编写 `agent-execute` 单元测试**

在 `plugin-custom/gitea-workflow/tests/agent-execute.test.ts` 中测试：

- 严格基于 `runId` 匹配 worktree 目录，未找到且无 worktree 时抛出明确异常；
- 验证调用 `agentHandle.run()` 并等待返回，提取 `lastMessage` 作为 `summary` 返回。

- [x] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/agent-execute.test.ts --bail=1`

- [x] **Step 3: 重构 `server/adapters/agent-execute.ts`**

1. 精确匹配工作空间：

```typescript
const match = list.entries.find(
  (w: any) => runId && (w.workspaceDirectory?.includes(runId) || w.name?.includes(runId)),
);
if (!match?.workspaceDirectory) {
  throw new Error(`Cannot locate worktree workspace for workflow run ${runId}`);
}
```

2. 真实等待 Agent 执行完成：

```typescript
const runResult = await agentHandle.run(prompt, { timeoutMs: 30 * 60 * 1000 });
if (runResult.status !== "idle") {
  throw new Error(`Agent run failed with status: ${runResult.status}, error: ${runResult.error}`);
}
const summary = runResult.lastMessage || "Completed phase execution.";
return {
  agentId: agentHandle.id,
  status: "succeeded",
  outcome: summary,
  summary,
};
```

- [x] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/agent-execute.test.ts --bail=1`  
预期：PASS。

- [x] **Step 5: 提交代码**

```bash
git add plugin-custom/gitea-workflow/server/adapters/agent-execute.ts plugin-custom/gitea-workflow/tests/agent-execute.test.ts
git commit -m "fix(gitea-workflow): await agent completion and ensure strict worktree targeting"
```

---

### Task 4: 门禁评论动态注入 Agent 方案产出物 (`server/poller.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/poller.ts`
- Test: `plugin-custom/gitea-workflow/tests/poller.test.ts`

**Interfaces:**

- Consumes: 上游步骤输出 `inspected.run.steps[i].output.summary`
- Produces: 包含真实方案 A/B/C 的 Gitea Issue 门禁评论正文。

- [x] **Step 1: 编写测试验证方案内容注入**

在 `plugin-custom/gitea-workflow/tests/poller.test.ts` 中测试：

- 当 `pending.stepId` 为 `gate-brainstorm` 时，从上一步骤 `brainstorm-agent` 的 output 中提取方案 Markdown；
- 验证发出的 Issue 评论包含该方案文本。

- [x] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`

- [x] **Step 3: 修改 `server/poller.ts` 评论构造逻辑**

在 `poller.ts` 发送门禁评论前，提取上游 Agent 步骤的 `summary`：

```typescript
let proposalDetail = pending.policyReason || "当前阶段需要人工确认后方可继续执行。";
const stepOutputs = inspected?.run?.stepOutputs || {};
// 查找上一个 agent_execute 步骤的产出
for (const [stepKey, stepOut] of Object.entries(stepOutputs)) {
  if (stepOut && typeof (stepOut as any).summary === "string" && (stepOut as any).summary.trim()) {
    proposalDetail = (stepOut as any).summary.trim();
  }
}
```

构造富文本格式并发布到 Gitea Issue。

- [x] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`  
预期：PASS。

- [x] **Step 5: 提交代码**

```bash
git add plugin-custom/gitea-workflow/server/poller.ts plugin-custom/gitea-workflow/tests/poller.test.ts
git commit -m "feat(gitea-workflow): inject agent proposals directly into gate comments"
```

---

### Task 5: PR 标题/描述注入 Issue 关联语法 (`server/presets/issue-to-pr.ts` & `resolve-delivery.ts`)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/presets/issue-to-pr.ts`
- Modify: `plugin-custom/gitea-workflow/server/adapters/resolve-delivery.ts`
- Test: `plugin-custom/gitea-workflow/tests/preset.test.ts`
- Test: `plugin-custom/gitea-workflow/tests/step-adapters.test.ts`

**Interfaces:**

- Produces: PR 标题包含 `(#<issueNumber>)`，PR 正文包含 `Resolves #<issueNumber>` 语法。

- [x] **Step 1: 编写测试验证 PR 关联模板**

在 `plugin-custom/gitea-workflow/tests/preset.test.ts` 中测试：

- 验证预设生成的 `git.create_pr` 步骤带有动态格式化模板或引用；
- 验证 `resolve-delivery` 生成的 manifest 明确标记 `Resolves #${issueNumber}`。

- [x] **Step 2: 运行测试验证失败**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/preset.test.ts --bail=1`

- [x] **Step 3: 修改 `resolve-delivery.ts` 与 `issue-to-pr.ts`**

在 `resolve-delivery.ts` 中：

```typescript
const pullRequestTitle =
  input.pullRequestTitle ||
  (issueNumber ? `fix: resolve issue #${issueNumber}` : "Automated Delivery");
const pullRequestBody =
  input.pullRequestBody ||
  (issueNumber ? `### Automated Implementation\n\nResolves #${issueNumber}\n` : "");
```

- [x] **Step 4: 运行测试验证通过**

运行：`npx vitest run plugin-custom/gitea-workflow/tests/preset.test.ts plugin-custom/gitea-workflow/tests/step-adapters.test.ts --bail=1`  
预期：PASS。

- [x] **Step 5: 提交代码**

```bash
git add plugin-custom/gitea-workflow/server/presets/issue-to-pr.ts plugin-custom/gitea-workflow/server/adapters/resolve-delivery.ts plugin-custom/gitea-workflow/tests/preset.test.ts plugin-custom/gitea-workflow/tests/step-adapters.test.ts
git commit -m "fix(gitea-workflow): auto-link and close issues via PR title and description"
```

---

### Task 6: 全链路回归验证与静态质量门禁

**Files:**

- All modified files

- [x] **Step 1: 运行全量插件测试套件**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/ --bail=1
```

预期：所有测试全部 PASS。

- [x] **Step 2: 运行类型检查与 Lint 检查**

运行：

```bash
npm run typecheck
npm run lint
npm run format:check
```

预期：0 errors, 0 warnings。

- [x] **Step 3: 最终整合提交**

```bash
git add .
git commit -m "chore(gitea-workflow): complete logic hardening and closed-loop verification"
```
