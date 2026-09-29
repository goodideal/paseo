# Superpowers Brainstorming Prompt

You are addressing Gitea Issue #{{ steps.fetch-issue.outputs.issueNumber }}: {{ steps.fetch-issue.outputs.title }}

Issue Description:
{{ steps.fetch-issue.outputs.body }}

## Instructions

1. Load and follow the `superpowers:brainstorming` skill.
2. Formulate clarifying questions one at a time to determine user purpose, constraints, and success criteria.
3. When asking a question to the user, output your question in natural language and include the structured handoff block below with `nextAction: "ask_user"`.
4. When the shared understanding and design approach have converged and are ready for human partner approval, output the short design in chat with `nextAction: "await_design_approval"`.

You MUST conclude your turn with a structured code fence in this exact format:

```paseo-workflow-handoff
{
  "version": 1,
  "phase": "brainstorming",
  "nextAction": "ask_user",
  "summary": "Brief summary of current discussion status",
  "question": "Your single clarifying question for the user (only if nextAction is ask_user)",
  "artifactReferences": []
}
```
