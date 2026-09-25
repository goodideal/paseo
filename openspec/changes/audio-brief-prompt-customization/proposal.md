## Why

Paseo's Audio Brief feature converts assistant messages into spoken executive summaries via Text-to-Speech (TTS) and displays a summary card in the chat timeline. However, the current implementation has three significant limitations:

1. **Rigid Length & Format Limits**: The prompt strictly enforces "1 to 2 spoken sentences, under 60 words total", and the Zod schema limits the output to 300 characters.
2. **Loss of Explanatory Detail on Proposals**: When an assistant provides architecture proposals, trade-offs, or multiple implementation options, the brief is reduced to an uninformative generic statement (e.g., "I suggested three options, please decide"), preventing the developer from understanding the options by ear.
3. **Lack of User Customization**: Developers cannot adjust briefing style, language preference, or focus areas (e.g. performance implications, security, or humor/tone).

## What Changes

- **Content-Adaptive Built-in Prompt**: Automatically differentiates between:
  - _Architectural Proposals & Trade-offs_: Explains each option's core approach, trade-offs, and recommendations clearly (80-200 words).
  - _Action, Execution & Confirmation_: Delivers a concise 1-2 sentence status and action update (<60 words).
- **Expanded Output Schema**: Increases `BRIEF_SCHEMA` character ceiling from 300 to 2000 to prevent truncating nuanced proposal explanations.
- **Wholesale Prompt Customization**: Custom instructions provided by the user completely replace the briefing guidelines, giving full control over briefing style while maintaining structured JSON output.
- **Dual-Tier Configuration**:
  - _Host Settings (Daemon Config)_: Configurable globally across all workspaces in the host settings page.
  - _Project Config (`paseo.json`)_: Configurable per-repo under `metadataGeneration.audioBrief.instructions`, overriding host settings and shared via version control.
- **Prompt-Aware Cache Invalidation**: Includes a SHA-256 hash of the effective prompt in the audio cache key, ensuring immediate regeneration when prompt instructions change.
- **Settings UI with Template Loader**: Adds an Audio Brief card with multi-line input and a "Load Default Template" button in both Host Settings and Project Settings.

## Capabilities

### New Capabilities

- `audio-brief/custom-prompt`: Allows configuring custom instructions for audio brief synthesis at the host and project levels, with template loading and automatic cache invalidation.

### Modified Capabilities

- `audio-brief/synthesis`: Upgrades default prompt with content-adaptive logic and expands schema capacity to 2000 characters.

## Impact

- `packages/protocol`:
  - Adds `audioBrief` to `PaseoMetadataGenerationSchema` and `MutableMetadataGenerationConfigSchema`.
  - Adds optional `customPrompt` to `AgentMessageSynthesizeBriefRequestSchema`.
  - Exports `DEFAULT_AUDIO_BRIEF_INSTRUCTIONS`.
- `packages/server`:
  - Updates `AudioBriefService` to resolve instructions (runtime > project > host > default), hash prompt into cache key, and relax briefText schema.
  - Updates `DaemonConfigStore` and `persisted-config.ts` to preserve and patch `metadataGeneration.audioBrief`.
- `packages/app`:
  - Updates `ProjectConfigDraft` and `METADATA_PROMPT_KEYS` in `project-config-form.ts`.
  - Adds Audio Brief prompt section and "Load default template" button to `ProjectSettingsScreen` and `MetadataGenerationPage`.
  - Adds i18n localization keys across 9 languages.
