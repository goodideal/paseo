# Gitea Workflow 与 Superpowers 交互式开发设计

**日期：** 2026-09-29  
**状态：** 已确认设计，待实施计划  
**范围：** Paseo Workflow Engine、Workflow protocol/App、`gitea-workflow` 本地插件

## 目标

让 `gitea-workflow` 在已授权项目中自动发现带启动标签的 Gitea Issue，并以可恢复、可审计、有人机门禁的方式完成开发到 PR 的闭环。

默认策略必须完整遵守 Superpowers 的工作流：设计澄清、设计确认、书面 spec、spec 确认、实施计划、计划确认、开发、验证、独立审查、最终 PR 确认。自动化负责取单、编排、状态同步和审查修复循环；人负责需要判断的设计、计划和外部交付决定。

## 非目标

- 不在插件 settings 中保存 Gitea Token、`tea` 配置或任何其他密钥。
- 不通过硬编码的本机 skill 路径调用 `gitea-ship.js`，也不绕过该 skill 对远端写入的确认规则。
- 不把完整 Agent 对话、测试原始输出或本地路径持续同步到 Gitea Issue。
- 不为旧 App 或旧 daemon 构建不可审计的“文本聊天降级模式”。
- 不自动批准 provider 权限请求、push、创建 PR 或其他外部写入。

## 已确认的产品决策

| 主题         | 决定                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Issue 执行   | Host 总开关默认关闭；逐项目显式授权后自动处理匹配 Issue。                                                |
| Gitea 连接   | 从 Git `origin`、`tea` 登录和 Host 环境变量自动发现；不录入 Token。                                      |
| Issue 筛选   | 每个项目一个启动标签，默认 `agent-ready`。                                                               |
| Agent        | 使用一个全局自动化 Profile；完整 Superpowers 策略只允许已验证支持 Claude Code + Superpowers 的 Profile。 |
| 工作流策略   | Host 默认 + 项目覆盖；任务认领时固化策略与 Profile 快照。                                                |
| 默认策略     | 完整 Superpowers。                                                                                       |
| PR 时机      | 人工最终批准后才 push 并创建 PR。                                                                        |
| 设计交互     | 在 Gitea Review workspace panel 内逐轮对话。                                                             |
| 审计         | 事件永久保留；重量级本地证据保留 90 天。                                                                 |
| Gitea 可见性 | 仅同步生命周期摘要评论。                                                                                 |
| 自动修复     | 独立审查后最多自动修复 2 轮，之后转人工介入。                                                            |

## 总体架构

```text
Gitea Issue 标签
       │
       ▼
┌───────────────────────────────────────────────────────────────┐
│ gitea-workflow 插件                                            │
│ - 发现项目、解析 Gitea、筛选/认领 Issue                         │
│ - Gitea 专属步骤、项目设置、生命周期摘要评论                    │
│ - Issue ↔ Workflow Run 可重建索引                               │
└───────────────────────┬───────────────────────────────────────┘
                        │ 创建 preset run
                        ▼
┌───────────────────────────────────────────────────────────────┐
│ Paseo Workflow Engine                                           │
│ - DAG、步骤尝试、交互、审批、意图/回执、持久化、恢复             │
│ - Agent 运行到完成、同会话续接、受控产物                         │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│ Claude Code 自动化 Agent                                        │
│ - using-superpowers 选择并执行适用 Skill                         │
│ - brainstorming、writing-plans、TDD、验证、审查                 │
└───────────────────────┬───────────────────────────────────────┘
                        │ 交互 / 产物 / 审计
                        ▼
┌───────────────────────────────────────────────────────────────┐
│ Paseo App：Gitea Review panel                                   │
│ - 设计对话、文本回复、阶段批准、验证/审查证据、审计查询          │
└───────────────────────────────────────────────────────────────┘
```

Workflow Run 是任务状态、审批、步骤尝试、操作意图和回执的事实源。插件只维护 Issue 到 Run 的持久化索引；该索引可从 Run 的初始输入重建，不能成为第二个任务事实源。

