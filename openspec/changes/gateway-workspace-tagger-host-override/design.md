# Design: Gateway Workspace Tagger Host-Level CLI Override

## 1. 架构总览 (Architecture Overview)

本设计采用 **宿主命令行参数强压制 (Host CLI Override)** 模式，保持 Agent 与网关之间的直接通信通道，彻底消除本地中间代理引入的额外流式延迟（TTFT）与单点崩溃风险。

```
┌────────────────────────────────────────────────────────┐
│                   Paseo Daemon                         │
│                                                        │
│  gateway-workspace-tagger 插件                          │
│  - 监听 agent.session_open 钩子                         │
│  - 提取 workspaceId / workspaceName / agentId          │
│  - 拼装富化 URL (Query 参数及 Path 占位符)              │
│  - 输出 launchEnv:                                     │
│      ANTHROPIC_BASE_URL                                │
│      CODEX_BASE_URL & OPENAI_BASE_URL                  │
└──────────────────────────┬─────────────────────────────┘
                           │ 派发 launchEnv
            ┌──────────────┴──────────────┐
            ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│     Claude Provider       │ │      Codex Provider       │
│ 将 ANTHROPIC_BASE_URL     │ │ 将 CODEX_BASE_URL         │
│ 装入 --settings '{"env":}'│ │ 装入 -c model_providers.  │
│ 压制 ~/.claude/settings   │ │ custom.base_url 压制 toml │
└───────────┬───────────────┘ └───────────┬───────────────┘
            │ CLI Spawn                   │ CLI Spawn
            ▼                             ▼
   ┌─────────────────┐           ┌─────────────────┐
   │   Claude Code   │           │ Codex App-Server│
   └────────┬────────┘           └────────┬────────┘
            │                             │
            └──────────────┬──────────────┘
                           │ 直连 HTTP/SSE 请求 (携带完整元数据)
                           ▼
             ┌───────────────────────────┐
             │ 大模型网关 (llm.ezcloud.cc) │
             └───────────────────────────┘
```

---

## 2. 组件详细设计 (Component Specifications)

### 2.1 插件层增强 (`plugin-custom/gateway-workspace-tagger`)

#### A. 设置项扩展 (`shared/settings.ts`)

```typescript
export const GatewayTaggerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  source: z.string().default("paseo"),
  // 网关兜底地址（当环境变量为空或为无效本地端口如 127.0.0.1:3456 时启用）
  defaultAnthropicBaseUrl: z.string().default("https://llm.ezcloud.cc/anthropic"),
  defaultOpenAiBaseUrl: z.string().default("https://llm.ezcloud.cc/v1"),
  workspaceParamName: z.string().default("workspace_id"),
  sourceParamName: z.string().default("source"),
  includeAgentId: z.boolean().default(true),
  agentParamName: z.string().default("agent_id"),
  includeWorkspaceName: z.boolean().default(true),
  workspaceNameParamName: z.string().default("workspace_name"),
  targetHosts: z.array(z.string()).default([]),
  extraEnvKeys: z.array(z.string()).default([]),
});
```

#### B. 核心执行逻辑 (`index.server.ts`)

- 过滤无效本地地址：若当前环境变量中解析出的 URL 包含 `127.0.0.1:3456`，自动重定向至配置中的 `defaultAnthropicBaseUrl` / `defaultOpenAiBaseUrl`。
- 双轨生成：
  - 富化 Anthropic URL，写入 `nextEnv.ANTHROPIC_BASE_URL`；
  - 富化 OpenAI/Codex URL，写入 `nextEnv.CODEX_BASE_URL` 及 `nextEnv.OPENAI_BASE_URL`；
  - 写入 `PASEO_WORKSPACE_ID`, `PASEO_WORKSPACE_NAME`, `PASEO_SOURCE`, `PASEO_AGENT_ID`。

---

### 2.2 Claude Provider 命令行压制 (`packages/server/src/server/agent/providers/claude/agent.ts`)

在 `buildSettingsOptions` 中扩展逻辑：

