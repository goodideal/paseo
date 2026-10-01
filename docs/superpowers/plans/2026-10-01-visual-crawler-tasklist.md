# Visual Crawler, Scheduled Testing & Issue Task List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-architect the `visual-crawler-auto-fix` plugin to run real headless Playwright crawls on schedules or nocturnal time windows, explore configurable targets with customizable hops and depth, detect runtime and visual defects, and compile a persistent, deduplicated issue task list with actionable reports.

**Architecture:** A modular decoupled pipeline: (1) `CrawlerScheduler` handles cron triggers and time-window guard limits; (2) `PlaywrightBrowserDriver` manages real headless Chromium and event listeners; (3) `VisualCrawlerEngine` traverses pages with BFS/DFS and action budgets; (4) `TaskCompiler` clusters anomalies into deduplicated `CrawlerTaskItem`s; (5) `TaskStore` persists tasks to `<workspace>/.evidence/visual-crawler/tasks.json` and writes Markdown reports; (6) UI panel provides full URL, depth, schedule configuration, and interactive task triage.

**Tech Stack:** TypeScript, Node.js, Playwright (`chromium`), React Native Web (Paseo Plugin API), Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-10-01-visual-crawler-tasklist-redesign.md`

## Global Constraints

- Never use mock data in place of real browser calls in production code.
- Decouple defect detection and task list generation completely from auto-fix workflows.
- Always store task artifacts directly in workspace-relative `.evidence/visual-crawler/`.
- Ensure headless crawls can execute without requiring the desktop window or UI to be open.
- Respect the time window: if current time moves outside `[windowStart, windowEnd]`, gracefully conclude the crawl, flush results to disk, and generate the final report.

## Review Focus

1. **Target URL redirects to external origin**: Drop the request if redirected outside `allowedOrigins` to prevent unauthorized crawling of external sites.
2. **Playwright fails to launch Chromium**: Return an actionable diagnostic error indicating `npx playwright install chromium` or missing system Chrome without crashing the daemon.
3. **Nocturnal window closes during an active crawl**: Ensure `CrawlerScheduler` signals `VisualCrawlerEngine` to cleanly stop, save all existing findings to `tasks.json`, and generate the Markdown report without losing data.
4. **Duplicate recurring errors across dozens of pages**: Verify that `TaskCompiler` groups them by error signature and stack into a single task item with multiple affected URLs and an occurrence counter.
5. **Modal overlay blocking navigation**: Ensure `VisualCrawlerEngine` attempts to close the modal (Escape key / close selector) and backtracks rather than getting trapped in an infinite loop.

---

### Task 1: Shared Schemas and Typed RPC Contracts

**Files:**

- Modify: `plugin-custom/visual-crawler-auto-fix/shared/types.ts`
- Modify: `plugin-custom/visual-crawler-auto-fix/shared/contracts.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/contracts.test.ts`

**Interfaces:**

- Produces:
  - `CrawlerTaskItemSchema`, `CrawlScheduleConfigSchema`, `TimeWindowConfigSchema`
  - Updated `CrawlConfigSchema` (targetUrl, allowedOrigins, maxHops, maxDepth, seedRoutes, authHeaders, timeWindow)
  - RPC contracts: `startCrawlRpc`, `stopCrawlRpc`, `getCrawlStatusRpc`, `saveScheduleRpc`, `getScheduleRpc`, `listTasksRpc`, `updateTaskStatusRpc`

- [ ] **Step 1: Write failing tests for contracts and schemas**

Create `plugin-custom/visual-crawler-auto-fix/tests/contracts.test.ts` verifying parsing of valid and invalid `CrawlConfig`, `CrawlerTaskItem`, `CrawlScheduleConfig`, and RPC definitions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/contracts.test.ts --bail=1`
Expected: FAIL (types and contracts missing new fields)

- [ ] **Step 3: Implement updated schemas and RPC contracts**

In `shared/types.ts`:

- Define `TimeWindowConfig` (`enabled: boolean`, `startTime: string` "HH:mm", `endTime: string` "HH:mm").
- Define `CrawlScheduleConfig` (`enabled: boolean`, `cron?: string`, `timeWindow?: TimeWindowConfig`, `targetUrl: string`, `maxHops: number`, `maxDepth: number`).
- Define `CrawlerTaskItem` (id, clusterKey, title, severity, category, status, occurrenceCount, affectedUrls, reproductionBreadcrumbs, evidence, firstSeenAt, lastSeenAt).
- Update `CrawlConfig` with `maxDepth`, `authHeaders`, and `timeWindow`.

In `shared/contracts.ts`:

