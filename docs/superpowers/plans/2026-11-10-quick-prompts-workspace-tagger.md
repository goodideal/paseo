# Quick-Prompts Non-Invasive Worktree / Local Workspace Tagger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automated, non-invasive Worktree and Local tagging in the `quick-prompts` plugin using Paseo's native Workspace Labels system, and revert previous invasive icon code in `packages/app`.

**Architecture:** Extend `@getpaseo/client` and `@getpaseo/plugin` to expose `setLabel` and provide `server.paseo` to server plugins. Create a `workspace-tagger` module inside `plugin-custom/quick-prompts` that backfills labels on startup and tags new workspaces on `workspace.create.after`. Revert all hardcoded `<ThemedFolderGit2 />` markup and related unit test assertions in `packages/app`.

**Tech Stack:** TypeScript, React Native / Expo, Vitest, `@getpaseo/client`, `@getpaseo/plugin`, `@getpaseo/protocol`.

**Spec:** `docs/superpowers/specs/2026-11-10-quick-prompts-workspace-tagger-design.md`

## Global Constraints

- Never restart the main Paseo daemon on port 6767 without permission.
- Wire schemas and protocol messages stay backward-compatible (no breaking schema changes).
- All changes must pass `npm run typecheck` and `npm run format:check`.
- Target labels: Worktree = `{ name: "Worktree", color: "sky" }`; Local = `{ name: "Local", color: "amber" }`.
- Non-git `directory` workspaces remain untagged.

## Review Focus

1. **Idempotency**: Workspaces already bearing the target label must not trigger duplicate RPC requests.
2. **Type Switching**: A workspace switching from local to worktree (or vice versa) must remove the opposite label and assign the target label.
3. **Missing Workspaces at Creation**: If `workspace.create.after` fires for a workspace that is immediately deleted or unresolvable, the tagger must gracefully log an error without crashing the plugin process.
4. **App Layout Stability**: Reverting the hardcoded icon in `packages/app` must preserve the 20px rail height and alignment in `SidebarWorkspaceRowContent` and `WorkspaceHeaderTitleBar`.
5. **Client Build Declarations**: Monorepo packages consume generated declarations; `@getpaseo/client` must be rebuilt (`npm run build:client`) before typechecking dependent workspaces.

---

### Task 1: Expose `setLabel` in `@getpaseo/client` and Attach `paseo` to `PluginServerContext`

**Files:**

- Modify: `packages/client/src/index.ts`
- Modify: `packages/plugin/src/server/contracts.ts`
- Modify: `packages/server/src/server/plugins/plugin-process.ts`
- Test: `packages/client/src/index.test.ts`

**Interfaces:**

- Consumes: `daemonClient.setWorkspaceLabel` from `packages/client/src/daemon-client.ts`
- Produces:
  - `paseo.workspaces.setLabel(workspaceId: string, label: WorkspaceLabelDefinition, assigned?: boolean)` on `PaseoWorkspaceActions`
  - `workspaceHandle.setLabel(label: WorkspaceLabelDefinition, assigned?: boolean)` on `PaseoWorkspaceHandle`
  - `server.paseo: PaseoApi` on `PluginServerContext`

- [ ] **Step 1: Write the failing test in `packages/client/src/index.test.ts`**

Add test verifying that `api.workspaces.setLabel` and `workspaceHandle.setLabel` delegate to `daemonClient.setWorkspaceLabel`:

```ts
test("workspace actions expose setLabel delegating to daemon client", async () => {
  const driver = createMockDriver();
  const api = createPaseoApi(driver);
  expect(typeof api.workspaces.setLabel).toBe("function");
  const handle = api.workspaces.ref("wks_123");
  expect(typeof handle.setLabel).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/client/src/index.test.ts -t "workspace actions expose setLabel" --bail=1`
Expected: FAIL with "setLabel is not a function"

- [ ] **Step 3: Implement `setLabel` in `packages/client/src/index.ts` and attach `paseo` to `PluginServerContext`**

