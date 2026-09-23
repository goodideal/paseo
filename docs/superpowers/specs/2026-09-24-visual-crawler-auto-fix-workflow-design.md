# Architecture & Technical Design: Visual Crawler & Multi-Worktree Autonomous Fix System

## 1. Executive Summary & Core Philosophy

This document specifies an end-to-end autonomous QA and code remediation system designed for Paseo (`visual-crawler-auto-fix`). The system addresses a fundamental limitation in traditional automated testing: visual and runtime defects often emerge only across long, exploratory user journeys (50~100 hops) that rigid E2E scripts miss.

### Core Tenets:

1. **Decoupled Exploration & Inference (Token Efficiency)**: 100 hops of screenshots will quickly blow any LLM context window. The crawling state machine runs headlessly with lightweight DOM heuristics; multimodal VLM and LLM reasoning are invoked strictly on-demand when runtime errors occur or visual anomaly heuristics trigger.
2. **Deterministic Triaging before Dispatch**: Never send raw, duplicate crawling errors directly to coding agents. A central **Review & Triage Agent** clusters symptoms (e.g., 20 pages breaking due to the same navbar component), dedupes issues, assigns severity (P0-P3), and synthesizes precise, self-contained **Fix Directives**.
3. **Strict Worktree Isolation with Managed Concurrency**: Code fixes must never collide in a single working directory. The system provisions isolated Git Worktrees with bounded concurrency (default: 3 workers), orchestrates coding agents, validates fixes via local builds/tests, and publishes standard Pull Requests.
4. **CTO-Grade UI/UX & Observability**: Developers must not look at a black box. The Paseo plugin client provides a high-aesthetic, responsive dashboard displaying real-time crawl telemetry, interactive issue triage cards, and live worker lane status.

---

## 2. System Topology & Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Target Web Application                          │
│        (Local Dev Server / Staging with Source Map / React Dev)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Browser Automation (Paseo Host)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Subsystem 1: Visual Explorer Engine                      │
│  ┌─────────────────────────┐       ┌────────────────────────────────┐  │
│  │ Traversal State Machine │──────►│ Dual-Modal Anomaly Detector    │  │
│  │ - BFS/DFS Router        │       │ - Runtime: console.error, 5xx  │  │
│  │ - 50~100 Hop Controller │       │ - Visual: layout overlap/shift │  │
│  │ - Loop & Deadlock Guard │       │ - Source Mapping (data-source) │  │
│  └─────────────────────────┘       └───────────────┬────────────────┘  │
└────────────────────────────────────────────────────┼───────────────────┘
                                                     │ Issues Checklist (.evidence/inspection.json)
                                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Subsystem 2: Review & Triage Agent                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Issue Deduplication & Root-Cause Clustering Engine               │  │
│  │ - Fingerprint hashing (Error stack + DOM selector + Component)   │  │
│  │ - Severity Scoring (P0 Critical, P1 High, P2 Medium, P3 Cosmetic)│  │
│  │ - Fix Directive Synthesizer (Reproduction steps, Target files)   │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │ Approved Directives
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│         Subsystem 3: Multi-Worktree Fix Orchestrator                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Worker Pool & Concurrency Throttle (Max Concurrent = 3)         │  │
│  ├─────────────────────────┬───────────────────────┬────────────────┤  │
│  │ Worker Lane 1           │ Worker Lane 2         │ Worker Lane 3  │  │
│  │ ├─ Git Worktree (wt-1)  │ ├─ Git Worktree (wt-2)│ ├─ Worktree... │  │
│  │ ├─ Coding Agent         │ ├─ Coding Agent       │ ├─ ...         │  │
│  │ ├─ Build & Verify       │ ├─ Build & Verify     │                │  │
│  │ └─ Push & Open PR       │ └─ Push & Open PR     │                │  │
│  └─────────────────────────┴───────────────────────┴────────────────┘  │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      │ State RPCs
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│            Subsystem 4: Paseo Dashboard UI (Client Panel)              │
│  - Live Inspection Telemetry (Hops counter, active URL, anomaly pulse) │
│  - Interactive Issue Triage Board (Screenshots, Stacktrace, Approve)   │
│  - Active Worker Matrix (Concurrency gauge, live diff, PR status)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Subsystem Specifications

