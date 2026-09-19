# Design Spec: Gitea Automated Worktree Task Pipeline & Screenshot Review Workflow

## 1. Overview & Goals

This specification defines the architecture, data structures, execution lifecycle, and user interface for an automated task-to-review pipeline implemented as a Paseo local plugin (`paseo-plugin-gitea-workflow`).

### Primary Objectives

1. **Automated Task Ingestion**: Periodically poll a designated Gitea repository for issues labeled `agent-ready`, claim them atomically, and assign them to isolated execution environments.
2. **Worktree Isolation**: Concurrently run independent Git worktree workspaces for each claimed task, preventing branch and workspace pollution.
3. **Automated Coding & Self-Review**: Dispatch coding agents to fulfill issue requirements, execute project test suites and typechecks, and perform self-review passes.
4. **Dev Server & Headless Browser Screenshots**: Start the project's dev server, resolve its Paseo Service Proxy URL, navigate to the target web interface, and capture high-resolution visual proof screenshots.
5. **Native Review & Approval in Paseo App**: Present a dedicated review panel inside the Paseo client showing the Gitea issue context, Git diff stats, and rendering screenshots.
6. **PR Creation & Lifecycle Closure**: On human approval, automatically push the branch to the remote Gitea repository, open a Pull Request containing the visual proof, and update issue tracking labels. On human rejection, forward feedback directly to the agent for iterative refinement.

---

## 2. Architecture & Subsystem Responsibilities

The system is implemented as a Paseo plugin adhering to `@getpaseo/plugin` contracts (`index.server.ts` running in the daemon background and `index.client.tsx` running in Paseo frontend surfaces).

```text
┌─────────────────────────────────────────────────────────────┐
│                       Gitea Server                          │
│   (Issues labeled "agent-ready", API, Pull Requests)        │
└──────────────┬───────────────────────────────▲──────────────┘
               │ 1. Polling Issues             │ 6. Push & Create PR
               ▼                               │
┌─────────────────────────────────────────────────────────────┐
│         Plugin Daemon Server (index.server.ts)              │
│                                                             │
│  ┌─────────────────┐       ┌──────────────────────────────┐ │
│  │ Gitea Poller    │ ───►  │ Task Orchestrator            │ │
│  │ (Cron / Interval│       │ - Creates Git Worktree       │ │
│  │  Scheduler)     │       │ - Dispatches Coder Agent     │ │
│  └─────────────────┘       │ - Dispatches Reviewer Agent  │ │
│                            └──────────────┬───────────────┘ │
│                                           │                 │
│                                           ▼                 │
│  ┌─────────────────┐       ┌──────────────────────────────┐ │
│  │ Artifact Store  │ ◄───  │ Browser Automation Runner    │ │
│  │ (.paseo/tasks/) │       │ - Starts Dev Service Proxy   │ │
│  └────────┬────────┘       │ - Headless Screenshot (CDP)  │ │
│           │                └──────────────────────────────┘ │
└───────────┼─────────────────────────────────────────────────┘
            │ 5. RPC Sync (Tasks, Screenshots, Status)
            ▼
┌─────────────────────────────────────────────────────────────┐
│           Plugin App Client (index.client.tsx)              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Review Workbench (WorkspacePanel / Sidebar Surface)   │  │
│  │ - Issue details & status tags                         │  │
│  │ - Web visual screenshots (Desktop / Mobile viewports) │  │
│  │ - Git diff statistics & agent self-check summary      │  │
│  │ - Action buttons: [Approve & Create PR] / [Reject]    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

- **Gitea Poller (`server/poller.ts`)**: Scans Gitea repository issues at configured intervals (default: 60s), manages label transitions (`agent-ready` -> `agent-in-progress`), and adds initial claim comments.
- **Task Orchestrator (`server/orchestrator.ts`)**: Manages the task state machine and concurrency limits (default: 3 active worktrees). Coordinates worktree workspace creation via `paseo.workspaces.create`, agent generation, and lifecycle hooks.
- **Browser Automation Pipeline (`server/screenshot-pipeline.ts`)**: Orchestrates the dev server lifecycle through Paseo Service Proxy (`paseo.scripts.start`), resolves `http://<script>--<branch>--<project>.localhost`, and captures viewport/full-page screenshots using Paseo browser automation tools.
- **Task Store (`server/store.ts`)**: Persists task state, metadata, and artifact references to `.paseo/plugins/gitea-workflow/tasks.json`.
- **Review Panel (`client/review-panel.tsx`)**: Renders task review state, multi-viewport screenshots, and provides one-click approval and rejection dialogs.

---

## 3. Task State Machine & Data Model

### 3.1 State Transitions