```typescript
private buildSettingsOptions(
  providerOptions: ClaudeProviderOptions,
  input: { ultracode: boolean },
): Pick<ClaudeOptions, "settings"> | Record<string, never> {
  const fastMode = this.resolveFastModeSetting();
  const disableAllHooks = this.config.internal === true;

  // 提取 launchEnv 中的 ANTHROPIC_BASE_URL
  const envOverrides: Record<string, string> = {};
  if (this.launchEnv?.["ANTHROPIC_BASE_URL"]) {
    envOverrides.ANTHROPIC_BASE_URL = this.launchEnv["ANTHROPIC_BASE_URL"];
  }

  const hasEnvOverrides = Object.keys(envOverrides).length > 0;
  if (fastMode === null && !input.ultracode && !disableAllHooks && !hasEnvOverrides) {
    return {};
  }

  return {
    settings: mergeClaudeSettings(providerOptions.settings, {
      ...(fastMode === null ? {} : { fastMode }),
      ...(input.ultracode ? { ultracode: true } : {}),
      ...(disableAllHooks ? { disableAllHooks: true } : {}),
      ...(hasEnvOverrides ? { env: envOverrides } : {}),
    }),
  };
}
```

**原理**：Claude Code CLI 启动参数 `--settings` 会在运行时合并进配置树，且其优先级高于磁盘上的 `~/.claude/settings.json`，确保 URL 中的 query 参数不被清空。

---

### 2.3 Codex Provider 命令行压制 (`packages/server/src/server/agent/providers/codex-app-server-agent.ts`)

在 `spawnAppServer` 中动态拼接 `-c` 参数：

```typescript
private async spawnAppServer(
  launchEnv?: Record<string, string>,
  options?: { goalsEnabled?: boolean; agentId?: string; environment?: Record<string, string> },
): Promise<ChildProcessWithoutNullStreams> {
  const launchPrefix = await resolveCodexLaunchPrefix(this.runtimeSettings);
  const args = [...launchPrefix.args, "app-server"];
  if (options?.goalsEnabled) {
    args.push("--enable", "goals");
  }

  // 检查是否注入了 Codex / OpenAI Base URL
  const codexBaseUrl = launchEnv?.["CODEX_BASE_URL"] || launchEnv?.["OPENAI_BASE_URL"];
  if (codexBaseUrl) {
    // 强制压制 ~/.codex/config.toml 中的 base_url
    args.push("-c", `model_providers.custom.base_url=${JSON.stringify(codexBaseUrl)}`);
  }

  // 原有启动逻辑保持不变
```

**原理**：Codex 官方原生提供 `-c <key=value>`，支持通过点分路径（如 `model_providers.custom.base_url`）强行覆盖 TOML 配置中的嵌套键。

---

## 3. 错误处理与容错机制 (Error Handling & Graceful Degradation)

1. **配置缺失时保持兼容**：若未启用该插件或未配置 Base URL，不追加任何额外的 `--settings` 或 `-c` 参数，完全回退为原有官方默认行为。
2. **URL 格式防御**：`url-enricher` 仅对有效 HTTP/HTTPS 协议追加 Query，若为特殊或畸形字符串则原样安全返回，绝不阻塞 Agent 启动流程。

---

## 4. 测试与验证策略 (Testing & Verification Strategy)

1. **自动化测试**：
   - 编写 `plugin-custom/gateway-workspace-tagger/tests/` 单元测试，验证双轨 URL 生成及无效本地端口回退；
   - 编写 `packages/server/src/server/agent/providers/claude/` 针对 `buildSettingsOptions` 的测试；
   - 编写 `packages/server/src/server/agent/providers/codex-app-server-agent.test.ts` 针对 `-c model_providers.custom.base_url` 参数追加的测试。
2. **真实环境检查**：
   - 在开发环境下验证启动的 Claude Code 进程实际持有的 `ANTHROPIC_BASE_URL`；
   - 验证 Codex 会话发起请求时是否成功命中网关并携带 `workspace_id`。