### 3.1 Subsystem 1: Visual Explorer Engine

#### Responsibilities:

- Manage the headless browser session using Paseo's Browser Automation RPCs (`browser_navigate`, `browser_click`, `browser_snapshot`, `browser_logs`, `browser_screenshot`).
- Execute 50~100 hops without getting trapped in infinite loops or modal traps.
- Continuously collect runtime telemetry and trigger visual inspection.

#### Navigation Strategy:

1. **Seed Routes + DOM Expansion (Hybrid BFS/DFS)**:
   - Initial queue seeded from sitemap/routes (e.g. `/`, `/dashboard`, `/settings`, `/projects`).
   - On each page:
     - Identify clickable interactive candidates: `a[href]`, `button`, `[role="tab"]`, `[role="menuitem"]`.
     - Prioritize unvisited route transitions, then in-page state changes (Tabs, Dialogs, Dropdowns).
2. **Loop & Trap Prevention**:
   - **DOM Fingerprinting**: Hash normalized DOM structure (`tag + id + classNames`) to detect identical pages.
   - **Action History Table**: Disallow executing the exact same selector on identical DOM fingerprints.
   - **Hop Budget**: Maximum 5 actions per URL before forcing navigation to the next route in the BFS queue.
   - **Esc/Backtrack Recovery**: If a modal overlay blocks the viewport for >2 hops, dispatch `Escape` keypress or navigate back.
3. **Dual-Modal Anomaly Detection**:
   - **Runtime Errors (Deterministic, Zero-False-Positive)**:
     - Listen to `console.error`, unhandled Promise rejections, and window errors.
     - Intercept HTTP responses with status `>= 400`.
   - **Visual Defects (Heuristic + VLM Gated)**:
     - Fast Client-side Heuristics: Element bounding boxes overlapping (`isIntersecting` between sibling text/container nodes), horizontal text clipping (`scrollWidth > clientWidth` with `overflow: hidden`), viewport overflow (`rect.right > window.innerWidth`).
     - When a heuristic anomaly or runtime error fires, capture high-res viewport screenshot + bounding box.
   - **UI-to-Source Mapping**:
     - Inspect DOM node dataset attributes (`data-source-file`, `data-component`, `data-react-source`) or evaluate React fiber internals (`__reactFiber$...`) to pinpoint the exact local file (e.g. `src/components/Header.tsx:42`).

---

### 3.2 Subsystem 2: Review & Triage Agent

#### Responsibilities:

- Filter noise, cluster recurring symptoms, and prioritize issues before burning developer or coding agent time.
- Transform raw browser telemetry into formal, executable **Fix Directives**.

#### Triage Pipeline:

1. **Deduplication & Clustering**:
   - Compute `ClusterKey = hash(errorName + normalizedStackTop + (sourceFile || domSelector))`.
   - Aggregate occurrences: If an error appeared on 15 different hops, record 1 Issue with 15 occurrence traces.
2. **Severity Classification Matrix**:
   - **P0 (Critical)**: Uncaught Exception breaking page rendering (White screen / crash), 500 API on core flows.
   - **P1 (High)**: Broken interactive widget (button click throws error, 404 on critical asset, modal trap).
   - **P2 (Medium)**: Visual layout overlap, noticeable text truncation, non-fatal console warnings.
   - **P3 (Low)**: Minor styling inconsistency, harmless CSS rule warnings.