```text
[QUEUED]
   │
   ▼
[WORKTREE_CREATING]
   │
   ▼
[CODING]
   │
   ▼
[SELF_REVIEW] ──(Self-check fail; max 2 retries)──► [CODING]
   │
   ▼
[SCREENSHOTTING]
   │
   ▼
[PENDING_HUMAN_REVIEW] ◄──┐
   │                      │
   ├── [Reject] ──────────┘ (Agent loops to fix)
   │
   └── [Approve] ──► [PR_CREATING] ──► [DONE]
```

- **`QUEUED`**: Issue detected with `agent-ready`; placed in the internal queue waiting for a concurrency slot.
- **`WORKTREE_CREATING`**: Worktree branch created (`agent/issue-<number>-<slug>`) and workspace provisioned.
- **`CODING`**: Primary coding agent active, writing code, running tests.
- **`SELF_REVIEW`**: Secondary review pass verifying diff, test coverage, and linting.
- **`SCREENSHOTTING`**: Dev server active; headless browser capturing visual screenshots.
- **`PENDING_HUMAN_REVIEW`**: Waiting for human decision in the Paseo review panel.
- **`PR_CREATING`**: Human approved; pushing Git branch to origin and creating Gitea PR.
- **`DONE`**: PR created, labels updated (`agent-reviewed`), worktree ready for archive.
- **`FAILED`**: Unrecoverable error (e.g., git branch conflict, repeated test failures).

### 3.2 Data Schema

```typescript
export interface GiteaWorkflowTask {
  id: string; // e.g. "task-gitea-42"
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueBody: string;
  repoOwner: string;
  repoName: string;
  branchName: string;
  workspaceId: string | null;
  agentId: string | null;
  state:
    | "queued"
    | "worktree_creating"
    | "coding"
    | "self_review"
    | "screenshotting"
    | "pending_human_review"
    | "pr_creating"
    | "done"
    | "failed";
  screenshots: Array<{
    id: string;
    label: string; // e.g., "Desktop (1280x800)", "Mobile (375x667)"
    viewport: { width: number; height: number };
    relativePath: string;
    capturedAt: string;
  }>;
  diffSummary: {
    additions: number;
    deletions: number;
    filesChanged: number;
  } | null;
  prUrl?: string;
  prNumber?: number;
  reviewFeedback?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. Gitea Integration & Issue Polling

### 4.1 Configuration Settings (`plugin-settings.json`)

- `giteaUrl`: String (e.g. `https://gitea.internal`)
- `giteaToken`: String (Gitea Personal Access Token)
- `repoOwner`: String
- `repoName`: String
- `listenLabel`: String (default: `agent-ready`)
- `inProgressLabel`: String (default: `agent-in-progress`)
- `reviewedLabel`: String (default: `agent-reviewed`)
- `pollIntervalSeconds`: Number (default: `60`)
- `maxConcurrentWorktrees`: Number (default: `3`)

### 4.2 Claim Protocol

1. **Poll**: `GET /api/v1/repos/{owner}/{repo}/issues?state=open&labels={listenLabel}`.
2. **Claim**: For each unprocessed issue:
   - Call `DELETE /api/v1/repos/{owner}/{repo}/issues/{index}/labels/{listenLabel}`.
   - Call `POST /api/v1/repos/{owner}/{repo}/issues/{index}/labels` with `{ labels: [inProgressLabel] }`.
   - Post comment: `POST /api/v1/repos/{owner}/{repo}/issues/{index}/comments` stating that Paseo Agent has claimed the issue and initialized a dedicated worktree workspace.

---

## 5. Worktree Provisioning & Agent Execution

### 5.1 Worktree Setup

- Branch Name: `agent/issue-${issue.number}-${slugify(issue.title)}`.
- Workspace Creation:
  ```typescript
  const workspace = await paseo.workspaces.create({
    isolation: "worktree",
    path: projectRootPath,
    branchName,
    baseBranch: "main",
    title: `#${issue.number} ${issue.title}`,
  });
  ```

### 5.2 Agent Execution Protocol

1. **Coder Phase**:
   - Spawn agent inside `workspace.id` with provider configured (e.g. `codex` / `claude-code`).
   - Prompt injected includes issue description, acceptance criteria, and instruction to verify code via project build/test scripts before completion.
2. **Self-Review Phase**:
   - Inspect git status and run `git diff HEAD~1` (or against base branch).
   - Verify tests succeed (`npm test`, `npm run typecheck`, etc.).
   - If tests fail, send corrective turn to Coder Agent (up to 2 attempts).

---

## 6. Dev Server & Browser Screenshot Pipeline

### 6.1 Dev Server Lifecycle

- Query workspace scripts (`paseo.scripts.list({ workspaceId })`).
- If a service script exists (e.g. `"dev"` with `"type": "service"`), start it via `paseo.scripts.start({ workspaceId, scriptName: "dev" })`.
- Resolve Paseo Service Proxy URL:
  `http://<script>--<branch>--<project>.localhost`
