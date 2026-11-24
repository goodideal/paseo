# Vertical TDD Implementation Prompt

The implementation plan has been approved for Gitea Issue #{{ steps.fetch-issue.outputs.issueNumber }}: {{ steps.fetch-issue.outputs.title }}

## Instructions

1. Load and follow `codebase-design`, `tdd` (or `diagnosing-bugs` for bug fixes), and `pr`.
2. Work in vertical `Red -> Green -> Refactor` slices at public module Seams: write one failing behavior test, implement minimal passing code, and refactor.
3. Verify with targeted unit tests, typecheck, and lint (never run full monorepo test suites).
4. Commit all changes cleanly with conventional commits and include a `pr` skill summary block (`## Summary`, `## Evidence`, `## Merge Danger`) at the end of your response.

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
