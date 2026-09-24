## Purpose

为 Paseo 提供可由 Plugin 默认值、仓库版本化文件和单次运行参数共同解析的 Workflow Definition，使自动化行为在启动前可验证、可共享且不能借配置扩大权限。

## ADDED Requirements

### Requirement: Workflow definition uses constrained layered configuration

The system SHALL resolve each run from a registered Plugin preset, an optional repository workflow override, and an optional runtime override. The resolved definition SHALL be immutable for that run, and repository/runtime overrides MUST NOT add Step types, broaden command scope, reduce required approval, or exceed host policy limits.

#### Scenario: Repository configuration disables shipping

- **WHEN** a repository override disables a PR creation Step from the registered preset
- **THEN** the resolved definition SHALL omit or skip that shipping Step and retain host permission requirements for remaining Steps

#### Scenario: Runtime override attempts to relax approval

- **WHEN** a runtime override changes an external-write Step from required approval to automatic execution
- **THEN** run creation SHALL be rejected before any Step executes with a policy-violation error

### Requirement: Workflow definition validates graph, templates, and expressions before execution

The system SHALL reject a definition with an unresolved preset, cyclic or missing dependency, duplicate Step ID, unregistered Step type, out-of-root prompt path, invalid condition expression, or reference to an undeclared upstream output.

#### Scenario: Condition references an unavailable output

- **WHEN** a condition reads an output field not declared by the referenced Step
- **THEN** definition inspection and run creation SHALL return a validation error naming the workflow, Step, and invalid reference

### Requirement: Prompt rendering receives only declared context

The system SHALL render Markdown prompts with allowlisted workflow, run, workspace, directive, and completed-Step output fields. It MUST NOT resolve environment variables, credentials, host files, or undeclared adapter-internal state.

#### Scenario: Prompt uses an unavailable secret placeholder

- **WHEN** a prompt template requests a process environment token
- **THEN** run creation SHALL fail template validation and no rendered prompt artifact SHALL be created
