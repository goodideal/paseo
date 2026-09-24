## Purpose

为声明式 Workflow 提供可审计的有限 DAG 执行、重试、恢复和副作用幂等保护，使 daemon 重启或局部失败不会伪造完成或重复创建外部资源。

## ADDED Requirements

### Requirement: Workflow run executes only ready DAG steps

The system SHALL execute a Step only after all dependencies have reached succeeded or a valid skipped terminal state and its condition evaluates true. A false condition SHALL record a skipped Step with its reason without marking the run failed.

#### Scenario: Conditional review is skipped after failed verification

- **WHEN** verification completes with passed false and the review condition requires a passing verification result
- **THEN** review SHALL be recorded as skipped and the run SHALL follow the configured failure path without dispatching a reviewer

### Requirement: Workflow run persists immutable execution evidence

The system SHALL atomically persist the resolved definition hash, Step inputs, declared outputs, attempt history, timestamps, rendered redacted prompts, approvals, artifacts, and terminal failure classification under the daemon workflow storage root.

#### Scenario: Daemon restarts during a waiting approval

- **WHEN** the daemon restarts after a Step creates an approval request but before a decision
- **THEN** the restarted daemon SHALL expose the same pending approval and SHALL NOT execute the protected Step until a new explicit decision is recorded

### Requirement: Resumption preserves side-effect idempotency

The system SHALL use an idempotency key for Worktree and forge-writing Steps. On resume it MUST inspect the recorded resource before creating another Worktree, branch, push, or PR. A non-resumable provider session SHALL be marked blocked or started as a distinct new attempt; it MUST NOT be reported as resumed.

#### Scenario: Run resumes after PR creation response was lost

- **WHEN** a create-PR Step has a stored idempotency key and the daemon restarts before it records the provider response
- **THEN** resume SHALL query for the matching PR before attempting creation and SHALL attach the existing PR when found
