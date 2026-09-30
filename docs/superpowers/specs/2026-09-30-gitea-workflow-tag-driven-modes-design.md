# Gitea Workflow 标签驱动双模架构与双向审批网关设计

**日期：** 2026-09-30  
**状态：** 已确认设计，待实施计划  
**范围：** `plugin-custom/gitea-workflow`（Poller 调度、预设 DAG、适配器扩展、标签流转、双向审批网关）

---

## 1. 目标与设计哲学

### 1.1 核心目标

将 `gitea-workflow` 从依赖插件全局/项目配置的策略调度模式，演进为**纯 Issue 标签驱动（Label-Driven）的零配置自治系统**：

1. **显式意图契约（Explicit Intent Only）**：彻底废除模糊的 `agent-ready` 标签。系统杜绝默认隐式触发，开发者通过贴附明确的二元标签（`agent-auto` 或 `agent-plan`）决定执行路径。未贴标时 Poller 彻底忽略。
2. **全自动（`agent-auto`）透明化归档**：即使在全自动无人值守模式下，Agent 也严禁黑盒静默执行。必须在设计阶段向 Issue 评论区输出完整的《架构设计与决策简报》（包含备选方案 A/B/C、选型理由、涉及模块），保证全流程透明与事后可追溯。
3. **严格计划（`agent-plan`）工程治理**：完整贯彻 Superpowers 软件工程规范（Brainstorming → Spec → Implementation Plan → TDD 编码 → 独立审查 → PR 交付），每一层产出结构化文档，并设立硬性审批门禁。
4. **双向审批网关（Dual-Channel Approval Gate）**：用户既可以在 Paseo App/Web 界面点击批准，也可以直接在 Gitea Issue 评论区回复指令（如 `/approve`、`同意`、选型字母）放行流程，甚至直接回复修改意见触发方案迭代。

### 1.2 非目标

- 不在 `gitea-workflow` 中保留任何旧版 `agent-ready` 的默认隐式触发逻辑。
- 不引入复杂的外部中间件；双向审批依赖 Gitea Issue 增量评论轮询与 Paseo 原生 Workflow 审批引擎。
- 不破坏现有 `IssueRunIndexStore` 的幂等与单任务绑定契约。

---

## 2. 标签协议与状态流转

### 2.1 触发标签契约

| 标签 (Tag)                           | 触发预设                 | 自动化程度                   | 设计阶段 Issue 评论行为                                                                                             |
| :----------------------------------- | :----------------------- | :--------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| **`agent-auto`** (兼容 `agent:auto`) | `gitea.issue-to-pr.auto` | 全自动无人值守（Unattended） | **必须回帖**：分析问题并输出方案对比（A/B/C），明确说明 Agent 采纳的方案及决策理由；随后自动推进编码与 PR，不阻塞。 |
| **`agent-plan`** (兼容 `agent:plan`) | `gitea.issue-to-pr.plan` | 严格计划门禁（Superpowers）  | **必须回帖**：给出方案设计与决策选项（A/B/C），**明确请求用户选择与批准**；在各阶段门禁处阻塞等待。                 |
| _无标签 / 其它标签_                  | _无_                     | 不触发                       | Poller 彻底忽略。                                                                                                   |
| _双标共存_                           | `gitea.issue-to-pr.plan` | 安全降级（Strict）           | 判定为冲突，安全优先自动降级为 `agent-plan` 严格模式，并在 Issue 回帖警告。                                         |

### 2.2 标签原子流转状态机

```text
[ 用户在 Gitea 打标: agent-auto 或 agent-plan ]
                       │
                       ▼ gitea.claim_issue
[ 认领任务：原子移除触发标，新增 agent-in-progress ]
                       │
       ┌───────────────┴───────────────┐
       ▼ (agent-auto)                  ▼ (agent-plan)
[ 自动架构分析并回贴决策 ]           [ Brainstorm / Spec / Plan 阶段 ]
       │                               │
       │                               ▼ 挂起等待
       │                     [ 增加 agent-waiting-approval 标 ]
       │                               │
       │                               ▼ 用户在 Issue 回复 /approve 或 Paseo 点击批准
       │                     [ 移除 agent-waiting-approval，继续推进 ]
       │                               │
       └───────────────┬───────────────┘
                       ▼
           [ 编码、验证与独立代码审查 ]
                       │
       ┌───────────────┴───────────────┐
       ▼ 成功                          ▼ 失败 / 超时放弃
[ 移除 agent-in-progress ]       [ 移除 agent-in-progress / waiting ]
[ 新增 agent-delivered ]         [ 新增 agent-failed ]
[ 回贴交付单与 PR 链接 ]         [ 回贴失败诊断信息与重试建议 ]
```

