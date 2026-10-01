# Architecture & Technical Design: Visual Crawler, Scheduled Testing & Issue Task List System

## 1. Executive Summary & Core Philosophy

This specification refactors and redesigns the `visual-crawler-auto-fix` plugin for Paseo. The original implementation suffered from critical foundational flaws:

1. **Mocked Browser Engine**: The backend driver was a pure mock (`step++`), generating fake errors and non-existent screenshot paths without touching a real browser.
2. **Hardcoded UI & Target URL**: The client panel hardcoded `http://localhost:3000` with no configuration inputs for target URL, allowed origins, or crawl limits.
3. **Zero Scheduling Support**: There was no mechanism to run tests unattended at night or within specified time windows.
4. **Premature Auto-Fix Coupling**: Heavy Git worktree pooling and coding agent dispatch were prioritized over a functioning browser crawler and reliable defect detection.

### Core Redesign Principles:

- **Real Headless Browser Execution**: Use real Playwright Chromium (`channel: "chrome"` or bundled headless shell) in headless mode inside the plugin server process, completely independent of whether a desktop GUI tab is open.
- **Scheduled & Time-Window Gated Runs**: Support cron scheduling (e.g. nightly at 02:00) and time-window enforcement (e.g. `23:00 - 06:00`), ensuring the crawler runs unattended and halts cleanly outside its designated window.
- **Configurable Crawl Limits**: Support customizable max hops (e.g. 50, 100), tree depth limits, and crawl rounds, with strict domain allowlisting and anti-loop safeguards.
- **Strict Decoupling of Detection and Remediation**: Phase 1 focuses exclusively on exploratory testing, multi-modal defect detection, deduplication, and compiling a structured, actionable **Task List** (Issue Backlog) with real screenshots and reproduction traces. Auto-fix is decoupled into an optional future step.
- **Persistent Workspace Artifacts**: Save all inspection data and screenshots directly into the workspace's `.evidence/visual-crawler/` directory, and automatically generate Markdown and JSON inspection reports for overnight reviews.

---

## 2. System Architecture & Topology

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Schedule & Trigger Subsystem                    │
│  - Cron Trigger: Nightly runs (e.g. 02:00 AM)                           │
│  - Time-Window Guard: Permitted execution window (e.g. 23:00 - 06:00)   │
│  - Manual Trigger: Immediate on-demand crawl ("Run Now")               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Start / Abort Signal
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Headless Visual Explorer Engine (Playwright)             │
│  ┌─────────────────────────┐       ┌────────────────────────────────┐  │
│  │ Traversal State Machine │──────►│ Multi-Modal Anomaly Sniffer    │  │
│  │ - BFS/DFS Page Router   │       │ - Console Error & Unhandled    │  │
│  │ - Hops & Depth Throttle │       │ - HTTP 4xx/5xx & Timeout       │  │
│  │ - Loop & Trap Breaker   │       │ - Visual: Overlap, Blank/Crash │  │
│  │ - Action Breadcrumbs    │       │ - Real High-Res Screenshot PNG │  │
│  └─────────────────────────┘       └───────────────┬────────────────┘  │
└────────────────────────────────────────────────────┼───────────────────┘
                                                     │ Raw Telemetry & Anomalies
                                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Issue Deduplication & Task List Compiler                 │