1. In `packages/client/src/index.ts`:
   - Add `setLabel(label: WorkspaceLabelDefinition, assigned?: boolean): Promise<WorkspaceLabelAssignmentPayload>` to `PaseoWorkspaceHandle`.
   - In `createWorkspaceHandleFactory`: return `setLabel: (label, assigned = true) => daemonClient.setWorkspaceLabel({ workspaceId: id, label, assigned })`.
   - Add `setLabel(workspaceId: string, label: WorkspaceLabelDefinition, assigned?: boolean): Promise<WorkspaceLabelAssignmentPayload>` to `PaseoWorkspaceActions`.
   - In `createPaseoApi`: add `setLabel: (workspaceId, label, assigned = true) => daemonClient.setWorkspaceLabel({ workspaceId, label, assigned })` to `workspaces`.
2. In `packages/plugin/src/server/contracts.ts`:
   - Add `readonly paseo: PaseoApi;` to `PluginServerContext`.
3. In `packages/server/src/server/plugins/plugin-process.ts`:
   - In `startPlugin`, attach `paseo` to the `PluginServerContext` object passed to `contribute(server)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/client/src/index.test.ts -t "workspace actions expose setLabel" --bail=1`
Expected: PASS

- [ ] **Step 5: Rebuild client declarations**

Run: `npm run build:client`
Expected: SUCCESS

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/index.ts packages/client/src/index.test.ts packages/plugin/src/server/contracts.ts packages/server/src/server/plugins/plugin-process.ts
git commit -m "feat(client,plugin): expose setLabel on workspace actions and attach paseo to PluginServerContext"
```

---

### Task 2: Implement `workspace-tagger.ts` in `plugin-custom/quick-prompts`

**Files:**

- Create: `plugin-custom/quick-prompts/server/workspace-tagger.ts`
- Create: `plugin-custom/quick-prompts/tests/workspace-tagger.test.ts`

**Interfaces:**

- Consumes: `PaseoApi["workspaces"]` from `@getpaseo/client`, `WorkspaceLabelDefinition` from `@getpaseo/protocol/workspace-labels`
- Produces:
  - `WORKTREE_LABEL`: `{ name: "Worktree", color: "sky" }`
  - `LOCAL_LABEL`: `{ name: "Local", color: "amber" }`
  - `resolveTargetLabel(kind: string)`: `{ target: WorkspaceLabelDefinition, opposite: WorkspaceLabelDefinition } | null`
  - `tagWorkspace(workspaceId, kind, labels, paseoWorkspaces)`: `Promise<boolean>`
  - `syncAllWorkspaces(paseoWorkspaces)`: `Promise<{ tagged: number; skipped: number }>`

- [ ] **Step 1: Write unit tests in `plugin-custom/quick-prompts/tests/workspace-tagger.test.ts`**

Cover:

1. `resolveTargetLabel`: returns `WORKTREE_LABEL` for `"worktree"`, `LOCAL_LABEL` for `"local_checkout"` and `"checkout"`, `null` for `"directory"`.
2. `tagWorkspace`:
   - Tags unlabelled worktree with `WORKTREE_LABEL`.
   - Skips if `WORKTREE_LABEL` is already present (idempotent).
   - Removes `LOCAL_LABEL` if present when tagging as `WORKTREE_LABEL` (type switch).
   - Skips non-git `"directory"`.
3. `syncAllWorkspaces`:
   - Iterates workspaces list and applies `tagWorkspace` to each.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/quick-prompts/tests/workspace-tagger.test.ts --bail=1`
Expected: FAIL with "module not found"

- [ ] **Step 3: Implement `plugin-custom/quick-prompts/server/workspace-tagger.ts`**

Write minimal implementation fulfilling all exported signatures:

