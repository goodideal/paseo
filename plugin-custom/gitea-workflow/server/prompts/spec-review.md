# Deep Module Architecture & Plan Review Prompt

The high-level design has been reviewed for Gitea Issue #{{ steps.fetch-issue.outputs.issueNumber }}: {{ steps.fetch-issue.outputs.title }}

## Instructions

1. Load and follow `codebase-design` and `grilling`.
2. Define deep module interfaces, data flows, error modes, and behavior-level test Seams in your response without writing repository spec files.
3. Perform an inline self-review for scope, interface depth, and edge cases.

Conclude your turn with:

```paseo-workflow-handoff
{
  "version": 1,
  "phase": "plan",
  "nextAction": "await_plan_approval",
  "summary": "Architecture and implementation plan self-reviewed and ready for confirmation.",
  "artifactReferences": []
}
```
