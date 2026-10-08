# Gitea Workflow Custom Prompts Design Spec

## 1. Overview & Motivation

Paseo 的 `gitea-workflow` 插件通过 `agent-auto`（全自动模式）和 `agent-plan`（规划审查模式）二元触发机制实现敏捷的 Issue 自动化研发。此前，派发给 Agent 的 Prompt 均为写死的固定字符串，开发者无法根据具体仓库的业务背景、技术框架（如 React / Vue / Go / Rust）或内部研发纪律对 Prompt 进行针对性调优。

本设计为 `gitea-workflow` 引入全局与项目级二元 Prompt 自定义体系、内置标准模板一键重置、模板变量插值引擎以及直观易用的客户端设置界面。

---

## 2. Configuration & Schema Design

### 2.1 Types Extension (`plugin-custom/gitea-workflow/shared/types.ts`)

```typescript
export const GiteaProjectSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  readyLabel: z.string().default("agent-ready"),
  workflowPolicyOverride: GiteaWorkflowPolicySchema.optional(),
  agentProviderOverride: z.string().optional(),
  agentModelOverride: z.string().optional(),
  agentChangeModeOverride: z.string().optional(),
  // 新增：项目级 Prompt 覆盖
  agentAutoPromptOverride: z.string().optional(),
  agentPlanPromptOverride: z.string().optional(),
});

export const GiteaHostSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  pollIntervalSeconds: z.number().int().min(10).default(60),
  maxConcurrentRuns: z.number().int().min(1).max(10).default(3),
  maxAutomaticRepairCycles: z.number().int().min(0).max(5).default(2),
  automationProfile: z.string().default("claude-code"),
  agentProvider: z.string().default("claude"),
  agentModel: z.string().default(""),
  agentChangeMode: z.string().default("auto"),
  workflowPolicy: GiteaWorkflowPolicySchema.default("full_superpowers"),
  projects: z.record(z.string(), GiteaProjectSettingsSchema).default({}),
  inProgressLabel: z.string().default("agent-in-progress"),
  reviewedLabel: z.string().default("agent-reviewed"),
  evidenceRetentionDays: z.number().int().min(1).default(90),
  // 新增：全局默认 Prompt
  agentAutoPrompt: z.string().optional(),
  agentPlanPrompt: z.string().optional(),
});
```

---

## 3. Built-in Templates & Interpolation

### 3.1 Standard Templates (`plugin-custom/gitea-workflow/shared/prompts.ts`)

```typescript
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
```

### 3.2 Template Interpolator (`plugin-custom/gitea-workflow/server/prompt-interpolator.ts`)

纯函数实现变量安全替换，支持 `{{var}}` 与 `{{ var }}`：

- `issueNumber`: 数字编号
- `issueTitle`: Issue 标题
- `issueBody`: Issue 正文
- `repoOwner`: 仓库所有人/组织
- `repoName`: 仓库名称
- `branchName`: 目标开发分支
- `projectId`: Paseo 项目 ID

---

## 4. Cascading Precedence & Resolution

在 `SettingsManager` 中提供统一解析方法：

1. `getAgentAutoPrompt(projectId?: string): string`
   - 若 `projectId` 存在且配置了非空 `agentAutoPromptOverride`，返回该覆盖值；
   - 否则若全局配置了非空 `agentAutoPrompt`，返回全局值；
   - 否则返回内置 `DEFAULT_AGENT_AUTO_PROMPT`。
2. `getAgentPlanPrompt(projectId?: string): string`
   - 若 `projectId` 存在且配置了非空 `agentPlanPromptOverride`，返回该覆盖值；
   - 否则若全局配置了非空 `agentPlanPrompt`，返回全局值；
   - 否则返回内置 `DEFAULT_AGENT_PLAN_PROMPT`。

---

## 5. UI & Interaction Flow

### 5.1 Host Settings Screen (`client/host-settings.tsx`)

- 新增「提示词自定义 (Custom Prompts)」分区：
  - 简述可用变量说明（`{{issueNumber}}`, `{{issueTitle}}`, `{{issueBody}}` 等）；
  - 提供多行输入框编辑全局 Auto / Plan 模板；
  - 提供「恢复内置默认」操作按钮。

### 5.2 Project Detail Settings Screen (`client/project-detail-settings.tsx`)

- 新增「提示词覆盖 (Prompt Overrides)」分区：
  - 允许针对当前项目分别配置 Auto / Plan 提示词覆盖；
  - 提示“留空时将直接继承全局配置”；
  - 提供「填充默认模板」和「清除覆盖（恢复继承）」按钮。

---

## 6. Verification Strategy

1. **Schema & Serialization Tests**：验证新字段的解析、默认值、合法保存与向后兼容性。
2. **Interpolator Unit Tests**：覆盖已知占位符替换、空白容错、未知占位符安全保留、边界情况测试。
3. **SettingsManager Precedence Tests**：覆盖项目覆盖优先、继承全局设置、回退内置默认三级级联行为。
4. **Agent Execute Adapter Integration Tests**：验证在真实 workflow run 下，模板是否被正确解析、插值并注入到待启动 Agent 的 prompt 中。
5. **UI Component Tests**：验证多行输入框渲染、内容保存、填充默认模板及清除覆盖交互。