## 核心 Workflow Engine 扩展

现有 `agent.dispatch` 与 `review.agent` 是 fire-and-forget，不能支撑阶段门禁：它们不会等待 Agent 完成、不能续接既有会话，也不能把自由文本输入传回运行中的 Workflow。本设计新增下列通用能力。

### Agent 步骤

| 新步骤                          | 职责                                                            | 核心输出                                                                          |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `agent.run_until_complete`      | 创建 Agent，等待本轮结束、失败、取消或权限阻塞。                | `agentId`、`sessionId`、`turnId`、最终输出 artifact、handoff artifact、结果状态。 |
| `agent.continue_until_complete` | 向指定 Session 续接一条用户回复或受控阶段指令，并等待该轮结束。 | 与启动步骤相同的结果形状。                                                        |

两个步骤都由核心 `AgentManager` 的完整运行/等待能力实现，而不是由插件自行轮询 Agent 状态。续接时可以应用受控的模式升级：设计与计划阶段用规划/只读模式；计划获批后才切换到已配置的执行模式。模式变更、Profile 版本和有效权限写入审计。

### 结构化 handoff

每个 Agent 阶段 prompt 要求在最终回复中产生受验证的 `paseo-workflow-handoff` JSON 块。核心将其提取为独立 artifact，并验证统一 schema：

```text
version
phase
nextAction: ask_user | await_design_approval | await_spec_approval |
            await_plan_approval | ready_for_verification | blocked
summary
question?             # nextAction = ask_user 时必填
artifactReferences[]  # spec、计划、测试、审查等产物
```

最终回复本身也保存为受大小上限和敏感信息清理规则保护的 artifact。缺少或无法通过 handoff schema 验证时，步骤不能猜测下一步；Run 转入 `blocked`，保留输出供人工查看、重试或取消。

这不能密码学地证明 Agent 在内部调用过某个 Skill。严格模式的可验证证据是：匹配策略的 prompt 模板版本、完整阶段产物、有效 handoff、人工门禁和验证结果。任何一项缺失都阻断交付。

### 交互式 Workflow

`approval.wait` 保持二元的批准/拒绝语义，不承载设计讨论。核心新增：

- `interaction.wait`：等待用户的自由文本输入；
- 持久化 `WorkflowInteraction`：关联 Run、阶段、发起步骤、问题 artifact、回答 artifact、发起/回答时间、主体身份和状态；
- `workflow.interaction.respond.request` / `.response`：提交用户的文本回答；
- 交互响应后，调用 `agent.continue_until_complete` 将回答续接给同一 Session。

“请求修改”不是 `approval.wait` 的拒绝。它创建或复用一条 `interaction.wait`，保存反馈并让 Agent 回到对应阶段。明确“取消”或批准门禁的“拒绝”才终止该阶段或 Run。

Agent 输出通过受控 Workflow artifact 提供给客户端；客户端不读取任意内部步骤输出或服务端对象。

### 兼容性

交互功能增加 `server_info.features.workflowInteractions`。App 在单一连接边界检查该能力；不支持的 Host 显示更新提示，不进入半功能状态。

所有新增 wire 字段为可选字段，保持旧端解析；新 RPC 遵循 `workflow.interaction.respond.request` / `.response` 的 dotted 名称和相关 `requestId` 约定。wire schema 保持纯结构声明，不使用 `transform`、`catch` 或 `preprocess`。兼容 shim 必须带 `COMPAT(...)` 标签和删除条件。

## Gitea Workflow 插件

### Host 设置

插件注册一个 Host scope、版本化的 settings 文档。它保存：

```text
enabled: boolean                         # 默认 false
pollIntervalSeconds: integer             # 默认 60，最小 10
maxConcurrentRuns: integer               # 默认 3
maxAutomaticRepairCycles: integer        # 默认 2
automationProfile: profile reference
workflowPolicy: full_superpowers | issue_preapproved | unattended
projects: Record<projectId, {
  enabled: boolean
  readyLabel: string                     # 默认 agent-ready
  workflowPolicyOverride?: policy
}>
labelPolicy: {
  inProgressLabel: string                # 默认 agent-in-progress
  reviewedLabel: string                  # 默认 agent-reviewed
}
evidenceRetentionDays: 90
```

