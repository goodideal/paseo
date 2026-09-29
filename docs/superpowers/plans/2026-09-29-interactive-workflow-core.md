# 交互式 Workflow Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Paseo Workflow Engine 中加入可等待/续接的 Agent 步骤、自由文本交互、受控产物暴露与不可变交付批准，使任何 Workflow preset 都能可靠地编排人机协作阶段。

**Architecture:** 保留既有 `WorkflowRun`、DAG scheduler、审批、intent/receipt、artifact 和 session 体系。将交互作为 Run 的持久化数据和一个新的核心等待步骤；将 Agent 的“运行到完成”与“同会话续接”作为通用 core step adapter；通过新 capability-gated protocol surface 向 App、client SDK 和插件暴露交互与受控产物，而不泄露内部步骤对象。

**Tech Stack:** TypeScript、Zod、Paseo WebSocket protocol、file-backed WorkflowStore、AgentManager、React Native/Expo、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-29-gitea-superpowers-workflow-design.md`

## Global Constraints

- 在既有 `packages/server/src/server/workflows/`、`packages/protocol/src/workflow/`、`packages/server/src/server/session/workflow/` 和 `packages/app/src/panels/` 上增量实现，禁止重建现有 Workflow Engine。
- 所有新增 wire 字段必须为 `.optional()`；不得收窄、移除或将既有字段改为必填。
- 新 RPC 使用 `workflow.<namespace>.<verb>.request` / `.response`；请求参数顶层、结果位于 `payload`，双方都有 `requestId`。
- WebSocket Zod schema 只能是纯结构声明：禁止 `.transform()`、`.catch()`、`.preprocess()`；共享 literal tag 时使用 `z.discriminatedUnion()`。
- 增加 `server_info.features.workflowInteractions`，在连接边界 gate 一次；旧 Host 显示更新提示，不实现不可审计的 fallback。
- 不能向旧 wire status enum 新增会破坏解析的 literal；新交互状态以可选 projection 字段表达，旧客户端仍能解析既有 Run 状态。
- `approval.wait` 继续只承载批准/拒绝；自由文本反馈使用 `interaction.wait`，请求修改不等同于拒绝。
- Agent 的最终输出与 handoff 通过受控 artifact 暴露，必须有大小限制和敏感数据清理；任何无效 handoff 都使 Run `blocked`。
- 交付批准必须绑定源分支、目标分支、提交 SHA、PR 标题/正文摘要和关联 Issue 的不可变 manifest；任一内容变化必须重新批准。
- 每次 protocol 改动后先运行 `npm run build:client`；每次 server 消费跨包声明前运行 `npm run build:server`，再诊断类型错误。
- 每个任务只运行相关 Vitest 文件：`npx vitest run <file> --bail=1`；禁止本地全量测试套件。
- 每个提交末尾添加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

1. **新 daemon + 旧 App：**含 pending interaction 的 Run 仍使用旧端能解析的状态和可选字段；旧端只能看到需要更新提示，不能因新 enum 或必填字段断连。由任务 2 的 wire-compat 测试固定。
2. **无效 handoff：**Agent 缺少、截断或输出非法 `paseo-workflow-handoff` 时，保留最终输出 artifact 并转 `blocked`，绝不自动进入下一阶段。由任务 4 的 executor 测试固定。
3. **多重交互响应：**重复、过期或属于其他 scope 的 interaction response 不得续接第二轮 Agent，也不得覆盖首个回答。由任务 3 和任务 7 的 service/session 测试固定。
4. **权限阻塞：**`agent.run_until_complete` 在 provider 请求权限、Agent 失败、取消或关闭时必须结束等待并记录确定状态，不能永久挂起。由任务 4 的多终态测试固定。
5. **交付内容漂移：**批准后修改 branch、SHA、PR 内容或关联 Issue 必须使 delivery approval 失效；超时恢复先解析远端 receipt，不能重复 push/建 PR。由任务 5 的 e2e 测试固定。

---

## Phase 1 Gate

在开始 Gitea 插件计划前，必须完成本计划全部任务，并让通用 e2e 流程通过：**Agent 提问 → 用户文本回复 → 同会话续接 → 结构化 handoff → 明确批准 → artifact 可见**。该 e2e 不依赖 Gitea。

### Task 1: 为 Run 添加交互、handoff 与交付 manifest 领域模型

**Files:**

- Modify: `packages/server/src/server/workflows/workflow-models.ts`
- Modify: `packages/server/src/server/workflows/workflow-service.test.ts`
- Modify: `packages/server/src/server/workflows/workflow-core.test.ts`

**Interfaces:**

- Produces: `WorkflowInteraction`, `WorkflowInteractionStatus`, `WorkflowAgentHandoff`, `DeliveryApprovalManifest` 的 Zod 推断类型。
- Produces: `WorkflowRun.interactions`、`WorkflowRun.deliveryApprovalManifest` 的持久化字段；后续任务只通过这些字段读取交互/manifest。
- Consumes: 既有 `IdentifierSchema`、`TimestampSchema`、`WorkflowArtifactSchema`、`WorkflowApprovalSchema`。

- [ ] **Step 1: 写入 Run 序列化与严格 schema 的失败测试**

在 `workflow-service.test.ts` 添加用例，构造一个含 pending interaction、answer artifact 和 delivery manifest 的 Run，经 store 写回后断言其完整保留；再断言缺 `runId`、缺 `promptArtifactId` 或 manifest 缺 `commitSha` 时 schema 拒绝：

```ts
expect(
  WorkflowInteractionSchema.parse({
    id: "interaction_1",
    runId: "run_1",
    stepId: "design-input",
    status: "pending",
    promptArtifactId: "artifact_question",
    createdAt: 1,
  }),
).toMatchObject({ status: "pending" });

