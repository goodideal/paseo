## Context

见 `proposal.md` 的 Why。本仓库已有 file-backed JSON Store（例如 ScheduleStore）、语义权限分类、session WebSocket、`server_info.features` 能力门控和 Plugin subprocess，但 Visual Crawler 示例仍在 Plugin 内以 `/tmp` 状态、mock Adapter 和后台队列直接串联修复。该形式既不具备 workspace scope，也不能在外部副作用结果不确定时安全恢复。

## Goals / Non-Goals

### Goals

- 建立一个按 `projectId + workspaceId` 隔离的有限 DAG 执行核心，供 Visual Crawler 作为第一个消费者。
- 让 JSON Definition 成为唯一可执行事实；Markdown 只作为 Prompt 和审计 Artifact，按固定 revision/hash 关联 Run。
- 将 finding severity 与 execution risk 分离；宿主语义权限和一次性审批是唯一授权边界。
- 对 Worktree、Agent、验证、push、PR 等副作用记录 intent、receipt 和未知结果，支持安全恢复。
- 通过静态 Schema、受限 DSL、受控 Adapter、资源冲突键和配额阻止 Workflow 退化为任意代码执行平台。
- 提供安静、可操作的运行视图，并以现有 UI 基元在 Desktop/Web/Compact 交付完整操作路径。

### Non-Goals

- 不提供拖拽式编排器、任意循环、事件驱动无限等待、动态 Step 生成、任意 JavaScript、任意 Shell 或仓库模块加载。
- 不提供自动 Merge、自动 Deploy、跨 workspace 隐式访问或跨机器分布式调度。
- 不将 P0/P1/P2 缺陷等级解释为授权；首期 P0 只提高待审批任务的优先级。
- 不保留 `WorktreeFixPool` 作为 Workflow Engine 之外的第二个修复调度事实来源。

## Decisions

### 1. Core owns runs; Plugin owns domain inputs and optional extensions

`packages/server/src/server/workflows/` 负责 Definition、Run、StepAttempt、Approval、Artifact metadata、调度、恢复和审计。Run 在创建时必须携带 `projectId`、`workspaceId`、调用主体和固定 workspace root；所有查询、订阅、Artifact 读取和审批都按该 scope 授权与过滤。

Visual Crawler 仅负责 Crawl、Evidence、Triage，并把一个 approved FixDirective 映射为一个 Run input。Plugin 可注册 Preset 和非 Core StepAdapter，但注册清单必须声明 input/output Zod Schema、Adapter version、execution risk、required semantic permissions、repositoryCallable、idempotency、cancellation、recovery、supported platforms 和 resource-conflict key。Core 先执行 Manifest 校验和权限判断，Plugin 不得绕过。

替代方案是把 Engine 留在插件中。它无法为其他消费者共享权限/审计/恢复模型，且会重复 session、store 和 UI 逻辑，因此拒绝。

### 2. JSON is executable truth; Markdown is bounded text

Definition 文件为 `.paseo/workflows/*.workflow.json`；Prompt 是同一 workflow root 内的 Markdown 文本资源。解析顺序为 Plugin preset → repository override → runtime override。repository/runtime 层只能关闭 Step、收紧 timeout/retry/concurrency 和填充预声明输入；不能新增 Adapter/type、扩大 resources、提升并发上限、降低审批级别或写入 raw command。

在 Run 创建前编译为 ResolvedDefinition：固定 `definitionRevision`、content hash、Prompt hash、Adapter versions 和 schema version。每个 Prompt 渲染副本在 Artifact 中脱敏保存；任一缺失变量、路径逃逸、未声明 Step output 或敏感字段引用都拒绝启动。人工 Markdown 编辑影响文本，但不能单独改变执行规则。

### 3. Fixed DAG and restricted expression language

Step 仅能引用已注册 `type`，依赖使用 `dependsOn`，条件使用无副作用 DSL。DSL 只支持 typed JSON 的字段读取、常量、布尔逻辑、比较、`exists` 和数组长度；不允许函数调用、动态属性、环境变量、文件/网络读取、eval 或模板表达式执行。

Definition 校验固定上限：最大 Step 数、深度、fan-out、并行数、attempt 数、timeout、output bytes 和 Artifact bytes。无环、无递归、无动态节点。调度同时持有 resource conflict key，例如 `workspace:<workspaceId>:branch:<branch>`；不依赖的 Step 也不能并行写同一 workspace/branch。

替代方案是 JSON Logic 或 JavaScript。首期文本 DSL 更适合人工 JSON 配置和错误定位；JS 破坏信任边界，JSON Logic 的可读性和 UI 显示较差。

### 4. Workflow state uses intents, receipts, leases, and unknown outcomes

Run 状态为 `queued → running → waiting_approval → succeeded | failed | cancelled | blocked | unknown`。StepAttempt 状态区分 `pending`、`ready`、`running`、`retry_wait`、`waiting_approval`、`succeeded`、`skipped`、`failed`、`cancelled`、`blocked`、`unknown`。

