# plugin-extension/turn-action Specification

## Purpose

Provides a generic turn action and interactive card slot mechanism allowing client plugins to contribute action buttons and contextual cards to the assistant turn footer without invading message presentation components.

## Requirements

### Requirement: Plugin Client Context Turn Action Registration

The `@getpaseo/plugin` client context SHALL expose an `addTurnAction` registration function that accepts a turn action contribution with button and optional card components, returning a disposable cleanup function.

#### Scenario: Successful turn action registration

- **WHEN** a client plugin calls `client.addTurnAction({ id, type, Component, order })`
- **THEN** the turn action is registered into the active plugin turn action registry, and calling the returned cleanup function removes it from the registry.

### Requirement: Turn State Reactive Subscription

The client plugin runtime SHALL provide a reactive hook `useTurnState(turnId)` allowing turn action components to query and subscribe to assistant message streaming status and content.

#### Scenario: Observing completed turn content

- **WHEN** an assistant turn reaches `completed` state
- **THEN** the `useTurnState(turnId)` hook emits the full turn text and completed status to the subscribed turn action component.