expect(() =>
  DeliveryApprovalManifestSchema.parse({
    sourceBranch: "agent/42",
    targetBranch: "main",
  }),
).toThrow();
```

- [ ] **Step 2: 运行模型测试并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-service.test.ts --bail=1
```

预期：因 `WorkflowInteractionSchema` 与 `DeliveryApprovalManifestSchema` 尚不存在而失败。

- [ ] **Step 3: 增加最小的严格领域 schema 与 Run 字段**

在 `workflow-models.ts` 定义并导出以下稳定形状，所有新字段以 Run schema 的默认空数组或 `.optional()` 方式进入持久化模型：

```ts
export const WorkflowInteractionSchema = z
  .object({
    id: IdentifierSchema,
    runId: IdentifierSchema,
    stepId: IdentifierSchema,
    status: z.enum(["pending", "answered", "expired", "cancelled"]),
    promptArtifactId: IdentifierSchema,
    answerArtifactId: IdentifierSchema.optional(),
    requestedAt: TimestampSchema,
    answeredAt: TimestampSchema.optional(),
    responderId: IdentifierSchema.optional(),
  })
  .strict();

export const DeliveryApprovalManifestSchema = z
  .object({
    sourceBranch: z.string().min(1),
    targetBranch: z.string().min(1),
    commitSha: z.string().min(1),
    pullRequestTitle: z.string().min(1),
    pullRequestBodyDigest: DigestSchema,
    issueReference: z.string().min(1),
  })
  .strict();
```

将 `interactions` 和可选 `deliveryApprovalManifest` 写进 `WorkflowRunSchema`，并更新所有创建/clone Run 的构造点使 `.strict()` 校验继续通过。

- [ ] **Step 4: 运行领域模型测试并确认通过**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-service.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-core.test.ts --bail=1
```

预期：Run 重启/读取后保留 interaction 与 manifest；缺关键字段被拒绝。

- [ ] **Step 5: 提交领域模型切片**

```bash
git add packages/server/src/server/workflows/workflow-models.ts \
  packages/server/src/server/workflows/workflow-service.test.ts \
  packages/server/src/server/workflows/workflow-core.test.ts
git commit -m "feat(workflows): persist interactions and delivery manifests" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 2: 添加兼容的交互 RPC、artifact projection 与 capability gate

**Files:**

- Modify: `packages/protocol/src/workflow/rpc-schemas.ts`
- Modify: `packages/protocol/src/workflow/rpc-schemas.test.ts`
- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/protocol/src/messages.wire-compat.test.ts`
- Modify: `packages/server/src/server/authorization/operation-permissions.ts`
- Modify: `packages/server/src/server/authorization/index.test.ts`
- Modify: `packages/server/src/server/websocket-server.ts`

**Interfaces:**

- Consumes: `WorkflowInteraction`、`DeliveryApprovalManifest`。
- Produces: `WorkflowInteractionRespondRequest` / `WorkflowInteractionRespondResponse`、可选 `pendingInteraction` / `interactions` projection、`features.workflowInteractions`。
- Produces: 已授权主体可调用的 `workflow.interaction.respond.request`，后续 session/client 任务依赖该 wire contract。

- [ ] **Step 1: 写入 protocol 兼容失败测试**

在 `rpc-schemas.test.ts` 增加一个带 scope、`runId`、`interactionId`、`answer` 和 `requestId` 的 response request 成功断言；在 `messages.wire-compat.test.ts` 断言旧 Run detail 不需要交互字段也能解析，新 detail 的 `pendingInteraction` 为可选：

```ts
const request = WorkflowInteractionRespondRequestSchema.parse({
  type: "workflow.interaction.respond.request",
  requestId: "request_1",
  projectId: "project_1",
  workspaceId: "workspace_1",
  runId: "run_1",
  interactionId: "interaction_1",
  answer: "保留人工批准",
});
expect(request.answer).toBe("保留人工批准");
```

- [ ] **Step 2: 运行 protocol 测试并确认失败**

运行：

```bash
npx vitest run packages/protocol/src/workflow/rpc-schemas.test.ts --bail=1
npx vitest run packages/protocol/src/messages.wire-compat.test.ts --bail=1
```

预期：交互 RPC schema 和可选 projection 尚未定义而失败。

- [ ] **Step 3: 定义 RPC 并接入消息、权限与 capability**

在 `rpc-schemas.ts` 以既有 `WorkflowRequestScopeSchema` / `WorkflowResponseScopeSchema` 扩展下列相关 RPC：

```ts
export const WorkflowInteractionRespondRequestSchema = WorkflowRequestScopeSchema.extend({
  type: z.literal("workflow.interaction.respond.request"),
  runId: z.string().min(1),
  interactionId: z.string().min(1),
  answer: z.string().trim().min(1).max(16_384),
});

