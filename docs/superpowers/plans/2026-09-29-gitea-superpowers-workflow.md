# Gitea Superpowers Workflow Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Phase 1 交付的交互式 Workflow Engine，将 `plugin-custom/gitea-workflow` 重构为生产级插件，实现从 Gitea Issue 自动认领、Superpowers 阶段编排、多轮人机对话与审批、独立代码审查、到最终 PR 交付与 90 天审计追踪的完整闭环。

**Architecture:** 废除原插件自管的临时文件状态机 (`tasks.json`) 与硬编码脚本调用，将任务生命周期完全交由 Paseo 核心 Workflow 引擎驱动 (`gitea.issue-to-pr` preset)。插件专注于 Gitea 仓库与凭据解析、Host 级配置与项目白名单授权、Gitea 专用步骤适配器 (`fetch_issue`, `claim_issue`, `update_status`, `post_lifecycle_summary`, `resolve_delivery`)、以及在 Review 面板中提供多阶段对话、产物查阅、阶段批准与 90 天证据管理。

**Tech Stack:** TypeScript, React Native / Expo UI, Zod, Paseo Plugin SDK (`@getpaseo/plugin`), Paseo Client API, Gitea REST API, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-gitea-superpowers-workflow-design.md`

## Global Constraints

- **前置依赖**：本计划依赖 Phase 1（`docs/superpowers/plans/2026-09-29-interactive-workflow-core.md`）全部完成且网关能力 `server_info.features.workflowInteractions` 生效。
- **任务事实源唯一性**：工作流状态、步骤尝试、交互、产物与审批唯一由核心 `WorkflowRun` 承载，插件只维护 Issue ↔ RunId 的轻量可重建索引，严禁恢复自管任务状态机。
- **安全与零凭据存储**：Host Settings 绝不持久化 Gitea Token、SSH 密钥或明文凭据；所有连接统一通过 Git `origin` 远端、本机 `tea login` 与守护进程环境变量动态解析。
- **外部交付门禁**：未经用户在 Review 面板显式批准 Delivery Manifest，严禁执行 `git push` 或向 Gitea 创建 Pull Request；禁止硬编码绝对路径调用本地脚本。
- **阶段权限安全**：设计与计划阶段 Agent 仅具备只读/规划权限，仅在计划获得人类批准后才可由核心升级为执行写权限。
- **证据保留与清理**：核心审计事件永久保留；本地大证据（截图、测试矩阵、服务日志）保留 90 天，到期自动修剪并写入 `evidence_pruned` 审计记录。未终态任务永不清理。
- **规范与代码质量**：客户端代码禁止直接引入 DOM 全局变量或 HTML 标签；必须使用主题颜色（`theme.colors.foreground` 等），UI 需兼容移动端紧凑布局；每个变更只运行定向 Vitest 测试，禁止运行全仓测试套件。
- 每个 Git commit 末尾必须包含：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

1. **TOCTOU 认领竞态与重复入队**：多项目并发轮询或守护进程重启时，相同 Issue 被重复认领或创建多个活跃 Run。由 Task 4 与 Task 6 的并发幂等测试固定。
2. **凭据失效与错误隔离**：某一项目 Gitea Token 失效或网络断开时，仅标记该项目诊断异常，绝不阻塞其他授权项目的轮询与执行。由 Task 3 与 Task 6 测试固定。
3. **未授权项目静默拦截**：即便某项目存在带 `agent-ready` 标签的 Issue，只要未在 Settings 中显式开启授权，轮询器绝不发起认领与执行。由 Task 6 测试固定。
4. **Delivery Manifest 篡改/漂移检测**：若代码在审查批准后发生额外 commit 或分支被篡改，提交 PR 时必须阻断并要求重新批准。由 Task 4 测试固定。
5. **活跃任务证据误删**：90 天清理定时器触发时，对于仍处于 `pending_human_review` 或未合并的任务，必须完整保护其截图与测试证据。由 Task 7 测试固定。

---

### Task 1: 补齐插件工程脚手架与共享契约重构 (Scaffolding & Shared Contracts)

**Files:**

- Create: `plugin-custom/gitea-workflow/package.json`
- Create: `plugin-custom/gitea-workflow/tsconfig.json`
- Modify: `plugin-custom/gitea-workflow/shared/types.ts`
- Modify: `plugin-custom/gitea-workflow/shared/contracts.ts`
- Modify: `plugin-custom/gitea-workflow/tests/schema.test.ts`

**Interfaces:**

- Produces: `GiteaHostSettingsSchema`（用于 `defineSettings`），包含全局开关、Profile、默认策略、并发、保留天数、项目授权映射。
- Produces: `IssueRunIndexEntrySchema`、`GiteaProjectDiagnosticSchema`。
- Produces: 废弃原 `gitea.tasks.approve`/`reject`，新增 `gitea.diagnostics.list`、`gitea.evidence.prune` RPC 契约。
- Consumes: `@getpaseo/plugin` (`defineRpc`, `defineSettings`)。

- [ ] **Step 1: 编写新增配置与索引 Schema 的失败测试**

在 `plugin-custom/gitea-workflow/tests/schema.test.ts` 中增加测试用例，验证 `GiteaHostSettingsSchema` 的默认值、合法校验与项目覆盖校验：

```typescript
import { describe, it, expect } from "vitest";
import { GiteaHostSettingsSchema, IssueRunIndexEntrySchema } from "../shared/types";