│  - Fingerprint Hashing: error signature + selector + route pattern     │
│  - Occurrence Aggregation: cluster recurring faults across hops        │
│  - Severity Scoring: P0 (Critical/Crash), P1 (High), P2 (Medium)       │
│  - Action Trace Synthesis: sequential reproduction steps               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 Persistence & Observability Layer                      │
│  - Storage: <workspace>/.evidence/visual-crawler/tasks.json            │
│  - Real Screenshots: <workspace>/.evidence/visual-crawler/screenshots/ │
│  - Overnight Report: <workspace>/.evidence/visual-crawler/reports/*.md │
│  - Paseo UI Panel: Interactive Task List with filters, triage & logs   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1 Real Playwright Browser Driver (`PlaywrightBrowserDriver`)

#### Responsibilities:

- Launch and supervise headless Chromium (`playwright.chromium.launch({ headless: true, channel: 'chrome' })`).
- Support optional authentication headers (Cookie, Bearer Token) and viewport configurations.
- Intercept and record:
  - `console.error` and unhandled exceptions via `page.on("pageerror", ...)`.
  - Network responses with HTTP status >= 400 via `page.on("response", ...)`.
- Detect visual defects via in-page DOM evaluation (`page.evaluate`):
  - Blank page detection (`document.body.children.length === 0` or all children zero height).
  - Element overlap between sibling layout blocks.
  - Horizontal text clipping or container overflow.
- Capture real PNG screenshots saved to `.evidence/visual-crawler/screenshots/`.
- Discover interactive candidates: `a[href]`, `button`, `input[type="submit"]`, `[role="button"]`, `[role="tab"]`.
- Clean lifecycle management: guarantees browser close on completion, error, or cancellation.

### 3.2 Crawl Traversal & State Machine (`VisualCrawlerEngine`)

#### Configuration Parameters:

- `targetUrl`: Base entrypoint URL (e.g. `http://localhost:3000` or staging site).
- `allowedOrigins`: Strict domain allowlist to prevent the crawler from escaping external links (e.g. OAuth providers, third-party CDNs).
- `maxHops`: Maximum total interaction/page transition steps (e.g. 50, 100). Default: 50.
- `maxDepth`: Maximum link tree depth from entrypoint. Default: 10.
- `seedRoutes`: Initial route paths to visit (e.g. `["/", "/dashboard", "/settings"]`).
- `actionBreadcrumbs`: Array of user actions leading up to the current hop, enabling precise reproduction steps.

#### Anti-Loop & Trap Protection:

1. **DOM Fingerprinting**: Hash normalized DOM structures (`tag + id + classNames`) to detect identical pages.
2. **Action Budget per Route**: Maximum 5 interactive clicks per unique URL before navigating to the next queued route.
3. **Modal & Dialog Escaping**: When an overlay modal is detected for >2 hops, attempt `Escape` keypress or modal close button before backtracking.
4. **Time-Window Enforcer**: Periodically check whether the current time is within the allowed window; if the window expires, trigger a graceful finish.

### 3.3 Scheduler & Time Window Controller (`CrawlerScheduler`)

#### Modes of Operation:

1. **Manual Run Now**: Immediate execution on demand from the Paseo client panel.
2. **Cron Schedule**: Configure execution at specific times (e.g., `0 2 * * *` for 2:00 AM nightly).
3. **Execution Window**: Configurable allowed time range `[windowStart, windowEnd]` (e.g. `22:00` to `06:00`). If a crawl is ongoing when the window ends, the crawler halts gracefully, compiles the task list from completed hops, and writes the report.

### 3.4 Issue Task List & Deduplication (`TaskCompiler`)

#### Deduplication & Fingerprinting:

Raw anomalies from multiple hops are clustered using a stable fingerprint:

```ts
ClusterKey = sha256(`${category}::${normalizedErrorOrSelector}::${topStackFrame}`);
```

#### Task Item Schema (`CrawlerTaskItem`):

```ts
export interface CrawlerTaskItem {
  id: string; // Stable UUID or hash
  clusterKey: string; // Deduplication fingerprint
  title: string; // Human-readable summary
  severity: "P0" | "P1" | "P2" | "P3";
  category: "runtime_error" | "network_failure" | "visual_defect";
  status: "todo" | "in_review" | "ignored" | "resolved";
  occurrenceCount: number; // Number of hops this defect was triggered
  affectedUrls: string[]; // List of unique URLs where defect occurred
  firstSeenAt: number;
  lastSeenAt: number;
  reproductionBreadcrumbs: Array<{
    hopNumber: number;
    url: string;
    action: string;
  }>;
  evidence: {
    screenshotPath?: string; // Path to real screenshot on disk
    consoleMessage?: string;
    stackTrace?: string;
    httpStatus?: number;
    failedUrl?: string;
    domSelector?: string;
  };
}
```

### 3.5 Storage & Nightly Report Generator

- **Storage Location**:
  All files are persisted in the active workspace under:
  ```text
  .evidence/visual-crawler/
    ├── tasks.json                 # Persistent structured task list
    ├── state.json                 # Latest telemetry & schedule settings
    ├── screenshots/               # Real PNG evidence files
    └── reports/                   # Markdown overnight summaries
        └── crawl-report-2026-10-01-02-00-00.md
  ```
- **Markdown Report Structure**:
  - Executive Run Summary: Date, target URL, duration, total hops visited, time window compliance.
  - Severity Breakdown: Count of P0, P1, P2, P3 issues.
  - Actionable Task Checklist: Formatted task list with checkboxes, reproduction steps, error logs, and relative screenshot image links.

### 3.6 Client UI (Paseo Workspace Panel)

#### Interface Layout:

1. **Header & Telemetry**:
   - Status Badge (`IDLE`, `SCHEDULED`, `RUNNING`, `COMPLETED`, `WINDOW_CLOSED`).
   - Progress gauge: `Hops: 34 / 50` | `Depth: 4 / 10`.
   - Current visiting URL & duration timer.
2. **Crawl & Schedule Configuration Section**:
   - `Target URL` text input (defaults to workspace dev server URL or user specified URL).
   - `Max Hops` number input / quick chips (30, 50, 100, custom).
   - `Max Depth` input (default 10).
   - `Night Schedule` toggle + time window inputs (e.g. `Start: 02:00`, `Window: 23:00 - 06:00`).
   - Action buttons: `Run Now`, `Stop`, `Save Schedule`.
3. **Interactive Issue Task List**:
   - Severity filters (`All`, `P0 Critical`, `P1 High`, `P2 Medium`).
   - Task cards showing title, occurrence count, affected routes, and inline screenshot preview.
   - Status toggle buttons: `Mark Done`, `Ignore`.
   - Expandable details: stacktrace, network failure payload, and breadcrumb reproduction steps.
4. **Report & History Drawer**:
   - View past test runs and one-click open for generated Markdown reports.

---

## 4. Error Handling & Edge Cases

| Failure Scenario                                 | Mitigation Strategy                                                                                                                       |
| :----------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **No Google Chrome or Playwright browser found** | Provide auto-fallback detection; return clear diagnostic RPC error advising installation command (`npx playwright install chromium`).     |
| **Target website requires login**                | Support optional authentication headers (Cookie / Authorization token) in crawl configuration.                                            |
| **Infinite redirect or redirect out of domain**  | Strict domain allowlist check before every navigation; drop actions targeting external domains.                                           |
| **Browser crashes or hangs during crawl**        | Wrapped in per-hop timeout (15s); if page freezes, force-terminate page, record anomaly, and continue queue.                              |
| **Crawl exceeds nocturnal time window**          | Timer checks `isWithinTimeWindow()`; triggers graceful teardown, dumps all accumulated tasks and screenshots, and generates final report. |

---

## 5. Verification & Testing Strategy

1. **Unit Tests (`vitest`)**:
   - `scheduler.test.ts`: Verify time window calculations, cron triggers, and window expiration events.
   - `task-compiler.test.ts`: Verify anomaly clustering, fingerprint calculation, and task item synthesis.
   - `report-generator.test.ts`: Verify generated Markdown and JSON report formats.
2. **Integration Tests (`vitest` + local HTTP server)**:
   - Spin up a lightweight local test server with injected console errors, 500 API responses, and broken links.
   - Run `PlaywrightBrowserDriver` headlessly against the test server for 10 hops.
   - Verify that real screenshots are captured, console errors are clustered, and `.evidence/visual-crawler/tasks.json` is correctly written.
3. **UI Contract & Component Tests**:
   - Verify that configuration changes update the crawl parameters.
   - Verify task status mutations (`todo` -> `ignored` / `resolved`).