设置保存的是 Profile 引用和显示安全的诊断状态，不能保存 Token。Profile 和 Host 在启用前执行能力探测：完整策略需要可用的 Claude Code 与 Superpowers；不满足时项目开关不可开启，并提供可操作的错误说明。

关闭总开关只阻止新的 Issue 认领；已认领任务继续使用认领时不可变的策略和 Profile 快照。后续设置变更只影响新任务。

### 项目发现、认证与认领

轮询器从 Paseo 项目目录读取 Git 项目，解析 `origin`，通过 `tea` 登录优先、Host 环境变量回退获取 Gitea 地址和认证。无法解析、非 Gitea、无认证或未授权项目不会处理 Issue。

对于每个合格项目：

1. 查询带项目启动标签的开放 Issue，排除 Pull Request；
2. 根据 Issue、项目和仓库身份查找既有 Run，并以该组合的稳定幂等键创建 `gitea.issue-to-pr` preset Run；
3. Run 的首个步骤 `gitea.fetch_issue` 读取完整快照，随后 `gitea.claim_issue` 重新读取 Issue 标签；若启动标签已被移除、已存在活动 Run 或已有其他认领证据，停止该 Run；
4. 成功认领后移除启动标签，添加 `status:doing` 与处理中标签，并发布简短认领评论；
5. 将 Issue 与已认领 Run 写入可重建索引，再进入 worktree 与后续阶段。

插件不依赖临时目录的 `tasks.json` 保存任务状态。认证失效、网络故障和标签不存在都产生可见错误和审计事件，不能被视作空队列。

### 插件步骤与 preset

插件注册：

| 步骤                           | 行为                                              |
| ------------------------------ | ------------------------------------------------- |
| `gitea.fetch_issue`            | 读取 Issue 详情、标签、URL 和稳定快照。           |
| `gitea.claim_issue`            | 安全认领并写入活动 Run 关联。                     |
| `gitea.update_status`          | 依据阶段更新 Gitea 标签。                         |
| `gitea.post_lifecycle_summary` | 仅发布认领、关键等待、PR 创建、失败、完成等摘要。 |
| `gitea.resolve_delivery`       | 查询远端分支/PR，协助外部写入超时后的幂等恢复。   |

插件不负责通用 Agent 生命周期、聊天协议、审批存储或通用验证。

## Superpowers 策略与 DAG

### 完整 Superpowers（默认）

```text
claim issue
  → create worktree
  → brainstorm agent turn
  ↔ interaction.wait / continue agent        # 一次一个问题
  → approve conversation design
  → continue agent: write spec + self-review
  → approve written spec
  → continue agent: writing-plans
  → approve plan
  → continue agent: execute plan / TDD
  → verify
  → independent review
  ↔ repair / verify / review                  # 最多 2 轮
  → approve delivery
  → push + create PR
  → Gitea reviewed status + summary
```

该顺序保留 `superpowers:brainstorming` 的硬门禁：对话设计批准只允许写 spec；书面 spec 批准后才能调用 `writing-plans`；实施计划批准后才能进入写入模式和执行阶段。

### Issue 已批准设计

Issue 必须已含足够设计信息。该策略跳过 brainstorming 和书面 spec 审批，从 `writing-plans` 与计划批准开始。Run 审计记录策略、跳过阶段和认领时的 Issue 快照。

### 无人值守

该策略跳过设计、spec 与计划的人审门禁，但保留策略启用者、配置快照、Agent/验证/审查证据和外部写入风险控制。它不能静默绕过 push 或创建 PR 的批准要求。

## 验证、审查与交付

### 验证

