# Design: Truly Non-Invasive Worktree / Local Header Indicator via Quick-Prompts Plugin

## 1. Intent and The Why

Previously, Paseo was customized via invasive modifications in `packages/app`:

- Direct insertion of a `<ThemedFolderGit2 />` icon into `SidebarWorkspaceRowContent` and `WorkspaceHeaderTitleBar`.
- Invasive unit test suites asserting DOM structure of these hardcoded icons.

Whenever the local branch rebases or merges upstream Paseo releases (e.g. v0.15.0+), these core UI files and tests are prone to merge conflicts and maintenance overhead.

To achieve a **strictly non-invasive** solution:

1. **Zero changes to Paseo core packages** (`packages/client`, `packages/plugin`, `packages/server`, `packages/protocol`).
2. **Zero data pollution** (no automated writing of fake/system labels to `workspaces.json` or `workspace-labels.json`).
3. **Purely implemented within the `quick-prompts` plugin** using Paseo's official Plugin Client API (`client.addHeaderButton`).

---

## 2. Architecture & Design

### 2.1 Workspace Header Indicator (`plugin-custom/quick-prompts/index.client.tsx`)

Paseo's plugin SDK officially provides `client.addHeaderButton`, which renders inside `PluginHeaderButtons` right in the workspace header bar (on desktop toolbar and mobile action menu).

1. The plugin observes workspaces via `client.paseo.workspaces.list({ subscribe: {} })`.
2. For each workspace:
   - If `workspaceKind === "worktree"`:
     - Button Title: `"Git Worktree"`
     - Button Label: `"Worktree"`
     - Icon: `"FolderGit2"` (Lucide icon resolved natively by Paseo)
     - Behavior: Popover displaying branch, project name, worktree directory, and isolation status.
   - If `workspaceKind === "local_checkout" || workspaceKind === "checkout"`:
     - Button Title: `"Local Checkout"`
     - Button Label: `"Local"`
     - Icon: `"Monitor"` (Lucide icon resolved natively by Paseo)
     - Behavior: Popover displaying branch, project name, local repository directory.
   - If `workspaceKind === "directory"`:
     - Omitted (untagged).
3. Dynamic lifecycle:
   - When a workspace is created or updated (`workspace_update` upsert), the button is automatically registered/updated.
   - When a workspace is deleted (`workspace_update` remove), the button is cleanly removed.
   - On plugin teardown, all buttons are removed cleanly.

### 2.2 Reversion of Invasive Core Code

- `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`: Restored to pure upstream layout (no hardcoded icons).
- `packages/app/src/screens/workspace/workspace-header-title-bar.tsx`: Restored to pure upstream layout.
- `packages/app/src/screens/workspace/workspace-screen.tsx`: Restored to pure upstream layout.
- `packages/client`, `packages/plugin`, `packages/server`: 100% untouched.

---

## 3. Verification

- 51 unit tests in `plugin-custom/quick-prompts/tests/` passing.
- 6 unit tests in `packages/app` passing.
- Monorepo typecheck 0 errors.
