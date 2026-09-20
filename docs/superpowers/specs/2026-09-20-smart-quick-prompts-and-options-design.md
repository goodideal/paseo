# Smart Quick Prompts and Dynamic Options Design Specification

## 1. Overview & Objectives

In Paseo, coding agents frequently end their responses with multiple choices (e.g. _"1. Refactor with WebSocket ... 2. Keep polling with debounce ..."_) or binary confirmation requests (_"(y/n)"_). In the current Quick Prompts engine, users must manually type their choice or write a custom rule in advance.

This specification enhances the Quick Prompts engine with **Intelligent Dynamic Option Generation & Multi-Tier Next-Step Suggestions**:

1. **Local Heuristic Option Extractor (Layer 1 - Deterministic, 0ms, Zero Token Cost)**:
   - Client-side parser that inspects the latest Assistant message when the agent is `idle`.
   - Automatically extracts numbered/lettered options (e.g., `1. ... 2. ... 3. ...`, `(A) ... (B) ...`) and binary prompts (`(y/n)`).
   - Generates ultra-compact chip labels (`[Option 1]` or `[1. Keyword]`), keeping buttons clean while delegating details to the message body.
   - Synthesizes robust, unambiguous prompt payloads (e.g. `"I choose Option 1 (<Keyword>). Please proceed."`).
   - Ephemeral lifecycle: chips exist only for the current assistant turn and disappear when the user replies or when agent state changes.
2. **AI Next-Step Suggestions (Layer 2 - Optional, User-Gated)**:
   - Gated behind a user setting (`settings.editor.aiQuickPromptSuggestions`, default: `false`).
   - When enabled and Layer 1 yields no explicit options, queries lightweight model inference to propose 2-3 contextual next actions.
   - When disabled (default), only Layer 1 and static/rule-based prompts are displayed, preserving zero-token and zero-latency performance.
3. **Seamless Composer & Edit-Mode Integration**:
   - Single-tap: Sends the explicit choice payload directly to the agent.
   - Long-press / Right-click: Injects the choice payload into the composer text input and focuses at the end, allowing the user to append custom modifications without retyping.

---

## 2. Architecture & Data Model

### 2.1 Ephemeral Quick Prompt Item

Extend `QuickPromptItem` schema with ephemeral provenance:

```typescript
export type QuickPromptTriggerType = "fixed" | "rule" | "ephemeral";

export interface QuickPromptItem {
  id: string;
  label: string; // Ultra-compact display (e.g., "Option 1" or "1. WebSocket")
  content: string; // Full prompt payload sent or inserted into composer
  shortcut?: string; // Optional command alias
  triggerType: QuickPromptTriggerType;
  ruleCondition?: QuickPromptRuleCondition;
  enabled: boolean;
  builtIn?: boolean;
  ephemeral?: boolean; // True for turn-bound, non-persisted dynamic options
  createdAt: number;
  order: number;
}
```

### 2.2 Layer 1: Heuristic Parser Engine (`packages/app/src/utils/ephemeral-option-extractor.ts`)

Pure, deterministic evaluation pipeline:

```typescript
export interface ExtractedOption {
  index: number | string; // 1, 2, 'A', 'B'
  conciseLabel: string; // e.g. "1. WebSocket" or "Option 1"
  summary: string; // Key title or first sentence
  fullPayload: string; // Formatted prompt payload
}

export function extractEphemeralOptions(
  assistantText: string,
  locale: string = "en",
): QuickPromptItem[];
```

#### Extraction Rules:

1. **Option Recognition**:
   - Matches ordered lists near the end of the assistant response:
     - Numbered: `(?:^|\n)\s*(?:[1-9]\.|\([1-9]\))\s+(.+?)(?=\n|$)`
     - Lettered: `(?:^|\n)\s*(?:[A-D]\.|\([A-D]\))\s+(.+?)(?=\n|$)`
   - Presence of choice trigger context (e.g. `which option`, `do you prefer`, `请选择`, `方案 1`, `choose one`).
2. **Label Shortening & Extraction**:
   - First checks for bold title: `1. **WebSocket Refactor**: ...` -> keyword: `WebSocket` (or up to 6-8 chars).
   - Checks before colon/dash: `1. WebSocket - use native sockets` -> keyword: `WebSocket`.
   - If keyword length <= 10 chars: label is `[1. <Keyword>]`.
   - Otherwise, falls back to localized compact label: `[Option 1]` (en) / `[选项 1]` (zh).
3. **Payload Formatting**:
   - English: `"I choose Option 1 (<Summary>). Please proceed."`
   - Chinese: `"我选择方案 1（<Summary>），请继续执行。"`
4. **Binary Confirmation Recognition**:
   - Matches `(y/n)`, `[y/n]`, `proceed?`, `是否继续`, `确认执行`.
   - Generates:
     - `[Yes]`: `"Yes, please proceed."`
     - `[No]`: `"No, please cancel or abort this operation."`

---

### 2.3 Layer 2: AI Next-Step Suggestions Settings

Added to App Settings store (`packages/app/src/hooks/use-settings/`):

```typescript
export interface AppSettings {
  // ... existing fields
  aiQuickPromptSuggestions: boolean; // default: false
}
```

UI in `packages/app/src/screens/settings/editor-section.tsx`:

- Toggle: `settings.editor.aiSuggestions.title` ("Suggest quick replies with AI" / "智能预测快捷回复")
- Description: `settings.editor.aiSuggestions.description` ("When no explicit options exist, use AI to suggest next actions.")

---

## 3. UI & Interaction Design

### 3.1 Quick Prompt Bar Layout

In `<QuickPromptBar />`:

1. **Ordering**:
   - `ephemeral` options appear **first** in the horizontal chip list.
   - Next: matched `rule` items (e.g. `Fix Error`, `Run Tests`).
   - Next: `fixed` items (e.g. `Continue`, `Review`).
2. **Styling**:
   - Ephemeral option chips feature an accent border and mini indicator icon (e.g. `Sparkles` or distinct number badge).
3. **Gestures**:
   - `onPress`: Sends the synthesized `item.content` immediately.
   - `onLongPress` (mobile touch) / `onContextMenu` (web/desktop right-click):
     - Injects `item.content` into composer via `replaceUserInput(content, { start: content.length, end: content.length })`.
     - Appends a trailing space so user can type additional context immediately.
     - Automatically focuses the composer.

---

## 4. Test Strategy

1. **Unit Tests (`ephemeral-option-extractor.test.ts`)**:
   - Numbered Markdown lists (`1.`, `2.`, `3.`) with bold titles.
   - Numbered Markdown lists with plain text (length threshold fallback).
   - Lettered choices (`(A)`, `(B)`, `(C)`).
   - Binary questions (`(y/n)`).
   - Non-choice assistant messages (ensures no false positives).
   - Multilingual payload formatting (English and Chinese).
2. **Integration Tests (`composer/quick-prompts/bar.test.tsx`)**:
   - Verifies ephemeral chips render before fixed chips.
   - Verifies click and long-press behavior.
3. **Settings Tests**:
   - Persistence and toggle of `aiQuickPromptSuggestions`.
4. **End-to-End Typecheck & Lint**:
   - `npm run typecheck`
   - `npm run lint`
   - `npm run format:check`
