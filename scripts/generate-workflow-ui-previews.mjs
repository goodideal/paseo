import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const outDir = path.resolve(".evidence/ui-previews");
fs.mkdirSync(outDir, { recursive: true });

const htmlTemplate = (content, title = "Paseo Workflow Engine") => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #121214;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      overflow: hidden;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      border: 1px solid transparent;
    }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
    }
    .badge-warning {
      background: rgba(192, 150, 100, 0.12);
      color: #c09664;
      border-color: rgba(192, 150, 100, 0.3);
    }
    .badge-warning .badge-dot { background: #db932e; }
    .badge-error {
      background: rgba(216, 132, 123, 0.12);
      color: #d8847b;
      border-color: rgba(216, 132, 123, 0.3);
    }
    .badge-error .badge-dot { background: #f7796d; }
    .badge-success {
      background: rgba(108, 177, 123, 0.12);
      color: #6cb17b;
      border-color: rgba(108, 177, 123, 0.3);
    }
    .badge-success .badge-dot { background: #35c264; }
    .badge-running {
      background: rgba(92, 170, 246, 0.12);
      color: #5caaf6;
      border-color: rgba(92, 170, 246, 0.3);
    }
    .badge-running .badge-dot { background: #5caaf6; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .btn-primary {
      background: #16a34a;
      color: #ffffff;
    }
    .btn-secondary {
      background: #27272a;
      color: #f4f4f5;
      border-color: #3f3f46;
    }
    .btn-destructive {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .btn-ghost {
      background: transparent;
      color: #a1a1aa;
    }

    /* Top Bar */
    .app-topbar {
      height: 44px;
      background: #18181b;
      border-bottom: 1px solid #27272a;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 12px;
      font-size: 13px;
    }
    .app-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      background: #27272a;
      border-radius: 6px;
      color: #fff;
      font-weight: 500;
    }
    .tab-close {
      opacity: 0.6;
      font-size: 14px;
    }

    /* Split layout */
    .split-view {
      display: flex;
      height: calc(100vh - 44px);
    }
    .master-pane {
      width: 330px;
      border-right: 1px solid #27272a;
      background: #121214;
      display: flex;
      flex-direction: column;
    }
    .pane-header {
      padding: 14px 16px;
      border-bottom: 1px solid #27272a;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pane-title {
      font-size: 15px;
      font-weight: 600;
      color: #fafafa;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .run-list {
      flex: 1;
      overflow-y: auto;
    }
    .run-row {
      padding: 12px 16px;
      border-bottom: 1px solid #1f1f23;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: background 0.15s;
    }
    .run-row:hover { background: #1a1a1d; }
    .run-row.selected {
      background: #202025;
      border-left: 3px solid #6cb17b;
    }
    .run-row-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .run-name {
      font-size: 13.5px;
      font-weight: 600;
      color: #f4f4f5;
    }
    .run-meta {
      font-size: 12px;
      color: #71717a;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Detail Pane */
    .detail-pane {
      flex: 1;
      background: #121214;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 24px 32px;
      gap: 20px;
    }
    .detail-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #27272a;
      padding-bottom: 18px;
    }
    .detail-title-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .detail-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .detail-subtitle {
      font-size: 13px;
      color: #a1a1aa;
    }
    .detail-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* Stepper Container */
    .dag-container {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .dag-header {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #71717a;
      margin-bottom: 4px;
    }
    .step-card {
      background: #121214;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
    }
    .step-card.indented {
      margin-left: 28px;
      border-left: 2px solid #3f3f46;
    }
    .step-card.blocking {
      border-color: #c09664;
      background: rgba(192, 150, 100, 0.04);
      box-shadow: 0 0 0 1px rgba(192, 150, 100, 0.2);
    }
    .step-card.failed {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.04);
    }
    .step-row-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .step-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .step-idx {
      font-size: 12px;
      color: #71717a;
      font-family: ui-monospace, monospace;
      font-weight: 600;
    }
    .step-id {
      font-size: 14px;
      font-weight: 600;
      color: #fafafa;
    }
    .step-attempt {
      font-size: 11px;
      color: #71717a;
      background: #1f1f23;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .step-detail-text {
      font-size: 12.5px;
      color: #a1a1aa;
      line-height: 1.5;
    }
    .step-code-box {
      font-family: ui-monospace, monospace;
      font-size: 11.5px;
      background: #09090b;
      padding: 8px 12px;
      border-radius: 6px;
      color: #a1a1aa;
      border: 1px solid #1f1f23;
    }
    .step-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }
    .alert-banner {
      background: rgba(192, 150, 100, 0.1);
      border: 1px solid rgba(192, 150, 100, 0.3);
      padding: 12px 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: #e4d4c8;
    }
    .alert-icon { font-size: 16px; }

    /* Worker lanes component */
    .lanes-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-top: 16px;
    }
    .lane-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .lane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .lane-title {
      font-size: 14px;
      font-weight: 600;
      color: #f4f4f5;
    }
    .lane-sub {
      font-size: 12px;
      color: #a1a1aa;
    }
  </style>
</head>
<body>
${content}
</body>
</html>
`;

async function renderScreenshot(html, outputPath, viewport = { width: 1280, height: 820 }) {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({ viewport });
  await page.setContent(html);
  await page.screenshot({ path: outputPath });
  await browser.close();
  console.log(`Generated: ${outputPath}`);
}

async function main() {
  // 1. Wide View of Workflow Runs Panel
  const wideHtml = htmlTemplate(
    `
    <div class="app-topbar">
      <div class="app-tab">
        <span>⚡ noble-scorpion</span>
      </div>
      <div class="app-tab" style="background: #18181b; border: 1px solid #27272a;">
        <span>🌿 branch: feat/workflow-engine</span>
      </div>
      <div class="app-tab" style="background: #222226; border: 1px solid #3f3f46;">
        <span>⚙️ Workflow Runs</span>
        <span class="tab-close">×</span>
      </div>
    </div>
    <div class="split-view">
      <!-- Master List -->
      <div class="master-pane">
        <div class="pane-header">
          <div class="pane-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Workflow Runs
          </div>
          <span style="font-size: 12px; color: #71717a;">4 runs</span>
        </div>
        <div class="run-list">
          <div class="run-row selected">
            <div class="run-row-header">
              <span class="run-name">visual-crawler-fix</span>
              <span class="badge badge-warning"><span class="badge-dot"></span>Awaiting Approval</span>
            </div>
            <div class="run-meta">
              <span>Run #run_01a</span> · <span>2m ago</span> · <span>ship</span>
            </div>
          </div>
          <div class="run-row">
            <div class="run-row-header">
              <span class="run-name">ci-validation-flow</span>
              <span class="badge badge-error"><span class="badge-dot"></span>Failed</span>
            </div>
            <div class="run-meta">
              <span>Run #run_9b2</span> · <span>14m ago</span> · <span>verify.command</span>
            </div>
          </div>
          <div class="run-row">
            <div class="run-row-header">
              <span class="run-name">nightly-security-audit</span>
              <span class="badge badge-running"><span class="badge-dot"></span>Running</span>
            </div>
            <div class="run-meta">
              <span>Run #run_8ef</span> · <span>32m ago</span> · <span>agent.dispatch</span>
            </div>
          </div>
          <div class="run-row">
            <div class="run-row-header">
              <span class="run-name">dep-license-compliance</span>
              <span class="badge badge-success"><span class="badge-dot"></span>Succeeded</span>
            </div>
            <div class="run-meta">
              <span>Run #run_33a</span> · <span>1h ago</span> · <span>completed</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Pane -->
      <div class="detail-pane">
        <div class="detail-hero">
          <div class="detail-title-group">
            <div class="detail-title">
              visual-crawler-fix
              <span class="badge badge-warning" style="font-size: 12px; padding: 4px 10px;"><span class="badge-dot"></span>Awaiting Approval</span>
            </div>
            <div class="detail-subtitle">
              Preset: <code>visual-crawler</code> · Scope: <code>noble-scorpion</code> (workspace: <code>ws-main</code>) · Hash: <code>6cb17b4...</code>
            </div>
          </div>
          <div class="detail-actions">
            <button class="btn btn-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              Cancel Run
            </button>
          </div>
        </div>

        <div class="alert-banner">
          <span class="alert-icon">⚠️</span>
          <div>
            <strong>Approval Required:</strong> Step <code>ship</code> (<code>git.create_pr</code>) requests authorization to create a Pull Request on <code>origin/main</code>.
          </div>
        </div>

        <!-- Vertical Stepper DAG -->
        <div class="dag-container">
          <div class="dag-header">DAG Execution Steps & Attempt History</div>

          <!-- Step 1 -->
          <div class="step-card">
            <div class="step-row-top">
              <div class="step-title-row">
                <span class="step-idx">1.</span>
                <span class="step-id">worktree</span>
                <span class="step-attempt">Attempt #1</span>
              </div>
              <span class="badge badge-success"><span class="badge-dot"></span>Succeeded</span>
            </div>
            <div class="step-detail-text">Adapter: <code>worktree.create</code> · Duration: 1.2s · Exit: clean</div>
            <div class="step-code-box">
              { "worktreePath": "/Users/jerry/.paseo/worktrees/1evk71d9/noble-scorpion", "branch": "fix/header-overlap" }
            </div>
          </div>

          <!-- Step 2 -->
          <div class="step-card indented">
            <div class="step-row-top">
              <div class="step-title-row">
                <span class="step-idx">2.</span>
                <span class="step-id">repair</span>
                <span class="step-attempt">Attempt #1</span>
              </div>
              <span class="badge badge-success"><span class="badge-dot"></span>Succeeded</span>
            </div>
            <div class="step-detail-text">Adapter: <code>agent.dispatch</code> · Provider: <code>codex</code> · Duration: 24.5s</div>
            <div class="step-code-box">
              { "agentId": "agent-8f7a2", "sessionId": "sess_01a", "resumable": true }
            </div>
          </div>

          <!-- Step 3 -->
          <div class="step-card indented">
            <div class="step-row-top">
              <div class="step-title-row">
                <span class="step-idx">3.</span>
                <span class="step-id">verify</span>
                <span class="step-attempt">Attempt #1</span>
              </div>
              <span class="badge badge-success"><span class="badge-dot"></span>Succeeded</span>
            </div>
            <div class="step-detail-text">Adapter: <code>verify.command</code> · Profile: <code>typecheck + unit-test</code> · Duration: 8.1s</div>
            <div class="step-code-box">
              { "passed": true, "report": "All 18 tests passed. TypeScript typecheck 0 errors." }
            </div>
          </div>

          <!-- Step 4: Blocking Approval -->
          <div class="step-card indented blocking">
            <div class="step-row-top">
              <div class="step-title-row">
                <span class="step-idx">4.</span>
                <span class="step-id">ship</span>
                <span class="step-attempt">Attempt #1 (Pending Decision)</span>
              </div>
              <span class="badge badge-warning"><span class="badge-dot"></span>Waiting Approval</span>
            </div>
            <div class="step-detail-text" style="color: #e4d4c8;">
              Adapter: <code>git.create_pr</code> · Condition: <code>steps.verify.outputs.passed == true</code> (satisfied)
              <br/>
              Policy: <code>[P0 High Priority] External action requires approval: git.create_pr</code>
            </div>
            <div class="step-actions">
              <button class="btn btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                Approve &amp; Submit PR
              </button>
              <button class="btn btn-destructive">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Deny Action
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
    "Paseo - Workflow Runs (Wide Master-Detail)",
  );

  await renderScreenshot(wideHtml, path.join(outDir, "workflow-runs-wide.png"), {
    width: 1280,
    height: 820,
  });

  // 2. Compact View of Workflow Runs Panel (Mobile: 390x844)
  const compactHtml = htmlTemplate(
    `
    <div style="background: #121214; height: 100vh; display: flex; flex-direction: column;">
      <div style="padding: 14px 16px; border-bottom: 1px solid #27272a; display: flex; align-items: center; justify-content: space-between;">
        <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 13px;">
          ← Back to List
        </button>
        <span class="badge badge-warning"><span class="badge-dot"></span>Waiting Approval</span>
      </div>

      <div style="padding: 16px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;">
        <div>
          <h2 style="font-size: 18px; font-weight: 700; color: #fff;">visual-crawler-fix</h2>
          <div style="font-size: 12px; color: #71717a; margin-top: 2px;">noble-scorpion · Run #run_01a</div>
        </div>

        <div class="alert-banner" style="font-size: 12px; padding: 10px 12px;">
          <span>⚠️</span>
          <div>Action required: External write approval for step <strong>ship</strong>.</div>
        </div>

        <div class="dag-container" style="padding: 14px;">
          <div class="dag-header">Execution Steps</div>

          <div class="step-card" style="padding: 10px 12px;">
            <div class="step-row-top">
              <span class="step-id" style="font-size: 13px;">1. worktree</span>
              <span class="badge badge-success"><span class="badge-dot"></span>OK</span>
            </div>
          </div>

          <div class="step-card indented" style="padding: 10px 12px; margin-left: 14px;">
            <div class="step-row-top">
              <span class="step-id" style="font-size: 13px;">2. repair</span>
              <span class="badge badge-success"><span class="badge-dot"></span>OK</span>
            </div>
          </div>

          <div class="step-card indented" style="padding: 10px 12px; margin-left: 14px;">
            <div class="step-row-top">
              <span class="step-id" style="font-size: 13px;">3. verify</span>
              <span class="badge badge-success"><span class="badge-dot"></span>OK</span>
            </div>
          </div>

          <div class="step-card indented blocking" style="padding: 12px; margin-left: 14px;">
            <div class="step-row-top">
              <span class="step-id" style="font-size: 13px;">4. ship</span>
              <span class="badge badge-warning"><span class="badge-dot"></span>Approval</span>
            </div>
            <div style="font-size: 11.5px; color: #c09664; margin-top: 4px;">
              Target: <code>origin/main</code>
            </div>
            <div class="step-actions" style="margin-top: 10px;">
              <button class="btn btn-primary" style="flex: 1; font-size: 12px; padding: 8px;">Approve</button>
              <button class="btn btn-destructive" style="flex: 1; font-size: 12px; padding: 8px;">Deny</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
    "Paseo - Workflow Runs (Compact)",
  );

  await renderScreenshot(compactHtml, path.join(outDir, "workflow-runs-compact.png"), {
    width: 390,
    height: 844,
  });

  // 3. Visual Crawler Dashboard with Concurrency Worker Lanes
  const dashboardHtml = htmlTemplate(
    `
    <div class="app-topbar">
      <div class="app-tab">
        <span>⚡ noble-scorpion</span>
      </div>
      <div class="app-tab" style="background: #222226; border: 1px solid #3f3f46;">
        <span>🕷️ Visual QA &amp; Auto-Fix</span>
        <span class="tab-close">×</span>
      </div>
    </div>
    <div style="padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; height: calc(100vh - 44px); overflow-y: auto;">
      <!-- Telemetry Header -->
      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 18px 24px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 18px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 10px;">
            Visual Web Crawler &amp; Auto-Fix
            <span class="badge badge-success"><span class="badge-dot"></span>Completed (50/50 Hops)</span>
          </div>
          <div style="font-size: 13px; color: #a1a1aa; margin-top: 4px;">
            Target: <code>http://localhost:3000</code> · Seed Routes: 3 · Active Anomalies: <strong>7 detected</strong>
          </div>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary">Rerun Crawl</button>
          <button class="btn btn-primary">Batch Approve (P0 &amp; P1)</button>
        </div>
      </div>

      <!-- Triage Board -->
      <div>
        <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #71717a; margin-bottom: 12px;">
          Triaged Fix Directives
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
          <!-- Directive 1 -->
          <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="badge badge-error">P0 Critical</span>
              <span style="font-size: 12px; color: #71717a;">3 occurrences · /dashboard</span>
            </div>
            <div style="font-size: 15px; font-weight: 600; color: #fff;">Uncaught TypeError: Cannot read property 'items' of undefined</div>
            <div style="font-size: 12.5px; color: #a1a1aa;">File: <code>src/components/HeaderNav.tsx:42</code></div>
            <div style="background: #121214; padding: 10px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 12px; color: #e4e4e7;">
              Suggested Fix: Add optional chaining check on <code>response.data?.items</code>.
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span class="badge badge-running">Linked Run: #run_vc_d1</span>
              <button class="btn btn-secondary" style="font-size: 12px; padding: 4px 10px;">Inspect Run →</button>
            </div>
          </div>

          <!-- Directive 2 -->
          <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="badge badge-warning">P1 Layout Defect</span>
              <span style="font-size: 12px; color: #71717a;">5 occurrences · /settings</span>
            </div>
            <div style="font-size: 15px; font-weight: 600; color: #fff;">CSS Flexbox overlap in Settings sidebar buttons</div>
            <div style="font-size: 12.5px; color: #a1a1aa;">Selector: <code>div.settings-sidebar-nav</code></div>
            <div style="background: #121214; padding: 10px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 12px; color: #e4e4e7;">
              Suggested Fix: Change <code>flex-direction: row</code> to <code>column</code> with gap 8px.
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span style="font-size: 12px; color: #71717a;">Status: Pending Review</span>
              <button class="btn btn-primary" style="font-size: 12px; padding: 4px 10px;">Approve Directive</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Concurrency Worker Lanes (Integrated with Workflow Engine) -->
      <div>
        <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #71717a; margin-bottom: 12px;">
          Autonomous Worker Lanes (Workflow Engine Runtime)
        </div>
        <div class="lanes-grid">
          <!-- Worker 1 -->
          <div class="lane-card" style="border-color: #c09664;">
            <div class="lane-header">
              <span class="lane-title">Lane 1: Fix Header Nav</span>
              <span class="badge badge-warning"><span class="badge-dot"></span>Awaiting Approval</span>
            </div>
            <div class="lane-sub">Current Step: <code>git.create_pr</code></div>
            <div style="font-size: 12px; color: #71717a;">🌿 branch: <code>fix/header-overlap</code></div>
            <div style="font-size: 12px; color: #c09664; margin-top: 4px;">⚠️ Waiting for user review before PR creation</div>
            <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px; margin-top: auto;">Open Workflow Detail →</button>
          </div>

          <!-- Worker 2 -->
          <div class="lane-card" style="border-color: #5caaf6;">
            <div class="lane-header">
              <span class="lane-title">Lane 2: Fix Flexbox Overlap</span>
              <span class="badge badge-running"><span class="badge-dot"></span>Running</span>
            </div>
            <div class="lane-sub">Current Step: <code>agent.dispatch</code> (Codex)</div>
            <div style="font-size: 12px; color: #71717a;">🌿 branch: <code>fix/settings-flex</code></div>
            <div style="font-size: 12px; color: #a1a1aa; margin-top: 4px;">Synthesizing stylesheet patch in isolated worktree</div>
            <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px; margin-top: auto;">Open Workflow Detail →</button>
          </div>

          <!-- Worker 3 -->
          <div class="lane-card">
            <div class="lane-header">
              <span class="lane-title">Lane 3: Standing by</span>
              <span class="badge" style="background: #27272a; color: #a1a1aa;">Idle</span>
            </div>
            <div class="lane-sub">Concurrency slot 3/3 available</div>
            <div style="font-size: 12px; color: #71717a;">Waiting for next approved directive...</div>
          </div>
        </div>
      </div>
    </div>
  `,
    "Paseo - Visual QA & Auto-Fix Dashboard",
  );

  await renderScreenshot(dashboardHtml, path.join(outDir, "visual-crawler-dashboard.png"), {
    width: 1280,
    height: 820,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