3. **Fix Directive Schema**:
   ```typescript
   interface FixDirective {
     id: string;
     title: string;
     severity: "P0" | "P1" | "P2" | "P3";
     category: "runtime_error" | "visual_defect" | "network_failure";
     affectedPages: string[];
     sourceHint?: {
       filePath: string;
       componentName?: string;
       line?: number;
     };
     errorDetails: {
       message: string;
       stack?: string;
       httpStatus?: number;
     };
     evidence: {
       screenshotPath?: string;
       domSnippet?: string;
     };
     suggestedFix: string;
     status: "pending_review" | "approved" | "in_progress" | "resolved" | "rejected";
   }
   ```
4. **Autonomous vs. Supervised Mode**:
   - Supports auto-approving P0/P1 issues or presenting them to the developer in the Paseo UI for one-click approval.

---

### 3.3 Subsystem 3: Multi-Worktree Fix Orchestrator

#### Responsibilities:

- Maintain an active worker pool with strict concurrency enforcement (default `concurrency = 3`).
- Prevent git conflicts and contaminated test runs via completely isolated Git Worktrees.
- Supervise coding agents, run validation gates, and push clean PRs.

#### Execution Lifecycle per Fix Task:

1. **Provisioning**:
   - Acquire worker slot from concurrency semaphore (queue if 3 workers active).
   - Create branch: `fix/visual-crawler-${directive.id}`.
   - Spawn isolated worktree: `.paseo/worktrees/<workspace-id>/fix-${directive.id}` branched from `develop` (or `main`).
2. **Agent Dispatch**:
   - Spawn Coding Agent with targeted prompt containing:
     - Exact error stack & reproduction sequence.
     - Target source file and component hint.
     - Screenshot evidence path.
     - Acceptance criteria (must compile, pass linter, pass scoped unit tests).
3. **Verification Gate**:
   - Execute scoped verification command inside worktree (e.g. `npm run typecheck`, `npm run lint`, relevant unit tests).
   - If build/lint fails, feed error back to Agent (up to 2 retry attempts).
4. **Delivery & PR Creation**:
   - Commit changes with conventional commit message (e.g., `fix(ui): resolve text overflow in Header navigation (#crawl-102)`).
   - Push branch to origin.
   - Open Pull Request via forge API (`gitea` or `github`) with embedded reproduction evidence and fix summary.
   - Release worker slot to unblock next queued task.
   - Clean up worktree upon PR approval/merge.

---

### 3.4 Subsystem 4: Paseo Client UI (Dashboard & Interaction)

#### Aesthetic & Interaction Principles:

- **Design Alignment**: Built with Paseo design tokens, Dark/Light mode fidelity, strict typography hierarchy.
- **Three-Pane / Adaptive Architecture**:
  1. **Top Status Bar**: Total hops progress bar (e.g. `78/100 hops`), Crawl State badge (`Idle` | `Scanning` | `Analyzing` | `Fixing`), Active Workers indicator (`2/3 Busy`), Issues Discovered badge.
  2. **Main Split View**:
     - **Left: Issue Triage Matrix**: Filterable by Severity (P0-P3) and Status. Cards display error badge, component target, thumbnail preview, and "Dispatch Fix" button.
     - **Right: Detail & Visual Inspector**: Side-by-side inspection showing full-size screenshot with highlighted defect box, stack trace drawer, network failure log, and Agent prompt preview.
  3. **Bottom Drawer / Worker Lanes**: 3 live cards showing Worker 1, Worker 2, Worker 3 with real-time state (`Git Worktree Provisioned` -> `Coding` -> `Testing` -> `PR #42 Created`).

---

## 4. Shared RPC Contracts & Storage Schema

### RPC Specifications (`shared/contracts.ts`):

