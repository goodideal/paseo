## Purpose

允许可信 Plugin 将业务域输入接入 Core Workflow，同时保持 Core 对业务模型无感、Plugin 卸载安全且历史 Run 的解释不因后续 Plugin 变更而失真。

## ADDED Requirements

### Requirement: Plugin can register constrained workflow contributions

The system SHALL allow a Plugin to register uniquely named presets and StepAdapter types with declared input/output schema, risk, repository-callability, and resumption metadata. A Plugin MUST NOT replace a Core Adapter or take over another Plugin registered type.

#### Scenario: Plugin attempts to register a duplicate Core type

- **WHEN** a Plugin registers a StepAdapter with an existing Core type name
- **THEN** registration SHALL fail and the existing Adapter SHALL remain active

### Requirement: Plugin lifecycle protects active runs

The system SHALL stop accepting new runs that require an unloaded or failed Plugin contribution. Active runs depending on that contribution SHALL transition to blocked or safely terminated according to the Adapter lifecycle contract, while retaining their resolved-definition snapshot and artifacts.

#### Scenario: Visual Crawler plugin reloads during review

- **WHEN** a visual-crawler-specific Step is running and the Plugin reloads
- **THEN** the run SHALL become blocked with an actionable dependency-unavailable reason and SHALL not be marked succeeded

### Requirement: Visual Crawler submits directives as workflow inputs

The Visual Crawler integration SHALL map an approved FixDirective to one isolated Workflow Run and SHALL use the Core run state as the authoritative status for its repair lifecycle. It MUST NOT concurrently dispatch the same directive through the legacy Worker Pool.

#### Scenario: Approved directive awaits PR approval

- **WHEN** a directive run completes review and pauses before PR creation
- **THEN** the directive view SHALL show the associated run and its awaiting-approval status instead of reporting a submitted PR
