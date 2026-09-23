# Server-Backed Hierarchical Quick Prompts Design Specification

## 1. Overview & Objectives

In Paseo, users interact with AI coding agents across multiple platforms (mobile iOS/Android, desktop Electron, and web). The original implementation stored quick prompt buttons purely in the client's local cache (`AsyncStorage` under `"paseo-quick-prompts"`). This had two fatal shortcomings:

1. **No Cross-Device Synchronization**: Custom quick prompts created on a desktop did not sync to the mobile app or browser sessions.
2. **Lack of Project Context**: Generic global buttons cluttered the bar, while project-specific repetitive tasks (e.g. `cargo test`, `pnpm lint`, `pytest`) had no dedicated scope.

This specification elevates Quick Prompts to a **Server-Backed, Two-Tier Hierarchical Configuration Architecture**:

1. **Global Quick Prompts**: Stored in Paseo Daemon (`$PASEO_HOME/quick-prompts.json`), accessible to all projects and synchronized automatically across all connected clients.
2. **Project-Level Quick Prompts**: Stored on the Daemon in `$PASEO_HOME/projects/project-quick-prompts.json` keyed by `projectId` (completely zero-touch to the user's Git repository and codebase).
3. **Inheritance & Permission Rules**:
   - **Inheritance by Default**: A project automatically inherits all global quick buttons.
   - **Project-Level Add / Delete**: Users can add new project-specific buttons and delete project-level buttons.
   - **Strict Global Read-Only Constraint**: Inside a project context, users **cannot modify or overwrite** the label or content of a global button. They may **only Disable** it for that specific project.
4. **Intuitive & Aesthetic Management UI**:
   - Tabbed segmented control: `[ Current Project ]` vs `[ Global Prompts ]`.
   - Clear scope badges (`Project` vs `Global`), explanation banners, and one-click navigation from project view to global editor.
   - Dedicated entry point in App Settings for global prompt library management.

---

## 2. Architecture & Data Model

### 2.1 Schemas in `@getpaseo/protocol`

```typescript
export type QuickPromptTriggerType = "fixed" | "rule" | "ephemeral";
export type QuickPromptAgentStatus = "idle" | "running" | "error";

export interface QuickPromptRuleCondition {
  keywords?: string[];
  regex?: string;
  agentStatuses?: QuickPromptAgentStatus[];
}

export interface QuickPromptItem {
  id: string;
  label: string;
  content: string;
  shortcut?: string;
  triggerType: QuickPromptTriggerType;
  ruleCondition?: QuickPromptRuleCondition;
  enabled: boolean;
  builtIn?: boolean;
  ephemeral?: boolean;
  createdAt: number;
  order: number;
}

export interface GlobalQuickPromptsRecord {
  version: 1;
  items: QuickPromptItem[];
}

export interface ProjectQuickPromptsRecord {
  version: 1;
  projectId: string;
  items: QuickPromptItem[]; // Project-owned custom buttons
  disabledGlobalIds: string[]; // Set of global prompt IDs disabled in this project
  order?: string[]; // Optional explicit display order
}
```

### 2.2 Server Persistence (`packages/server`)

- **Global File**: `$PASEO_HOME/quick-prompts.json`
  - Seeded on startup with sensible defaults (`Continue`, `Review`, `Fix Error`, `Run Tests`, `Proceed`) if missing.
  - Written atomically via temporary file and rename.
- **Projects File**: `$PASEO_HOME/projects/project-quick-prompts.json`
  - JSON record mapping `projectId -> ProjectQuickPromptsRecord`.
  - Stored inside Paseo Daemon directory — zero dirty git files in user repo.
  - Written atomically with temp-file rename and in-memory caching.

---

## 3. WebSocket RPC Protocol

Following Paseo RPC naming standards (`quick_prompts.<scope>.<action>.<request|response>`):

### 3.1 Global RPCs

1. **`quick_prompts.global.get.request`**:
   - Payload: `{ requestId: string }`
   - Response: `quick_prompts.global.get.response` -> `{ payload: { items: QuickPromptItem[], requestId: string } }`
2. **`quick_prompts.global.set.request`**:
   - Payload: `{ items: QuickPromptItem[], requestId: string }`
   - Response: `quick_prompts.global.set.response` -> `{ payload: { success: boolean, items: QuickPromptItem[], requestId: string } }`

### 3.2 Project RPCs

1. **`quick_prompts.project.get.request`**:
   - Payload: `{ projectId: string, requestId: string }`
   - Response: `quick_prompts.project.get.response` -> `{ payload: { projectId: string, items: QuickPromptItem[], disabledGlobalIds: string[], requestId: string } }`
2. **`quick_prompts.project.set.request`**:
   - Payload: `{ projectId: string, items: QuickPromptItem[], disabledGlobalIds: string[], order?: string[], requestId: string }`
   - Response: `quick_prompts.project.set.response` -> `{ payload: { success: boolean, projectId: string, items: QuickPromptItem[], disabledGlobalIds: string[], requestId: string } }`

### 3.3 Broadcast Notification

When global or project prompts are updated, the server broadcasts an event:

- `quick_prompts.changed` -> `{ scope: "global" }` or `{ scope: "project", projectId: string }`
  Clients listen and invalidate their TanStack Query caches, providing real-time multi-device synchronization.

---

## 4. Client Resolution & UI Design

### 4.1 Resolution Logic (`resolveEffectiveQuickPrompts`)

Pure deterministic evaluation:

1. `ephemeralOptions`: dynamic options extracted from the latest assistant turn (if any), always displayed first.
2. `projectActive`: project-specific items where `enabled === true`.
3. `globalActive`: global items where `enabled === true` and `id` is NOT in `disabledGlobalIds`.
4. Merged list is evaluated against triggers (`fixed` vs `rule` matching latest message / agent status).

### 4.2 Management Modal (`<QuickPromptsModal />`)

- **Tabs / Segmented Control**:
  - `[ Current Project ]` (only when opened in a project/workspace context).
  - `[ Global Prompts ]`.
- **Project Tab Rules**:
  - Displays Project items with full CRUD actions (edit, delete, toggle, create new).
  - Displays inherited Global items marked with a `Global` badge.
  - Global items only display a toggle switch. Content/label inputs are disabled/hidden, with a hint: _"Global item: you can disable this for the current project, or edit the master definition in the Global tab."_
- **Global Tab Rules**:
  - Full CRUD on all global items.
  - Banner: _"Changes here apply across all projects on this machine."_
  - "Reset to Defaults" button to restore built-in presets.

### 4.3 App Settings Integration

In `packages/app/src/screens/settings/editor-section.tsx`:

- Directly opens the modal in Global mode.
- Shows total count of active global prompts.

---

## 5. Implementation Phases

1. **Protocol (`@getpaseo/protocol`)**: Define schemas, messages, request/response types, and recompile declarations.
2. **Server (`@getpaseo/server`)**: Implement `QuickPromptsStore`, service layer, WebSocket session RPC handlers, and broadcast notifications.
3. **Client Store / Hooks (`@getpaseo/app`)**: Replace purely local `AsyncStorage` store with RPC-backed React Query hooks (`useQuickPrompts`), fallback caching, and sync.
4. **UI Components (`@getpaseo/app`)**:
   - Update `<QuickPromptBar />` to use resolved prompts.
   - Redesign `<QuickPromptsModal />` with segmented controls, scope indicators, disabled global toggles, and edit transitions.
   - Wire Settings section.
5. **Testing & QA**:
   - Vitest unit tests for server store & resolution logic.
   - Component tests for modal and bar.
   - Lint & typecheck verification.