```ts
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import type { PaseoWorkspaceActions } from "@getpaseo/client";

export const WORKTREE_LABEL: WorkspaceLabelDefinition = { name: "Worktree", color: "sky" };
export const LOCAL_LABEL: WorkspaceLabelDefinition = { name: "Local", color: "amber" };

export function resolveTargetLabel(kind: string) {
  if (kind === "worktree") return { target: WORKTREE_LABEL, opposite: LOCAL_LABEL };
  if (kind === "local_checkout" || kind === "checkout")
    return { target: LOCAL_LABEL, opposite: WORKTREE_LABEL };
  return null;
}

export async function tagWorkspace(
  workspaceId: string,
  kind: string,
  currentLabels: readonly (string | WorkspaceLabelDefinition)[] = [],
  workspaces: Pick<PaseoWorkspaceActions, "setLabel">,
): Promise<boolean> {
  const resolved = resolveTargetLabel(kind);
  if (!resolved) return false;

  const targetKey = workspaceLabelKey(resolved.target.name);
  const oppositeKey = workspaceLabelKey(resolved.opposite.name);
  const hasTarget = currentLabels.some(
    (l) => (typeof l === "string" ? l : l.name).toLowerCase() === targetKey,
  );
  const hasOpposite = currentLabels.some(
    (l) => (typeof l === "string" ? l : l.name).toLowerCase() === oppositeKey,
  );

  let modified = false;
  if (hasOpposite) {
    await workspaces.setLabel(workspaceId, resolved.opposite, false);
    modified = true;
  }
  if (!hasTarget) {
    await workspaces.setLabel(workspaceId, resolved.target, true);
    modified = true;
  }
  return modified;
}

export async function syncAllWorkspaces(
  workspaces: Pick<PaseoWorkspaceActions, "list" | "setLabel">,
): Promise<{ tagged: number; skipped: number }> {
  const list = await workspaces.list();
  let tagged = 0;
  let skipped = 0;
  for (const ws of list) {
    const wasTagged = await tagWorkspace(ws.id, ws.workspaceKind, ws.labels ?? [], workspaces);
    if (wasTagged) tagged++;
    else skipped++;
  }
  return { tagged, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/quick-prompts/tests/workspace-tagger.test.ts --bail=1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin-custom/quick-prompts/server/workspace-tagger.ts plugin-custom/quick-prompts/tests/workspace-tagger.test.ts
git commit -m "feat(quick-prompts): implement workspace-tagger module for worktree and local labeling"
```

---

### Task 3: Integrate Workspace Tagger into `plugin-custom/quick-prompts/index.server.ts`

**Files:**

- Modify: `plugin-custom/quick-prompts/index.server.ts`
- Test: `plugin-custom/quick-prompts/tests/server.test.ts`

**Interfaces:**

- Consumes: `tagWorkspace`, `syncAllWorkspaces` from `./server/workspace-tagger.js`, `server.addHook` and `server.paseo` from `PluginServerContext`
- Produces: Integrated startup sync and `workspace.create.after` hook on `quick-prompts` server entrypoint

- [x] **Step 1: Write integration test in `plugin-custom/quick-prompts/tests/server.test.ts`**

Assert that `contribute(server)`:

1. Calls `syncAllWorkspaces` on startup using `server.paseo`.
2. Registers a hook for `"workspace.create.after"`.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugin-custom/quick-prompts/tests/server.test.ts -t "workspace tagger" --bail=1`
Expected: FAIL

- [x] **Step 3: Update `plugin-custom/quick-prompts/index.server.ts`**

Integrate auto-tagging into `contribute`:

```ts
import { tagWorkspace, syncAllWorkspaces } from "./server/workspace-tagger.js";

// Inside contribute(server):
if (server.paseo?.workspaces) {
  void syncAllWorkspaces(server.paseo.workspaces).catch((error) => {
    console.error("[QuickPrompts] Startup workspace tagger sync failed:", error);
  });
}

