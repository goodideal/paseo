# Gitea Workflow Custom Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `gitea-workflow` 提供全局及项目级 `agent-auto` 与 `agent-plan` 提示词模板自定义、变量插值引擎、内置默认模板重置及前端设置 UI。

**Architecture:**
通过在 `shared/types.ts` 中扩展全局与项目级配置 Schema，结合 `shared/prompts.ts` 集中管理内置标准 Prompt 常量；构建轻量安全正则插值引擎 `prompt-interpolator.ts`；在 `SettingsManager` 实现「项目覆盖 > 全局设置 > 内置默认」三级级联回退；在 `agent-execute.ts` 中完成动态变量提取与 Prompt 装配；在前端 `host-settings.tsx` 与 `project-detail-settings.tsx` 提供直观的多行编辑、变量提示与一键恢复能力。

**Tech Stack:** TypeScript, React Native, Vitest, Zod, Paseo Plugin API.

**Spec:** `docs/superpowers/specs/2026-10-08-gitea-workflow-custom-prompts-design.md` 与 `openspec/changes/gitea-workflow-custom-prompts/specs/gitea-workflow/custom-prompts/spec.md`

## Global Constraints

- Wire schemas 与 settings schema 保持纯正并向后兼容（新增字段全部可选，不破坏现有已存储配置）。
- 插值引擎保持无外部依赖，对未识别变量占位符安全保留原样，避免运行时抛错。
- 遵循严谨原子可测试 TDD 流程：Red 失败测试 -> Green 极简实现 -> Verify 验证命令。

## Review Focus

1. 用户清空项目级覆盖或仅保存空格时，必须平滑回退继承全局设置，严禁向 Agent 传递空字符串。
2. 用户在 Prompt 中包含未知变量时（如 `{{custom_var}}`），插值器必须原样保留而不能崩溃或替换为 `undefined`。
3. Issue 标题或描述中包含特殊字符或代码反引号时，插值必须保持原始语义不被破坏。
4. 全局点击「恢复内置默认模板」后，必须准确填入与底层默认兜底完全一致的官方最新提示词。
5. 所有修改必须通过 `npm run typecheck` 与 `npm run lint` 验证。

---

## 1. Schema & Standard Prompts (Data Contracts)

- [x] 1.1 在 `tests/schema.test.ts` 中编写失败测试（Red），断言 `GiteaHostSettingsSchema` 与 `GiteaProjectSettingsSchema` 支持 `agentAutoPrompt`、`agentPlanPrompt`、`agentAutoPromptOverride`、`agentPlanPromptOverride` 字段
- [x] 1.2 创建 `plugin-custom/gitea-workflow/shared/prompts.ts`，导出标准 `DEFAULT_AGENT_AUTO_PROMPT` 与 `DEFAULT_AGENT_PLAN_PROMPT` 常量及可用变量清单
- [x] 1.3 更新 `plugin-custom/gitea-workflow/shared/types.ts`，在 Schema 中加入可选的 Prompt 模板字段（Green）
- [x] 1.4 运行验证命令确保 Schema 测试通过（Verify: `npx vitest run plugin-custom/gitea-workflow/tests/schema.test.ts`）

## 2. Interpolator & Settings Resolution (Core Engine)

- [x] 2.1 在 `plugin-custom/gitea-workflow/tests/prompt-interpolator.test.ts` 中编写失败测试（Red），覆盖全变量替换、带空格占位符、未知占位符安全保留与空输入边界
- [x] 2.2 创建 `plugin-custom/gitea-workflow/server/prompt-interpolator.ts`，实现 `interpolatePrompt` 纯函数（Green）
- [x] 2.3 运行验证命令确保插值器单元测试通过（Verify: `npx vitest run plugin-custom/gitea-workflow/tests/prompt-interpolator.test.ts`）
- [x] 2.4 在 `plugin-custom/gitea-workflow/tests/settings.test.ts` 中编写失败测试（Red），验证 `SettingsManager` 的三级级联解析（项目覆盖 > 全局设置 > 内置默认）与空白字符串回退
- [x] 2.5 更新 `plugin-custom/gitea-workflow/server/settings-manager.ts`，实现 `getAgentAutoPrompt(projectId)` 与 `getAgentPlanPrompt(projectId)`（Green）
- [x] 2.6 运行验证命令确保设置解析测试通过（Verify: `npx vitest run plugin-custom/gitea-workflow/tests/settings.test.ts`）

## 3. Agent Execution Adapter Integration

- [x] 3.1 在 `plugin-custom/gitea-workflow/tests/agent-execute.test.ts` 中增加失败测试（Red），断言 `agent-auto` 与 `agent-plan` 模式下派发给 Agent 的 Prompt 优先采用配置的自定义模板并完成上下文插值
- [x] 3.2 改造 `plugin-custom/gitea-workflow/server/adapters/agent-execute.ts`，注入插值逻辑与 `settingsManager` 提示词解析（Green）
- [x] 3.3 运行验证命令确保适配器集成测试通过（Verify: `npx vitest run plugin-custom/gitea-workflow/tests/agent-execute.test.ts`）

## 4. UI Settings Screens & Component Tests

- [x] 4.1 在 `plugin-custom/gitea-workflow/tests/settings-screen.test.tsx` 中编写测试（Red），覆盖全局提示词自定义卡片展示、保存、恢复默认按钮以及项目级覆盖/清除继承
- [x] 4.2 更新 `plugin-custom/gitea-workflow/client/host-settings.tsx`，增加全局「提示词自定义 (Custom Prompts)」卡片、多行编辑框与「恢复内置默认」按钮（Green）
- [x] 4.3 更新 `plugin-custom/gitea-workflow/client/project-detail-settings.tsx`，增加项目级「提示词覆盖 (Prompt Overrides)」多行编辑框与「清除覆盖（恢复继承）」/「填充默认模板」操作（Green）
- [x] 4.4 运行验证命令确保前端设置组件测试通过（Verify: `npx vitest run plugin-custom/gitea-workflow/tests/settings-screen.test.tsx`）

## 5. Full Pipeline Verification & Review

- [ ] 5.1 运行 `gitea-workflow` 模块全套单元与集成测试（Verify: `npx vitest run plugin-custom/gitea-workflow/tests/ --bail=1`）
- [ ] 5.2 运行代码格式化与静态检查（Verify: `npm run typecheck && npm run lint && npm run format:check`）
- [ ] 5.3 检查 OpenSpec 变更状态并通过 `openspec validate` 验证
