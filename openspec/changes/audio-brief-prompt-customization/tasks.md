## 1. Protocol & Shared Constants

- [x] 1.1 Export `DEFAULT_AUDIO_BRIEF_INSTRUCTIONS` in `packages/protocol/src/audio-brief.ts` and re-export in `packages/protocol/src/index.ts`
- [x] 1.2 Update `PaseoMetadataGenerationSchema` in `packages/protocol/src/paseo-config-schema.ts` to include optional `audioBrief`
- [x] 1.3 Update `MutableMetadataGenerationConfigSchema` and `AgentMessageSynthesizeBriefRequestSchema` in `packages/protocol/src/messages.ts` with optional `audioBrief` and `customPrompt`
- [x] 1.4 Rebuild protocol declarations and compile validation AOT via `npm run --workspace=@getpaseo/protocol pretypecheck`

## 2. Server Implementation & Caching

- [x] 2.1 Update `AgentMetadataGenerationSchema` in `packages/server/src/server/persisted-config.ts` to support `audioBrief`
- [x] 2.2 Update `DaemonConfigStore` in `packages/server/src/server/daemon-config-store.ts` to preserve and patch `metadataGeneration.audioBrief`
- [x] 2.3 Update `AudioBriefService` to support instruction resolution (runtime > project > host > default), prompt hashing in cache key, and relaxed 2000-char schema
- [x] 2.4 Update `session.ts` to pass `customPrompt`, daemon config, and git resolver to `AudioBriefService`
- [x] 2.5 Add unit tests in `packages/server/src/server/agent/audio-brief-service.test.ts` verifying prompt resolution, cache invalidation, and custom prompt execution

## 3. Client Settings & Forms

- [x] 3.1 Update `METADATA_PROMPT_KEYS` and `ProjectConfigDraft` in `packages/app/src/utils/project-config-form.ts` to include `audioBrief`
- [x] 3.2 Update `packages/app/src/screens/project-settings-screen.tsx` to display Audio Brief prompt section with "Load Default Template" button
- [x] 3.3 Update `packages/app/src/screens/settings/metadata-generation-page.tsx` with Audio Brief configuration card and template loader
- [x] 3.4 Add unit tests in `packages/app/src/utils/project-config-form.test.ts` for `audioBrief` round-tripping and draft handling

## 4. UI Polish & Localization

- [x] 4.1 Ensure `AudioBriefCard` in `packages/app/src/components/turn-audio-brief-button.tsx` displays full multi-line proposal briefs cleanly
- [x] 4.2 Add translation strings across all 9 locales in `packages/app/src/i18n/resources/*.ts`

## 5. Verification & Review

- [x] 5.1 Run targeted vitest test suites for protocol, server, and app
- [x] 5.2 Run `npm run typecheck` and `npm run lint` across monorepo workspaces
- [x] 5.3 Perform architectural code review and deliver developer report
