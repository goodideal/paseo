# Quick Prompts and Replies (常用语快捷回复与指令快速替换) Design Specification

## 1. Overview & Objectives

In Paseo, developers frequently interact with local coding agents using recurring instructions (e.g. "继续", "运行测试并修复报错", "进行代码审查", "确认并执行"). Typing these out repeatedly is tedious, especially on mobile devices or during rapid iterative sessions.

This feature introduces a unified **Quick Prompts and Replies Engine** with the following capabilities:

1. **Quick Reply Chips Bar (`<QuickPromptBar />`)**: Positioned directly above the composer input box, displaying horizontal scrollable chips.
2. **Short Display Label vs. Full Prompt Payload**: Chips display concise text (e.g. "修复报错"), while the actual injected/sent prompt can be comprehensive (e.g. "请根据以上错误堆栈排查原因，修复所有失败的测试并重新运行验证").
3. **Dual Action Gestures**:
   - **Single Tap (`onPress`)**: Submits and sends the full prompt immediately to the agent (zero-friction execution). Disabled when the agent is busy/cannot accept input.
   - **Long Press (`onLongPress`)**: Populates the full prompt into the composer input field and focuses it, allowing the user to review and modify before sending.
4. **Context-Aware Dynamic Rules ("根据内容自动添加")**:
   - Items can be **Fixed** (always visible) or **Rule-based** (conditionally visible).
   - Rules match against the agent's current state (e.g. `idle`, `error`) and/or keywords/regex in the latest assistant response (e.g. `FAILED`, `error`, `(y/n)`, `选项`).
5. **User-Customizable Rules & Presets**: Users can create, edit, toggle, reorder, and delete both fixed items and custom dynamic rules, seeded with sensible out-of-the-box defaults.
6. **Slash Command Autocomplete Integration**: Custom quick prompts can define an optional command shortcut (e.g. `fix` -> `/fix`), appearing in the composer's autocomplete popup alongside built-in slash commands.

---

## 2. Data Model & Storage

### 2.1 Schema Definition

Using Zod for runtime schema validation and persistence integrity:

```typescript
export type QuickPromptTriggerType = "fixed" | "rule";

export interface QuickPromptRuleCondition {
  keywords?: string[]; // Case-insensitive substring match in latest assistant message
  regex?: string; // Optional regex pattern
  agentStatuses?: ("idle" | "running" | "error")[]; // Trigger only on specific agent status
}

export interface QuickPromptItem {
  id: string;
  label: string; // Short display name (e.g. "修复测试")
  content: string; // Actual prompt sent or inserted (e.g. "请根据报错修复测试...")
  shortcut?: string; // Optional slash command alias (e.g. "fix" -> /fix)
  triggerType: QuickPromptTriggerType;
  ruleCondition?: QuickPromptRuleCondition;
  enabled: boolean;
  builtIn?: boolean; // True if provided by default presets
  createdAt: number;
  order: number;
}

export interface QuickPromptsPersistedState {
  items: QuickPromptItem[];
}
```

### 2.2 Persistence

Stored via Paseo's standard `createValidatedPersistStorage(AsyncStorage, QuickPromptsPersistedStateSchema)` within `packages/app/src/stores/quick-prompts-store.ts`.

### 2.3 Default Built-in Presets

When initialized with empty storage, the store populates the following defaults:

- **继续** (Fixed):
  - Label: `继续`
  - Content: `请继续执行下一步。`
  - Shortcut: `continue`
  - Trigger: `fixed`
- **代码审查** (Fixed):
  - Label: `代码审查`
  - Content: `请对我刚才的代码改动进行审查，检查潜在的边界条件、类型安全和性能问题。`
  - Shortcut: `review`
  - Trigger: `fixed`
- **修复报错** (Dynamic Rule):
  - Label: `修复报错`
  - Content: `请分析上述报错信息，定位根本原因并完成修复，同时重新执行验证。`
  - Shortcut: `fix`
  - Trigger: `rule`, `keywords: ["error", "exception", "failed", "failure", "报错", "失败"]`
- **运行测试** (Dynamic Rule):
  - Label: `运行测试`
  - Content: `请运行相关的单元测试并确认全部通过。`
  - Shortcut: `test`
  - Trigger: `rule`, `keywords: ["test", "vitest", "jest", "测试", "spec"]`
- **同意执行** (Dynamic Rule):
  - Label: `同意执行`
  - Content: `确认，请按照方案执行。`
  - Shortcut: `yes`
  - Trigger: `rule`, `keywords: ["(y/n)", "确认", "是否继续", "请选择", "approve", "proceed?"]`