每个外部副作用在调用前原子写入 immutable intent（run/step/attempt、definition hash、input digest、scope、idempotency key、lease holder/expiry）。成功后写入 receipt，例如 Worktree path/branch、Agent ID/session reference、verification artifact hash、commit SHA、remote/PR ID。重启恢复：有 receipt 时重新观察；副作用可能发生但无 receipt 时转 `unknown` 并要求人工确认；禁止依据超时或内存队列盲重跑。Store 以 `$PASEO_HOME/workflows/` 的 JSON 文件和 atomic write 落盘，并使用 keyed mutation serialization + lease 防止双调度。

取消先阻止尚未开始的 Step，再向 Adapter 发出取消信号。无法取消的外部操作保留 `unknown` 或 `blocked`，不能伪造取消成功。

### 5. Risk and approval bind to semantic permissions, not UI or severity

每个 Step 的 `executionRisk` 为 `observe`、`workspace_write`、`external_side_effect` 或 `privileged`，并声明所需 Paseo semantic permission。服务端在 Run 创建和每次实际执行前都重新评估 session principal、workspace scope 和 host policy。Finding severity 只影响排序、通知和 SLA。

外部副作用默认产生一次性 ApprovalRequest。记录 `runId`、definition revision/hash、stepId、attemptId、input digest、project/workspace、target remote/branch、requester/approver、过期时间、reason 和 consumed marker。批准仅消费那个 Attempt；拒绝按预定义 onDenied 变为 skipped/failed。Crawler 浏览器目标在首期仅允许显式登记的 local/staging origin 和路径范围，禁止任意 URL、内网扫描与运行中扩大 scope。

`verify.command` 只引用注册的 Verification Profile。Profile 在宿主定义 command、cwd scope、env allowlist、timeout ceiling 和支持平台；仓库 JSON 不能提供 Shell 文本。

### 6. Compatibility and API surface

新增 Protocol 叶模块和纯 Zod wire schemas，RPC 使用 `workflow.definition.*.request/.response`、`workflow.run.*.request/.response`、`workflow.approval.*.request/.response`、`workflow.artifact.*.request/.response`。创建 Run 返回稳定 `runId` 和初始状态，绝不只返回 `{ ok: true }`。

新增 capability `server_info.features.workflowEngine`。App/CLI/Plugin 在能力门控处一次判定，旧 daemon 显示升级说明，不编写多处分支 fallback。新字段 optional；任何 protocol shim 以 `COMPAT(name)` 注释版本和移除条件。Schema 保持 structural-pure，不使用 transform/catch/preprocess。

### 7. UI uses existing primitives and layout ownership

首期 App 交付 Workspace-scoped Runs surface：wide layout 为 master-detail（Run list + selected Run Detail），compact layout 使用 list → full-detail 导航。Run Detail 采用缩进列表/vertical stepper 投影 DAG；并行 sibling 以分组呈现，当前审批或失败节点在主轨内突出。不会使用二维连线图。

所有按钮、状态、标题和确认分别复用 `Button`、`StatusBadge`、`ScreenTitle`、`confirmDialog`。Stop Crawl、batch-approve、deny、retry external-write 和 cancel run 必须确认；任意 RPC 操作显示 pending、success 或 in-context actionable error。hover-only actions 使用现有 hover pattern 且 native/compact 始终可达。Visual Crawler Worker Lanes 只显示关联 Run 摘要和跳转，不展示自有调度真相。

## Risks / Trade-offs

- [文件 Store 的多进程并发不足] → 首期将 daemon 作为唯一 writer，以 keyed mutation + lease 保护；跨进程 worker 不直接写 Store，所有状态回报经 daemon Adapter API。
- [外部 API 返回丢失] → intent/receipt 和 `unknown` 阻止重复提交；人工确认是安全优先的代价。
- [Plugin reload 影响 Run] → 新 Run 拒绝使用不可用贡献；运行中 adapter 按 lifecycle 契约 blocked 或安全终止，保留快照和 Artifact。
- [Definition 很容易变成命令执行面] → typed manifest、profile-only command、DSL/配额/路径限制和服务端授权共同防护。
- [跨版本新增 protocol 复杂] → 单 feature gate、optional fields、纯 schema 与 targeted compatibility tests 限制风险。
- [DAG 信息密度过高] → UI 只展示关键路径和分组 sibling；细节在可展开 Step 内提供，Compact 使用独立 Detail 页面。

## Migration Plan

1. 增加 Protocol、Store、Definition compiler、Adapter registry 和 Runtime，但不改现有 Visual Crawler 自动修复行为。
2. 以隔离 daemon harness 和测试仓库验证 scope、approval、receipt/recovery 和 capability gate；在 feature flag 下启用 Core API。
3. 让 Visual Crawler 先创建 Run 并展示只读 Run 摘要；保留 legacy pool 仅用于迁移开关下的既有 Run，禁止同一 Directive 双重 dispatch。
4. 当 Directive→Run 真实验证完成后，删除 Visual Crawler `WorktreeFixPool` 触发路径和 mock production Adapter；迁移中的 Run 仍可读取历史证据。
5. 失败回滚仅关闭 `workflowEngine` capability 和新的 dispatch 入口；已持久化 Run 保留只读/blocked/unknown 状态，绝不通过删除 Store 回滚。
