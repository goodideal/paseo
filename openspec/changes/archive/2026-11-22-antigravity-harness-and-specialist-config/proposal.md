# Proposal

## Why

当前 `agent-harness` 插件将 `"antigravity"` 整体列入 `bypassProviders`，导致 Antigravity 单阶模型（如 `gemini-4-hydrogen-high`、`gemini-4-carbon-high`、`gemini-4-argon-high`）无法作为跨进程专家叶节点挂载 `LAZY_TOOL_CONFIG` 物理工具切片与档位路由；同时插件设置页缺失专家角色（`specialists`）与 Provider 模型映射（`providerMappings`）的可视化配置界面，且存在 `general` 覆盖 `architect.json`、`syncDaemonAgentProfiles` 模型未解析、L2 LLM Fallback 空转以及 `pm`/`architect` 后台只读锁死等缺陷。

## What Changes

- **Antigravity 双模按模型豁免机制**：将 `bypassProviders: ["antigravity"]` 替换为按 `bypassModels` 正则匹配（默认 `["^gemini-pro-orchestrator"]`）。使用原生 `gemini-pro-orchestrator*` 时全链路跳过 Agent Harness，保留内置 Carbon/Hydrogen 双阶编排与宽工具池供 `core-harness` 进程内子代理继承；使用 Antigravity 其余单阶模型或无模型叶节点派发时，完整启用 Harness 路由与环境切片，并接入 Gemini 4 档位映射（`plan: gemini-4-carbon-high`、`flash: gemini-4-hydrogen-high`、`review: gemini-4-argon-high`）。
- **可视化配置界面与动态 Handoff**：在插件设置页面补齐 **Provider Tier Mappings & Bypass** 与 **Specialist Roles Matrix** 面板（支持按专家配置 `preferredProvider` 含 `antigravity`、`preferredTier`、`modelOverride`、`lazyToolSlice` 等），暴露 `honorSpecialistPreferredProvider` 与 `llmFallbackApplyRole` / `Endpoint` / `API Key` 选项；在 `HarnessPopover` 动态加载启用交接的专家并对 `gemini-pro-orchestrator*` 展示 `NATIVE ORCHESTRATOR` 状态。
- **配置与生命周期缺陷修复**：
  - 修复 `general` 专家 `profileFilename` 为 `"general.json"` 并清理不当输出目标，恢复磁盘 `architect.json`；
  - 修复 `syncDaemonAgentProfiles` 经由 `providerMappings` 解析真实模型 ID、图标转 kebab-case、按角色去重就地合并既有 `profile_*` 并在保存时接通 `autoSyncDaemonAgentProfiles`；
  - 将 `llmFallbackEnabled` 默认设为 `false` 并在 `index.server.ts` 接通 `llmFallbackApplyRole`；
  - 清空 `pm` / `architect` 预设的 `defaultModeId: "plan"` 避免后台写盘失败，解除 `orchestrator` 提示词对 `--provider claude` 的硬编码，并在 Banner 生成时针对 `antigravity` 适配 `read_file` 技能加载指引。

## Capabilities

### New Capabilities

（无新增独立 capability，均归属既有 `agent-harness/capability-harness`）

### Modified Capabilities

- `agent-harness/capability-harness`: 将全量 `antigravity` Provider 旁路变更为按 `bypassModels` 仅豁免 `gemini-pro-orchestrator*` 模型、其余 Antigravity 模型启用 Gemini 4 路由与环境变量注入；新增专家角色 Provider/模型可视化配置及 Daemon Agent Profiles 真实模型同步要求。

## Impact

- 插件服务端与共享逻辑：`plugin-custom/agent-harness/{index.server.ts, shared/*, server/*}`
- 插件前端 UI：`plugin-custom/agent-harness/client/{settings-screen.tsx, harness-popover.tsx}`
- 插件单测：`plugin-custom/agent-harness/tests/*`
- 本机配置与文档：`~/.agents/profiles/{architect.json, general.json}`、`~/Documents/codevai/agent/README.md`