export const WorkflowInteractionRespondResponseSchema = WorkflowResponseScopeSchema.extend({
  type: z.literal("workflow.interaction.respond.response"),
  payload: z.object({
    requestId: z.string().min(1),
    interaction: WorkflowInteractionSchema,
  }),
});
```

将 schema 加入 `SessionInboundMessageSchema` 和 `SessionOutboundMessageSchema`；在 `ServerInfoStatusPayloadSchema.features` 加 `workflowInteractions: z.boolean().optional()` 与 dated `COMPAT(workflowInteractions)` 注释；在 inbound/outbound permission 映射补齐新类型，沿用现有 workflow manage permission。不要把 `waiting_interaction` 作为既有对外 status enum 的新 literal；新客户端靠可选 interaction projection 分辨。

- [ ] **Step 4: 运行 protocol、授权和声明构建检查**

运行：

```bash
npx vitest run packages/protocol/src/workflow/rpc-schemas.test.ts --bail=1
npx vitest run packages/protocol/src/messages.wire-compat.test.ts --bail=1
npx vitest run packages/server/src/server/authorization/index.test.ts --bail=1
npm run build:client
```

预期：旧 wire fixture 继续通过；新的 request/response 在消息联合和权限映射中完整注册。

- [ ] **Step 5: 提交 protocol 切片**

```bash
git add packages/protocol/src/workflow/rpc-schemas.ts \
  packages/protocol/src/workflow/rpc-schemas.test.ts \
  packages/protocol/src/messages.ts \
  packages/protocol/src/messages.wire-compat.test.ts \
  packages/server/src/server/authorization/operation-permissions.ts \
  packages/server/src/server/authorization/index.test.ts \
  packages/server/src/server/websocket-server.ts
git commit -m "feat(protocol): add workflow interaction responses" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: 让 WorkflowService 持久化、校验并消费用户交互

**Files:**

- Modify: `packages/server/src/server/workflows/workflow-service.ts`
- Modify: `packages/server/src/server/workflows/workflow-scheduler.ts`
- Modify: `packages/server/src/server/workflows/workflow-service.test.ts`
- Modify: `packages/server/src/server/workflows/workflow-scheduler.test.ts`

**Interfaces:**

- Consumes: `WorkflowInteraction` 和 interaction response RPC 输入。
- Produces: `WorkflowService.createInteraction(input)`、`WorkflowService.respondInteraction(input)`、`WorkflowService.expireInteraction(input)`。
- Produces: 仅当指定 interaction 成功回答时才使依赖 `interaction.wait` 的步骤重新 ready 的 scheduler 语义。

- [ ] **Step 1: 写入 interaction 状态转换失败测试**

在 `workflow-service.test.ts` 覆盖首个合法回答、重复回答、错 scope、过期交互和取消 Run：

```ts
const first = await service.respondInteraction({
  projectId: "project_1",
  workspaceId: "workspace_1",
  runId: "run_1",
  interactionId: "interaction_1",
  responderId: "principal_1",
  answer: "继续写 spec",
});
expect(first.interactions[0]?.status).toBe("answered");

await expect(service.respondInteraction({ ...input, answer: "第二次回答" })).rejects.toThrow(
  "already answered",
);
```

在 scheduler 测试断言有 pending interaction 时后继步骤不 ready，回答后仅该 interaction 的 continuation 可 ready。

- [ ] **Step 2: 运行 service/scheduler 测试并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-service.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-scheduler.test.ts --bail=1
```

预期：`respondInteraction` 与 interaction-aware scheduling 尚不存在而失败。

- [ ] **Step 3: 实现不可变回答与恢复调度**

实现时将答案先写入 redacted Workflow artifact，再原子更新 interaction；同一 interaction 只能从 `pending` 变为 `answered` 一次：

```ts
async respondInteraction(input: RespondWorkflowInteractionInput): Promise<WorkflowRun> {
  const run = this.requireRun(input);
  const interaction = run.interactions.find((item) => item.id === input.interactionId);
  if (!interaction || interaction.status !== "pending") {
    throw new WorkflowInteractionStateError(input.interactionId, interaction?.status);
  }
  const answerArtifact = this.createRedactedTextArtifact(run, input.answer);
  return this.options.store.update(input, (current) => scheduleWorkflow(
    this.answerInteraction(current, interaction.id, input.responderId, answerArtifact),
    this.requireDefinition(current),
    this.now(),
    { registry: this.options.registry },
  ).run);
}
```

将 interaction 过期、Run 取消和 plugin unload 的状态变化收敛到同一 domain-error 路径，防止悬挂 promise 或重复续接。

- [ ] **Step 4: 运行 service/scheduler 回归测试**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-service.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-scheduler.test.ts --bail=1
```

