## 1. 协议、Scope 与持久化基线

- [x] 1.1 在 `packages/protocol` 增加纯 Zod Workflow wire schemas、可选 `server_info.features.workflowEngine` 与 request/response 消息，并以 protocol schema/compatibility tests 验证旧 `server_info` 仍可解析、新消息的 requestId 与 payload 结构正确。
- [x] 1.2 在 `packages/server/src/server/workflows/` 建立带 `projectId`、`workspaceId`、definition revision/hash、Run、StepAttempt、Approval、Artifact metadata、intent、receipt、lease 和 unknown outcome 的 Zod persisted model，并以临时 `$PASEO_HOME` 文件系统测试验证原子读写、scope 查询和 schema 拒绝。
- [x] 1.3 接入 daemon bootstrap、shutdown 和 Session RPC 路由，使 Workflow Store 与 Runtime 作为 daemon-owned service 生命周期运行；用 in-process daemon harness 验证创建 Run 返回稳定 `runId`，以及关闭/重启后仍能读取持久化状态。

## 2. Definition 编译与受限执行边界

- [x] 2.1 实现 Plugin preset、repository `.paseo/workflows/` 覆盖和 runtime override 的 Definition compiler，并以单元测试验证三层优先级及下层只能收紧 timeout/retry/concurrency、不能新增 Step 或放宽审批。
- [x] 2.2 实现 Prompt root 路径约束、Markdown template allowlist、definition/prompt hash 固定和敏感字段脱敏 Artifact，并以测试验证路径逃逸、未声明变量和环境变量占位符在运行前被拒绝。
- [x] 2.3 实现有限 DAG 与 typed JSON 条件 DSL 校验，覆盖重复 ID、缺失依赖、环、未注册 type、非法/未声明 output 引用、Step/深度/fan-out/并发/Artifact 配额，以及 false condition 的 skipped 原因。
- [x] 2.4 定义并验证 StepAdapter Manifest：输入/输出 Schema、version、executionRisk、semantic permissions、repositoryCallable、idempotency、cancellation、recovery、platform 和 resource conflict key；测试 Plugin 不得覆盖 Core type 或动态加载任意模块。

## 3. Runtime、权限与恢复

- [x] 3.1 实现由 ready dependencies、`when`、resource conflict key 和 daemon-owned lease 驱动的 Step 调度器；测试无依赖 Step 可并行、同 workspace/branch 写入冲突会串行、false condition 会跳过、取消阻止未开始 Step。
- [x] 3.2 实现 attempt intent/receipt 事务语义、idempotency key 和 unknown-outcome 收敛；用可注入 fake forge/worktree adapter 测试崩溃点：intent 后、外部提交后 receipt 前、receipt 后，并验证未知结果不会重复 push/创建 PR。
- [x] 3.3 将 Step 风险映射到既有 semantic permissions，并实现一次性、过期、scope-bound Approval Request；测试缺少 `workspace.write` 时不创建 Worktree、P0 finding 仅升高待审批优先级、批准只消费目标 attempt、拒绝不执行外部操作。
- [x] 3.4 实现注册的 Verification Profile 与 Adapter 恢复/取消约定；测试 workflow JSON 不能提供 raw shell、未注册 profile 被拒绝、不可恢复 Provider session 进入 blocked 或新 attempt 而不是伪造恢复。
- [x] 3.5 实现 Workflow core 的 `worktree.create`、`agent.dispatch`、`verify.command`、`review.agent`、`approval.wait`、`git.push`、`git.create_pr` Adapter，并分别以 scoped unit/integration tests 验证输入、输出、风险、receipt 和 denial 行为。

## 4. Client、Plugin 与 Visual Crawler 迁移

- [x] 4.1 在 `packages/client` 增加 capability-gated Workflow actions 与 typed Run/Approval/Artifact API；测试旧 daemon 缺少 `workflowEngine` 时只返回升级所需状态且不触发分散 fallback。
- [x] 4.2 扩展 `packages/plugin` 的受控 workflow registration API，并以 Plugin runtime tests 验证 registry 生命周期、duplicate type 拒绝、卸载后新 Run 拒绝以及运行中 Plugin Adapter 转 blocked 的事实记录。
- [x] 4.3 将 Visual Crawler 的 approved FixDirective 映射为 scope-bound Workflow Run，删除同一 Directive 的 legacy pool 双重 dispatch；以 plugin integration test 验证 Directive 与 Run 关联、Run awaiting approval 时不伪造 PR、Plugin reload 时显示 actionable blocked。
- [x] 4.4 将 Visual Crawler 的浏览器目标配置改为显式 workspace-scoped local/staging allowlist；以 tests 验证拒绝任意 URL、内网扩展和运行中扩大 origin/path scope。

## 5. App UI / UX

- [x] 5.1 基于现有 Workspace panel/screen host 增加 Workflow Runs 列表及 wide master-detail、compact list-to-full-detail 导航；使用 `useIsCompactFormFactor()`，并以组件测试验证 failed/awaiting-approval 置顶且状态不只依赖颜色。
- [x] 5.2 实现使用 `ScreenTitle`、`StatusBadge`、`Button` 的 Run Detail vertical stepper/indented DAG，展示依赖、parallel siblings、attempt、evidence、approval 和 current blocking node；以组件测试验证无需二维图即可定位下一步。
- [x] 5.3 实现 Approval、Retry、Resume、Cancel 和 Visual Crawler Stop/Batch 操作的 in-context pending/success/error 状态；使用 `confirmDialog` 保护 destructive/external-write 操作，并以 Web 行为测试验证确认前不发 RPC、失败后仍能重试或关闭。
- [x] 5.4 将 Visual Crawler Worker Lanes 重构为 Workflow Run 摘要和详情跳转，移除自定义按钮/Badge 样式；以 UI test 验证 Native/compact 不存在 hover-only 死角，所有操作经可见控件或 `DropdownMenu` 可达。

## 6. 文档、E2E 与交付证据

- [x] 6.1 将 Workflow 持久化、scope、unknown outcome、Definition/Prompt 安全、Adapter manifest、权限审批和 Plugin lifecycle 规则整合到拥有主题的 `docs/` 文档，并以 `npm run format:files --` 验证文档格式。
- [x] 6.2 在隔离 `test/workflow-engine-verification` 分支或隔离测试仓库运行真实 daemon E2E：创建 Worktree、受控 Agent、Verification Profile、Approval、push/PR receipt/recovery；记录 input/expected/actual/status，并清理 Worktree、branch、PR 测试副作用。
- [x] 6.3 使用真实 Web、Electron 和 Compact 流程验证 Run list/detail、approval、failure/retry、confirmation、hover fallback，并保存所需截图与平台矩阵；不运行本地全量测试。
- [x] 6.4 执行 `npm run format`、受影响 package 的 typecheck/lint、目标 Vitest、Protocol build 前置依赖与 OpenSpec strict validation；汇总独立 Codex/Gemini Pro code+UI review 发现、修复和未验证项。
