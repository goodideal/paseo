export const PROMPT_PLACEHOLDERS = [
  { key: "issueNumber", label: "Issue 编号 (如 42)" },
  { key: "issueTitle", label: "Issue 标题" },
  { key: "issueBody", label: "Issue 描述正文" },
  { key: "repoOwner", label: "代码仓库拥有者 / 组织名" },
  { key: "repoName", label: "代码仓库名称" },
  { key: "branchName", label: "目标分支名称" },
  { key: "projectId", label: "Paseo 项目 ID" },
] as const;

export const DEFAULT_AGENT_AUTO_PROMPT = `You are an automated software engineer assigned to Gitea Issue #{{issueNumber}}: {{issueTitle}}.

Issue Description:
{{issueBody}}

## Workflow Instructions (agent-auto Mode):
1. Use the \`gitea\` skill to inspect Issue #{{issueNumber}} context, requirements, and comments.
2. Analyze the requirements and formulate alternative solutions (A/B/C) with trade-offs.
3. Post your brief Architecture & Solution Decision to the Gitea Issue comments so it is transparent and auditable.
4. Load and follow \`superpowers:subagent-driven-development\` or \`superpowers:executing-plans\`.
5. Strictly adhere to Test-Driven Development (TDD):
   - Write unit tests proving the intended behavior;
   - Implement clean, focused code until all tests pass;
   - Verify with tests, lint, and typecheck;
   - Commit your changes with clear conventional commit syntax.`;

export const DEFAULT_AGENT_PLAN_PROMPT = `You are addressing Gitea Issue #{{issueNumber}}: {{issueTitle}}.

Issue Description:
{{issueBody}}

## Workflow Instructions (agent-plan Mode):
1. Use the \`gitea\` skill to fetch Issue #{{issueNumber}} and inspect its background and criteria.
2. Load and follow the \`superpowers:brainstorming\` skill.
3. Explore alternative technical architectures and propose distinct design options (Solution A / B / C) with clear pros, cons, and recommendations.
4. Formulate the implementation plan and present it clearly for human review.`;