预期：重复/过期/scope 错误都不能创建第二个 answer artifact 或重新调度第二轮。

- [ ] **Step 5: 提交交互服务切片**

```bash
git add packages/server/src/server/workflows/workflow-service.ts \
  packages/server/src/server/workflows/workflow-scheduler.ts \
  packages/server/src/server/workflows/workflow-service.test.ts \
  packages/server/src/server/workflows/workflow-scheduler.test.ts
git commit -m "feat(workflows): persist and resolve interactions" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: 实现可等待/可续接的 Agent step 与结构化 handoff

**Files:**

- Modify: `packages/server/src/server/workflows/core-step-manifests.ts`
- Modify: `packages/server/src/server/workflows/step-executors.ts`
- Modify: `packages/server/src/server/bootstrap.ts`
- Create: `packages/server/src/server/workflows/workflow-agent-handoff.ts`
- Create: `packages/server/src/server/workflows/workflow-agent-handoff.test.ts`
- Modify: `packages/server/src/server/workflows/step-adapters.test.ts`
- Modify: `packages/server/src/server/workflows/workflow-core.test.ts`
- Modify: `packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts`

**Interfaces:**

- Produces: core adapters `agent.run_until_complete`、`agent.continue_until_complete`、`interaction.wait`。
- Produces: `StepExecutorHost.runAgentUntilComplete(input)`、`continueAgentUntilComplete(input)`、`waitForInteraction(input)`。
- Produces: `extractWorkflowAgentHandoff(text)`，返回 `WorkflowAgentHandoff | WorkflowAgentHandoffError`。
- Consumes: `WorkflowService.respondInteraction`、AgentManager 终态/权限事件、`sendPromptToAgent`。

- [ ] **Step 1: 写入多终态与 handoff 解析失败测试**

在 `workflow-agent-handoff.test.ts` 覆盖有效 JSON block、缺失 block、非法 JSON、未知 `nextAction`；在 `step-adapters.test.ts` 覆盖 completed、failed、cancelled、permission pending 四个 agent 终态：

```ts
expect(
  extractWorkflowAgentHandoff(`完成。\n\n\`\`\`paseo-workflow-handoff
{"version":1,"phase":"design","nextAction":"ask_user","summary":"需要范围确认","question":"是否保留审计？","artifactReferences":[]}
\`\`\``),
).toMatchObject({
  nextAction: "ask_user",
});

await expect(execute("agent.run_until_complete", permissionPendingHost)).resolves.toMatchObject({
  status: "blocked",
  failureClassification: "permission_pending",
});
```

- [ ] **Step 2: 运行 Agent adapter 测试并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-agent-handoff.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/step-adapters.test.ts --bail=1
```

预期：新 adapter、host 方法和 handoff extractor 尚不存在而失败。

- [ ] **Step 3: 注册 adapter，并在 bootstrap 复用真实 Agent 生命周期原语**

在 manifest 中声明稳定输入/输出和风险；`agent.run_until_complete` 只在当前 Run 的 step receipt 完整后成功。bootstrap host 必须复用 AgentManager 等待、关闭和权限事件，并让所有 prompt 经 `sendPromptToAgent` 发送：

```ts
interface RunWorkflowAgentInput {
  cwd: string;
  prompt: string;
  profile: WorkflowAgentProfile;
  mode: "plan" | "execute" | "review";
}

interface WorkflowAgentTurnResult {
  agentId: string;
  sessionId: string;
  outcome: "completed" | "failed" | "cancelled" | "permission_pending";
  finalArtifactId: string;
  handoffArtifactId?: string;
}
```

实现 `workflow-agent-handoff.ts`，仅接受最后一个标记的 JSON code fence；缺失或解析失败时把最终文本保存为 artifact 并返回 `blocked`。`agent.continue_until_complete` 必须验证前序 session 与阶段、在计划批准前拒绝切换至 execute 模式。`interaction.wait` 创建 pending interaction，等待 service 记录的回答而不是占用一个无界的进程 promise。

- [ ] **Step 4: 运行 adapter、核心和 daemon lifecycle 测试**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-agent-handoff.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/step-adapters.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-core.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts --bail=1
npm run build:server
```

预期：权限请求不会永挂；相同 `agentId` 在合法续接中保持不变；无效 handoff 使 Run blocked。

- [ ] **Step 5: 提交 Agent 编排切片**

```bash
git add packages/server/src/server/workflows/core-step-manifests.ts \
  packages/server/src/server/workflows/step-executors.ts \
  packages/server/src/server/bootstrap.ts \
  packages/server/src/server/workflows/workflow-agent-handoff.ts \
  packages/server/src/server/workflows/workflow-agent-handoff.test.ts \
  packages/server/src/server/workflows/step-adapters.test.ts \
  packages/server/src/server/workflows/workflow-core.test.ts \
  packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts
