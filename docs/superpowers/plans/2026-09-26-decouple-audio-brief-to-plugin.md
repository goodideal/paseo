# Audio Brief Standalone Plugin Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Audio Brief into a standalone standard Paseo plugin package (`plugin-examples/audio-brief`) and completely remove custom audio brief service, protocol schemas, and fallback components from Paseo core.

**Architecture:** Standalone plugin architecture using `@getpaseo/plugin`'s `defineRpc` for `audio_brief.synthesize.request` handled by the plugin server subprocess, and `client.addTurnAction` for contributing `button` and `card` components to the assistant turn footer. Core `<PluginTurnActions />` becomes a 100% pure plugin slot container rendering `null` when no plugin is installed.

**Tech Stack:** TypeScript, React Native / Expo, `@getpaseo/plugin`, Node.js, Vitest, Zod, Biome.

**Spec:** `openspec/changes/decouple-audio-brief-to-plugin/proposal.md`, `openspec/changes/decouple-audio-brief-to-plugin/design.md`, `openspec/changes/decouple-audio-brief-to-plugin/specs/`

## Global Constraints

- Never restart the main Paseo daemon on port 6767 without permission.
- Always run typecheck and lint after changes.
- Build workspace packages (`npm run build:server`, `npm run build:client`) before diagnosing cross-package type errors.
- Always use npm scripts for linting and formatting (`npm run format:files -- ...`).
- Prefix all shell commands with `rtk`.

---

### Task 1: Standalone Plugin Scaffolding & Shared RPC Contract

**Files:**

- Create: `plugin-examples/audio-brief/paseo-plugin.json`
- Create: `plugin-examples/audio-brief/package.json`
- Create: `plugin-examples/audio-brief/tsconfig.json`
- Create: `plugin-examples/audio-brief/shared/contracts.ts`
- Create: `plugin-examples/audio-brief/shared/types.ts`
- Test: `plugin-examples/audio-brief/tests/contracts.test.ts`

**Interfaces:**

- Produces: `audioBriefSynthesizeRpc` with input `{ agentId: string, turnId: string, text: string, customPrompt?: string, forceRefresh?: boolean }` and output `{ briefText: string, audioBase64?: string, mimeType?: string, durationMs?: number, error?: string | null }`.

- [ ] **Step 1: Write the failing test for RPC contract validation**

```typescript
import { describe, it, expect } from "vitest";
import { audioBriefSynthesizeRpc } from "../shared/contracts";

describe("audioBriefSynthesizeRpc", () => {
  it("validates valid input payload", () => {
    const input = {
      agentId: "agent-1",
      turnId: "turn-1",
      text: "Completed refactoring task.",
      customPrompt: "Keep it under 30 words.",
      forceRefresh: true,
    };
    expect(audioBriefSynthesizeRpc.input.parse(input)).toEqual(input);
  });

  it("validates valid output payload", () => {
    const output = {
      briefText: "Summary of completed task.",
      audioBase64: "dGVzdA==",
      mimeType: "audio/wav",
      durationMs: 120,
      error: null,
    };
    expect(audioBriefSynthesizeRpc.output.parse(output)).toEqual(output);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run plugin-examples/audio-brief/tests/contracts.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement plugin config, package files, and shared RPC contracts**

Create `plugin-examples/audio-brief/paseo-plugin.json`:

```json
{
  "id": "audio-brief",
  "name": "Audio Brief",
  "description": "Intelligent audio summaries and voice player for assistant message turns",
  "requirements": {
    "paseo": ">=0.9.1-custom"
  }
}
```

Create `plugin-examples/audio-brief/package.json`:

```json
{
  "name": "@paseo-plugin/audio-brief",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@getpaseo/plugin": "*",
    "typescript": "^5.0.0",
    "zod": "^3.23.8"
  }
}
```

Create `plugin-examples/audio-brief/shared/contracts.ts`:

```typescript
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const audioBriefSynthesizeRpc = defineRpc({
  name: "audio_brief.synthesize.request",
  input: z.object({
    agentId: z.string(),
    turnId: z.string(),
    text: z.string(),
    customPrompt: z.string().optional(),
    forceRefresh: z.boolean().optional(),
  }),
  output: z.object({
    briefText: z.string(),
    audioBase64: z.string().optional(),
    mimeType: z.string().optional(),
    durationMs: z.number().optional(),
    error: z.string().nullable().optional(),
  }),
});

