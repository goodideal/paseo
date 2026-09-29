# Superpowers Implementation & TDD Prompt

The implementation plan has been approved for Gitea Issue #{{ steps.fetch-issue.outputs.issueNumber }}: {{ steps.fetch-issue.outputs.title }}

## Instructions

1. Load and follow `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
2. Follow strict TDD: red -> green -> refactor for each task.
3. Write clean, focused code and verify with targeted tests only.
4. When all tasks and verification steps pass, commit all changes.

Conclude your turn with:

```paseo-workflow-handoff
{
  "version": 1,
  "phase": "implementation",
  "nextAction": "ready_for_verification",
  "summary": "Implementation and focused tests completed successfully.",
  "artifactReferences": []
}
```
