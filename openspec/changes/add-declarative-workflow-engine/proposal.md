## Why

现有 Visual Crawler 修复链路把 Worktree、Agent、验证与 PR 操作硬编码在 Plugin 的 `WorktreeFixPool` 中，并依赖 mock/predetermined adapter。它不能由仓库共享配置复用，也无法在运行前校验权限、以统一审计方式暂停高风险操作，或在 daemon 重启后按幂等语义恢复。

本变更建立一个最小通用、受控的 Workflow Engine，使 Visual Crawler 的每个 `FixDirective` 可启动可审计的 Run；后续能力只在真实消费者出现时通过注册 Adapter 扩展。

## What Changes

- 在 `packages/server` 新增声明式 Workflow Definition、Run / StepRun 持久化、有限 DAG 调度、受限条件 DSL、Prompt 模板渲染与恢复机制。
- 实现 `Plugin preset → .paseo/workflows/ → runtime override` 的配置解析；后两层只能收紧并发、超时、重试和已开放参数，不能新增 Step、扩大风险或绕过宿主权限。
- 提供受控的 Core StepAdapter：`worktree.create`、`agent.dispatch`、`verify.command`、`review.agent`、`approval.wait`、`git.push`、`git.create_pr`。验证步骤只能引用注册的 Verification Profile，不执行仓库 JSON 内的任意 Shell。
- 将权限判定映射到既有 semantic permissions；任何外部写操作在执行前产生可审计 Approval Request。批准和拒绝都必须明确影响范围与后续状态。
- 通过后向兼容的 `workflow.*.request/.response` RPC、Client API 与 Plugin API 暴露 Definition、Run、Approval 与 Artifact；新功能由 `server_info.features.*` 门控。
- 将 Visual Crawler 的获批准 Directive 映射为 Workflow Run，逐步替换其 Plugin 内硬编码 Worker Pool 调度，不保留第二个执行事实来源。
- 新增 Workflow Runs 列表、Run Detail、缩进式 DAG/纵向 Stepper、审批卡、失败恢复操作，并把 Crawler Worker Lanes 改为 Run 摘要。界面复用 `Button`、`StatusBadge`、`ScreenTitle`、`confirmDialog` 等现有基元；紧凑布局采用列表→详情导航，不以平台判断替代布局判断。

**BREAKING**: 无。协议新增字段与 RPC 保持可选、可能力门控；旧客户端和 daemon 继续使用原有行为。

## Capabilities

### New Capabilities

- `workflow-definition`: 定义、解析并验证可继承、不可越权的 Workflow 配置、Prompt 与 DAG。
- `workflow-runtime`: 执行、持久化、恢复与审计受控 Workflow Run 和 StepRun。
- `workflow-authority`: 对 Workflow Step 施加语义权限、审批和受限执行策略。
- `workflow-plugin-integration`: 允许 Plugin 注册受控 Preset / StepAdapter，并将 Visual Crawler Directive 接入 Workflow Run。
- `workflow-observability-ui`: 在 Paseo App 中展示 Run、步骤、审批、失败和恢复动作。

### Modified Capabilities

- 无。

## Impact

- `packages/server/src/server/workflows/`、daemon bootstrap/session、持久化目录、权限分类与测试 harness。
- `packages/protocol`、`packages/client` 与 `packages/plugin` 的兼容 API / Schema。
- `packages/app` 的 Workspace 运行状态与紧凑布局交互。
- `plugin-examples/visual-crawler-auto-fix` 的 Directive→Run 集成及旧 Worker Pool 迁移。
- `docs/data-model.md`、`docs/permissions.md`、`docs/plugins.md`、`docs/qa.md` 与相关架构文档。
