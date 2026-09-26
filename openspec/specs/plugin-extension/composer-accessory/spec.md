# plugin-extension/composer-accessory Specification

## Purpose

Provides a generic composer accessory slot mechanism allowing client plugins to contribute custom auxiliary toolbars and widgets above the input composer without modifying core composer files.

## Requirements

### Requirement: Plugin Client Context Composer Accessory Registration

The `@getpaseo/plugin` client context SHALL expose an `addComposerAccessory` registration function that accepts an accessory contribution and returns a disposable cleanup function.

#### Scenario: Successful accessory registration and cleanup

- **WHEN** a client plugin calls `client.addComposerAccessory({ id, Component, order })`
- **THEN** the accessory contribution is registered into the active plugin accessory registry, and calling the returned cleanup function removes it from the registry.

### Requirement: Reactive Composer Access API for Plugins

The client plugin runtime SHALL provide a reactive hook `useComposerApi` that exposes composer input actions without causing unnecessary re-renders of the host composer container.

#### Scenario: Submitting text from plugin accessory

- **WHEN** a registered composer accessory invokes `composerApi.submitText("hello")`
- **THEN** the composer transmits the text to the active agent session as a prompt submission.

#### Scenario: Inserting text into composer

- **WHEN** a registered composer accessory invokes `composerApi.insertText("prefix ")`
- **THEN** the composer input updates to include the inserted text at the cursor position.

### Requirement: Pure Plugin Accessory Slot Rendering Without Legacy Fallback

The `<PluginComposerAccessories />` container SHALL render contributed composer accessories from active plugins in defined sort order, and SHALL render `null` without falling back to any built-in legacy components when no accessories are contributed for the target server.

#### Scenario: Contributed accessory rendering

- **WHEN** one or more plugins register composer accessories for the current server
- **THEN** the container renders each accessory wrapped inside `SurfaceErrorBoundary` and `PluginRuntimeBoundary` ordered by their `order` property.

#### Scenario: Pure empty rendering when no accessories contributed

- **WHEN** no plugins contribute any composer accessories for the current server
- **THEN** the container renders `null` and produces no DOM/native layout elements.