---

## 3. Dynamic Rule Matching Engine

Pure, deterministic evaluation function in `packages/app/src/utils/quick-prompt-matcher.ts`:

```typescript
export interface EvaluateQuickPromptsInput {
  items: readonly QuickPromptItem[];
  lastAssistantMessageText?: string | null;
  agentStatus?: "idle" | "running" | "error" | null;
}

export function evaluateQuickPrompts(input: EvaluateQuickPromptsInput): QuickPromptItem[];
```

Evaluation rules:

1. Filter out items where `enabled === false`.
2. For `item.triggerType === "fixed"`, include immediately.
3. For `item.triggerType === "rule"`:
   - Check `agentStatuses`: if specified, current `agentStatus` must match.
   - Check `keywords`: if specified and non-empty, case-insensitively check if `lastAssistantMessageText` contains at least one keyword.
   - Check `regex`: if specified, test against `lastAssistantMessageText`.
   - If either keyword or regex matches (and status condition is satisfied), include.
4. Sort matching items by `order` ascending.

---

## 4. UI & Interaction Design

### 4.1 Quick Prompt Bar (`<QuickPromptBar />`)

- **Placement**: Nested inside `packages/app/src/composer/index.tsx`, right above the message input container (`styles.messageInputContainer`).
- **Visibility**: Rendered if active matched items exist OR user is in manage mode. If 0 items match, collapses without taking any vertical layout space.
- **Scroll**: Horizontal `ScrollView` with `showsHorizontalScrollIndicator={false}` and platform-friendly wheel scrolling on web.
- **Chip Appearance**:
  - Compact rounded pill (`border-radius: 9999px`), subtle themed surface background (`$surfaceMuted`), text colored `$textMuted` transitioning on hover.
  - Distinct styling/icon indicator when triggered dynamically vs fixed (or simple clean typography for minimalism).
- **Trailing Action**:
  - A small trailing `+` or icon button at the end of the chip row to quickly open the Quick Prompts Manager sheet/modal.

### 4.2 Gestures & Handlers

- **`onPress` (Short Tap)**:
  - If `isSubmitDisabled` is true (e.g. agent is currently generating or disconnected), trigger haptic/feedback or no-op.
  - Otherwise, directly invokes `onSubmit(item.content)`.
- **`onLongPress` (Hold / Long Tap)**:
  - Triggers `onSelectForEdit(item.content)`:
    - Sets composer input text to `item.content` (or appends if text exists).
    - Focuses the `MessageInput`.
  - Configured with `delayLongPress={350}` for responsive feel.
  - On web/desktop, a hover tooltip displays: `"单击直接发送，长按填入编辑框"`.

### 4.3 Management Modal & Settings (`<QuickPromptsModal />`)

- **Features**:
  - List of all prompts (Fixed and Rule-based).
  - Quick toggle switch (Enable/Disable).
  - Edit existing item (Label, Content, Shortcut, Trigger Type, Keywords/Regex).
  - Add new item.
  - Reset to default presets.
- **Accessibility**: Accessible via the `+` button in the quick prompt bar and in the App Settings section under `Quick Prompts & Commands` (常用语与快捷指令).

---

## 5. Slash Command Autocomplete Integration

Extend `packages/app/src/hooks/use-agent-autocomplete.ts`:

- In addition to built-in client commands (`/exit`, `/clear`), plugin commands, and provider commands, include enabled custom quick prompts with shortcuts or names.
- When the user types `/`, these custom prompts appear in the autocomplete dropdown with kind `"custom_prompt"`.
- Selecting an item replaces the slash query with `item.content`, ready for submission.

---

## 6. Testing Strategy

1. **Unit Tests**:
   - `quick-prompt-matcher.test.ts`: Test keyword matching, regex matching, agent status matching, ordering, and disabled item filtering.
   - `quick-prompts-store.test.ts`: Test CRUD operations, reordering, enabling/disabling, storage hydration and fallback to default presets.
   - `slash-command-integration.test.ts`: Verify custom quick prompts appear in command autocomplete options.
2. **Component Tests**:
   - `quick-prompt-bar.test.tsx`: Test render, horizontal scroll, `onPress` dispatching immediate send, and `onLongPress` calling edit handler.
3. **End-to-End Verification**:
   - Typecheck (`npm run typecheck`).
   - Lint (`npm run lint`).
   - Format (`npm run format`).