1. **认领原子性**：`claim_issue` 步骤认领成功后，必须先在 Gitea Issue 上移除 `agent-auto` / `agent-plan`，再打上 `agent-in-progress`。杜绝后续 Poller 轮询造成重复识别。
2. **状态可感知性**：当工作流处于 `approval.wait` 阶段时，贴上 `agent-waiting-approval`，团队可直接在 Issue 看板上获知任务正在等待决策；批准后移除该标签。
3. **完成与失败**：任务成功提交 PR 后挂载 `agent-delivered`；若构建/审查失败或用户明确拒绝则挂载 `agent-failed`。

---

## 3. 工作流 DAG 架构设计

### 3.1 全自动预设：`gitea.issue-to-pr.auto`

面向简单缺陷、常规优化与明确需求，端到端无人值守：

```text
fetch-issue
    └── claim-issue (移除 agent-auto, 新增 agent-in-progress)
            └── worktree-create
                    └── auto-design (Agent: 分析上下文，回贴方案与选型理由，非阻塞)
                            └── implement-agent (Agent: 依据选定方案编码，TDD)
                                    └── verify-command (运行单元测试与 Lint)
                                            └── independent-review (Agent: 独立代码审查)
                                                    └── resolve-delivery (打包交付凭据)
                                                            └── git-push
                                                                    └── git-create-pr (回贴 PR 链接，标记 agent-delivered)
```

### 3.2 严格计划预设：`gitea.issue-to-pr.plan`

面向架构改造、复杂特性与破坏性变更，严格人机协同：

```text
fetch-issue
    └── claim-issue (移除 agent-plan, 新增 agent-in-progress)
            └── worktree-create
                    └── brainstorm-agent (Agent: 头脑风暴，输出备选方案 A/B/C 到 Issue)
                            └── gate-brainstorm (双向审批网关：等待确认方案)
                                    └── spec-agent (Agent: 输出详细 Spec 设计文档到 Issue)
                                            └── gate-spec (双向审批网关：等待确认 Spec)
                                                    └── plan-agent (Agent: 输出实施步骤清单到 Issue)
                                                            └── gate-plan (双向审批网关：等待确认 Plan)
                                                                    └── implement-agent (Agent: 编码)
                                                                            └── verify-command
                                                                                    └── independent-review
                                                                                            └── resolve-delivery
                                                                                                    └── gate-delivery (双向审批网关：等待确认发布)
                                                                                                            └── git-push
                                                                                                                    └── git-create-pr
```

---

## 4. 关键组件与适配器实现

### 4.1 Poller 调度器升级 (`server/poller.ts`)

1. **多标签检索**：
   `clientPool.getClient().fetchReadyIssues()` 调整为同时检索拥有 `agent-auto` 或 `agent-plan` 标签的未关闭 Issue。
2. **模式路由计算**：

   ```typescript
   export function resolveIssueWorkflowPreset(labels: Array<{ name: string }>): {
     presetId: string;
     mode: "auto" | "plan";
     conflictWarning: boolean;
   } | null {
     const hasAuto = labels.some(
       (l) => l.name.toLowerCase() === "agent-auto" || l.name.toLowerCase() === "agent:auto",
     );
     const hasPlan = labels.some(
       (l) => l.name.toLowerCase() === "agent-plan" || l.name.toLowerCase() === "agent:plan",
     );

     if (hasAuto && hasPlan) {
       return { presetId: "gitea.issue-to-pr.plan", mode: "plan", conflictWarning: true };
     }
     if (hasAuto) {
       return { presetId: "gitea.issue-to-pr.auto", mode: "auto", conflictWarning: false };
     }
     if (hasPlan) {
       return { presetId: "gitea.issue-to-pr.plan", mode: "plan", conflictWarning: false };
     }
     return null;
   }
   ```

3. **输入参数注入**：
   调用 `workflows.runCreate` 时，将识别出的 `mode` 与 `conflictWarning` 注入工作流初始 payload。

### 4.2 双向审批网关适配器 (`server/adapters/dual-approval-gate.ts`)