git commit -m "feat(workflows): await and continue agent turns" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 5: 实现受控 artifact 内容与一次性交付批准 manifest

**Files:**

- Modify: `packages/server/src/server/workflows/step-executors.ts`
- Modify: `packages/server/src/server/workflows/workflow-service.ts`
- Modify: `packages/server/src/server/session/workflow/workflow-session.ts`
- Modify: `packages/server/src/server/session/workflow/workflow-session.test.ts`
- Modify: `packages/server/src/server/workflows/workflow-engine-e2e-verification.e2e.test.ts`
- Modify: `packages/protocol/src/workflow/rpc-schemas.ts`
- Modify: `packages/protocol/src/workflow/rpc-schemas.test.ts`

**Interfaces:**

- Produces: `workflow.artifact.get` 对授权、未清理 artifact 返回受控文本内容的语义。
- Produces: `WorkflowService.approveDelivery(input)`，只接受与当前 manifest digest 匹配的批准。
- Produces: `DeliveryApprovalManifest` 绑定的一次交付授权，供 `git.push` 与 `git.create_pr` 共同消费。

- [ ] **Step 1: 写入 artifact redaction 与 manifest 漂移失败测试**

在 session 测试断言 redacted artifact 返回元数据但不返回内容；在 workflow e2e 测试先批准 manifest，再改 title 或 SHA，断言 push/PR 步骤重新等待批准：

```ts
expect(await inspectArtifact({ artifactId: "artifact_redacted" })).toMatchObject({
  content: null,
  artifact: { redacted: true },
});

await service.approveDelivery({ ...scope, runId: "run_1", manifestDigest: firstDigest });
await service.updateRunForTest({ runId: "run_1", pullRequestTitle: "changed" });
expect(await service.schedule(scope)).toMatchObject({ status: "waiting_approval" });
```

- [ ] **Step 2: 运行受控交付测试并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/session/workflow/workflow-session.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-engine-e2e-verification.e2e.test.ts --bail=1
```

预期：artifact content 仍恒为 `null`，manifest 不存在，测试失败。

- [ ] **Step 3: 实现 artifact 内容读取与 delivery grant 消费**

让 `workflow.artifact.get` 在 scope/权限允许、artifact 非 redacted 且尚未清理时读取受大小上限保护的内容；否则稳定返回 `content: null` 和 metadata。

将终态前的 source/target branch、HEAD SHA、PR 文本 digest 和 Issue reference 规范化为 `DeliveryApprovalManifest`，生成 digest。最终批准只对该 digest 有效：

```ts
function canConsumeDeliveryApproval(run: WorkflowRun, manifest: DeliveryApprovalManifest): boolean {
  return (
    run.deliveryApproval?.status === "approved" &&
    run.deliveryApproval.manifestDigest === sha256(manifest) &&
    run.deliveryApproval.consumedAt === undefined
  );
}
```

把这份 grant 作为 `git.push`、`git.create_pr` 的共享前置条件；任何 manifest 差异都废弃旧 grant 并创建新的审批。保留既有 intent/receipt/unknown-outcome 恢复流程。

- [ ] **Step 4: 运行交付与 session 测试**

运行：

```bash
npx vitest run packages/server/src/server/session/workflow/workflow-session.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-engine-e2e-verification.e2e.test.ts --bail=1
npx vitest run packages/protocol/src/workflow/rpc-schemas.test.ts --bail=1
```

预期：非敏感 artifact 可见，redacted 内容不可见；manifest 变化后需要重新批准；未知结果不会重复外部写入。

- [ ] **Step 5: 提交安全交付切片**

```bash
git add packages/server/src/server/workflows/step-executors.ts \
  packages/server/src/server/workflows/workflow-service.ts \
  packages/server/src/server/session/workflow/workflow-session.ts \
  packages/server/src/server/session/workflow/workflow-session.test.ts \
  packages/server/src/server/workflows/workflow-engine-e2e-verification.e2e.test.ts \
  packages/protocol/src/workflow/rpc-schemas.ts \
  packages/protocol/src/workflow/rpc-schemas.test.ts
git commit -m "feat(workflows): gate delivery with manifests" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 6: 完成插件 Workflow step adapter 的注册与执行桥

**Files:**

- Modify: `packages/plugin/src/server/contracts.ts`
- Modify: `packages/plugin/src/server/index.ts`
- Modify: `packages/server/src/server/plugins/plugin-process.ts`
- Modify: `packages/server/src/server/plugins/plugin-process-protocol.ts`
- Modify: `packages/server/src/server/plugins/runtime.ts`
- Modify: `packages/server/src/server/plugins/index.ts`
- Modify: `packages/server/src/server/bootstrap.ts`
- Modify: `packages/server/src/server/workflows/step-executors.ts`
- Modify: `packages/server/src/server/workflows/workflow-plugin-integration.test.ts`
- Modify: `packages/server/src/server/plugins/plugin-process.test.ts`