- Export `saveScheduleRpc`, `getScheduleRpc`, `listTasksRpc`, `updateTaskStatusRpc`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/contracts.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/shared/ plugin-custom/visual-crawler-auto-fix/tests/contracts.test.ts
rtk git commit -m "feat(crawler): add task item, scheduler and updated crawl contracts"
```

---

### Task 2: Task Compiler (Anomaly Deduplication and Synthesis)

**Files:**

- Create: `plugin-custom/visual-crawler-auto-fix/server/triage/task-compiler.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/task-compiler.test.ts`

**Interfaces:**

- Consumes: `AnomalyRecord`, `HopRecord`, `CrawlerTaskItem` from `shared/types.ts`
- Produces: `TaskCompiler` class with `compile(hops: HopRecord[], existingTasks?: CrawlerTaskItem[]): CrawlerTaskItem[]`

- [ ] **Step 1: Write failing tests for TaskCompiler**

Create `plugin-custom/visual-crawler-auto-fix/tests/task-compiler.test.ts`:

- Test clustering two console errors with same message across different URLs into one `CrawlerTaskItem`.
- Test assigning correct severity (P0 for crash/unhandled, P1 for syntax/type error, P2 for visual overlap).
- Test synthesizing reproduction breadcrumbs from hop history.
- Test updating existing tasks without duplicating them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/task-compiler.test.ts --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement TaskCompiler**

In `server/triage/task-compiler.ts`:

- Implement `computeClusterKey(anomaly: AnomalyRecord): string` using SHA-256 on category + normalized error message + selector.
- Implement `compile()`: iterate over hops and anomalies, group by `clusterKey`, merge affected URLs, collect action breadcrumbs leading to the anomaly, and construct or update `CrawlerTaskItem`s.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/task-compiler.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/server/triage/task-compiler.ts plugin-custom/visual-crawler-auto-fix/tests/task-compiler.test.ts
rtk git commit -m "feat(crawler): implement task compiler and anomaly deduplication"
```

---

### Task 3: Scheduler and Time-Window Guard

**Files:**

- Create: `plugin-custom/visual-crawler-auto-fix/server/scheduler/crawler-scheduler.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/crawler-scheduler.test.ts`

**Interfaces:**

- Consumes: `CrawlScheduleConfig`, `TimeWindowConfig` from `shared/types.ts`
- Produces: `CrawlerScheduler` with:
  - `isWithinTimeWindow(date: Date, window: TimeWindowConfig): boolean`
  - `schedule(config: CrawlScheduleConfig, onTrigger: () => Promise<void>): void`
  - `stop(): void`
  - `getStatus(): CrawlScheduleConfig`

- [ ] **Step 1: Write failing tests for CrawlerScheduler**

Create `plugin-custom/visual-crawler-auto-fix/tests/crawler-scheduler.test.ts`:

- Test `isWithinTimeWindow` for standard daytime window (e.g. 09:00 - 18:00) inside and outside.
- Test `isWithinTimeWindow` for overnight window crossing midnight (e.g. 23:00 - 06:00) at 23:30 (true), 02:00 (true), 08:00 (false).
- Test manual trigger and stop.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/crawler-scheduler.test.ts --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement CrawlerScheduler**

In `server/scheduler/crawler-scheduler.ts`:

- Implement `isWithinTimeWindow`: parse `HH:mm` to minute-of-day; handle start < end (same day) and start > end (overnight).
- Implement `CrawlerScheduler` with timer loop / cron check.
- Provide callback trigger when scheduled time arrives and ensure execution is skipped or aborted if window is closed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/crawler-scheduler.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/server/scheduler/ plugin-custom/visual-crawler-auto-fix/tests/crawler-scheduler.test.ts
rtk git commit -m "feat(crawler): implement time window and schedule controller"
```

---

### Task 4: Real Playwright Headless Browser Driver

**Files:**

- Create: `plugin-custom/visual-crawler-auto-fix/server/engine/playwright-driver.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/playwright-driver.test.ts`

**Interfaces:**

- Consumes: `BrowserDriver` interface from `crawler-engine.ts`
- Produces: `PlaywrightBrowserDriver` class that uses real `playwright.chromium` to navigate, click, capture screenshots, and gather real runtime logs.

- [ ] **Step 1: Write unit/mock tests for PlaywrightBrowserDriver**

Create `plugin-custom/visual-crawler-auto-fix/tests/playwright-driver.test.ts`:

- Test browser launch parameter detection (prefers chrome channel, falls back to default chromium).
- Test console log capturing and filtering.
- Test visual anomaly detection evaluation script logic.
- Test screenshot output directory creation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/playwright-driver.test.ts --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement PlaywrightBrowserDriver**

In `server/engine/playwright-driver.ts`:

- Launch headless Chromium (`channel: "chrome"` or system default).
- Set up `page.on("console")` and `page.on("pageerror")` buffers.
- Set up `page.on("response")` buffer for HTTP >= 400.
- Implement `navigate(url)` with timeout protection.
- Implement `getInteractiveElements()` querying `a[href]`, `button`, `[role="button"]`, `[role="tab"]`.
- Implement `click(selector)`.
- Implement `captureScreenshot(targetPath)`.
- Implement `checkVisualAnomalies()` using DOM evaluation (zero height root, overlapping sibling blocks, clipped text).
- Implement `close()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/playwright-driver.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/server/engine/playwright-driver.ts plugin-custom/visual-crawler-auto-fix/tests/playwright-driver.test.ts
rtk git commit -m "feat(crawler): implement real Playwright headless browser driver"
```

---

### Task 5: Traversal State Machine & Depth Control Enhancements

**Files:**

- Modify: `plugin-custom/visual-crawler-auto-fix/server/engine/crawler-engine.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/crawler-engine.test.ts`

**Interfaces:**

- Consumes: `BrowserDriver`, `CrawlConfig`
- Produces: `VisualCrawlerEngine` with `maxDepth` tracking, route action budgets, modal escape handling, and action breadcrumbs.

- [ ] **Step 1: Update tests for depth limits, action budgets, and breadcrumbs**

In `tests/crawler-engine.test.ts`:

- Test that engine halts when `maxDepth` is reached even if `maxHops` remains.
- Test that engine records action breadcrumbs for each hop.
- Test that single route does not exceed action budget (maximum 5 clicks per URL).
- Test abort signal handling when time window closes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/crawler-engine.test.ts --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement depth control and breadcrumb tracking in crawler engine**

In `server/engine/crawler-engine.ts`:

- Maintain current depth per URL in the traversal tree.
- Keep sequence of action breadcrumbs (`hopNumber`, `url`, `action`).
- Enforce `maxDepth` constraint in `chooseNextAction()`.
- Add `abortSignal?: AbortSignal` support to terminate loop immediately on time window close.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/crawler-engine.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/server/engine/crawler-engine.ts plugin-custom/visual-crawler-auto-fix/tests/crawler-engine.test.ts
rtk git commit -m "feat(crawler): add depth control, breadcrumb tracing, and abort signals"
```

---

### Task 6: Persistent Task Store and Markdown Report Generator

**Files:**

- Modify: `plugin-custom/visual-crawler-auto-fix/server/store/task-store.ts`
- Create: `plugin-custom/visual-crawler-auto-fix/server/report/report-generator.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/report-generator.test.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/store.test.ts`

**Interfaces:**

- Consumes: `CrawlerTaskItem`, `CrawlTelemetry`
- Produces:
  - `TaskStore` with `getTasks()`, `saveTasks()`, `updateTaskStatus()`
  - `generateMarkdownReport(telemetry: CrawlTelemetry, tasks: CrawlerTaskItem[]): string`

- [ ] **Step 1: Write failing tests for report generator and task persistence**

Create `plugin-custom/visual-crawler-auto-fix/tests/report-generator.test.ts`:

- Test Markdown report contains overview table, severity counts, and task checklists with reproduction steps.
  Update `tests/store.test.ts`:
- Test persistence of `tasks.json` and status transitions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/report-generator.test.ts --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement TaskStore updates and Markdown report generator**

In `server/store/task-store.ts`:

- Store tasks in `.evidence/visual-crawler/tasks.json`.
- Methods: `getTasks(filter)`, `upsertTask(task)`, `updateTaskStatus(id, status)`.

In `server/report/report-generator.ts`:

- Format Markdown report with:
  - Run metadata (target URL, hops, depth, duration, timestamp).
  - Severity summary table (P0, P1, P2, P3).
  - Actionable checklist with reproduction steps and screenshot links.
- Write report to `.evidence/visual-crawler/reports/crawl-report-<timestamp>.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/report-generator.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/server/store/ plugin-custom/visual-crawler-auto-fix/server/report/ plugin-custom/visual-crawler-auto-fix/tests/
rtk git commit -m "feat(crawler): implement task persistence and markdown report generator"
```

---

### Task 7: Server Integration & RPC Wiring

**Files:**

- Modify: `plugin-custom/visual-crawler-auto-fix/index.server.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/rpc-integration.test.ts`

**Interfaces:**