- Wait for HTTP readiness (poll `GET /` until HTTP 200/304 or timeout after 30s).

### 6.2 Browser Automation & Capture

1. Launch tab: `browser_new_tab({ url: serviceProxyUrl })`.
2. Wait for stabilization: `browser_wait({ url: serviceProxyUrl, timeoutMs: 5000 })`.
3. Capture Multi-Viewport Screenshots:
   - **Desktop**: Resize viewport to 1280x800 -> `browser_screenshot` -> save to `.paseo/tasks/{taskId}/desktop.png`.
   - **Mobile**: Resize viewport to 375x667 -> `browser_screenshot` -> save to `.paseo/tasks/{taskId}/mobile.png`.
4. Close browser tab: `browser_close_tab`.
5. Gracefully terminate dev server if configured to conserve resources.

---

## 7. Paseo Native Review UI & Client RPCs

### 7.1 Client Review Panel (`WorkspacePanel`)

- Location: Registered via `client.addWorkspacePanel({ id: "gitea-review", title: "Gitea Task Review", ... })`.
- Components:
  - **Issue Metadata Bar**: Issue number, title, author, Gitea link.
  - **Visual Proof Gallery**: Side-by-side or tabbed Desktop/Mobile screenshot viewer with click-to-zoom modal.
  - **Diff & Changeset Card**: Additions/deletions badge, modified files list.
  - **Action Controls**:
    - `[Approve & Create PR]`: Triggers PR submission modal/flow.
    - `[Reject with Feedback]`: Displays text area for review comments to redirect the agent.

### 7.2 RPC Contracts (`shared/contracts.ts`)

- `giteaWorkflow.getTasks`: List all tracked tasks.
- `giteaWorkflow.getTaskDetail`: Get single task detail with base64/URL screenshot references.
- `giteaWorkflow.approveTask`: Approve task -> trigger Git push and PR creation.
- `giteaWorkflow.rejectTask`: Reject task -> provide feedback string to Agent.

---

## 8. PR Creation & Lifecycle Closure

### 8.1 Approval Handling

1. **Push Branch**: `git push origin agent/issue-{number}-{slug}`.
2. **Upload Screenshots**: Upload captured PNGs via Gitea attachment API (`POST /api/v1/repos/{owner}/{repo}/issues/{index}/assets`).
3. **Open Pull Request**:
   - Endpoint: `POST /api/v1/repos/{owner}/{repo}/pulls`
   - Title: `[Agent] #${issue.number} ${issue.title}`
   - Body:

     ```markdown
     Resolves #${issue.number}

     ### Summary of Changes

     ${summaryGeneratedByReviewer}

     ### Visual Verification

     ![Desktop Viewport](attachment_url_desktop)
     ![Mobile Viewport](attachment_url_mobile)

     ### Automated Verification

     - [x] Unit tests passed
     - [x] Typecheck passed
     - [x] Human reviewed in Paseo
     ```

4. **Update Labels**: Remove `agent-in-progress`, add `agent-reviewed`.
5. **Mark Task Complete**: Status becomes `done`.

### 8.2 Rejection Handling

1. Human enters feedback (e.g. _"Button padding is too tight on mobile; also validate email field"_).
2. Plugin Server dispatches feedback prompt to the running agent in the worktree workspace.
3. Task status returns to `coding`.
4. Agent performs edits, reruns tests, regenerates screenshots, and resubmits to `pending_human_review`.

---

## 9. Error Handling & Edge Cases

1. **Gitea Network/Auth Failures**:
   - Poller employs exponential backoff on network errors without crashing the daemon.
   - Auth errors surface directly in the plugin settings screen.
2. **Dev Server Boot Failure / Hang**:
   - 30s timeout on service proxy probe.
   - If server fails to boot, visual screenshot step is skipped with a warning, allowing diff-only review.
3. **Port & Worktree Collisions**:
   - Branches use deterministic naming containing issue numbers.
   - Paseo Service Proxy ensures unique subdomains per branch/worktree, preventing port clashes.
4. **Agent Loop Safeguard**:
   - Maximum 3 human feedback retry loops per task.
   - Rejection counter prevents runaway agent execution.

---

## 10. Testing & Verification Plan

1. **Unit Testing**:
   - State machine transition tests.
   - Gitea API client parser and payload validation.
   - Service proxy URL generator test.
2. **Integration Testing**:
   - Mock Gitea HTTP server verifying poll, claim, label mutation, and PR creation.
   - In-memory workspace mock verifying worktree creation and lifecycle callbacks.
3. **End-to-End Verification**:
   - Trigger a real test issue on Gitea with `agent-ready`.
   - Verify worktree checkout, agent prompt execution, dev server startup, and screenshot generation.
   - Validate UI rendering of the screenshot inside Paseo App.
   - Approve task and verify remote PR creation on Gitea.
