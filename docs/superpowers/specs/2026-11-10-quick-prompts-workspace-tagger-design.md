# Design: Non-Invasive Worktree / Local Tagging via Quick-Prompts Plugin

## 1. Intent and The Why

Previously, Paseo was customized via invasive modifications in `packages/app`:

- Direct insertion of a `<ThemedFolderGit2 />` icon into `SidebarWorkspaceRowContent` and `WorkspaceHeaderTitleBar`.
- Invasive unit test suites asserting DOM structure of these hardcoded icons.

Whenever the local branch rebases or merges upstream Paseo releases (e.g. v0.15.0+), these core UI files and tests are prone to merge conflicts and maintenance overhead.

With the introduction of Paseo's first-class **Workspace Labels** system (`@getpaseo/protocol/workspace-labels`), Paseo natively renders colored label chips (`WorkspaceLabelChip`) in every workspace's metadata row (`WorkspaceMetaRow`) in the sidebar, and supports filtering workspaces by label.

This design transitions the Worktree / Local visual indicator to a completely non-invasive, plugin-driven model implemented within the `quick-prompts` (quick button) plugin.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals

1. **Zero invasive modifications in `packages/app`**: Revert all invasive worktree icon markup and corresponding test assertions in `packages/app`.
2. **Automated Label Tagging in `quick-prompts` plugin**:
   - Git Worktree workspaces (`workspaceKind === "worktree"`) receive the label `{ name: "Worktree", color: "sky" }`.
   - Git Local checkout workspaces (`workspaceKind === "local_checkout" || workspaceKind === "checkout"`) receive the label `{ name: "Local", color: "amber" }`.
   - Non-git directory workspaces remain untagged.
3. **Full Lifecycle Coverage**:
   - **Startup sync**: When the plugin starts, scan existing workspaces via `paseo.workspaces.list()` and backfill missing Worktree/Local labels.
   - **Event-driven**: On `workspace.create.after`, fetch the created workspace's descriptor via `paseo.workspaces.ref(workspace.id).refresh()` and automatically assign the corresponding label.
4. **Clean SDK Ergonomics**:
   - Expose `setLabel` on `PaseoWorkspaceHandle` and `PaseoWorkspaceActions` in `@getpaseo/client` so that plugins can assign labels using standard Paseo SDK APIs.
   - Expose `paseo: PaseoApi` on `PluginServerContext` so server plugins have direct access to daemon APIs at activation time for background tasks like startup sync.
5. **Full Test & Lint Green**: All affected test suites pass, TypeScript typechecks across the monorepo, and formatting conforms to Biome.

### Non-Goals

- Adding custom React component decorators inside sidebar workspace rows (not supported by Paseo plugin SDK).
- Changing the visual geometry or styling of Paseo's native `WorkspaceLabelChip`.
- Tagging non-git directories.

### Anti-Goals

- Modifying `packages/server` persistence files directly without going through the `WorkspaceLabelService` / RPCs.
- Writing redundant labels repeatedly if the label is already present.

---

## 3. Architecture & Detailed Design

### 3.1 SDK & Server Plugin Runtime Layer

1. **`@getpaseo/client` (`packages/client/src/index.ts`)**:
   - Add to `PaseoWorkspaceHandle`:
     `setLabel(label: WorkspaceLabelDefinition, assigned?: boolean): Promise<WorkspaceLabelAssignmentPayload>`
   - Add to `PaseoWorkspaceActions`:
     `setLabel(workspaceId: string, label: WorkspaceLabelDefinition, assigned?: boolean): Promise<WorkspaceLabelAssignmentPayload>`
     `listLabels(): Promise<WorkspaceLabelListPayload>`
2. **`@getpaseo/plugin` & Server Process**:
   - In `packages/plugin/src/server/contracts.ts`: Add `readonly paseo: PaseoApi` to `PluginServerContext`.
   - In `packages/server/src/server/plugins/plugin-process.ts`: Inject `paseo: PaseoApi` into the `PluginServerContext` object provided to `contribute(server)`.

### 3.2 Server Plugin Layer (`plugin-custom/quick-prompts/`)

Create `plugin-custom/quick-prompts/server/workspace-tagger.ts`:

1. **Label Definitions**:
   ```ts
   export const WORKTREE_LABEL: WorkspaceLabelDefinition = { name: "Worktree", color: "sky" };
   export const LOCAL_LABEL: WorkspaceLabelDefinition = { name: "Local", color: "amber" };
   ```
2. **Tagging Logic**:
   - For a workspace with `workspaceKind`:
     - If `workspaceKind === "worktree"`: target is `WORKTREE_LABEL`, conflict to remove is `LOCAL_LABEL`.
     - If `workspaceKind === "local_checkout" || workspaceKind === "checkout"`: target is `LOCAL_LABEL`, conflict to remove is `WORKTREE_LABEL`.
     - Otherwise: no tag.
   - If target label not in `workspace.labels`: call `paseo.workspaces.setLabel(workspace.id, target, true)`.
3. **Activation & Lifecycle Hooks**:
   - In `plugin-custom/quick-prompts/index.server.ts`:
     - Startup: asynchronously run `syncAllWorkspaces(server.paseo)`.
     - Hook: `server.addHook("workspace.create.after", async ({ workspace }, context) => { ... })`.

### 3.3 App Clean-up (`packages/app`)

Revert all previous invasive modifications:

1. `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`:
   - Remove `worktreeIconWrapper` and `ThemedFolderGit2` inside `workspaceTitleGroup`.
   - Revert `workspaceTitleGroup` to standard title styling.
2. `packages/app/src/screens/workspace/workspace-header-title-bar.tsx`:
   - Remove `headerWorktreeBadge` and `ThemedFolderGit2`.
3. `packages/app/src/screens/workspace/workspace-screen.tsx`:
   - Remove `isWorktree` prop propagation to `WorkspaceHeaderTitleBar`.
4. Tests:
   - Clean up `sidebar-workspace-row-content.test.tsx` and `workspace-header-title-bar.test.tsx` to remove assertions on the hardcoded worktree icon elements.

---

## 4. Verification Plan

1. **Unit Tests**:
   - New test suite: `plugin-custom/quick-prompts/tests/workspace-tagger.test.ts`
   - Re-run app tests:
     - `npx vitest run packages/app/src/components/sidebar/sidebar-workspace-row-content.test.tsx --bail=1`
     - `npx vitest run packages/app/src/screens/workspace/workspace-header-title-bar.test.tsx --bail=1`
   - Re-run client SDK tests:
     - `npx vitest run packages/client/src/index.test.ts --bail=1`
2. **Typecheck & Monorepo Validation**:
   - `npm run build:client`
   - `npm run typecheck`
   - `npm run format:check`
