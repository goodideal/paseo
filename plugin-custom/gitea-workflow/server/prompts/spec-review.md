# Superpowers Spec & Design Prompt

The high-level design has been approved for Gitea Issue #{{ steps.fetch-issue.outputs.issueNumber }}: {{ steps.fetch-issue.outputs.title }}

## Instructions

1. Write the design spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. Follow the spec writing guidelines: clear boundaries, component models, data flows, and test strategies.
3. Perform the Spec Self-Review inline (check for placeholders, internal consistency, scope, ambiguity).
4. Commit the design spec to Git with conventional commit message `docs: add <topic> design spec`.

Conclude your turn with:

```paseo-workflow-handoff
{
  "version": 1,
  "phase": "spec_design",
  "nextAction": "await_spec_approval",
  "summary": "Design spec authored, self-reviewed, and committed.",
  "artifactReferences": []
}
```
