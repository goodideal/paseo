export const GATEWAY_SPEC_MARKDOWN = `# Paseo LLM Gateway Metadata Specification (网关元数据协议规范)

本插件为所有发往大模型网关的 HTTP/HTTPS 请求自动注入上游元数据，便于网关统一识别来源并按工作区（Workspace）聚合 Agent 对话。

---

### 一、支持的传输方式 (Transmission Method)

1. **Path 路径前缀 / 模板占位符插值（推荐）**：
   - 大模型客户端（Claude Code / Codex）发起调用时，会直接将端点（如 \`/v1/messages\`、\`/responses\`）追加到 Base URL 末尾。
   - 若 Base URL 中含有 Query 参数，子路径会被错误作为 Query 参数值拼接，导致服务端返回 404。
   - 因此请使用 Path 路径前缀或占位符模板注入元数据：
     - \`\${PASEO_WORKSPACE_ID}\` / \`\${workspace_id}\` / \`{workspace_id}\`
     - \`\${PASEO_WORKSPACE_NAME}\` / \`\${workspace_name}\` / \`{workspace_name}\`
     - \`\${PASEO_AGENT_ID}\` / \`\${agent_id}\` / \`{agent_id}\`
     - \`\${PASEO_SOURCE}\` / \`\${source}\` / \`{source}\`
   - 示例：\`https://llm.ezcloud.cc/ws/\${workspace_id}/v1\` 或 \`https://llm.ezcloud.cc/ws/\${workspace_id}/anthropic\`

2. **HTTP 请求头传输 (Headers)**：
   - 网关支持从 HTTP Headers 中解析元数据（\`X-Workspace-Id\`, \`X-Agent-Id\`, \`X-Source\` 等）。

3. **URL Query 参数（已禁用/已弃用）**：
   - 默认已禁用。仅在不拼接子路径的绝对 URL 场景下由用户显式开启，在主流 Coding Agent（Claude/Codex）下启用会导致 404 错误。

---

### 二、传递的字段格式与内容定义 (Fields & Content)

| 参数键名 (默认) | Header 键名 | 内容含义与格式 | 示例值 |
| :--- | :--- | :--- | :--- |
| **\`source\`** | \`X-Source\` | 请求来源标识（固定或自定义字符串） | \`paseo\` |
| **\`workspace_id\`** | \`X-Workspace-Id\` | Paseo 工作区的全局唯一标识 (Workspace ID) | \`wks_01j7k9m2x5q...\` |
| **\`workspace_name\`** | \`X-Workspace-Name\` | 工作区名称/标题。若未生成则回退为目录名或分支名 | \`重构登录逻辑\` / \`my-app\` |
| **\`agent_id\`** | \`X-Agent-Id\` | 发起该请求的当前 Agent 会话唯一标识 (Agent ID) | \`agent_a869988c...\` |

---

### 三、URL 路径样例 (Examples)

- **Codex / OpenAI 标准 Path 格式**：
  \`https://llm.ezcloud.cc/ws/wks_01j7k9.../v1\`
  （Codex 拼接后请求: \`https://llm.ezcloud.cc/ws/wks_01j7k9.../v1/responses\`）
- **Claude Code 标准 Path 格式**：
  \`https://llm.ezcloud.cc/ws/wks_01j7k9.../anthropic\`
  （Claude 拼接后请求: \`https://llm.ezcloud.cc/ws/wks_01j7k9.../anthropic/v1/messages\`）
`;
