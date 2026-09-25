# Audio Brief Prompt Customization & Adaptive Summarization Design Specification

## 1. Overview & Problem Statement

Paseo's **Audio Brief** feature converts coding assistant messages into spoken executive summaries via Text-to-Speech (TTS) and displays a companion summary card in the chat timeline.

### 1.1 Current Limitations

1. **Rigid Length & Tone Constraints**:
   The current implementation hardcodes a strict rule: `"In 1 to 2 spoken sentences: under 60 words total"`, paired with a Zod schema restriction of `max(300)` characters.
2. **Loss of Explanatory Depth**:
   When an agent outputs multiple architecture proposals, trade-off comparisons, or technical alternatives, the rigid limit compresses the output into a generic sentence (e.g. _"I proposed three options. Please decide."_), rendering the audio brief useless for auditory decision-making.
3. **Lack of User Personalization**:
   Developers cannot adjust the briefing style, focus area (e.g., performance impact, security risks), tone (e.g., concise, butler/Jarvis, conversational), or language preference (e.g., forcing Chinese speech even when agent code output is English).

### 1.2 Core Objectives

- **Content-Adaptive Summarization**: The built-in prompt automatically detects message types:
  - **Proposals & Architecture Options**: Explains options, trade-offs, and recommendations clearly so the developer can make decisions by ear alone (~80–200 words).
  - **Actions, Execution & Verification**: Keeps status updates and standard approvals punchy and concise (1–2 sentences, under 60 words).
- **Wholesale Prompt Customization**: Users can provide custom instructions that completely replace the default briefing guidelines while preserving the JSON contract envelope.
- **Dual-Tier Configuration**:
  - **Project-Level** (`paseo.json`): Shared with repository collaborators, taking highest precedence.
  - **Host-Level** (Daemon Settings): Global preference for all workspaces on a machine.
- **Prompt-Aware Cache Invalidation**: Audio and text caches incorporate the prompt's cryptographic hash, ensuring immediate cache invalidation when prompts change.
- **Template Assistance in Settings**: A "Load Default Template" action in both Host and Project settings lets developers inspect, copy, and modify the system prompt.

---

## 2. Prompt Architecture & Rules

### 2.1 Built-in Default Adaptive Prompt

```text
You are an executive technical briefer converting coding assistant messages into spoken audio for the developer.

Analyze the assistant's message and adapt the briefing strategy based on content type:

1. ARCHITECTURAL / PROPOSAL / COMPARISON (Multiple options, trade-offs, design choices):
   - First, state the problem or goal in one clear spoken sentence.
   - Then, explain each option's core approach and key trade-off in plain conversational speech. Do not skip options.
   - Mention the recommended option and why.
   - End with the specific choice or decision needed from the developer.
   - Target length: Thorough but spoken-friendly (typically 80-200 words, ~30-60 seconds when read aloud).

2. ACTION / EXECUTION / CONFIRMATION (Task updates, bug fixes, test runs, approval requests):
   - In 1 to 2 concise spoken sentences: state the key outcome (what was done or fixed), status of checks/tests, and what decision or next step is needed.
   - Target length: Brief and punchy (under 60 words, ~10-15 seconds).

Spoken Speech Rules:
- NEVER read code syntax, backticks, raw file paths, diff markers, or URLs aloud.
- Use natural spoken language (e.g. say "in the user settings component" instead of "src slash components slash user dash settings dot tsx").
- Match the language of the source text (Chinese if source is Chinese, English if English).
```

### 2.2 Contract Envelope & Wholesale Replacement

When a user defines custom instructions (at the project or host level), their text **completely replaces** the guidance above. The server wraps the prompt with the source assistant message:

```text
${effectiveInstructions}

Assistant Message:
${assistantMessageText}
```

The output schema is relaxed to accommodate longer proposal descriptions without truncation:

```typescript
const BRIEF_SCHEMA = z.object({
  briefText: z.string().min(1).max(2000).describe("Spoken summary text to be read aloud via TTS."),
});
```

---

## 3. Data Model, Protocol & Storage

### 3.1 Precedence & Resolution Chain

```
Runtime Override: msg.customPrompt (optional)
       ↓ (if undefined or empty)
Project Config: <repoRoot>/paseo.json -> metadataGeneration.audioBrief.instructions
       ↓ (if undefined or empty)
Host Config: Daemon Config -> metadataGeneration.audioBrief.instructions
       ↓ (if undefined or empty)
Default Prompt: DEFAULT_AUDIO_BRIEF_PROMPT
```

### 3.2 Protocol & Schema Extensions

#### 1. Project Config (`packages/protocol/src/paseo-config-schema.ts`)

Add `audioBrief` alongside existing keys (`title`, `branchName`, `commitMessage`, `pullRequest`):