实施 Agent 输出 `ready_for_verification` handoff 后，Workflow 运行项目适用的 `verify.command` profile：typecheck、lint 和受影响的定向测试。禁止本地全量重型测试的项目约束继续有效。

只有 UI 任务才启动开发服务并采集桌面/移动截图；逻辑或后端任务只保存测试矩阵。验证失败将输出 artifact 续接给原 Agent 修复，不能进入独立审查。

### 独立审查和修复

验证通过后创建独立、只读的审查 Agent。它读取 Issue、批准的 spec/计划、完整 diff、验证证据和历史 findings，并输出经过 schema 校验的 verdict：

```text
pass | changes_requested | blocked
```

`changes_requested` 包含文件、行号、严重度和说明。系统将 findings 续接给实现 Agent，然后重新执行“修复 → 定向验证 → 独立审查”。超过两轮、出现 Blocker/Critical 或审查 handoff 无效时，Run 进入人工介入状态；任何额外修复轮次或手动放行都写入审计。

### 最终 PR 门禁

最终 Review 详情汇总已批准设计、spec、计划、diff、验证、审查和证据。用户批准交付后，才允许 push 与创建 PR。

交付批准必须绑定不可变 delivery manifest：源分支、目标分支、提交 SHA、PR 标题/正文摘要和关联 Issue。manifest 变化时必须重新批准。外部写入继续记录 intent、receipt 和 unknown outcome；超时或重启后先查询远端状态，避免重复 push、重复 PR 或重复评论。

## 配置页与 Review 面板

### Settings → Plugins → Gitea Workflow

设置页面遵循 Paseo 的标准 Settings shell、SettingsSection、SettingsCard 和行组件；桌面使用居中详情列，紧凑端使用全屏详情。保存使用草稿模型与 revision 冲突处理，失败时保留草稿。

```text
Gitea Workflow
────────────────────────────────────────────────────────

[ 自动化 ]
┌──────────────────────────────────────────────────────┐
│ 自动处理 Issue                         [ 关闭 / 开启 ] │
│ 自动化 Profile                    Claude Code · Opus › │
│ 默认工作流策略                    完整 Superpowers ›  │
└──────────────────────────────────────────────────────┘

[ 调度 ]
┌──────────────────────────────────────────────────────┐
│ 轮询间隔                                  60 秒       │
│ 最大并行任务                                3 个       │
│ 自动修复上限                                2 轮       │
└──────────────────────────────────────────────────────┘

[ 已发现项目 ]
┌──────────────────────────────────────────────────────┐
│ paseo                                               › │
│ Gitea 已连接 · tea · 3 个等待中的 Issue       [开启] │
├──────────────────────────────────────────────────────┤
│ mobile-app                                          › │
│ 未找到 Gitea 凭据                              [关闭] │
└──────────────────────────────────────────────────────┘
```

首次开启总开关或项目开关必须确认，说明其会认领 Issue、创建 worktree 和 Agent，但不会在最终批准前交付远端 PR。

### Gitea Review workspace panel

现有面板升级为当前项目范围内的任务列表和详情。桌面为列表/详情，紧凑端使用列表到详情导航。详情内以分段页展示对话、产物、验证和审计。

```text
┌───────────────────────┬─────────────────────────────────────────────┐
│ 任务                  │ #142 添加工作流交互能力                      │
│                       │ [等待设计回复]  完整 Superpowers             │
│ ● #142 等待设计回复   ├─────────────────────────────────────────────┤
│ ● #138 实现中         │ 阶段                                         │
│ ○ #133 等待最终批准   │ ✓ Issue 已认领                              │
│                       │ ● Brainstorming · 等待你的回复               │
│                       ├─────────────────────────────────────────────┤
│                       │ Agent：这个流程需要支持哪些类型的回复？      │
│                       │                                             │
│                       │ 你的回复                                    │
│                       │ ┌─────────────────────────────────────────┐ │
│                       │ │ 需要自由文本、批准与拒绝理由…           │ │
│                       │ └─────────────────────────────────────────┘ │
│                       │                              [发送回复]    │
│                       ├─────────────────────────────────────────────┤
│                       │ [对话] [产物] [验证] [审计]                 │
└───────────────────────┴─────────────────────────────────────────────┘
```

