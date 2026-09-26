# plugin-extension/quick-prompts-standalone Specification

## Purpose

Provides a standalone Paseo plugin (`quick-prompts`) for multi-tier prompt templates, status and keyword-driven dynamic prompt suggestions, and interactive composer injection.

## Requirements

### Requirement: Standalone Quick Prompts Plugin Manifest and Lifecycle

The `quick-prompts` plugin SHALL be a standalone plugin package under `plugin-examples/quick-prompts` with valid `paseo-plugin.json` declaring required host capabilities, and SHALL export clean server and client contribution entry points.

#### Scenario: Server and client contribution initialization

- **WHEN** the Paseo daemon loads the `quick-prompts` plugin in isolated process mode
- **THEN** the plugin registers server RPC handlers without throwing errors, and the client entry point successfully registers the composer accessory contribution into the host plugin context.

### Requirement: Typed Quick Prompts RPC Protocol Contract

The `quick-prompts` plugin SHALL define typed RPC contracts using `@getpaseo/plugin`'s `defineRpc` for global and project-scoped quick prompt retrieval and persistence, without relying on core protocol schemas.

#### Scenario: Retrieve and save global quick prompts

- **WHEN** client invokes `quick_prompts.global.get.request`
- **THEN** server returns the persisted list of global quick prompts from storage or defaults.
- **WHEN** client invokes `quick_prompts.global.set.request` with an updated prompt list
- **THEN** server atomically persists the prompts to disk and returns success with the updated items.

#### Scenario: Retrieve and save project-scoped quick prompts

- **WHEN** client invokes `quick_prompts.project.get.request` with a `projectId`
- **THEN** server returns the project-level prompt items, disabled global IDs, and customized ordering.
- **WHEN** client invokes `quick_prompts.project.set.request` with project configuration
- **THEN** server atomically persists the project record and returns the updated state.

### Requirement: Dynamic Prompt Rule Matching Engine and Ephemeral Options

The plugin client SHALL evaluate effective quick prompts by combining global and project prompts, filtering out disabled IDs, applying custom sort orders, and matching active agent status, keywords, regex, agent profiles, and extracting ephemeral options from the latest assistant message.

#### Scenario: Matching prompt by agent status and keywords

- **WHEN** the active agent status is `error` or the last assistant text contains error keywords
- **THEN** rule-based prompts targeting error states SHALL be evaluated as active and shown in the quick prompt bar.

#### Scenario: Extracting ephemeral options from assistant stream

- **WHEN** the assistant outputs numbered or lettered option lists or choices in its latest turn
- **THEN** the resolver extracts candidate options as ephemeral quick prompt chips for one-click developer selection.

### Requirement: Composer Accessory Integration and Interactive Input Control

The plugin client SHALL register a composer accessory via `client.addComposerAccessory` that displays effective quick prompts in a toolbar above the composer and uses `useComposerApi` to either immediately submit or insert the prompt text.

#### Scenario: Submitting prompt directly on chip click

- **WHEN** user clicks a quick prompt chip
- **THEN** the accessory invokes `composerApi.submitText` with the prompt content, sending the prompt to the active agent.

#### Scenario: Inserting prompt into editor for manual adjustment

- **WHEN** user triggers the edit action on a quick prompt chip
- **THEN** the accessory invokes `composerApi.insertText` with the prompt content without auto-submitting.
