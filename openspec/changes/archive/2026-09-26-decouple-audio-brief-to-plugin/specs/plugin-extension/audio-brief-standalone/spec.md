## Purpose

Provides an independent Paseo plugin package for intelligent audio briefing of assistant messages, encapsulating server-side text summarization, TTS audio synthesis via plugin RPC, and client-side turn action button/card contributions.

## ADDED Requirements

### Requirement: Audio Brief Standalone Plugin Manifest and Entrypoints

The audio brief capability SHALL be packaged as a standalone Paseo plugin in `plugin-examples/audio-brief/` containing `paseo-plugin.json`, `index.server.ts`, and `index.client.tsx`.

#### Scenario: Daemon loads audio brief plugin

- **WHEN** the Paseo daemon loads the `audio-brief` plugin directory source
- **THEN** the plugin initializes without runtime errors and exposes server RPC handlers and client turn action contributions.

### Requirement: Audio Brief Typed RPC Contract

The audio brief plugin SHALL define a typed RPC contract `audio_brief.synthesize.request` using `@getpaseo/plugin`'s `defineRpc`, accepting message turn details and returning synthesized brief text and optional audio base64 payload.

#### Scenario: Client requests audio brief synthesis

- **WHEN** the client invokes `audio_brief.synthesize.request` with `agentId`, `turnId`, and message `text`
- **THEN** the plugin server handler produces a concise executive brief, synthesizes audio when TTS is configured, and returns the response payload.

### Requirement: Audio Brief Client Turn Action Contributions

The audio brief plugin client entry SHALL register both a `button` turn action (for triggering audio brief generation) and a `card` turn action (for audio playback and expanded briefing display) via `client.addTurnAction`.

#### Scenario: User clicks audio brief button

- **WHEN** user clicks the audio brief button in an assistant message turn footer
- **THEN** the client component invokes `audio_brief.synthesize.request` and expands the playback card upon completion.