**Interfaces:**

- Produces: `PluginWorkflowStepAdapterRegistration`，包含 manifest 和经 IPC 调用的 `execute(input, context)` handler。
- Produces: `PluginService.executeWorkflowStepAdapter(input)`，供 `StepExecutorHost.executePluginAdapter` 调用。
- Produces: 插件 child 的 ready metadata 中的 workflow step adapter registrations；daemon 可注册、调用、校验输出并在卸载时阻塞依赖 Run。
- Consumes: 已有 `StepAdapterRegistry.registerPlugin()`、`PluginRuntime.invoke()`、`WorkflowService.handlePluginUnload()`。

- [ ] **Step 1: 写入插件 adapter 实际执行的失败测试**

在 `workflow-plugin-integration.test.ts` 注册一个临时 plugin adapter，它将 `{ value: 2 }` 输出为 `{ value: 3 }`；断言 Workflow Run 真正调用 child handler，而不是只完成 manifest 注册。再断言插件卸载时，运行中的 adapter step 变为 `blocked: dependency_unavailable`：

```ts
const result = await executor.executePrepared({ run, attemptId, now: 1 });
expect(result.outputs).toEqual({ value: 3 });

await pluginService.disable("test-workflow-plugin");
expect((await workflowService.inspect(scope)).status).toBe("blocked");
```

在 `plugin-process.test.ts` 断言重复 adapter type、未注册 handler 和 handler 输出不符合 output schema 都产生确定错误。

- [ ] **Step 2: 运行插件 workflow 测试并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-plugin-integration.test.ts --bail=1
npx vitest run packages/server/src/server/plugins/plugin-process.test.ts --bail=1
```

预期：现有实现只发布 workflow preset metadata，未向 Runtime/StepExecutor 提供 adapter handler，测试失败。

- [ ] **Step 3: 在 SDK、child protocol、runtime 和 PluginService 建立受验证调用桥**

将仅有 manifest 的可选注册改为带 handler 的 registration，并让 child process 为每个 adapter 注册一个保留的、由 adapter type 决定的内部 RPC method。ready metadata 仅传可序列化的 manifest；handler 留在 child 内。daemon 调用时把 `input` 和最小 Run reference 送至该 method，Runtime 按 plugin ID + adapter type 精确路由，StepExecutor 继续用 registry 的 input/output schema 校验：

```ts
export interface PluginWorkflowStepAdapterRegistration
  extends PluginWorkflowStepAdapterManifest {
  execute(
    input: Record<string, unknown>,
    context: { paseo: PaseoApi; run: PluginWorkflowRunReference },
  ): Promise<Record<string, unknown>>;
}

async executeWorkflowStepAdapter(input: {
  pluginId: string;
  adapterType: string;
  adapterInput: Record<string, unknown>;
  run: PluginWorkflowRunReference;
}): Promise<Record<string, unknown>> {
  return this.runtime.invoke(input.pluginId, workflowAdapterMethod(input.adapterType), input);
}
```

在 `PluginService.publishWorkflowRegistrations()` 同时调用 `StepAdapterRegistry.registerPlugin()`；在 bootstrap 的 `StepExecutorHost.executePluginAdapter` 中注入 `PluginService.executeWorkflowStepAdapter()`。保留现有 unload 流程，禁止插件卸载后继续调用残留 handler。

- [ ] **Step 4: 运行执行、卸载和 server 构建验证**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-plugin-integration.test.ts --bail=1
npx vitest run packages/server/src/server/plugins/plugin-process.test.ts --bail=1
npx vitest run packages/server/src/server/plugins/lifecycle.e2e.test.ts --bail=1
npm run build:server
```

预期：adapter 的输入/输出被双端验证；重复/缺失 handler 被拒绝；卸载可靠阻塞活跃 Run。

- [ ] **Step 5: 提交插件 adapter bridge 切片**

