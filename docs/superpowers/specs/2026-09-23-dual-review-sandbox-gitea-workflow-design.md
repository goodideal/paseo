# Design Spec: Dual-Stage Review, Sandbox Verification & Gitea Ship Pipeline

## 1. Overview & Goals

This specification defines the architecture, evidence models, state machine, and runtime mechanisms for an end-to-end autonomous coding workflow in Paseo (`paseo-plugin-gitea-workflow`).

### Key Invariants & Principles

1. **Evidence-Based Delivery**: AI agents cannot claim completion through conversational self-assertion. Every task must yield concrete proof:
   - **UI / Frontend Tasks**: Dual-viewport screenshots (Desktop 1280x800 & Mobile 375x667) captured from a running service.
   - **Pure Logic / Backend Tasks**: Structured Test Execution Matrix recording specific inputs, expected outputs, actual outputs, and process exit code (0).
2. **Two-Stage Dual-Model Review (两阶段双模型交叉审查)**:
   - **Stage 1 (Static Code Review)**: A high-reasoning model (e.g. `codex/gpt-5.4`) audits code diffs for architectural integrity, edge-case vulnerabilities, and security flaws before launching runtime environments.
   - **Stage 2 (Dynamic Sandbox Review)**: Executed strictly after sandbox provisioning and service startup, verifying live rendering or running test suites against actual execution targets.
3. **Interactive Sandbox Environment & Live Preview URL**: Worktrees act as isolated sandboxes. Services managed via Paseo Service Proxy remain alive during human review, providing interactive URLs (`http://<script>--<branch>--<project>.localhost:8080`) for manual verification.
4. **Standardized Delivery via `gitea-ship`**: Pull Request creation, conflict prevention, issue state updates, and evidence embedding are delegated directly to `/Users/jerry/.agents/skills/gitea/scripts/gitea-ship.js`.

---

## 2. State Machine & Lifecycle Flow

```text
               [queued]
                  │
                  ▼
              [coding] (Coder Agent implements requirements & self-tests)
                  │
                  ▼
          [static_reviewing] ────【Stage 1: Static Code Review (High-reasoning Model)】
                  │               - Audits Git diff, boundary checks, missing tests
                  ├── REJECT ──► Feedback re-prompted to Coder Agent (max 2 healing rounds)
                  │
                  ▼ PASS
        [sandbox_provisioning]
                  │
                  ├── Starts Dev Service Proxy (`paseoApi.scripts.start`)
                  └── Polls HTTP Readiness Probe (200 OK + HTML within 30s)
                  │
                  ▼
          [dynamic_reviewing] ───【Stage 2: Dynamic Runtime Sandbox Review】
                  │               - UI: Playwright headless capture + console error check
                  │               - Logic: Execute test runner, parse input/expected/actual matrix
                  │
                  ├── REJECT ──► Console logs / test failures piped back to Coder Agent
                  │
                  ▼ PASS
              [shipping]
                  │
                  ├── Executes `node gitea-ship.js <payload>`
                  │   (Attaches test matrix, screenshots, preview URL, and review badges)
                  │
                  ▼
        [pending_human_review] (Workbench displayed in Paseo App)
                  │  - Live Preview Link active
                  │  - Full visual/logical evidence displayed
                  │
                  ├── Human Reject ──► Feedback re-prompts Coder Agent; state returns to [coding]
                  │                    (Sandbox service recycled)
                  │
                  ▼ Human Approve
                [done] (Gitea issue closed/marked done, sandbox service stopped)
```

---

## 3. Evidence Data Schemas & Contracts

### 3.1 Logical Test Execution Matrix (`shared/types.ts`)

