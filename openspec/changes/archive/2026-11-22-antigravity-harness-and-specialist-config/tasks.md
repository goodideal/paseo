# Tasks

## 1. 共享契约、预设与模型豁免基底改造

- [x] 1.1 更新 `shared/types.ts` 与 `shared/presets.ts`，新增 `bypassModels`（默认 `["^gemini-pro-orchestrator"]`）、`antigravity` Gemini 4 映射与模式配置，并修复 `general`、`pm`、`architect`、`orchestrator` 预设缺陷；运行单测确认类型与预设契约正确
- [x] 1.2 更新 `shared/settings.ts` 升级至 Schema v3（`bypassProviders: []`、`bypassModels`、`llmFallbackEnabled: false` 及自动迁移规则），更新 `shared/config-resolver.ts` 的 `antigravity` Banner 适配与 `shared/intent-detector.ts` 的 `isModelBypassed` 逻辑；运行 `intent-detector.test.ts` 与 `config-resolver.test.ts` 验证通过

## 2. 服务端生命周期透传与 Profile 同步修复

- [x] 2.1 更新 `index.server.ts` 实现 `agentHarnessBypassed` 跨 Hook 状态传递、L2 LLM 角色回填与单次复用、并接通 `autoSyncDaemonAgentProfiles` 自动同步；运行 `server.test.ts` 验证 Orchestrator 跳过与单阶模型启用双路径
- [x] 2.2 更新 `server/profile-sync.ts` 与 `server/rpc-handlers.ts` 修复真实模型 ID 解析、图标转 kebab-case 与既有 `profile_*` 去重合并；运行 `profile-sync.test.ts` 与后端全组定向 Vitest 验证绿灯

## 3. 前端配置 UI 与动态 Popover 实现

- [x] 3.1 更新 `client/settings-screen.tsx` 补齐 Provider Tier Mappings & Bypass、Specialist Roles Matrix（含 `preferredProvider`/`preferredTier`/`modelOverride`/`lazyToolSlice`）、`honorSpecialistPreferredProvider` 及 `L2 LLM Fallback` 完整配置控件
- [x] 3.2 更新 `client/harness-popover.tsx` 动态加载启用交接的专家列表与 `NATIVE ORCHESTRATOR` 状态徽章，并补齐 `tests/client.test.ts` 单测验证绿灯

## 4. 本机环境验证、双重门禁与 OpenSpec 归档

- [x] 4.1 运行全部 `plugin-custom/agent-harness/tests/*.test.ts`、`npm run typecheck`、`npm run lint -- plugin-custom/agent-harness` 与 `npm run format:files -- plugin-custom/agent-harness` 确认全绿
- [x] 4.2 执行 `paseo plugin reload agent-harness` 热重载插件，验证 `~/.agents/profiles/architect.json` 与 `general.json` 恢复正常，并同步更新 `~/Documents/codevai/agent/README.md`
- [x] 4.3 派发只读 `code-reviewer`（`Model: "pro"`）完成双轴审查并获 `APPROVE`，随后执行本地 `ocr` 质量门禁扫描无阻塞缺陷

## Workflow follow-up

- 完成后执行 `openspec-archive-change` 将 Delta Specs 合并至 `openspec/specs/agent-harness/capability-harness/spec.md` 并归档变更目录。
