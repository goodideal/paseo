## Purpose

将 Workflow 的读、工作区写入和外部写入动作映射到 Paseo 既有语义权限，并在执行不可逆或跨边界动作前提供可解释、可拒绝和可审计的审批。

## ADDED Requirements

### Requirement: Workflow steps are authorized by semantic permission and risk

The system SHALL classify each registered Step with a risk level and required semantic permission. Host policy SHALL be the final authorization decision; workflow configuration MAY restrict behavior but MUST NOT grant authority absent from the session principal.

#### Scenario: Viewer starts a workspace-writing run

- **WHEN** a principal without workspace-write authority attempts to create a run containing Worktree creation
- **THEN** run creation or the first protected Step SHALL be denied without creating a Worktree

### Requirement: External-write actions require an explicit approval record

The system SHALL pause before push, PR creation, or another external-write Step unless host policy explicitly permits automatic execution. The approval payload SHALL identify the action, repository/worktree, branch or remote target, policy reason, and exact next Step.

#### Scenario: User approves a PR creation

- **WHEN** a user selects Approve once for a pending PR creation
- **THEN** the system SHALL persist the approver identity and timestamp, execute only that waiting Step, and continue dependent Steps according to the DAG

#### Scenario: User denies a push

- **WHEN** a user denies a pending push
- **THEN** the system SHALL persist the optional reason and apply the Step denial policy without performing the push

### Requirement: Verification commands are constrained profiles

The system SHALL accept only registered Verification Profiles from Workflow configuration. A profile SHALL define its command, working-directory boundary, environment allowlist, and timeout ceiling; repository JSON MUST NOT supply arbitrary shell text.

#### Scenario: Workflow requests an unregistered command profile

- **WHEN** a definition references a verification profile that is not registered
- **THEN** validation SHALL reject the definition before any command is executed
