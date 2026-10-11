# Proposal: Gateway Workspace Tagger Host-Level CLI Override

## Why (背景与问题)

`gateway-workspace-tagger` 插件旨在为多 Agent 访问大模型统一网关（如 `https://llm.ezcloud.cc`）时自动注入 `workspace_id`、`workspace_name`、`agent_id` 与 `source` 元数据。然而在实际落地中，网关未能收到相关参数，原因包括：

1. **Claude Code 配置覆盖**：Claude Code 启动后优先加载本地全局配置 `~/.claude/settings.json`，其内部 `env` 节点无条件覆盖了系统外部传入的 `ANTHROPIC_BASE_URL`，将插件注入的 Query 参数完全抹除。
2. **Codex 配置孤岛**：Codex 使用 `custom` 供应商时直接从 `~/.codex/config.toml` 读取 `base_url`，不读取系统通用的环境变量。
3. **Daemon 脏环境变量**：长时间运行的 Paseo Daemon 继承了历史本地环境（如 `127.0.0.1:3456`），导致插件计算出的 Base URL 指向无效地址。

## What Changes (核心方案)

采用**宿主级原生命令行参数强压制 (Host CLI Override)**，保持零网络中间层直连网关：

1. **插件层增强**：
   - 增加默认网关配置项（`defaultAnthropicBaseUrl`、`defaultOpenAiBaseUrl`），当本地环境变量无效或为空时自动兜底；
   - 同时向 `launchEnv` 注入 Anthropic 与 OpenAI / Codex 双轨 URL。
2. **Claude Provider 增强**：
   - 在启动 Claude Code 时，若检测到 `launchEnv.ANTHROPIC_BASE_URL`，将其包装入 CLI 参数 `--settings '{"env":{"ANTHROPIC_BASE_URL":"..."}}'`，以绝对高优先级压制本地静态 `settings.json`。
3. **Codex Provider 增强**：
   - 在启动 `codex app-server` 时，若检测到 `launchEnv.CODEX_BASE_URL` 或 `OPENAI_BASE_URL`，自动追加启动参数 `-c model_providers.custom.base_url="<enriched_url>"`，以绝对高优先级压制本地静态 `config.toml`。

## Capabilities & Impact (收益与影响)

- **同时支持 Claude Code 与 Codex**：无论用户本地配置文件如何设置，Paseo 启动的 Agent 均能精准绑定当前工作区元数据上报给网关。
- **零网络开销与零流式延迟**：无需维护脆弱的本地反向代理，保持 HTTP SSE 长连接与流式输出的高性能。
