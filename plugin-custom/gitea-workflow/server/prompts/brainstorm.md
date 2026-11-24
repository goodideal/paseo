# Grill & Plan Prompt

You are addressing Gitea Issue #{{ steps.fetch-issue.outputs.issueNumber }}: {{ steps.fetch-issue.outputs.title }}

Issue Description:
{{ steps.fetch-issue.outputs.body }}

## Instructions

1. Inspect the issue context and existing codebase using read-only exploration (`serena` / file reads). Do NOT edit business source files.
2. Load and apply the `grilling` and `codebase-design` skills.
3. Batch at most 3-5 non-obvious Frontier architectural questions that cannot be inferred from the codebase, marking your recommended option with `➡️` for each.
4. Outline deep module interfaces, files to create or modify, and public test Seams (`codebase-design`) for single-gate human approval.

You MUST conclude your turn with a structured code fence in this exact format:

```paseo-workflow-handoff
{
  "version": 1,
  "phase": "plan",
  "nextAction": "await_plan_approval",
  "summary": "Frontier grilling questions and deep-module implementation plan ready for confirmation",
  "artifactReferences": []
}
```