注册统一的门禁步骤适配器 `gitea.dual_approval_gate`：

1. **启动与回贴**：
   - 步骤启动时，在 Gitea Issue 上添加 `agent-waiting-approval` 标签；
   - 将上游 Agent 输出的阶段结论（Brainstorm / Spec / Plan）格式化为评论发布到 Issue：

     ```markdown
     ### 🛑 Paseo 门禁：等待确认（阶段：{{phase}}）

     请查看上述方案。您可以通过以下任意方式推进或调整：

     1. **直接回复批准**：回复 `/approve`、`同意` 或选项序号（如 `A` / `方案A`）；
     2. **在 Paseo 中确认**：在移动端或 Web 控制台点击通过；
     3. **提出调整意见**：直接在评论中写下反馈，Agent 将重新生成方案。
     ```

2. **监听与放行循环**：
   - 在等待期间，以配置的间隔（默认 10 秒）轮询 Gitea 该 Issue 在门禁创建时间戳之后的最新评论；
   - **命中批准模式**（正则：`/^\/(approve|lgtm|proceed|yes)\b|^(同意|确认|批准|通过)$|^方案?\s*([a-c])$/i`）：
     - 自动调用 `context.workflows.stepApprove({ runId, stepId, decision: "approved" })`；
     - 移除 Issue 上的 `agent-waiting-approval` 标签；
     - 回贴确认通知：`✅ 已捕获来自 Issue 评论的确认指令，工作流继续进入下一阶段。`
   - **命中调整模式**（非审批指令的有效反馈）：
     - 捕获用户评论正文作为 feedback，调用工作流回退/修订逻辑；
   - **Paseo 原生放行**：
     - 若用户在 Paseo 界面点击批准，步骤监听到状态变为完成，自动移除 `agent-waiting-approval` 标签并记录日志。

### 4.3 认领与交付适配器扩展 (`claim-issue.ts` & `post-summary.ts`)

- `claim-issue` 适配器：支持动态识别并剥除匹配到的触发标签（`agent-auto` / `agent:auto` / `agent-plan` / `agent:plan`），附加 `agent-in-progress`。
- `resolve-delivery` / `post-summary`：在创建 PR 之后，移除 `agent-in-progress`，附加 `agent-delivered`，并在 Issue 留下指向 PR 的最终证据链接清单。

---

## 5. 防重防环与异常容错

1. **唯一并发防重（Active Run Guard）**：
   - 依赖 `indexStore` 存储 `projectId:owner:repo:issueNumber -> runId`；
   - Poller 遇到正在处于 `running` 或 `waiting_approval` 状态的 Issue 时，坚决忽略，不重复起任务。
2. **用户重试与重新激活（Re-trigger Protocol）**：
   - 若上一次执行已处于 `done` 或 `failed`，当用户再次手动贴上 `agent-auto` 或 `agent-plan` 时，Poller 视作全新一轮迭代，清理旧 run 索引并创建新任务。
3. **门禁超时机制**：
   - 每个审批门禁默认设置 24 小时超时时间（`timeoutMs: 86400000`）；
   - 超时未确认时，工作流自动转入挂起休眠状态，释放并发配额，不影响其他任务推进；用户日后唤醒仍可恢复。

---

## 6. 测试与验证策略

1. **单元测试（Unit Tests）**：
   - `tests/preset-resolver.test.ts`：测试标签解析器在 `agent-auto`、`agent-plan`、大小写混合、冒号形式、双标共存（降级）以及无标签场景下的准确性；
   - `tests/dual-approval-gate.test.ts`：测试双向网关对 Gitea 评论正则匹配（批准、驳回、修订意见）的解析与放行；
   - `tests/claim-adapter.test.ts`：测试针对不同触发标签的原子剥除与 `agent-in-progress` 替换。
2. **端到端集成测试（E2E Tests）**：
   - 模拟 `agent-auto` Issue：校验是否自动在 Issue 留下架构设计报告，并不停顿直接完成 PR 创建；
   - 模拟 `agent-plan` Issue：校验各门禁节点是否成功贴上 `agent-waiting-approval`，并通过 Mock Gitea 评论回复 `/approve` 验证流水线能否依次自动解除阻塞并继续。
3. **类型与代码规范检查**：
   - 执行 `npm run typecheck` 与 `npm run lint` 验证全包类型安全与代码风格。