```typescript
export const PaseoMetadataGenerationSchema = z
  .object({
    title: PaseoMetadataGenerationEntrySchema.optional(),
    branchName: PaseoMetadataGenerationEntrySchema.optional(),
    commitMessage: PaseoMetadataGenerationEntrySchema.optional(),
    pullRequest: PaseoMetadataGenerationEntrySchema.optional(),
    audioBrief: PaseoMetadataGenerationEntrySchema.optional(),
  })
  .passthrough()
  .catch({});
```

#### 2. Daemon Configuration (`packages/protocol/src/messages.ts` & `persisted-config.ts`)

Expand `MutableMetadataGenerationConfigSchema` and `AgentMetadataGenerationSchema`:

```typescript
const MutableMetadataGenerationConfigSchema = z
  .object({
    providers: z.array(MutableStructuredGenerationProviderSchema).default([]),
    audioBrief: z
      .object({
        instructions: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();
```

#### 3. Inbound Request Message (`packages/protocol/src/messages.ts`)

```typescript
export const AgentMessageSynthesizeBriefRequestSchema = z.object({
  type: z.literal("agent.message.synthesize_brief.request"),
  agentId: z.string(),
  turnId: z.string(),
  text: z.string().max(200_000),
  customPrompt: z.string().optional(),
  forceRefresh: z.boolean().optional(),
  requestId: z.string(),
});
```

---

## 4. Server Implementation & Caching

### 4.1 Prompt-Aware Cache Key

To prevent returning stale summaries when instructions change, `AudioBriefService` hashes the prompt:

```typescript
const promptHash = crypto
  .createHash("sha256")
  .update(resolvedPrompt.trim())
  .digest("hex")
  .slice(0, 16);

const cacheKey = crypto
  .createHash("sha256")
  .update(`${params.text.trim()}\0${ttsKey}\0${promptHash}`)
  .digest("hex");
```

- **Instant Invalidation**: Editing instructions generates a new `promptHash`. Subsequent plays immediately synthesize fresh audio.
- **In-flight Deduplication**: Concurrent requests for the same turn with the same prompt continue to be de-duplicated via `this.inflight.get(cacheKey)`.

### 4.2 Graceful Fallback

If structured text generation encounters an error or provider outage, `AudioBriefService` falls back to `extractFallbackBrief(params.text)` so that TTS playback remains functional.

---

## 5. Client UI & Interactions

### 5.1 Host Settings: Metadata Generation Page

`packages/app/src/screens/settings/metadata-generation-page.tsx`

- Add an **Audio Brief** settings card below the model selector.
- Provide a multi-line `SettingsTextAreaCard` displaying current host instructions.
- Provide a **"Load default template"** action button that populates the default adaptive prompt into the text area for editing.
- Changes auto-save on blur or explicit submit via `patchConfig({ metadataGeneration: { audioBrief: { instructions: text } } })`.

### 5.2 Project Settings Screen

`packages/app/src/screens/project-settings-screen.tsx`

- Update `METADATA_PROMPT_KEYS` in `packages/app/src/utils/project-config-form.ts` to include `"audioBrief"`.
- Render an `audioBrief` card with localized title, placeholder, and a **"Load default template"** button.
- Persist cleanly to `<repoRoot>/paseo.json` under `metadataGeneration.audioBrief.instructions`.

### 5.3 Timeline Audio Card

`packages/app/src/components/turn-audio-brief-button.tsx`

- Remove character truncation limits on `AudioBriefCard` so that longer proposal briefs render smoothly with auto-wrap.

### 5.4 Localization (i18n)

Add translations across all 9 supported locales:

- `settings.metadataGeneration.audioBriefTitle`
- `settings.metadataGeneration.audioBriefDescription`
- `settings.metadataGeneration.loadDefaultTemplate`
- `settings.project.metadata.audioBrief`
- `settings.project.metadata.audioBriefPlaceholder`

---

## 6. Testing & Quality Strategy

1. **Protocol Validation**:
   - `packages/protocol/src/paseo-config-schema.test.ts`: Validate serialization, parsing, and backwards compatibility when `audioBrief` is absent or present in `paseo.json`.
2. **Server Unit Tests**:
   - `packages/server/src/server/agent/audio-brief-service.test.ts`:
     - Test that default prompt generates adaptive output.
     - Test that custom prompt is passed to `StructuredTextGeneration`.
     - Test cache invalidation when prompt changes.
     - Test fallback extraction on model error.
3. **Client Form Tests**:
   - `packages/app/src/utils/project-config-form.test.ts`: Test draft serialization and round-tripping for `audioBrief`.
4. **Verification Rule**:
   - Run targeted tests via `npx vitest run <file> --bail=1`.
   - Run `npm run typecheck` and `npm run lint`.
