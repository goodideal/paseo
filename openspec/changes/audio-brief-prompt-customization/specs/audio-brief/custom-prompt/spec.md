## Purpose

Defines requirements and scenarios for prompt customization, content-adaptive synthesis, caching, and settings UI in Audio Brief.

## ADDED Requirements

### Requirement: Content-Adaptive Default Synthesis

The Audio Brief service SHALL use a content-adaptive default prompt that categorizes messages into architectural proposals versus routine execution updates, generating detailed comparisons (80–200 words) for the former and concise summaries (<60 words) for the latter.

#### Scenario: Summarizing architectural proposal with multiple options

- **WHEN** assistant message proposes Option A vs Option B with trade-offs
- **THEN** synthesized brief explains each option's approach, trade-off, and the recommended choice in conversational spoken prose without code syntax.

#### Scenario: Summarizing simple bug fix or confirmation request

- **WHEN** assistant message reports a completed test run or asks for confirmation
- **THEN** synthesized brief generates a punchy 1–2 sentence summary of what was done and what action is required.

### Requirement: Prompt Precedence and Wholesale Replacement

The system SHALL resolve instructions following Runtime > Project `paseo.json` > Host Daemon Config > Default, and completely replace the briefing instructions with the user's custom instructions when provided.

#### Scenario: Project configuration overrides host configuration

- **WHEN** project `paseo.json` defines `metadataGeneration.audioBrief.instructions="Project prompt"`
- **AND** host configuration defines `metadataGeneration.audioBrief.instructions="Host prompt"`
- **THEN** the brief generation uses "Project prompt".

#### Scenario: Host configuration overrides default

- **WHEN** project has no `audioBrief` instructions
- **AND** host configuration defines `metadataGeneration.audioBrief.instructions="Custom prompt"`
- **THEN** the brief generation uses "Custom prompt".

### Requirement: Prompt-Aware Caching

The Audio Brief service SHALL incorporate the SHA-256 hash of the resolved prompt into the cache key.

#### Scenario: Cache hit on unchanged prompt

- **WHEN** a brief is requested for the same text and same prompt
- **THEN** cached result is returned without re-invoking LLM generation or TTS.

#### Scenario: Immediate invalidation on prompt change

- **WHEN** a user modifies the audio brief prompt instructions and requests a brief for previously synthesized text
- **THEN** the system generates a new brief adhering to the updated prompt.

### Requirement: Settings UI & Template Loading

The system SHALL provide an Audio Brief configuration section in Host Settings and Project Settings, with multi-line text input and a "Load Default Template" action.

#### Scenario: Loading default template

- **WHEN** user clicks "Load Default Template" in settings
- **THEN** the text input is populated with the complete canonical adaptive prompt.