```typescript
export interface TestCaseResult {
  name: string;
  input: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
  durationMs?: number;
}

export interface TestMatrixEvidence {
  command: string;
  exitCode: number;
  totalPassed: number;
  totalFailed: number;
  durationMs: number;
  cases: TestCaseResult[];
}

export interface ReviewSignOff {
  staticReview: {
    passed: boolean;
    model: string;
    summary: string;
    reviewedAt: string;
  };
  dynamicReview: {
    passed: boolean;
    previewUrl?: string;
    testMatrix?: TestMatrixEvidence;
    screenshotsCount: number;
    reviewedAt: string;
  };
}
```

### 3.2 Extended `GiteaWorkflowTask` Schema

```typescript
export interface GiteaWorkflowTask {
  id: string;
  projectId: string;
  projectPath: string;
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueBody: string;
  giteaBaseUrl: string;
  giteaToken?: string;
  repoOwner: string;
  repoName: string;
  branchName: string;
  workspaceId: string | null;
  agentId: string | null;
  state:
    | "queued"
    | "worktree_creating"
    | "coding"
    | "static_reviewing"
    | "sandbox_provisioning"
    | "dynamic_reviewing"
    | "shipping"
    | "pending_human_review"
    | "done"
    | "failed";
  screenshots: ScreenshotMetadata[];
  testMatrix?: TestMatrixEvidence | null;
  reviewSignOff?: ReviewSignOff | null;
  diffSummary: DiffSummary | null;
  previewUrl?: string | null;
  prUrl?: string;
  reviewFeedback?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

### 3.3 Evidence Multi-Run & Parallel Conflict Resolution (证据冲突彻底根治设计)

When running tasks in parallel across multiple branches/worktrees or executing multiple review rounds (Run 1 -> Rejection -> Run 2), collisions and Git merge conflicts easily occur if evidence files share hardcoded paths or are committed into Git.

#### 1. 彻底杜绝 Git 分支合并冲突 (Zero Git Merge Conflict Policy)

- **非代码资产不入版本库**：`.evidence/` 目录默认作为运行时构建产物，自动加入 `.gitignore`（或置于 Paseo 工作区私有运行时目录）。
- **资产直传与 Markdown 固化**：
  - 截图文件通过 Gitea 原生 Attachment API 直接上传至该 PR/Issue，生成永久有效的 Gitea 附件链接（如 `/attachments/<uuid>`），直接写入 PR 正文。
  - 测试用例矩阵在运行时提取后，由 `gitea-ship` 直接转译并持久化为 PR Description 中的 Markdown 表格。
  - **结论**：主分支（`develop`/`main`）永远不会因合并不同 PR 而在 `.evidence/` 上发生 Git Conflict。

#### 2. 任务与运行批次命名空间隔离 (Namespaced Path Isolation)

证据产物按 `issueNumber` 与 `runId` 双层分片存储，禁止任何任务使用平铺根目录：

```text
.evidence/
└── issues/
    └── 42/
        ├── run-20260923-142010/
        │   ├── screenshots/
        │   │   ├── desktop.png
        │   │   └── mobile.png
        │   ├── test-matrix.json
        │   └── runtime-probe.json
        └── latest -> run-20260923-142010/ (软链或指向最新批次)