export type AudioBriefSynthesizeInput = z.infer<typeof audioBriefSynthesizeRpc.input>;
export type AudioBriefSynthesizeOutput = z.infer<typeof audioBriefSynthesizeRpc.output>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run plugin-examples/audio-brief/tests/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-examples/audio-brief/
rtk git commit -m "feat(audio-brief): scaffold standalone plugin package and shared rpc contract"
```

---

### Task 2: Standalone Plugin Server Implementation

**Files:**

- Create: `plugin-examples/audio-brief/server/audio-brief-service.ts`
- Create: `plugin-examples/audio-brief/index.server.ts`
- Test: `plugin-examples/audio-brief/tests/service.test.ts`

**Interfaces:**

- Consumes: `audioBriefSynthesizeRpc` from `../shared/contracts`
- Produces: `contribute(server: PluginServerContext)` handler registering `audio_brief.synthesize.request`

- [ ] **Step 1: Write test for server AudioBriefService**

````typescript
import { describe, it, expect } from "vitest";
import { extractFallbackBrief, AudioBriefService } from "../server/audio-brief-service";

describe("AudioBriefService", () => {
  it("extracts markdown fallback cleanly", () => {
    const md = "### Result\n\n```ts\nconsole.log(1);\n```\nAll unit tests passed successfully.";
    const result = extractFallbackBrief(md);
    expect(result).toContain("All unit tests passed successfully.");
    expect(result).not.toContain("```");
  });

  it("synthesizes brief using service", async () => {
    const service = new AudioBriefService();
    const result = await service.synthesizeBrief({
      agentId: "agent-1",
      turnId: "turn-1",
      text: "The implementation has been verified and all tests pass.",
    });
    expect(result.briefText).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run plugin-examples/audio-brief/tests/service.test.ts`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement AudioBriefService and index.server.ts**

Port `AudioBriefService` into `plugin-examples/audio-brief/server/audio-brief-service.ts` including `extractFallbackBrief`, SHA-256 prompt hashing, and safe fallback.
Implement `plugin-examples/audio-brief/index.server.ts`:

```typescript
import type { PluginServerContext } from "@getpaseo/plugin";
import { audioBriefSynthesizeRpc } from "./shared/contracts.js";
import { AudioBriefService } from "./server/audio-brief-service.js";

export default function contribute(server: PluginServerContext) {
  const service = new AudioBriefService();

  server.handle(audioBriefSynthesizeRpc, async (input) => {
    return service.synthesizeBrief({
      agentId: input.agentId,
      turnId: input.turnId,
      text: input.text,
      customPrompt: input.customPrompt,
      forceRefresh: input.forceRefresh,
    });
  });

  return () => {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run plugin-examples/audio-brief/tests/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-examples/audio-brief/server plugin-examples/audio-brief/index.server.ts plugin-examples/audio-brief/tests/service.test.ts
rtk git commit -m "feat(audio-brief): implement standalone server service and rpc handler"
```

---

### Task 3: Standalone Plugin Client Turn Action Implementation

**Files:**

- Create: `plugin-examples/audio-brief/client/turn-audio-brief-button.tsx`
- Create: `plugin-examples/audio-brief/client/audio-brief-card.tsx`
- Create: `plugin-examples/audio-brief/client/audio-brief-store.ts`
- Create: `plugin-examples/audio-brief/index.client.tsx`
- Test: `plugin-examples/audio-brief/tests/client.test.tsx`

**Interfaces:**

- Consumes: `useTurnState` from `@getpaseo/plugin/client`, `audioBriefSynthesizeRpc` from `../shared/contracts`
- Produces: `contribute(client: PluginClientContext)` registering `button` (id: `audio-brief-button`) and `card` (id: `audio-brief-card`)

- [ ] **Step 1: Write test for client registration**

```tsx
import { describe, it, expect, vi } from "vitest";
import contribute from "../index.client";
import type { PluginClientContext } from "@getpaseo/plugin/client";

describe("Audio Brief client contribute", () => {
  it("registers both button and card turn actions", () => {
    const turnActions: unknown[] = [];
    const client: Partial<PluginClientContext> = {
      addTurnAction: vi.fn((action) => {
        turnActions.push(action);
        return () => {};
      }),
    };

    contribute(client as PluginClientContext);
    expect(client.addTurnAction).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npx vitest run plugin-examples/audio-brief/tests/client.test.tsx`
Expected: FAIL (cannot find module)

- [ ] **Step 3: Implement client components and registration**

Implement `plugin-examples/audio-brief/client/audio-brief-store.ts` with local caching and play states.
Implement `plugin-examples/audio-brief/client/turn-audio-brief-button.tsx` using `useTurnState()`.
Implement `plugin-examples/audio-brief/client/audio-brief-card.tsx`.
Implement `plugin-examples/audio-brief/index.client.tsx`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TurnAudioBriefButton } from "./client/turn-audio-brief-button";
import { AudioBriefCard } from "./client/audio-brief-card";

export default function contribute(client: PluginClientContext) {
  client.addTurnAction({
    id: "audio-brief-button",
    type: "button",
    order: 10,
    Component: TurnAudioBriefButton,
  });

  client.addTurnAction({
    id: "audio-brief-card",
    type: "card",
    order: 10,
    Component: AudioBriefCard,
  });

  return () => {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run plugin-examples/audio-brief/tests/client.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin-examples/audio-brief/client plugin-examples/audio-brief/index.client.tsx plugin-examples/audio-brief/tests/client.test.tsx
rtk git commit -m "feat(audio-brief): implement standalone client components and turn action registration"
```

---

### Task 4: Core Turn Actions Container Purification

**Files:**

- Modify: `packages/app/src/plugins/turn-actions/view.tsx`
- Delete: `packages/app/src/components/turn-audio-brief-button.tsx`
- Delete: `packages/app/src/components/turn-audio-brief-button.test.tsx`
- Delete: `packages/app/src/audio-brief/`
- Test: `packages/app/src/plugins/turn-actions/view.test.tsx`

**Interfaces:**

- Produces: `<PluginTurnActions />` returns `null` when no plugins are registered.

- [ ] **Step 1: Write test asserting pure null rendering when no plugins registered**

Update `packages/app/src/plugins/turn-actions/view.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react-native";
import { PluginTurnActions } from "./view";

describe("PluginTurnActions purity", () => {
  it("renders null when no plugins registered for slot", () => {
    const { toJSON } = render(
      <PluginTurnActions
        turnId="turn-1"
        agentId="agent-1"
        type="button"
        getContent={() => "test text"}
      />,
    );
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails if fallback exists**

Run: `rtk npx vitest run packages/app/src/plugins/turn-actions/view.test.tsx`

- [ ] **Step 3: Clean up packages/app/src/plugins/turn-actions/view.tsx and delete old audio-brief files**

In `packages/app/src/plugins/turn-actions/view.tsx`:
Remove import of `AudioBriefCard, TurnAudioBriefButton`.
Replace fallback with:

```tsx
return null;
```

Delete:
`packages/app/src/components/turn-audio-brief-button.tsx`
`packages/app/src/components/turn-audio-brief-button.test.tsx`
`packages/app/src/audio-brief/`

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npx vitest run packages/app/src/plugins/turn-actions/view.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add packages/app/src/plugins/turn-actions/view.tsx
rtk git rm packages/app/src/components/turn-audio-brief-button.tsx packages/app/src/components/turn-audio-brief-button.test.tsx
rtk git rm -r packages/app/src/audio-brief/
rtk git commit -m "refactor(app): purify PluginTurnActions container and remove in-core audio-brief files"
```

---

### Task 5: Core Server & Protocol Cleanup

**Files:**

- Modify: `packages/protocol/src/messages.ts`
- Delete: `packages/protocol/src/audio-brief.ts`
- Modify: `packages/client/src/daemon-client.ts`
- Modify: `packages/server/src/server/session.ts`
- Modify: `packages/server/src/server/authorization/operation-permissions.ts`
- Delete: `packages/server/src/server/agent/audio-brief-service.ts`
- Delete: `packages/server/src/server/agent/audio-brief-service.test.ts`

- [ ] **Step 1: Clean protocol messages and delete audio-brief protocol**

In `packages/protocol/src/messages.ts`:
Remove `AgentMessageSynthesizeBriefRequestSchema` and `AgentMessageSynthesizeBriefResponseSchema`.
Remove their occurrences in `SessionInboundMessageSchema`, `SessionOutboundMessageSchema`, and export types.
Remove `packages/protocol/src/audio-brief.ts`.

- [ ] **Step 2: Clean client SDK**

In `packages/client/src/daemon-client.ts`:
Remove `synthesizeAgentMessageBrief` method.

- [ ] **Step 3: Clean server session and permissions**

In `packages/server/src/server/session.ts`:
Remove `audioBriefService` field, import, options, constructor instantiation, and `handleAgentMessageSynthesizeBriefRequest`.
In `packages/server/src/server/authorization/operation-permissions.ts`:
Remove `"agent.message.synthesize_brief.request"` and `"agent.message.synthesize_brief.response"`.
Delete `packages/server/src/server/agent/audio-brief-service.ts` and `audio-brief-service.test.ts`.

- [ ] **Step 4: Rebuild workspace packages**

Run: `rtk npm run build:server && rtk npm run build:client`
Expected: Build passes with new declaration outputs.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/protocol/ packages/client/ packages/server/
rtk git commit -m "refactor(core): remove legacy audio-brief protocol schemas, client methods, and server handlers"
```

---

### Task 6: Full Verification, Formatting, & OpenSpec Task Sync

**Files:**

- Modify: `openspec/changes/decouple-audio-brief-to-plugin/tasks.md`

- [ ] **Step 1: Run typecheck across all workspaces**

Run: `rtk npm run typecheck`
Expected: 0 errors across all 11 packages.

- [ ] **Step 2: Run linter across all workspaces**

Run: `rtk npm run lint`
Expected: 0 lint errors.

- [ ] **Step 3: Run targeted unit tests**

Run: `rtk npx vitest run packages/app/src/plugins/evaluate.test.ts plugin-examples/audio-brief/tests/contracts.test.ts`
Expected: PASS

- [ ] **Step 4: Mark all tasks completed in OpenSpec**

Update `openspec/changes/decouple-audio-brief-to-plugin/tasks.md` with checked boxes `[x]`.

- [ ] **Step 5: Commit and validate**

```bash
rtk npm run format
rtk git add .
rtk git commit -m "chore: complete audio-brief decoupling to standalone plugin and verify zero core regressions"
rtk openspec validate --strict decouple-audio-brief-to-plugin
```