```bash
git add packages/plugin/src/server/contracts.ts \
  packages/plugin/src/server/index.ts \
  packages/server/src/server/plugins/plugin-process.ts \
  packages/server/src/server/plugins/plugin-process-protocol.ts \
  packages/server/src/server/plugins/runtime.ts \
  packages/server/src/server/plugins/index.ts \
  packages/server/src/server/bootstrap.ts \
  packages/server/src/server/workflows/step-executors.ts \
  packages/server/src/server/workflows/workflow-plugin-integration.test.ts \
  packages/server/src/server/plugins/plugin-process.test.ts
git commit -m "feat(plugins): execute workflow step adapters" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 7: 接入 Workflow session、daemon client、公共 Paseo API 与插件可用能力

**Files:**

- Modify: `packages/server/src/server/session/workflow/workflow-session.ts`
- Modify: `packages/server/src/server/session/workflow/workflow-session.test.ts`
- Modify: `packages/server/src/server/session.ts`
- Modify: `packages/client/src/daemon-client.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/src/daemon-client.test.ts`
- Modify: `packages/plugin/src/server/contracts.ts`
- Modify: `packages/plugin/src/client/contracts.ts`
- Modify: `packages/plugin/src/server/index.ts`
- Modify: `packages/plugin/src/client/index.ts`

**Interfaces:**

- Consumes: wire `workflow.interaction.respond`、WorkflowService interaction methods。
- Produces: `DaemonClient.workflowInteractionRespond(input)`、`PaseoApi.workflows`、`PluginServerContext` / `PluginClientContext` 可访问的 workflow surface。
- Produces: session run detail 的可选 interaction projection 与 `toInteraction()` 映射。

- [ ] **Step 1: 写入 session/client/plugin SDK 的失败测试**

在 `workflow-session.test.ts` 发送完整 response request，断言返回回答后的 interaction；在 daemon client 测试断言 feature 缺失时抛出统一 update-host error；在 plugin contracts 测试断言 client/server 都能使用同一个 host-bound `paseo.workflows` API：

```ts
await client.workflowInteractionRespond({
  projectId: "project_1",
  workspaceId: "workspace_1",
  runId: "run_1",
  interactionId: "interaction_1",
  answer: "继续",
});
```

- [ ] **Step 2: 运行 session、client 和 plugin contract 测试并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/session/workflow/workflow-session.test.ts --bail=1
npx vitest run packages/client/src/daemon-client.test.ts --bail=1
npx vitest run packages/plugin/src/client/contracts.test.ts --bail=1
```

预期：interaction handler、client method 和 public workflow surface 尚不存在而失败。

- [ ] **Step 3: 实现 host-bound response 与单点 feature gate**

在 session 的 `handleRequest` 和 error response 路由中加入 interaction request；Run detail 使用可选字段投影 interaction，保持旧 detail 可解析。

在 daemon client 做一次 capability 判定，并让 `PaseoApi.workflows` 代理相同的 host-bound client：

```ts
function requireWorkflowInteractions(features: ServerFeatures | undefined): void {
  if (features?.workflowInteractions !== true) {
    throw new UnsupportedDaemonFeatureError("workflowInteractions");
  }
}
```

扩展 plugin SDK 的公开类型和绑定，使插件可以使用 `context.paseo.workflows`、`usePaseo().workflows`，不得由插件建立额外 WebSocket 或调用 app 私有模块。

- [ ] **Step 4: 运行跨包声明和定向测试**

运行：

```bash
npx vitest run packages/server/src/server/session/workflow/workflow-session.test.ts --bail=1
npx vitest run packages/client/src/daemon-client.test.ts --bail=1
npm run build:client
npm run build:server
```

预期：新 API 只在支持该 capability 的 Host 可用，插件得到与 App 相同的连接所有权。

- [ ] **Step 5: 提交 transport/SDK 切片**