- Consumes: `PlaywrightBrowserDriver`, `CrawlerScheduler`, `TaskStore`, `TaskCompiler`, `ReportGenerator`
- Produces: Fully functional plugin server handling all crawl, schedule, and task RPCs.

- [ ] **Step 1: Update RPC integration tests**

In `tests/rpc-integration.test.ts`:

- Test `startCrawlRpc` with configurable targetUrl, maxHops, maxDepth.
- Test `listTasksRpc` returning compiled task items.
- Test `updateTaskStatusRpc` updating task status.
- Test `saveScheduleRpc` and `getScheduleRpc`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/rpc-integration.test.ts --bail=1`
Expected: FAIL

- [ ] **Step 3: Wire all components in `index.server.ts`**

In `index.server.ts`:

- Instantiate `TaskStore` targeted at workspace `.evidence/visual-crawler/`.
- Instantiate `PlaywrightBrowserDriver` (or injected driver for tests).
- Instantiate `CrawlerScheduler` and register schedule handlers.
- Wire `startCrawlRpc`: trigger crawl with depth and time-window guard; upon completion or window close, compile tasks via `TaskCompiler`, persist to store, and write Markdown report.
- Wire `listTasksRpc` and `updateTaskStatusRpc`.
- Wire `saveScheduleRpc` and `getScheduleRpc`.
- Decouple old worktree pool from the main crawl execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/rpc-integration.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/index.server.ts plugin-custom/visual-crawler-auto-fix/tests/rpc-integration.test.ts
rtk git commit -m "feat(crawler): wire real crawler, scheduler, and task RPCs in server"
```

---

### Task 8: Client UI Redesign (Config Bar, Task Board & Reports)

**Files:**

- Create: `plugin-custom/visual-crawler-auto-fix/client/components/config-bar.tsx`
- Create: `plugin-custom/visual-crawler-auto-fix/client/components/task-board.tsx`
- Modify: `plugin-custom/visual-crawler-auto-fix/client/components/crawler-dashboard.tsx`
- Modify: `plugin-custom/visual-crawler-auto-fix/client/components/telemetry-header.tsx`
- Modify: `plugin-custom/visual-crawler-auto-fix/client/components/styles.ts`
- Test: `plugin-custom/visual-crawler-auto-fix/tests/task-board.test.tsx`

**Interfaces:**

- Produces: Interactive Paseo workspace panel with full crawl parameter configuration (target URL, hops, depth, night schedule) and issue task list cards.

- [ ] **Step 1: Write UI component tests for TaskBoard and ConfigBar**

Create `plugin-custom/visual-crawler-auto-fix/tests/task-board.test.tsx`:

- Test rendering task cards with severity badges, affected URLs, and reproduction steps.
- Test clicking "Mark Done" and "Ignore" triggers callbacks.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/task-board.test.tsx --bail=1`
Expected: FAIL

- [ ] **Step 3: Implement ConfigBar, TaskBoard, and updated CrawlerDashboard**

- Create `client/components/config-bar.tsx`: inputs for Target URL, Max Hops, Max Depth, Time Window toggle, and Run Now/Stop buttons.
- Create `client/components/task-board.tsx`: severity filter tabs, list of `CrawlerTaskItem` cards, reproduction breadcrumb display, screenshot modal preview, and status action buttons.
- Update `client/components/crawler-dashboard.tsx`: integrate `useRpc` for `startCrawlRpc`, `stopCrawlRpc`, `listTasksRpc`, `updateTaskStatusRpc`, `saveScheduleRpc`, `getScheduleRpc`.
- Update `styles.ts` with responsive styles for inputs, cards, and breadcrumb lists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/task-board.test.tsx --bail=1`
Expected: PASS

- [ ] **Step 5: Run full plugin test suite**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/ --bail=1`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/client/ plugin-custom/visual-crawler-auto-fix/tests/task-board.test.tsx
rtk git commit -m "feat(crawler): redesign client UI with configuration bar and task board"
```

---

### Task 9: End-to-End Integration Verification & Formatting

**Files:**

- Verify: Full plugin test suite & typecheck
- Format: Repository-wide formatting for changed files

- [ ] **Step 1: Run typecheck on plugin files**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Run all plugin tests**

Run: `npx vitest run plugin-custom/visual-crawler-auto-fix/tests/ --bail=1`
Expected: ALL PASS

- [ ] **Step 3: Format changed files**

Run: `npm run format:files -- plugin-custom/visual-crawler-auto-fix/`
Expected: Formatting applied cleanly

- [ ] **Step 4: Final commit**

```bash
rtk git add plugin-custom/visual-crawler-auto-fix/
rtk git commit -m "chore(crawler): verify typecheck, test suite and formatting"
```
