## Context

See proposal.md for background. Paseo's Audio Brief converts LLM messages to voice summaries. We need to support content-adaptive summarization and full prompt customization across host and project tiers without introducing breaking changes or latency degradation.

## Goals / Non-Goals

**Goals:**

- Provide intelligent, content-adaptive defaults: rich spoken explanations for multi-option proposals (80–200 words) and punchy 1–2 sentence briefs for routine actions (<60 words).
- Allow wholesale prompt replacement when user instructions are specified.
- Support dual-tier configuration: project-level `paseo.json` overriding host-level daemon configuration.
- Implement prompt-aware cache key hashing to guarantee immediate invalidation upon prompt changes.
- Provide a clean, accessible UI in both Host Settings and Project Settings with a "Load Default Template" action.

**Non-Goals:**

- Adding user-defined multi-speaker voice synthesis or prosody tagging.
- Real-time streaming TTS audio playback (chunks are synthesized and delivered as unified audio/wav payload per turn).

## Decisions

### Decision 1: Shared Canonical Prompt Constant in `@getpaseo/protocol`

- _Rationale_: Storing `DEFAULT_AUDIO_BRIEF_INSTRUCTIONS` in `packages/protocol/src/audio-brief.ts` ensures a single source of truth used both by the daemon backend during synthesis and by the frontend when the user clicks "Load default template".
- _Alternatives Considered_: Duplicating the prompt string in frontend and backend — rejected due to drift risk.

### Decision 2: Cascading Precedence (Runtime > Project > Host > Default)

- _Rationale_: Project needs often differ from personal defaults (e.g., an enterprise repo requiring strict terminology vs. personal casual coding). Project `paseo.json` committed to Git provides repo consistency. Host settings provide zero-friction defaults for all other workspaces.
- _Alternatives Considered_: Only global settings — rejected because team repositories need shared guidelines.

### Decision 3: SHA-256 Prompt Hashing in Cache Key

- _Rationale_: Hashing `${text}\0${ttsKey}\0${promptHash}` ensures that altering instructions immediately invalidates the cache without requiring manual cleanup or cache flushing.
- _Alternatives Considered_: Clearing the entire cache directory on config save — rejected because it evicts unaffected turns and causes unnecessary re-synthesis cost.

### Decision 4: Wholesale Replacement vs Appending

- _Rationale_: Appending user instructions to fixed system rules frequently causes LLM confusion and conflicting instructions (e.g., system says "under 60 words" while user asks for "detailed analysis"). Wholesale replacement gives users complete control while the server guarantees JSON output schema adherence.

## Risks & Mitigations

| Risk                                            | Mitigation                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Longer proposals increase TTS synthesis latency | The inflight deduplication map avoids redundant concurrent synthesis; `AudioBriefCard` displays the textual brief as soon as it is generated, keeping the user informed while audio is prepared. |
| Malformed user prompt causes LLM failure        | Graceful fallback to regex-based `extractFallbackBrief` ensures synthesis does not crash and basic audio is still produced.                                                                      |
| Inbound/outbound schema breakages               | Strictly optional fields on existing schemas; no `.transform()` or `.catch()` on wire schemas, preserving AOT validation compliance.                                                             |
