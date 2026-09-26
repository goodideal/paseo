## ADDED Requirements

### Requirement: Pure Turn Action Slot Rendering Without Core Fallback

The App runtime container `<PluginTurnActions />` SHALL render only registered plugin turn action contributions. When no plugin turn actions are registered for a given slot type (`button` or `card`), the container SHALL render nothing (`null`) without falling back to any hardcoded or built-in core implementation.

#### Scenario: No plugins registered for turn actions

- **WHEN** an assistant message turn is rendered and no plugins have registered contributions for slot type `button` or `card`
- **THEN** `<PluginTurnActions />` renders `null`, producing zero DOM or React Native elements for that slot

#### Scenario: Active plugin registers turn action

- **WHEN** one or more plugins have registered contributions matching slot type `button` or `card`
- **THEN** `<PluginTurnActions />` renders all registered contributions wrapped in `TurnStateProvider` and `PluginRuntimeBoundary` ordered by `order`