describe("GiteaHostSettingsSchema", () => {
  it("provides safe defaults with global automation disabled", () => {
    const settings = GiteaHostSettingsSchema.parse({});
    expect(settings.enabled).toBe(false);
    expect(settings.workflowPolicy).toBe("full_superpowers");
    expect(settings.pollIntervalSeconds).toBe(60);
    expect(settings.maxConcurrentRuns).toBe(3);
    expect(settings.evidenceRetentionDays).toBe(90);
    expect(settings.projects).toEqual({});
  });

  it("validates project authorization and policy override", () => {
    const settings = GiteaHostSettingsSchema.parse({
      enabled: true,
      projects: {
        "proj-1": {
          enabled: true,
          readyLabel: "bot-task",
          workflowPolicyOverride: "issue_preapproved",
        },
      },
    });
    expect(settings.projects["proj-1"].readyLabel).toBe("bot-task");
    expect(settings.projects["proj-1"].workflowPolicyOverride).toBe("issue_preapproved");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/schema.test.ts --bail=1
```

预期：由于 `GiteaHostSettingsSchema` 未导出或字段不匹配，测试报错失败。

- [ ] **Step 3: 创建工程配置并实现共享 Schema 与 RPC 契约**

1. 创建 `plugin-custom/gitea-workflow/package.json`：

```json
{
  "name": "@paseo-plugin/gitea-workflow",
  "version": "0.10.1",
  "private": true,
  "description": "Gitea Superpowers automated workflow and review workbench",
  "devDependencies": {
    "@getpaseo/plugin": "*",
    "@tanstack/react-query": "^5.0.0",
    "react": "^18.3.1",
    "react-native": "^0.76.0",
    "typescript": "^5.6.0",
    "zod": "^3.23.8"
  }
}
```

2. 创建 `plugin-custom/gitea-workflow/tsconfig.json`（禁止 DOM 库以保证跨端安全）：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ESNext"]
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

3. 更新 `plugin-custom/gitea-workflow/shared/types.ts`，导出 `GiteaHostSettingsSchema`、`GiteaWorkflowPolicySchema`、`IssueRunIndexEntrySchema` 等核心契约。
4. 更新 `plugin-custom/gitea-workflow/shared/contracts.ts`，废除任务状态流转直接 RPC，仅暴露状态读取与诊断 RPC。

- [ ] **Step 4: 运行测试验证通过并检查类型**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/schema.test.ts --bail=1
npm run typecheck
```

预期：所有 Schema 测试通过，类型检查无错误。

- [ ] **Step 5: 提交工程脚手架与契约代码**

```bash
git add plugin-custom/gitea-workflow/package.json \
  plugin-custom/gitea-workflow/tsconfig.json \
  plugin-custom/gitea-workflow/shared/types.ts \
  plugin-custom/gitea-workflow/shared/contracts.ts \
  plugin-custom/gitea-workflow/tests/schema.test.ts
git commit -m "feat(gitea-workflow): setup scaffolding and declare host settings schema" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Host Settings 注册与生命周期监听 (Host Settings Integration)

**Files:**

- Create: `plugin-custom/gitea-workflow/shared/settings.ts`
- Create: `plugin-custom/gitea-workflow/server/settings-manager.ts`
- Create: `plugin-custom/gitea-workflow/tests/settings.test.ts`
- Modify: `plugin-custom/gitea-workflow/index.server.ts`

**Interfaces:**

- Produces: `giteaSettings = defineSettings({ id: "config", scope: "host", version: 1, schema: GiteaHostSettingsSchema })`。
- Produces: `SettingsManager` 类，封装 `read()`、`subscribe()`，为轮询器与适配器提供响应式的最新配置快照。
- Consumes: `@getpaseo/plugin` (`defineSettings`)，`@getpaseo/plugin/server` (`PluginServerContext.registerSettings`)。

- [ ] **Step 1: 编写 Settings 订阅与读取的失败测试**

在 `plugin-custom/gitea-workflow/tests/settings.test.ts` 中编写测试：

```typescript
import { describe, it, expect, vi } from "vitest";
import { SettingsManager } from "../server/settings-manager";

describe("SettingsManager", () => {
  it("initializes with schema defaults and notifies on change", async () => {
    let subscriber: ((state: any) => void) | null = null;
    const mockPluginSettings = {
      read: vi.fn().mockResolvedValue({
        status: "ready",
        values: { enabled: false, pollIntervalSeconds: 60, projects: {} },
        revision: "rev-1",
      }),
      subscribe: vi.fn().mockImplementation((cb) => {
        subscriber = cb;
        return () => {};
      }),
    };

    const manager = new SettingsManager(mockPluginSettings as any);
    await manager.initialize();

    expect(manager.current.enabled).toBe(false);
    expect(manager.isProjectAuthorized("proj-1")).toBe(false);

    // 模拟配置变更事件
    subscriber!({
      status: "ready",
      values: {
        enabled: true,
        pollIntervalSeconds: 30,
        projects: { "proj-1": { enabled: true, readyLabel: "agent-ready" } },
      },
      revision: "rev-2",
    });

    expect(manager.current.enabled).toBe(true);
    expect(manager.current.pollIntervalSeconds).toBe(30);
    expect(manager.isProjectAuthorized("proj-1")).toBe(true);
    expect(manager.getReadyLabel("proj-1")).toBe("agent-ready");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/settings.test.ts --bail=1
```

预期：因缺少 `SettingsManager` 模块失败。

- [ ] **Step 3: 实现 Settings 定义与管理层**

1. 在 `plugin-custom/gitea-workflow/shared/settings.ts` 中使用 `defineSettings` 包装：

```typescript
import { defineSettings } from "@getpaseo/plugin";
import { GiteaHostSettingsSchema } from "./types.js";

export const giteaSettingsDefinition = defineSettings({
  id: "config",
  scope: "host",
  version: 1,
  schema: GiteaHostSettingsSchema,
});
```

2. 创建 `plugin-custom/gitea-workflow/server/settings-manager.ts`，管理只读状态缓存、授权判断助手方法与配置变更订阅。
3. 在 `plugin-custom/gitea-workflow/index.server.ts` 中注册 `server.registerSettings(giteaSettingsDefinition)`，并传入 `SettingsManager`。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/settings.test.ts --bail=1
```

预期：测试通过，配置变更能正确触发状态更新与授权判断。

- [ ] **Step 5: 提交设置管理切片**

```bash
git add plugin-custom/gitea-workflow/shared/settings.ts \
  plugin-custom/gitea-workflow/server/settings-manager.ts \
  plugin-custom/gitea-workflow/tests/settings.test.ts \
  plugin-custom/gitea-workflow/index.server.ts
git commit -m "feat(gitea-workflow): wire host settings definition and reactive manager" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 项目授权与 Gitea 连通性只读诊断服务 (Diagnostics & Auth Resolution)

**Files:**

- Create: `plugin-custom/gitea-workflow/server/diagnostics.ts`
- Modify: `plugin-custom/gitea-workflow/server/resolver.ts`
- Modify: `plugin-custom/gitea-workflow/tests/resolver.test.ts`
- Create: `plugin-custom/gitea-workflow/tests/diagnostics.test.ts`

**Interfaces:**

- Produces: `DiagnosticsService.diagnoseProjects(projects: PaseoProjectItem[]): Promise<GiteaProjectDiagnostic[]>`。
- Produces: 安全返回 Gitea 连通状态、认证来源（`tea` / `env`）、活跃待办数，**绝对隐藏真实 Token**。
- Consumes: `ProjectGiteaResolver`、`GiteaClientPool`、`SettingsManager`。

- [ ] **Step 1: 编写项目只读诊断的失败测试**

在 `plugin-custom/gitea-workflow/tests/diagnostics.test.ts` 编写测试：

```typescript
import { describe, it, expect, vi } from "vitest";
import { DiagnosticsService } from "../server/diagnostics";

describe("DiagnosticsService", () => {
  it("returns sanitized diagnostic status without exposing auth tokens", async () => {
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-1",
        host: "git.example.com",
        baseUrl: "https://git.example.com",
        token: "secret-token-12345",
        repoOwner: "org",
        repoName: "repo",
        authSource: "tea",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([{ number: 1, title: "Issue 1" }]),
    };
    const mockPool = {
      getClient: vi.fn().mockReturnValue(mockClient),
    };
    const mockSettings = {
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
    };

    const service = new DiagnosticsService(
      mockResolver as any,
      mockPool as any,
      mockSettings as any,
    );
    const results = await service.diagnoseProjects([
      { projectId: "proj-1", projectRootPath: "/app" } as any,
    ]);

    expect(results).toHaveLength(1);
    const diag = results[0];
    expect(diag.projectId).toBe("proj-1");
    expect(diag.connectionStatus).toBe("connected");
    expect(diag.authSource).toBe("tea");
    expect(diag.pendingIssueCount).toBe(1);
    // 强制验证凭据安全红线：绝不能泄露 token
    expect((diag as any).token).toBeUndefined();
    expect(JSON.stringify(diag)).not.toContain("secret-token-12345");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/diagnostics.test.ts --bail=1
```

预期：因缺少 `DiagnosticsService` 失败。

- [ ] **Step 3: 实现诊断服务并在 RPC 中注册**

1. 实现 `plugin-custom/gitea-workflow/server/diagnostics.ts`，遍历候选 Git 项目，解析 Gitea 远端并探测连通性。捕获网络错误、认证缺失与标签未找到等异常，返回结构化的 `{ status: "connected" | "unauthorized" | "unreachable" }` 诊断报告。
2. 确保返回给客户端的数据经过 DTO 清洗，不包含任何密钥信息。
3. 在 `index.server.ts` 中注册 `server.handle(diagnoseProjectsRpc, ...)`。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/diagnostics.test.ts --bail=1
npx vitest run plugin-custom/gitea-workflow/tests/resolver.test.ts --bail=1
```

预期：诊断服务逻辑正确，异常隔离，安全红线得到验证。

- [ ] **Step 5: 提交诊断服务切片**

```bash
git add plugin-custom/gitea-workflow/server/diagnostics.ts \
  plugin-custom/gitea-workflow/server/resolver.ts \
  plugin-custom/gitea-workflow/tests/diagnostics.test.ts \
  plugin-custom/gitea-workflow/index.server.ts
git commit -m "feat(gitea-workflow): implement sanitized project diagnostics service" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Gitea 专用 Workflow 步骤适配器实现 (Gitea Step Adapters)

**Files:**

- Create: `plugin-custom/gitea-workflow/server/adapters/fetch-issue.ts`
- Create: `plugin-custom/gitea-workflow/server/adapters/claim-issue.ts`
- Create: `plugin-custom/gitea-workflow/server/adapters/update-status.ts`
- Create: `plugin-custom/gitea-workflow/server/adapters/post-summary.ts`
- Create: `plugin-custom/gitea-workflow/server/adapters/resolve-delivery.ts`
- Create: `plugin-custom/gitea-workflow/server/adapters/index.ts`
- Create: `plugin-custom/gitea-workflow/tests/step-adapters.test.ts`

**Interfaces:**

- Produces: 5 个符合 Phase 1 `PluginWorkflowStepAdapterRegistration` 契约的适配器：
  - `gitea.fetch_issue`: 读取 Issue 完整快照；
  - `gitea.claim_issue`: 原子检查启动标签并切换为 `status:doing` + `inProgressLabel`；
  - `gitea.update_status`: 阶段标签更新（如 `status:review` + `reviewedLabel`）；
  - `gitea.post_lifecycle_summary`: 发布简要生命周期 Markdown 评论（脱敏）；
  - `gitea.resolve_delivery`: 验证远端分支与 PR 是否存在，输出 delivery manifest。
- Consumes: `GiteaClientPool`、Phase 1 中的 `registerWorkflowStepAdapter`。

- [ ] **Step 1: 编写步骤适配器执行逻辑的失败测试**

在 `plugin-custom/gitea-workflow/tests/step-adapters.test.ts` 编写测试：

```typescript
import { describe, it, expect, vi } from "vitest";
import { createClaimIssueAdapter } from "../server/adapters/claim-issue";

describe("gitea.claim_issue step adapter", () => {
  it("claims issue atomically and transitions labels", async () => {
    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({
        number: 42,
        labels: [{ name: "agent-ready", id: 101 }],
      }),
      claimIssue: vi.fn().mockResolvedValue(undefined),
    };
    const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };

    const adapter = createClaimIssueAdapter(mockPool as any);
    const result = await adapter.execute(
      {
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
        issueNumber: 42,
        listenLabel: "agent-ready",
        inProgressLabel: "agent-in-progress",
      },
      { paseo: {} as any, run: { runId: "run-1" } as any },
    );

    expect(result.claimed).toBe(true);
    expect(mockClient.claimIssue).toHaveBeenCalledWith(42, 101);
  });

  it("aborts claim if readyLabel was already removed", async () => {
    const mockClient = {
      getIssue: vi.fn().mockResolvedValue({
        number: 42,
        labels: [{ name: "other-label", id: 102 }],
      }),
      claimIssue: vi.fn(),
    };
    const mockPool = { getClient: vi.fn().mockReturnValue(mockClient) };

    const adapter = createClaimIssueAdapter(mockPool as any);
    await expect(
      adapter.execute(
        {
          baseUrl: "https://git.example.com",
          token: "tok",
          repoOwner: "org",
          repoName: "repo",
          issueNumber: 42,
          listenLabel: "agent-ready",
          inProgressLabel: "agent-in-progress",
        },
        { paseo: {} as any, run: { runId: "run-1" } as any },
      ),
    ).rejects.toThrow("Label 'agent-ready' no longer present on issue #42");
    expect(mockClient.claimIssue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/step-adapters.test.ts --bail=1
```

预期：适配器文件尚不存在，测试报错。

- [ ] **Step 3: 实现各 Gitea 步骤适配器**

1. 实现 `fetch-issue.ts`：抓取标题、正文、标签集合及不可变哈希快照。
2. 实现 `claim-issue.ts`：加锁探测并安全更新 Gitea 标签。
3. 实现 `update-status.ts`：按阶段原子切换状态标签。
4. 实现 `post-summary.ts`：生成并发布生命周期摘要评论（彻底过滤本地绝对路径与 Token）。
5. 实现 `resolve-delivery.ts`：装配包括源分支、目标分支、提交 SHA、PR 标题正文摘要的 `DeliveryApprovalManifest`。
6. 在 `index.ts` 聚合并在 `index.server.ts` 中调用 `server.registerWorkflowStepAdapter(...)` 注册。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/step-adapters.test.ts --bail=1
```

预期：所有适配器逻辑执行正确，异常分支按契约抛出。

- [ ] **Step 5: 提交步骤适配器切片**

```bash
git add plugin-custom/gitea-workflow/server/adapters/ \
  plugin-custom/gitea-workflow/tests/step-adapters.test.ts \
  plugin-custom/gitea-workflow/index.server.ts
git commit -m "feat(gitea-workflow): implement dedicated Gitea workflow step adapters" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Gitea Issue-to-PR Workflow Preset 与 Prompt 模板构建 (Workflow Presets)

**Files:**

- Create: `plugin-custom/gitea-workflow/server/presets/issue-to-pr.ts`
- Create: `plugin-custom/gitea-workflow/server/prompts/brainstorm.md`
- Create: `plugin-custom/gitea-workflow/server/prompts/spec-review.md`
- Create: `plugin-custom/gitea-workflow/server/prompts/implement.md`
- Create: `plugin-custom/gitea-workflow/server/prompts/independent-review.md`
- Create: `plugin-custom/gitea-workflow/tests/preset.test.ts`
- Modify: `plugin-custom/gitea-workflow/index.server.ts`

**Interfaces:**

- Produces: `issueToPrPreset: PluginWorkflowPreset`，注册 ID 为 `gitea.issue-to-pr`。
- Produces: 3 种策略的完整 DAG 定义（`full_superpowers`, `issue_preapproved`, `unattended`）。
- Consumes: Phase 1 核心步骤 (`worktree.create`, `agent.run_until_complete`, `agent.continue_until_complete`, `interaction.wait`, `approval.wait`, `verify.command`, `git.push`, `git.create_pr`) 与 Task 4 适配器。

- [ ] **Step 1: 编写 Preset DAG 编译与策略分支的失败测试**

在 `plugin-custom/gitea-workflow/tests/preset.test.ts` 中编写测试：

```typescript
import { describe, it, expect } from "vitest";
import { buildGiteaWorkflowDefinition } from "../server/presets/issue-to-pr";

describe("buildGiteaWorkflowDefinition", () => {
  it("builds strict full_superpowers DAG with design and plan gates", () => {
    const def = buildGiteaWorkflowDefinition("full_superpowers");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).toContain("fetch-issue");
    expect(stepIds).toContain("claim-issue");
    expect(stepIds).toContain("worktree-create");
    expect(stepIds).toContain("brainstorm-agent");
    expect(stepIds).toContain("design-approval");
    expect(stepIds).toContain("spec-agent");
    expect(stepIds).toContain("spec-approval");
    expect(stepIds).toContain("plan-agent");
    expect(stepIds).toContain("plan-approval");
    expect(stepIds).toContain("implement-agent");
    expect(stepIds).toContain("verify-command");
    expect(stepIds).toContain("independent-review");
    expect(stepIds).toContain("delivery-approval");
    expect(stepIds).toContain("git-push");
    expect(stepIds).toContain("git-create-pr");
  });

  it("skips design gates in issue_preapproved strategy", () => {
    const def = buildGiteaWorkflowDefinition("issue_preapproved");
    const stepIds = def.steps.map((s) => s.id);

    expect(stepIds).not.toContain("brainstorm-agent");
    expect(stepIds).not.toContain("design-approval");
    expect(stepIds).toContain("plan-agent");
    expect(stepIds).toContain("delivery-approval");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/preset.test.ts --bail=1
```

预期：因缺少 `buildGiteaWorkflowDefinition` 失败。

- [ ] **Step 3: 编写 Prompt 模板并实现 Preset DAG**

1. 编写 Markdown Prompt 模板，在末尾严格规定输出 `paseo-workflow-handoff` JSON 块的格式：
   - `brainstorm.md`: 指引调用 `superpowers:brainstorming`，每次提问一个，收敛至设计方案。
   - `spec-review.md`: 撰写 `docs/superpowers/specs/` 并执行自检。
   - `implement.md`: 执行实施计划，严格 TDD 并生成完整测试验证。
   - `independent-review.md`: 独立审查，输出 `pass` 或包含文件/行号的 `changes_requested` 结构化发现。
2. 实现 `issue-to-pr.ts`，组装 DAG，配置各步骤的 `dependsOn`、输入占位符及执行风险。
3. 在 `index.server.ts` 中通过 `server.registerWorkflowPreset(issueToPrPreset)` 注册。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/preset.test.ts --bail=1
```

预期：DAG 拓扑正确无环，各策略分支符合 Spec 预期。

- [ ] **Step 5: 提交 Preset 与模板切片**

```bash
git add plugin-custom/gitea-workflow/server/presets/ \
  plugin-custom/gitea-workflow/server/prompts/ \
  plugin-custom/gitea-workflow/tests/preset.test.ts \
  plugin-custom/gitea-workflow/index.server.ts
git commit -m "feat(gitea-workflow): define issue-to-pr workflow preset with superpowers prompts" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 轮询器重构与可重建 Issue ↔ Run 索引 (Poller & Engine-Backed Dispatch)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/store.ts`
- Modify: `plugin-custom/gitea-workflow/server/poller.ts`
- Modify: `plugin-custom/gitea-workflow/tests/poller.test.ts`
- Modify: `plugin-custom/gitea-workflow/tests/store.test.ts`
- Delete: `plugin-custom/gitea-workflow/server/orchestrator.ts`
- Modify: `plugin-custom/gitea-workflow/index.server.ts`

**Interfaces:**

- Produces: `IssueRunIndexStore`，文件存储位于 plugin 数据目录（不再放在 `os.tmpdir()`），支持根据活跃 Run 列表自动重建。
- Produces: `MultiProjectPoller`，根据 `SettingsManager` 判别项目白名单，自动向核心 `paseo.workflows.create({ presetId: "gitea.issue-to-pr", ... })` 提交任务。
- Consumes: `SettingsManager`、`ProjectGiteaResolver`、`PaseoApi.workflows`。

- [ ] **Step 1: 编写基于引擎派发的轮询器测试**

在 `plugin-custom/gitea-workflow/tests/poller.test.ts` 编写测试，断言未授权项目被过滤，授权项目通过 Workflow 引擎创建 Run：

```typescript
import { describe, it, expect, vi } from "vitest";
import { MultiProjectPoller } from "../server/poller";

describe("MultiProjectPoller", () => {
  it("skips unauthorized projects and creates workflow run for authorized ready issues", async () => {
    const mockSettings = {
      current: { enabled: true, pollIntervalSeconds: 60, maxConcurrentRuns: 3 },
      isProjectAuthorized: vi.fn().mockImplementation((id) => id === "proj-auth"),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getWorkflowPolicy: vi.fn().mockReturnValue("full_superpowers"),
    };
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-auth",
        baseUrl: "https://git.example.com",
        token: "tok",
        repoOwner: "org",
        repoName: "repo",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi
        .fn()
        .mockResolvedValue([{ number: 101, title: "Fix bug", labels: [{ name: "agent-ready" }] }]),
    };
    const mockIndexStore = {
      hasActiveRunForIssue: vi.fn().mockResolvedValue(false),
      recordRun: vi.fn().mockResolvedValue(undefined),
    };
    const mockWorkflows = {
      create: vi.fn().mockResolvedValue({ id: "run-gitea-101" }),
      list: vi.fn().mockResolvedValue({ runs: [] }),
    };

    const poller = new MultiProjectPoller({
      settings: mockSettings as any,
      resolver: mockResolver as any,
      clientPool: { getClient: () => mockClient } as any,
      indexStore: mockIndexStore as any,
      getWorkflows: () => mockWorkflows as any,
      getProjects: () => [{ projectId: "proj-auth", projectKind: "git" }] as any,
    });

    await poller.poll();

    expect(mockWorkflows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: "gitea.issue-to-pr",
        input: expect.objectContaining({ issueNumber: 101 }),
      }),
    );
    expect(mockIndexStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 101, runId: "run-gitea-101" }),
    );
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1
```

预期：因轮询器仍依赖已被废弃的 `WorktreeOrchestrator` 导致失败。

- [ ] **Step 3: 改造索引存储、彻底删除旧 orchestrator 并重构 poller**

1. 重写 `store.ts` 为 `IssueRunIndexStore`，将索引文件存入 `$PASEO_HOME/plugins/gitea-workflow/issue-index.json`，提供 `rebuildFromRuns(runs)` 方法。
2. 重写 `poller.ts`，彻底移除对 `orchestrator.ts` 的调用，改为直接调用 `paseo.workflows.create` 派发。
3. 删除 `plugin-custom/gitea-workflow/server/orchestrator.ts`。
4. 在 `index.server.ts` 中完成组件装配。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1
npx vitest run plugin-custom/gitea-workflow/tests/store.test.ts --bail=1
```

预期：轮询器与索引存储重构完成，测试绿灯。

- [ ] **Step 5: 提交轮询器与索引切片**

```bash
git rm plugin-custom/gitea-workflow/server/orchestrator.ts
git add plugin-custom/gitea-workflow/server/store.ts \
  plugin-custom/gitea-workflow/server/poller.ts \
  plugin-custom/gitea-workflow/tests/poller.test.ts \
  plugin-custom/gitea-workflow/tests/store.test.ts \
  plugin-custom/gitea-workflow/index.server.ts
git commit -m "refactor(gitea-workflow): delegate execution to workflow engine and drop orchestrator" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 证据管理器升级与 90 天自动化生命周期清理 (Evidence Retention)

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/evidence-manager.ts`
- Create: `plugin-custom/gitea-workflow/server/cleanup.ts`
- Modify: `plugin-custom/gitea-workflow/tests/evidence-manager.test.ts`
- Create: `plugin-custom/gitea-workflow/tests/cleanup.test.ts`
- Modify: `plugin-custom/gitea-workflow/index.server.ts`

**Interfaces:**

- Produces: `EvidencePruner.pruneExpiredEvidence(nowMs: number): Promise<PruneResult>`。
- Produces: 自动跳过未完成或等待审批的 Run，仅清理已终结（`succeeded` / `failed` / `cancelled`）且超过保留期限的大文件证据，生成不可变 `evidence_pruned` 审计条目。
- Consumes: `EvidenceManager`、`SettingsManager`、`PaseoApi.workflows`。

- [ ] **Step 1: 编写 90 天证据清理逻辑与保护活跃任务的失败测试**

在 `plugin-custom/gitea-workflow/tests/cleanup.test.ts` 中编写测试：

```typescript
import { describe, it, expect, vi } from "vitest";
import { EvidencePruner } from "../server/cleanup";

describe("EvidencePruner", () => {
  it("prunes evidence for terminal runs older than retention period but protects active runs", async () => {
    const now = 100_000_000_000;
    const ninetyOneDaysAgo = now - 91 * 24 * 3600 * 1000;

    const mockEvidenceManager = {
      listRecordedEvidence: vi.fn().mockResolvedValue([
        {
          runId: "old-terminal-run",
          path: "/tmp/ev1.png",
          createdAt: ninetyOneDaysAgo,
          sizeBytes: 1024,
        },
        {
          runId: "old-active-run",
          path: "/tmp/ev2.png",
          createdAt: ninetyOneDaysAgo,
          sizeBytes: 2048,
        },
      ]),
      deleteEvidenceFile: vi.fn().mockResolvedValue(true),
    };
    const mockWorkflows = {
      inspect: vi.fn().mockImplementation(async ({ runId }) => {
        if (runId === "old-terminal-run") return { status: "succeeded" };
        return { status: "waiting_approval" }; // 保护活跃或待审批任务
      }),
    };
    const mockSettings = { current: { evidenceRetentionDays: 90 } };

    const pruner = new EvidencePruner(
      mockEvidenceManager as any,
      mockWorkflows as any,
      mockSettings as any,
    );
    const result = await pruner.pruneExpiredEvidence(now);

    expect(result.prunedCount).toBe(1);
    expect(mockEvidenceManager.deleteEvidenceFile).toHaveBeenCalledWith("/tmp/ev1.png");
    expect(mockEvidenceManager.deleteEvidenceFile).not.toHaveBeenCalledWith("/tmp/ev2.png");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/cleanup.test.ts --bail=1
```

预期：因缺少 `EvidencePruner` 失败。

- [ ] **Step 3: 实现证据生命周期清理器并在守护进程注册**

1. 升级 `evidence-manager.ts`，在存储截图和测试矩阵时追加包含时间戳、文件哈希与大小的元数据记账。
2. 实现 `cleanup.ts`，执行安全修剪算法，严格校验对应 `WorkflowRun.status` 是否为终态。
3. 在 `index.server.ts` 中启动定时任务（每日运行一次），并在插件卸载（cleanup 返回值）中安全清除定时器。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/cleanup.test.ts --bail=1
npx vitest run plugin-custom/gitea-workflow/tests/evidence-manager.test.ts --bail=1
```

预期：过期大证据安全清除，活跃任务 100% 保护。

- [ ] **Step 5: 提交证据清理切片**

```bash
git add plugin-custom/gitea-workflow/server/evidence-manager.ts \
  plugin-custom/gitea-workflow/server/cleanup.ts \
  plugin-custom/gitea-workflow/tests/cleanup.test.ts \
  plugin-custom/gitea-workflow/tests/evidence-manager.test.ts \
  plugin-custom/gitea-workflow/index.server.ts
git commit -m "feat(gitea-workflow): add 90-day evidence retention pruner with active run guard" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 插件设置界面与项目授权管理 UI (Settings Screen)

**Files:**

- Create: `plugin-custom/gitea-workflow/client/host-settings.tsx`
- Create: `plugin-custom/gitea-workflow/client/project-detail-settings.tsx`
- Modify: `plugin-custom/gitea-workflow/index.client.tsx`
- Create: `plugin-custom/gitea-workflow/tests/settings-screen.test.tsx`

**Interfaces:**

- Produces: Gitea Workflow 设置界面（挂载于 **Settings → Plugins → Gitea Workflow**）。
- Produces: 包含全局自动化开关、Profile 选择、默认工作流策略、调度参数、项目授权列表及连通性诊断展示。
- Consumes: `@getpaseo/plugin/client` (`useSettings`, `useRpc`, `usePaseo`)，`@getpaseo/plugin/client/ui` (`SettingsCard`, `SettingsSection`, `SettingsSwitch`, `SettingsSelect`)。

- [ ] **Step 1: 编写设置页草稿与保存冲突处理的失败测试**

在 `plugin-custom/gitea-workflow/tests/settings-screen.test.tsx` 中编写测试：

```typescript
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { HostSettingsScreen } from "../client/host-settings";

describe("HostSettingsScreen", () => {
  it("renders settings controls and allows toggling global automation", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const mockUseSettings = vi.fn().mockReturnValue({
      status: "ready",
      values: {
        enabled: false,
        pollIntervalSeconds: 60,
        maxConcurrentRuns: 3,
        workflowPolicy: "full_superpowers",
        projects: {},
      },
      revision: "rev-1",
      save: mockSave,
    });

    render(<HostSettingsScreen useSettingsHook={mockUseSettings as any} theme={{ colors: {} } as any} />);

    expect(screen.getByText("自动处理 Issue")).toBeTruthy();
    const switchControl = screen.getByTestId("global-enabled-switch");
    fireEvent(switchControl, "valueChange", true);

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
      "rev-1"
    );
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/settings-screen.test.tsx --bail=1
```

预期：因组件尚未实现失败。

- [ ] **Step 3: 实现符合 Paseo 设计系统的设置界面**

1. 遵循 `docs/design.md`，使用 `@getpaseo/plugin/client/ui` 的标准卡片与行布局。
2. 实现 `host-settings.tsx`，展示自动化、调度、项目授权卡片；项目项点击可展开或导航至 `project-detail-settings.tsx` 调整单个启动标签与策略覆盖。
3. 增加首次开启全局/项目自动化开关时的确认对话弹窗提示（明确说明会认领 Issue 并启动 Agent）。
4. 在 `index.client.tsx` 中通过 `client.addSettingsScreen({ id: "config", title: "Gitea Workflow", icon: "GitBranch", Component: HostSettingsScreen })` 注册。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/settings-screen.test.tsx --bail=1
npm run typecheck
```

预期：设置页渲染与交互逻辑全部通过，类型检查无错误。

- [ ] **Step 5: 提交设置界面切片**

```bash
git add plugin-custom/gitea-workflow/client/host-settings.tsx \
  plugin-custom/gitea-workflow/client/project-detail-settings.tsx \
  plugin-custom/gitea-workflow/tests/settings-screen.test.tsx \
  plugin-custom/gitea-workflow/index.client.tsx
git commit -m "feat(gitea-workflow): implement host settings screen with project authorization UI" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Gitea Review 面板重构 (Workspace Review Panel)

**Files:**

- Modify: `plugin-custom/gitea-workflow/client/review-panel.tsx`
- Modify: `plugin-custom/gitea-workflow/client/feedback-dialog.tsx`
- Modify: `plugin-custom/gitea-workflow/client/screenshot-gallery.tsx`
- Create: `plugin-custom/gitea-workflow/client/audit-timeline.tsx`
- Create: `plugin-custom/gitea-workflow/tests/review-panel.test.tsx`

**Interfaces:**

- Produces: 重构后的 `ReviewPanel`（作为 Workspace Panel 挂载）。
- Produces: 任务列表（当前项目过滤）、阶段进度条、**设计问答回复输入框**、产物与测试证据展示、不可变审计时间线、以及受 Delivery Manifest 保护的“创建 PR”批准按钮。
- Consumes: `usePaseo().workflows`、Phase 1 提供的 `WorkflowInteractionCard` 与 `workflow.interaction.respond`。

- [ ] **Step 1: 编写 Review 面板阶段流转与回复交互的失败测试**

在 `plugin-custom/gitea-workflow/tests/review-panel.test.tsx` 中编写测试：

```typescript
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ReviewPanel } from "../client/review-panel";

describe("ReviewPanel", () => {
  it("renders pending interaction card when agent asks design question", async () => {
    const mockWorkflowApi = {
      inspect: vi.fn().mockResolvedValue({
        id: "run-101",
        status: "running",
        pendingInteraction: {
          id: "inter-1",
          promptArtifactId: "art-q",
          question: "需要支持哪些数据库？",
        },
        stepAttempts: [{ stepId: "brainstorm-agent", status: "running" }],
      }),
      interactionRespond: vi.fn().mockResolvedValue({}),
    };

    render(
      <ReviewPanel
        workspaceId="ws-1"
        theme={{ colors: { foreground: "#fff", surface0: "#000" } } as any}
        workflowApi={mockWorkflowApi as any}
      />
    );

    expect(await screen.findByText("需要支持哪些数据库？")).toBeTruthy();
    const input = screen.getByPlaceholderText("输入回复...");
    fireEvent.changeText(input, "支持 PostgreSQL 和 SQLite");
    fireEvent.press(screen.getByText("发送回复"));

    expect(mockWorkflowApi.interactionRespond).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "支持 PostgreSQL 和 SQLite" })
    );
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/review-panel.test.tsx --bail=1
```

预期：因原 `review-panel.tsx` 未接入交互式工作流 API 导致失败。

- [ ] **Step 3: 重构 Review 面板并集成设计问答与审计视图**

1. 废弃原 `review-panel.tsx` 中对旧 `gitea.tasks.approve` 的调用，接入 `usePaseo().workflows`。
2. 增加分段页（Segmented Tabs）：**对话 / 产物 / 验证 / 审计**。
   - 对话页：内嵌 `WorkflowInteractionCard`，展示当前 Agent 的问题并提供回复输入框；
   - 产物页：展示生成的 Spec、实施计划及 Diff 摘要；
   - 验证页：展示 `ScreenshotGallery`（UI 任务）与单元测试矩阵；
   - 审计页：展示从 Issue 认领到各阶段决定的不可变事件时间线（`audit-timeline.tsx`）。
3. 底部主操作区：严格根据当前 Run 状态呈现（“发送回复”、“批准设计”、“批准计划”、“批准交付并创建 PR”）。点击“请求修改”呼出 `FeedbackDialog`，将其作为交互反馈续接同一 Agent。
4. 修复硬编码颜色，全部采用 `theme.colors` 动态样式。

- [ ] **Step 4: 运行测试验证通过**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/review-panel.test.tsx --bail=1
npm run typecheck
```

预期：所有交互面板与审批逻辑测试通过，设计规范对齐。

- [ ] **Step 5: 提交 Review 面板重构切片**

```bash
git add plugin-custom/gitea-workflow/client/review-panel.tsx \
  plugin-custom/gitea-workflow/client/feedback-dialog.tsx \
  plugin-custom/gitea-workflow/client/screenshot-gallery.tsx \
  plugin-custom/gitea-workflow/client/audit-timeline.tsx \
  plugin-custom/gitea-workflow/tests/review-panel.test.tsx
git commit -m "refactor(gitea-workflow): modernize review panel with interactive dialogue and audit timeline" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: 插件端到端流水线集成测试与验证 (E2E Integration & Verification)

**Files:**

- Modify: `plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts`
- Modify: `packages/server/src/server/plugins/custom-plugins.e2e.test.ts`
- Modify: `plugin-custom/gitea-workflow/README.md`

**Interfaces:**

- Produces: 完整闭环的本地真实 Daemon 级端到端测试：Issue 抓取 → 授权判定 → 认领打标签 → Preset 启动 → 阶段对话回复 → 产物验证 → 模拟独立审查 → 交付审批 → PR 创建与 90 天清理。
- Consumes: 全部 Task 1~9 成果。

- [ ] **Step 1: 编写全新端到端集成测试的失败断言**

更新 `plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts`，模拟完整生命周期：

```typescript
import { describe, it, expect } from "vitest";

describe("Gitea Superpowers Workflow E2E", () => {
  it("executes closed-loop issue-to-pr pipeline with interactive gates and audit trail", async () => {
    // 1. 初始化插件与配置（启用全局并授权 proj-test）
    // 2. 模拟 Gitea Issue #42 [agent-ready]
    // 3. 轮询触发，验证 Issue 被认领（移除 agent-ready，增加 agent-in-progress 与评论）
    // 4. 验证创建了 gitea.issue-to-pr Workflow Run
    // 5. 模拟 Agent 抛出 ask_user 交互，客户端回复指导意见并续接
    // 6. 依次通过设计审批、计划审批
    // 7. 运行验证，获取截图证据
    // 8. 独立审查输出 pass
    // 9. 客户端核准 Delivery Manifest，触发 git.create_pr
    // 10. 验证 Gitea 状态更新为 agent-reviewed，审计记录完整保留
  });
});
```

- [ ] **Step 2: 运行端到端测试确认失败点**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts --bail=1
```

预期：发现未完整连通的接口或状态断言，确认测试真实生效。

- [ ] **Step 3: 完善各层胶水代码与集成接线**

1. 修复所有联调中发现的类型与状态机过渡细节。
2. 更新 `packages/server/src/server/plugins/custom-plugins.e2e.test.ts`，确保 `gitea-workflow` 在官方插件回归套件中平稳运行。
3. 完善 `plugin-custom/gitea-workflow/README.md`，提供清晰的架构说明、配置项参考与运行操作指引。

- [ ] **Step 4: 运行端到端全链路、类型检查与代码检查**

运行：

```bash
npx vitest run plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts --bail=1
npx vitest run packages/server/src/server/plugins/custom-plugins.e2e.test.ts --bail=1
npm run typecheck
npm run lint
npm run format
```

预期：所有测试全部绿灯，TypeScript 与 Lint 零警告，格式化无差异。

- [ ] **Step 5: 提交端到端与文档切片**

```bash
git add plugin-custom/gitea-workflow/tests/e2e-workflow.test.ts \
  packages/server/src/server/plugins/custom-plugins.e2e.test.ts \
  plugin-custom/gitea-workflow/README.md
git commit -m "test(gitea-workflow): complete end-to-end integration test suite and documentation" \
  -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