```

- **多任务并行隔离**：Issue #42 与 Issue #43 路径物理隔离，零竞争。
- **多轮次打回重审隔离**：第 1 轮（Run 1）被打回后，第 2 轮（Run 2）写入新的独立批次目录，旧凭据作为历史追溯保留，彻底避免文件写入竞争与覆盖污染。

#### 3. 原子落盘与运行互斥锁 (Atomic Writes & Per-Task Mutex)

- 写入 `test-matrix.json` 时采用 `fs.writeFile(path + '.tmp.' + pid) -> fs.rename()` 原子替换，杜绝并发读到半截 JSON。
- 任务调度器在执行沙箱动态验证时加持 `taskLock`，确保单任务同一时间仅存在一个运行中的测试实例。

---

## 4. Sandbox Lifecycle & Service Readiness Probing

1. **Service Startup**:
   - `paseoApi.scripts.start({ workspaceId, scriptName: "dev" })` initiates the dev server in the isolated worktree.
2. **Deterministic Readiness Probing**:
   - Instead of immediately snapshotting or rendering, an exponential backoff probe queries the Service Proxy endpoint:
     ```typescript
     async function waitForServiceReady(url: string, timeoutMs = 30000): Promise<boolean> {
       const start = Date.now();
       while (Date.now() - start < timeoutMs) {
         try {
           const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(2000) });
           if (res.ok) {
             const text = await res.text();
             if (text.includes("<html") || text.includes("<body") || text.includes("<div")) {
               return true;
             }
           }
         } catch {
           // Connection refused or proxy startup pending
         }
         await new Promise((r) => setTimeout(r, 800));
       }
       return false;
     }
     ```
3. **Keep-Alive During Human Review**:
   - While tasks sit in `pending_human_review`, the dev service process remains alive.
   - Teardown (`paseoApi.scripts.stop`) occurs only upon task state transitions to `done`, `failed`, or when `reject` triggers a new coding iteration.

---

## 5. `gitea-ship` Integration & Enhancements

### 5.1 Invocation Protocol

Rather than invoking ad-hoc Gitea HTTP endpoints directly in `orchestrator.ts`, the finalization step prepares a payload and invokes `gitea-ship.js`:

```typescript
const payload = {
  cwd: workspaceCwd,
  title: `[Agent] #${task.issueNumber} ${task.issueTitle}`,
  base: baseBranch,
  issue_number: task.issueNumber,
  close_issue: false,
  test_matrix: task.testMatrix,
  preview_url: task.previewUrl,
  review_signoff: task.reviewSignOff,
  screenshots: task.screenshots,
};
```

### 5.2 `gitea-ship.js` Enhancements

1. **Review Sign-Off Banner**: Renders model name, static pass verdict, dynamic test summary, and live sandbox preview URL in the PR header.
2. **Test Matrix Formatter**: Formats `test_matrix` into a clean Markdown table with inputs, expected, actual, and status badges.
3. **Conflict-Free Synchronization**: Leverages existing `gitea-ship.js` logic to merge base branches before push and seamlessly update existing PRs on subsequent revisions.

---

## 6. Paseo Review Workbench (UI Components)

### 6.1 Real-Time Preview Button

- Adds a prominent `[🌐 Open Preview App]` action button in `ReviewPanel` next to branch/PR badges.
- Displays connection indicator (🟢 `Active on port ...`).

### 6.2 Dual Review Badges

- **Static Review**: `🟢 Static Review (gpt-5.4 · Architecture & Security OK)`.
- **Dynamic Review**: `🟢 Sandbox Runtime Verified (3/3 Tests Passed / 2 Viewports Captured)`.

### 6.3 Test Matrix View (`TestMatrixTable.tsx`)

- Displayed when `testMatrix` exists.
- Renders columns: `#`, `Test Case`, `Input`, `Expected`, `Actual`, `Status`.

### 6.4 Re-prompting Rejection Loop

- `orchestrator.rejectTask(taskId, feedback)` locates the existing `agentId` and sends the feedback via `send_agent_prompt`, preserving context without creating orphaned agents.

---

## 7. Testing & Verification

1. **Unit Tests**:
   - `test-matrix.test.ts`: Verify test output parser extracts inputs, outputs, and status from JSON/TAP reporters.
   - `readiness-probe.test.ts`: Mock HTTP server with delayed 200 response to verify probe retry behavior.
2. **Integration Tests**:
   - `orchestrator-dual-review.test.ts`: Test task state flow through `coding` -> `static_reviewing` -> `sandbox_provisioning` -> `dynamic_reviewing` -> `shipping` -> `pending_human_review`.
   - `gitea-ship-evidence.test.ts`: Verify PR markdown generation with dual review sign-offs and test matrix tables.
