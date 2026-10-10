export const GATEWAY_SPEC_MARKDOWN = `# Paseo LLM Gateway Metadata Specification (网关元数据协议规范)

本插件为所有发往大模型网关的 HTTP/HTTPS 请求自动注入上游元数据，便于网关统一识别来源并按工作区（Workspace）聚合 Agent 对话。

---

### 一、支持的传输方式 (Transmission Method)

1. **URL Query 参数（默认）**：
   - 适用于标准 API 地址（如 \`https://gateway.example.com/v1\`）。
   - 保留原有的 Query 参数，在末尾追加元数据参数。
2. **URL 模板占位符插值（可选）**：
   - 如果网关配置的 Base URL 中包含以下占位符，将直接进行语义替换，不追加 Query 参数：
     - \`\${PASEO_WORKSPACE_ID}\` / \`\${workspace_id}\` / \`{workspace_id}\`
     - \`\${PASEO_WORKSPACE_NAME}\` / \`\${workspace_name}\` / \`{workspace_name}\`
     - \`\${PASEO_AGENT_ID}\` / \`\${agent_id}\` / \`{agent_id}\`
     - \`\${PASEO_SOURCE}\` / \`\${source}\` / \`{source}\`
   - 示例：\`https://gateway.example.com/pasu/\${workspace_id}/v1\`

---

### 二、传递的字段格式与内容定义 (Fields & Content)

| 参数键名 (默认) | 可自定义键名 | 内容含义与格式 | 示例值 |
| :--- | :--- | :--- | :--- |
| **\`source\`** | 是 (支持配置) | 请求来源标识（固定或自定义字符串） | \`paseo\` / \`pasu\` |
| **\`workspace_id\`** | 是 (支持配置) | Paseo 工作区的全局唯一标识 (Workspace ID) | \`ws_01j7k9m2x5q...\` |
| **\`workspace_name\`** | 是 (支持配置) | 工作区名称/标题。若未生成 Title 则自动回退为当前目录名或分支名 | \`重构登录逻辑\` / \`my-app\` |
| **\`agent_id\`** | 是 (支持配置) | 发起该请求的当前 Agent 会话唯一标识 (Agent ID) | \`agent_a869988c...\` |

---

### 三、完整 URL 样例 (Examples)

- **默认 Query 格式**：
  \`https://gateway.example.com/v1/chat/completions?source=paseo&workspace_id=ws_01j7k9...&workspace_name=%E9%87%8D%E6%9E%84%E7%99%BB%E5%BD%95&agent_id=agent_a86998...\`
- **带原有参数的 Query 格式**：
  \`https://gateway.example.com/v1/messages?model=claude-3-7-sonnet&source=paseo&workspace_id=ws_01j7k9...&workspace_name=my-app&agent_id=agent_a86998...\`
- **Path 占位符插值格式**：
  \`https://gateway.example.com/pasu/ws_01j7k9.../v1/chat/completions?source=paseo\`
`;