状态决定唯一的主要操作：回答问题、批准、创建 PR。请求修改打开标准表单 sheet 输入反馈；取消采用明确确认。等待中的动作显示 pending 并防止重复提交；错误原地呈现并可重试。

## 审计与证据

永久保留 Workflow Run、步骤尝试、交互、批准、配置/策略快照、Gitea 操作意图/回执、Agent/Profile 身份、handoff、审查 verdict 和证据元数据。审计不得记录 Token、未经清理的敏感值或不应外发的本地内容。

重量级本地证据包括截图、完整测试输出、开发服务日志和临时审查附件。结束任务达到 90 天后可清理这些文件；清理本身追加 `evidence_pruned` 审计事件，保留名称、内容哈希、大小、到期时间和原因。运行中、等待交互或等待审批的任务永不自动清理。已提交到 Git 的 spec/计划通过路径、内容哈希和 commit SHA 永久可追溯。

Gitea Issue 只接收生命周期摘要：认领、关键等待、PR 创建、失败或完成。摘要不得携带 Token、完整对话、原始测试输出或本地文件链接。

## 失败与恢复

| 情况                         | 行为                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| daemon 重启                  | 从持久化 Run、交互、审批和 artifact 继续；不重新认领或重复写远端。 |
| Gitea 网络/认证失败          | 保留错误 artifact，停止该任务，显示可重试状态。                    |
| 标签缺失或 Issue 被他人接管  | 停止认领/后续写入，记录冲突，不假定成功。                          |
| Agent 请求权限               | 进入等待权限状态，交由 Paseo 原生权限界面；绝不自动批准。          |
| Agent/审查输出无有效 handoff | `blocked`，由用户查看输出后重试、补充信息或取消。                  |
| 插件卸载/重载                | 活跃依赖插件步骤的 Run 转为 `blocked: dependency_unavailable`。    |
| 取消                         | 终止未开始步骤，安全停止服务/工作区资源；保留全部审计。            |

## 验收与测试范围

### 核心与协议

- 新交互 RPC 与 data model 的 schema、版本兼容和 feature gate 有定向测试。
- `agent.run_until_complete` 正确等待完成、失败、取消和权限阻塞。
- 同会话续接保留 Agent 身份，且只在批准计划后允许模式升级。
- 文本交互、请求修改、批准、取消、daemon 重启和 artifact 可见性都有持久化行为测试。
- push/创建 PR 的 delivery manifest、intent/receipt 和超时恢复不会重复外部写入。

### 插件

- 未开启总开关、未授权项目、无认证项目和不匹配标签的 Issue 都不会创建 Run。
- 并发轮询和 daemon 重启不会为同一 Issue 创建多个活跃 Run。
- 标签流转和生命周期摘要使用真实 Gitea adapter 契约测试。
- 策略/Profile 快照不会被后续 settings 修改改变。
- 审计保留和 90 天证据清理保留正确的元数据与 hash。

### App 与端到端

- Settings 草稿、冲突、诊断、开关确认和错误状态可见且可恢复。
- Review panel 覆盖问题回答、设计/spec/计划批准、请求修改、最终 PR 批准、失败和重试。
- 使用真实 daemon 的端到端测试覆盖 Issue → 对话 → spec/plan 门禁 → 实现/验证 → 审查 → PR 门禁关键路径。
- UI 验证覆盖 Web、Electron 和紧凑移动布局，以及深浅主题、慢连接和离线状态。
- 真实 Claude Code Profile 的 smoke 另放在 `*.real.e2e.test.ts`，不以 mock 冒充 Provider/Superpowers 集成验证。

实施按垂直切片 TDD 进行。每个变更只运行相关定向测试，最后运行 `npm run typecheck`、`npm run lint` 和 `npm run format`；不在本地运行全仓全量测试套件。
