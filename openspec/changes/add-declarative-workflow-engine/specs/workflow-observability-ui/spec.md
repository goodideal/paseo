## Purpose

让用户在 Paseo 各布局中理解 Workflow 的当前步骤、审批影响、失败原因和恢复操作，而无需阅读日志或推断并行 Worker 的内部状态。

## ADDED Requirements

### Requirement: Workflow run list exposes actionable status

The app SHALL list workflow runs with name, source preset, target/directive, aggregate status, current Step, elapsed time, and risk context. Failed and awaiting-approval runs SHALL be visually distinguishable without relying only on color.

#### Scenario: Run waits for PR approval

- **WHEN** a run is waiting to create a PR
- **THEN** the list SHALL display an awaiting-approval label and identify the pending Step

### Requirement: Run detail explains DAG state with a quiet vertical projection

The app SHALL render a run DAG as an indented list or vertical stepper that shows dependency relationships, each Step state, attempt history, evidence, and the current blocking node. It MUST NOT require a two-dimensional graph to determine the next action.

#### Scenario: Parallel Steps finish independently

- **WHEN** two non-dependent Steps execute in parallel and one fails
- **THEN** the detail view SHALL show both Step outcomes and the failed Step recovery action without hiding the successful sibling

### Requirement: Approval and failure actions use shared controls and confirmations

The app SHALL use shared Button, StatusBadge, ScreenTitle, and confirmation dialog primitives for Workflow actions. Stopping a run, batch-approving directives, retrying a failed external-write Step, and denying an approval MUST show the applicable confirmation and operation state.

#### Scenario: User stops a running crawl

- **WHEN** the user selects Stop Crawl
- **THEN** the app SHALL show the standard confirmation dialog and SHALL not send the stop request until the user confirms

#### Scenario: Retry action fails

- **WHEN** a user retries a failed Step and the request fails
- **THEN** the detail view SHALL keep an actionable error visible in context and allow retry or dismissal without relying on console output

### Requirement: Compact layout keeps every workflow action reachable

The app SHALL use the compact form-factor selector to choose compact navigation. On compact form factors, the run list SHALL open a full detail view; actions hidden on hover in wide layouts SHALL remain visible or be reachable in a standard menu on native and compact layouts.

#### Scenario: Compact user opens a failed run

- **WHEN** a compact-layout user selects a failed run
- **THEN** the app SHALL open its detail view and expose Resume, Retry, or Dismiss actions without requiring hover
