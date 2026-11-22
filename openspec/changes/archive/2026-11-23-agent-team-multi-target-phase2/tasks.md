# Tasks

## 1. OpenSpec 与核心架构定义

- [x] 1.1 创建并严格校验 `agent-team-multi-target-phase2` OpenSpec 变更包

## 2. Agent-Team 多端编译器与统一守卫实现 (`~/.agents/skills/gitea`)

- [x] 2.1 更新 `runtime_env.py` 支持 `targets` 解析推导（`--targets` / `bindings` 并集）与 `git_mode="tracked-all"`
- [x] 2.2 更新 `guard_template.py` 支持 `--client antigravity|claude` 协议转换（含 `hookSpecificOutput`）与 `--readonly` 工具拦截
- [x] 2.3 扩展 `synthesizer.py` 实现 Claude / OpenCode / Codex 原生子代理生成、方言重绑定、非破坏性 MCP/Hooks 合并、指纹化清理及 `.git/info/exclude` 受管块维护
- [x] 2.4 更新 `agent_team.py`、`doctor.py`、`scripts/gitea-team.js` 及 `agent-team` 文档，补全 `--targets` 选项与多端体检

## 3. Paseo Multi-Provider Federation 泛化 (`plugin-custom/agent-harness`)

- [x] 3.1 扩展 `shared/{types,contracts,config-resolver}.ts`、`server/agent-team-loader.ts`、`index.server.ts` 与 `client/settings-screen.tsx`，实现按 `checkoutRoot` 探测 `localFederatedTargets` 并泛化跨客户端 Federation 避让与桥接提示

## 4. 集成测试、双重质量门禁与归档

- [x] 4.1 扩展 `agent-team-integration.test.js`、`config-resolver.test.ts` 与 `server.test.ts` 验证全量目标生成、用户文件/配置保留、`team-guard.sh`、`doctor` 与多端 Federation 避让
- [x] 4.2 运行全套测试、`tsc`、全仓 `typecheck`、`oxlint`、`paseo plugin reload`，完成 `code-reviewer` 与 `ocr` 门禁检查，并同步归档 OpenSpec