const removeHook = server.addHook("workspace.create.after", async ({ workspace }, context) => {
  try {
    const handle = context.paseo.workspaces.ref(workspace.id);
    const snapshot = await handle.refresh();
    if (snapshot?.workspaceKind) {
      await tagWorkspace(
        workspace.id,
        snapshot.workspaceKind,
        snapshot.labels ?? [],
        context.paseo.workspaces,
      );
    }
  } catch (error) {
    console.error(`[QuickPrompts] Failed to auto-tag created workspace ${workspace.id}:`, error);
  }
});
```

Return `removeHook` in cleanup.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugin-custom/quick-prompts/tests/server.test.ts --bail=1`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add plugin-custom/quick-prompts/index.server.ts plugin-custom/quick-prompts/tests/server.test.ts
git commit -m "feat(quick-prompts): trigger workspace tagging on startup and workspace.create.after"
```

---

### Task 4: Revert Invasive WorkTree Icon Changes in `packages/app`

**Files:**

- Modify: `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-header-title-bar.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-screen.tsx`
- Modify: `packages/app/src/components/sidebar/sidebar-workspace-row-content.test.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-header-title-bar.test.tsx`

**Interfaces:**

- Consumes: Native Paseo upstream props
- Produces: Upstream-clean `SidebarWorkspaceRowContent` and `WorkspaceHeaderTitleBar` without hardcoded worktree icons

- [ ] **Step 1: Revert invasive changes in `sidebar-workspace-row-content.tsx`**

1. Remove `worktreeIconWrapper` and `ThemedFolderGit2` inside `workspaceTitleGroup`.
2. Remove unused `styles.worktreeIconWrapper`.
3. Restore clean `workspaceTitleRow`:

```tsx
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <Text
              style={workspaceBranchTextStyle}
              numberOfLines={1}
              testID={`sidebar-workspace-title-${workspace.workspaceKey}`}
            >
              {workspaceLabel}
            </Text>
            <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>
          </View>
          <WorkspaceMetaRow ... />
```

- [ ] **Step 2: Revert invasive changes in `workspace-header-title-bar.tsx` and `workspace-screen.tsx`**

1. In `workspace-header-title-bar.tsx`:
   - Remove `isWorktree?: boolean` from `WorkspaceHeaderTitleBarProps`.
   - Remove `headerWorktreeBadge` element and styling.
   - Restore clean `<ScreenTitle testID="workspace-header-title">{title}</ScreenTitle>`.
2. In `workspace-screen.tsx`:
   - Remove `getIsWorktree` function and `isWorktree` prop passed to `WorkspaceHeaderTitleBar`.

- [ ] **Step 3: Update test files in `packages/app`**

1. In `sidebar-workspace-row-content.test.tsx`:
   - Remove tests asserting on `sidebar-workspace-worktree-indicator`.
   - Retain standard tests asserting label rendering and status indicators.
2. In `workspace-header-title-bar.test.tsx`:
   - Remove tests asserting on `workspace-header-worktree-indicator`.
   - Retain standard title and subtitle rendering tests.

- [ ] **Step 4: Run app unit tests to verify they pass**

Run:

```bash
npx vitest run packages/app/src/components/sidebar/sidebar-workspace-row-content.test.tsx --bail=1
npx vitest run packages/app/src/screens/workspace/workspace-header-title-bar.test.tsx --bail=1
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx packages/app/src/components/sidebar/sidebar-workspace-row-content.test.tsx packages/app/src/screens/workspace/workspace-header-title-bar.tsx packages/app/src/screens/workspace/workspace-header-title-bar.test.tsx packages/app/src/screens/workspace/workspace-screen.tsx
git commit -m "refactor(app): revert invasive worktree indicator in favor of non-invasive plugin labels"
```

---

### Task 5: Monorepo Verification & Formatting

**Files:**

- Repository-wide

- [ ] **Step 1: Build client and verify cross-package declarations**

Run: `npm run build:client`
Expected: SUCCESS

- [ ] **Step 2: Run typecheck across all monorepo packages**

Run: `npm run typecheck`
Expected: SUCCESS (0 errors across packages/app, packages/server, packages/client, packages/protocol, plugin-custom)

- [ ] **Step 3: Run Biome formatting check**

Run: `npm run format`
Run: `npm run format:check`
Expected: Clean formatting with 0 errors

- [ ] **Step 4: Commit any formatting adjustments**

```bash
git add -u
git commit -m "chore: format and reconcile monorepo typecheck" || true
```
