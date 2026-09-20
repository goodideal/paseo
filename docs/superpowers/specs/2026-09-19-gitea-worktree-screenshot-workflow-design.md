# Design Spec: Multi-Project Gitea Automated Worktree Pipeline & Screenshot Review Workflow

## 1. Overview & Goals

This specification defines the architecture, data structures, multi-project execution lifecycle, and user interface for an automated task-to-review pipeline implemented as a Paseo local plugin (`paseo-plugin-gitea-workflow`).

### Key Evolution: Multi-Project Dynamic Resolution & Zero-Config Auth

Previous designs stored a single global `GITEA_URL`, `repoOwner`, and `repoName` in configuration. In real-world multi-repo environments, different repositories may reside on different Gitea servers (internal private instances, cloud servers, or subdomains), and each uses its own credentials and remotes (SSH or HTTPS).

**Core Philosophy:**

- **Zero Global URL Configuration**: The repository's Git remote (`origin`) is the single source of truth.
- **Dynamic Multi-Project Discovery**: Automatically discover and monitor all Git projects registered in the Paseo daemon (`paseo.projects.list()`).
- **SSH & HTTP Dual-Track Resolution**: Transparently resolve SSH SCP-like remotes (`git@host:owner/repo.git`) and SSH aliases (via `ssh -G`) to canonical HTTP/HTTPS API endpoints.
- **Native `tea` Credential Reuse (Priority 1)**: Directly read existing `tea login list -o json` profiles for base URLs and auth tokens without manual entry.
- **Probe & Environment Fallback (Priority 2)**: Fall back to zero-auth public version probes (`/api/v1/version`) and host-scoped environment variables (`GITEA_TOKEN_<HOST>`).
- **Workspace-Scoped Human Review**: While the background daemon polls and manages tasks across multiple projects, the Paseo Review Panel strictly isolates tasks to the developer's current project workspace.

---

## 2. Architecture & Subsystem Responsibilities

```text
┌─────────────────────────────────────────────────────────────┐
│                 Paseo Project Registry                      │
│             paseo.projects.list()                           │
│   ├── Project A (/path/to/web)  [git@gitea-corp:org/web]   │
│   └── Project B (/path/to/api)  [https://git.io/org/api]   │
└──────────────┬───────────────────────────────▲──────────────┘
               │ Dynamic Resolution            │ Worktree Provisioning
               ▼                               │
┌─────────────────────────────────────────────────────────────┐
│         Plugin Daemon Server (index.server.ts)              │
│                                                             │
│  ┌───────────────────────────┐   ┌────────────────────────┐ │
│  │ ProjectGiteaResolver      │   │ GiteaClientPool        │ │
│  │ - Parse Git Remote (SSH)  │──►│ - Key: (BaseURL, Token)│ │
│  │ - Query `tea login list`  │   │ - Reusable API Clients │ │
│  │ - Probe HTTP endpoints    │   └───────────┬────────────┘ │
│  └───────────────────────────┘               │              │
│                                              ▼              │
│  ┌───────────────────────────┐   ┌────────────────────────┐ │
│  │ MultiProjectPoller        │   │ Task Orchestrator      │ │
│  │ - Cron per Gitea Project  │──►│ - Git Worktree Spawn   │ │
│  │ - Claim `agent-ready`     │   │ - Coder/Reviewer Agent │ │
│  └───────────────────────────┘   │ - Headless Screenshot  │ │
│                                  └───────────┬────────────┘ │
│                                              ▼              │
│                                  ┌────────────────────────┐ │
│                                  │ TaskStore (tasks.json) │ │
│                                  │ - projectId Scoped     │ │
│                                  └───────────┬────────────┘ │
└──────────────────────────────────────────────┼──────────────┘
                                               │ RPC (Filtered)
                                               ▼
┌─────────────────────────────────────────────────────────────┐
│           Paseo App Review Panel (ReviewPanel)              │
│   - Context: Workspace (Strictly scoped to current Project) │
│   - Visual Gallery (Desktop 1280x800 & Mobile 375x667)      │
│   - Diff Summary, One-Click Approve (PR) / Reject (Feedback)│
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

1. **`ProjectGiteaResolver` (`server/resolver.ts`)**:
   - Inspects project root directories via `git remote get-url origin`.
   - Parses SSH remotes (`git@...`, `ssh://...`) and HTTPS remotes into `{ host, owner, repo }`.
   - Queries `tea login list -o json` to match `ssh_host`, `name`, or hostname, retrieving the authenticated Base URL and Token.
   - Falls back to querying HTTP endpoints (`/api/v1/version`) and host-specific environment variables.

2. **`GiteaClientPool` (`server/client-pool.ts`)**:
   - Manages and caches `GiteaClient` instances keyed by `(baseUrl, token)`.
   - Avoids duplicate API clients and handles rate-limiting / connection pooling.

3. **`MultiProjectPoller` (`server/poller.ts`)**:
   - Periodically queries Paseo daemon for active projects.
   - Resolves eligible Gitea projects and schedules parallel queue polling.
   - Claims `agent-ready` issues atomically, updating labels to `agent-in-progress`.

4. **`WorktreeOrchestrator` (`server/orchestrator.ts`)**:
   - Concurrency controller bounded by `maxConcurrentWorktrees` across projects or per-project.
   - Provisions isolated Git worktrees via Paseo `workspaces.create`.
   - Dispatches coding and review agents.
   - Starts dev service proxy and captures headless visual screenshots.

5. **`TaskStore` (`server/store.ts`)**:
   - Thread-safe persistence with file mutex promise chain and atomic rename.
   - Indexes and filters tasks by `projectId`.

6. **`ReviewPanel` (`client/review-panel.tsx`)**:
   - Workspace-scoped UI component displayed in the workspace/explorer panels.
   - Strictly renders tasks belonging to the current workspace's project.
   - High-aesthetic dark mode styling, responsive screenshot viewer, and review feedback dialog.

---

## 3. Data Schema & RPC Contracts

### 3.1 GiteaWorkflowTask Schema (`shared/types.ts`)

```typescript
export interface GiteaWorkflowTask {
  id: string; // e.g. "task-proj1-gitea-42"
  projectId: string; // Paseo project ID
  projectPath: string; // Local project root
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  issueBody: string;
  giteaBaseUrl: string;
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
    label: string;
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

### 3.2 RPC Contracts (`shared/contracts.ts`)

- `gitea.tasks.list`: Input `{ projectId?: string; workspaceId?: string }` -> Output `{ tasks: GiteaWorkflowTask[] }`
- `gitea.tasks.get`: Input `{ taskId: string }` -> Output `{ task: GiteaWorkflowTask | null }`
- `gitea.tasks.approve`: Input `{ taskId: string }` -> Output `{ ok: boolean; prUrl?: string; error?: string }`
- `gitea.tasks.reject`: Input `{ taskId: string; feedback: string }` -> Output `{ ok: boolean; error?: string }`
