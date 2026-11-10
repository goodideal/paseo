# Capability Harness & Profile Injection Implementation Plan

**Goal:** 实机打通 Paseo 的动态能力容器（Capability Harness）注入闭环，补齐 SDLC 专家画像与 `lazy-tool` 索引切片，并在 `agent-harness` 中实现 `agent.open.before` 自动环境装配与 Antigravity 冷备隔离。

---

## 1. Domain Profiles & Lazy-Tool Slices (Infrastructure Alignment)

- [x] 1.1 将 `ui-ux-pro-max` 与 `pm-*` 软链接同步至 `~/.claude/skills/`，确保 Claude Code 全局可发现
- [x] 1.2 在 `~/.agents/profiles/` 下补齐 `backend-specialist.json`、`architect.json`、`qa-gatekeeper.json`、`security-review.json`
- [x] 1.3 在 `~/.config/lazy-tool/profiles/` 下创建 `pm.yaml`，并执行 `lazy-tool reindex` 构建 `ui.db` 与 `pm.db`

## 2. Capability Harness & Safety-Net Router (TDD Red-Green-Verify)

- [x] 2.1 在 `plugin-custom/agent-harness/tests/intent-detector.test.ts` 中编写失败测试（Red）：覆盖 `antigravity` 冷备豁免、`detectDomainRole`（标签优先 + UI/Backend/PM/QA/Review 启发式匹配）以及 `resolveHarnessEnv`
- [x] 2.2 在 `plugin-custom/agent-harness/tests/server.test.ts` 中编写失败测试（Red）：验证 `agent.open.before` 钩子注册、按角色/标题注入 `LAZY_TOOL_CONFIG`、`PASEO_HARNESS_ROLE`、`PASEO_HARNESS_PROFILE`，且严格保留不可变字段与已有 `LAZY_TOOL_CONFIG`
- [x] 2.3 更新 `plugin-custom/agent-harness/shared/types.ts` 与 `shared/intent-detector.ts`，实现 `DomainRole`、`detectDomainRole`、`resolveHarnessEnv` 与 `antigravity` 豁免逻辑（Green）
- [x] 2.4 更新 `plugin-custom/agent-harness/index.server.ts`，注册 `agent.open.before` 并串联创建期缓存与环境变量注入（Green）
- [x] 2.5 运行单文件测试验证全部通过（Verify: `npx vitest run plugin-custom/agent-harness/tests/intent-detector.test.ts plugin-custom/agent-harness/tests/server.test.ts plugin-custom/agent-harness/tests/workspace-create.test.ts --bail=1`）

## 3. Dual Quality Gates & OpenSpec Archive

- [x] 3.1 运行 `npm run typecheck` 与 `npm run lint` 检查类型与代码规范
- [x] 3.2 执行智能体双轴审查（Standards + Spec）与本地 `@alibaba-group/open-code-review` (`ocr`) 扫描验证并修复全部 High/Medium 缺陷
- [x] 3.3 将 Delta Spec 同步至 `openspec/specs/agent-harness/capability-harness/spec.md` 并完成闭环验证