```bash
git add packages/server/src/server/session/workflow/workflow-session.ts \
  packages/server/src/server/session/workflow/workflow-session.test.ts \
  packages/server/src/server/session.ts \
  packages/client/src/daemon-client.ts \
  packages/client/src/index.ts \
  packages/client/src/daemon-client.test.ts \
  packages/plugin/src/server/contracts.ts \
  packages/plugin/src/client/contracts.ts \
  packages/plugin/src/server/index.ts \
  packages/plugin/src/client/index.ts
git commit -m "feat(workflows): expose interaction APIs to clients" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 8: 在通用 Workflow Runs 面板提供交互、产物和错误状态

**Files:**

- Modify: `packages/app/src/panels/projected-workflow-runs.ts`
- Modify: `packages/app/src/panels/projected-workflow-runs.test.ts`
- Modify: `packages/app/src/panels/workflow-runs-panel.tsx`
- Modify: `packages/app/src/panels/workflow-runs-panel.test.tsx`
- Create: `packages/app/src/panels/workflow-interaction-card.tsx`
- Create: `packages/app/src/panels/workflow-interaction-card.test.tsx`

**Interfaces:**

- Consumes: `PaseoApi.workflows`、optional interaction projection、artifact get API。
- Produces: `WorkflowInteractionCard`，显示问题 artifact、编辑草稿、pending/error/success 状态，并只提交一次 response。
- Produces: `ProjectedWorkflowRunDetail.pendingInteraction`，供 Gitea plugin panel 复用相同状态语义。

- [ ] **Step 1: 编写 UI 的失败行为测试**

覆盖 loaded/pending/error 三态、双击发送和 capability 缺失：

```tsx
render(<WorkflowInteractionCard interaction={pendingInteraction} onRespond={respond} />);
await user.type(screen.getByLabelText("Reply"), "采用完整门禁");
await user.click(screen.getByRole("button", { name: "Send reply" }));
expect(respond).toHaveBeenCalledWith("采用完整门禁");
expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
```

- [ ] **Step 2: 运行 UI 测试并确认失败**

运行：

```bash
npx vitest run packages/app/src/panels/workflow-interaction-card.test.tsx --bail=1
npx vitest run packages/app/src/panels/workflow-runs-panel.test.tsx --bail=1
```

预期：component 和 projected interaction 字段尚不存在而失败。

- [ ] **Step 3: 实现跨平台交互卡片和投影**

使用 React Native primitives 与已有 panel 样式；不使用 DOM、裸 `TextInput` 或本地 feature 判断。卡片只在 `workflowInteractions` 已支持且存在 pending interaction 时显示；不支持时渲染可操作的更新 Host 提示。将 draft、提交中的禁用状态和 error 保持在同一布局槽内，避免消息/按钮异步出现导致布局跳动。

- [ ] **Step 4: 运行 panel 测试与格式检查**

运行：

```bash
npx vitest run packages/app/src/panels/projected-workflow-runs.test.ts --bail=1
npx vitest run packages/app/src/panels/workflow-interaction-card.test.tsx --bail=1
npx vitest run packages/app/src/panels/workflow-runs-panel.test.tsx --bail=1
npm run format:files -- packages/app/src/panels/projected-workflow-runs.ts packages/app/src/panels/workflow-interaction-card.tsx packages/app/src/panels/workflow-runs-panel.tsx
```

预期：面板能回答一次、保留失败输入、正确投影 pending interaction。

- [ ] **Step 5: 提交通用 App 交互切片**

```bash
git add packages/app/src/panels/projected-workflow-runs.ts \
  packages/app/src/panels/projected-workflow-runs.test.ts \
  packages/app/src/panels/workflow-runs-panel.tsx \
  packages/app/src/panels/workflow-runs-panel.test.tsx \
  packages/app/src/panels/workflow-interaction-card.tsx \
  packages/app/src/panels/workflow-interaction-card.test.tsx
git commit -m "feat(app): answer workflow interactions" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 9: 固化通用交互端到端证据与文档

**Files:**

- Modify: `packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts`
- Modify: `packages/server/src/server/workflows/workflow-plugin-integration.test.ts`
- Modify: `public-docs/orchestration-workflows.md`
- Modify: `public-docs/plugins/reference.md`
- Modify: `docs/protocol-compatibility.md`

**Interfaces:**

- Consumes: 本计划任务 1–7 的 workflow preset、interaction RPC、Agent steps、artifact/delivery contracts。
- Produces: 一个 provider/forge 无关的互动 workflow e2e，以及面向插件作者的交互/agent-step 契约文档。

- [ ] **Step 1: 编写通用互动 e2e 的失败测试**

在 daemon lifecycle e2e 中注册临时通用 preset，要求一个 Agent turn 产生 `ask_user` handoff，再断言 response 续接同一 session、生成 `await_plan_approval` handoff：

```ts
expect(afterQuestion.interactions).toHaveLength(1);
await client.workflowInteractionRespond({ ...scope, runId, interactionId, answer: "继续生成计划" });
expect(afterReply.stepAttempts.find((step) => step.stepId === "continue")?.status).toBe(
  "succeeded",
);
expect(afterReply.interactions[0]?.status).toBe("answered");
```

- [ ] **Step 2: 运行 e2e 并确认失败**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts --bail=1
```

预期：interaction/continuation 行为尚未端到端接通而失败。

- [ ] **Step 3: 完成 e2e、插件卸载保护与文档整合**

让 e2e 同时断言：插件 adapter 卸载时依赖其的 Run 变为 `blocked: dependency_unavailable`；旧 feature gate 不会进入 interaction UI。更新公开 workflow 文档说明三个新 core step、handoff 格式、artifact 安全语义、interaction API、交付 manifest 与 plugin-unload 行为；在兼容文档补充 `workflowInteractions` 的 gate 和 shim 删除标准。

- [ ] **Step 4: 运行端到端、类型与 lint 验证**

运行：

```bash
npx vitest run packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts --bail=1
npx vitest run packages/server/src/server/workflows/workflow-plugin-integration.test.ts --bail=1
npm run typecheck
npm run lint
npm run format
```

预期：通用流程、插件依赖卸载和协议文档的类型/格式均通过；不运行全仓测试。

- [ ] **Step 5: 提交核心阶段与建立 Phase 1 gate**

```bash
git add packages/server/src/server/workflows/workflow-daemon-lifecycle.e2e.test.ts \
  packages/server/src/server/workflows/workflow-plugin-integration.test.ts \
  public-docs/orchestration-workflows.md \
  public-docs/plugins/reference.md \
  docs/protocol-compatibility.md
git commit -m "docs(workflows): document interactive workflow contracts" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

确认上述 Phase 1 e2e、`npm run typecheck`、`npm run lint` 和 `npm run format` 通过后，才开始 `2026-09-29-gitea-superpowers-workflow.md`。
