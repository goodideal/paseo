## ADDED Requirements

### Requirement: Pure Plugin Accessory Slot Rendering Without Legacy Fallback

The `<PluginComposerAccessories />` container SHALL render contributed composer accessories from active plugins in defined sort order, and SHALL render `null` without falling back to any built-in legacy components when no accessories are contributed for the target server.

#### Scenario: Contributed accessory rendering

- **WHEN** one or more plugins register composer accessories for the current server
- **THEN** the container renders each accessory wrapped inside `SurfaceErrorBoundary` and `PluginRuntimeBoundary` ordered by their `order` property.

#### Scenario: Pure empty rendering when no accessories contributed

- **WHEN** no plugins contribute any composer accessories for the current server
- **THEN** the container renders `null` and produces no DOM/native layout elements.
