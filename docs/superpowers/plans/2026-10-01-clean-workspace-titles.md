# Gitea Workflow 纯净精炼 Workspace 标题实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 净化 Gitea Workflow 自动生成的 Workspace 标题，去除 `SP1`、`[req/TR]`、`[P1]` 等各种内部噪音标签，统一格式化为 `🐞 #<Number> [Bug] <主标题>` 或 `✨ #<Number> [Feature] <主标题>`。

**Architecture:**
新增独立的标题清洗与格式化模块 `plugin-custom/gitea-workflow/server/workspace-title.ts`，在 `poller.ts`（工作流启动与调度）和 `agent-execute.ts`（工作区标题同步）中接入该模块，并保持分支生成与各适配器的平稳运行。

**Tech Stack:** TypeScript, Vitest, Paseo Plugin Server.

**Spec:** `docs/superpowers/specs/2026-10-01-clean-workspace-titles-design.md`

## Review Focus

- **复杂前缀剥离完整度**：对于 `[req/TR] [S] [P1] 支持下游断连...` 或 `[BUG] [SP2] 修复崩溃` 能否彻底剥离前缀，只保留真实主标题。
- **中英文混合与标点保留**：清洗后不能误删标题正文中的中文、英文或有效符号。
- **空标题防退化**：如果原标题全是前缀标签（如 `[SP1][P0]`），清洗后有兜底保护，不产生空标题。
- **单元测试全覆盖**：所有既有 poller 测试与 agent-execute 测试平稳过渡。

---

### Task 1: 标题清洗与格式化工具模块及单元测试 (Workspace Title Formatter)

**Files:**

- Create: `plugin-custom/gitea-workflow/server/workspace-title.ts`
- Create: `plugin-custom/gitea-workflow/tests/workspace-title.test.ts`

- [ ] **Step 1: 编写测试用例**
      覆盖以下情况：
  1. `[req/TR] [S] [P1] 支持下游断连感知` -> `✨ #138 [Feature] 支持下游断连感知`
  2. `[BUG] [SP2] 修复登录白屏异常` -> `🐞 #99 [Bug] 修复登录白屏异常`
  3. `SP1: 优化性能` -> `✨ #50 [Feature] 优化性能`
  4. 含有 label `bug` 但标题未带 `[BUG]` 的情况
  5. 含有纯英文字符、特殊符号的标题

- [ ] **Step 2: 运行测试验证失败**
      `rtk npx vitest run plugin-custom/gitea-workflow/tests/workspace-title.test.ts --bail=1`

- [ ] **Step 3: 实现 `workspace-title.ts`**
      实现 `cleanIssueTitle`、`detectIssueKind` 与 `formatWorkflowWorkspaceTitle`。

- [ ] **Step 4: 运行测试验证通过**
      `rtk npx vitest run plugin-custom/gitea-workflow/tests/workspace-title.test.ts --bail=1`

---

### Task 2: 集成至 Poller 调度与工作流标题

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/poller.ts`
- Modify: `plugin-custom/gitea-workflow/tests/poller.test.ts`

- [ ] **Step 1: 更新 poller.ts**
      在 `runCreate` 的 `input.title` 以及 `indexStore.recordRun` 中调用 `formatWorkflowWorkspaceTitle`。
- [ ] **Step 2: 更新并运行 poller 测试**
      `rtk npx vitest run plugin-custom/gitea-workflow/tests/poller.test.ts --bail=1`

---

### Task 3: 集成至 Agent Execute 适配器

**Files:**

- Modify: `plugin-custom/gitea-workflow/server/adapters/agent-execute.ts`
- Modify: `plugin-custom/gitea-workflow/tests/agent-execute.test.ts`

- [ ] **Step 1: 更新 agent-execute.ts**
      在 `wsRef.setTitle(...)` 时采用 `formatWorkflowWorkspaceTitle` 设置精炼标题。
- [ ] **Step 2: 更新并运行 agent-execute 测试**
      `rtk npx vitest run plugin-custom/gitea-workflow/tests/agent-execute.test.ts --bail=1`

---

### Task 4: 回归验证与类型检查

- [ ] **Step 1: 运行 gitea-workflow 所有相关测试**
- [ ] **Step 2: 全局类型检查与代码检查** (`npm run typecheck && npm run lint`)