- `visualCrawler.startCrawl.request`: `{ targetUrl: string, maxHops: number, seedRoutes?: string[], maxConcurrency: number, autoApproveP0: boolean }`
- `visualCrawler.stopCrawl.request`: `{}`
- `visualCrawler.getCrawlStatus.request`: `{}` -> `{ state: CrawlState, currentHop: number, maxHops: number, activeUrl: string, issuesCount: Record<Severity, number> }`
- `visualCrawler.listDirectives.request`: `{ filterSeverity?: string, filterStatus?: string }` -> `{ directives: FixDirective[] }`
- `visualCrawler.approveDirective.request`: `{ directiveId: string }`
- `visualCrawler.rejectDirective.request`: `{ directiveId: string, reason?: string }`
- `visualCrawler.getWorkerPoolStatus.request`: `{}` -> `{ maxConcurrency: number, activeWorkers: WorkerStatus[] }`

---

## 5. Risk Analysis & Mitigations

| Risk                                         | Impact | Mitigation Strategy                                                                                                                     |
| :------------------------------------------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **Token Exhaustion during 100 hops**         | High   | Zero LLM calls during regular navigation; state machine runs pure deterministic rules; VLM/LLM invoked only upon defect detection.      |
| **Infinite Navigation Loops / SPAs**         | High   | Path canonicalization, normalized DOM structure hashing, hard limit of 5 interactions per route.                                        |
| **Flaky Visual Detection (False Positives)** | Medium | Two-tier gating: Client-side DOM bounds overlap check -> Lightweight VLM confidence check. Runtime console/HTTP errors require no VLM.  |
| **Git Conflicts between Fix Workers**        | High   | Strict Worktree isolation: Each worker works in a separate directory on a dedicated feature branch. Base branch is always pulled fresh. |
| **Agent Stalling or Endless Fix Loop**       | Medium | Hard cap of 2 retry attempts for build errors; 10-minute timeout per worker lane.                                                       |

---

## 6. Architectural Amendments (CTO Review & Hardening)

Following architectural audit, the following four hardening invariants are incorporated:

### 6.1 State Invariant & Memory Ceiling (Long-Hop Stability)

- **Tab Memory Cycling**: To guarantee zero memory leak over 100 hops, the crawler restarts the underlying browser page context every 25 hops while preserving `localStorage`, `sessionStorage`, and session cookies.
- **Session Auto-Replay**: If a hop triggers a redirect to `/login` or 401 Unauthorized, the crawler pauses the hop counter, executes `reAuthenticateHook()`, and restores the previous route before resuming.
- **Deadlock Escaper**: If DOM fingerprint remains identical across 3 consecutive action attempts, execute `[Escape -> Back -> Dequeue Next Seed]` to escape modal traps.

### 6.2 Multi-Dimensional Clustering & Anti-Duplication

- **Two-Tier Cluster Key**:
  `ClusterKey = (SourceComponentPath || NormalizedDOMSelector) + "::" + NormalizedErrorMessage`
  - Strips transient tokens, line numbers, and bundle hashes.
  - Aggregates recurring errors across all 50~100 pages into 1 consolidated `FixDirective` with `occurrenceCount` and `affectedPages`.

### 6.3 Concurrency & Resource Safety in Parallel Worktrees

- **Dynamic Port Offsets**: For workers verifying fixes via local dev servers, ports are offset by slot: `PORT = 3000 + slotIndex` (e.g. 3001, 3002, 3003).
- **Cache Isolation**: Ensure `.cache` or `.turbo` directories are scoped to the individual worktree to avoid file lock collisions during parallel builds.
- **Deterministic Branching**: Branches follow `fix/crawler-${directiveId}-${Date.now().toString(36)}` to prevent branch name collisions.

### 6.4 Developer Experience & UI Polish

- **Status Dashboard**: Real-time visual progress ring, live URL breadcrumb trail, and active defect counters.
- **Worker Slot Rails**: 3 distinct visual lanes visualizing worker state:
  `[Slot 1: Active (fix/crawl-p0-1) | 70% Tests] [Slot 2: Idle] [Slot 3: Active (fix/crawl-p1-4) | PR Created]`
- **Single-Click & Batch Approval**: Developers can approve individual directives or batch-approve all P0/P1 fixes into the concurrency queue.
