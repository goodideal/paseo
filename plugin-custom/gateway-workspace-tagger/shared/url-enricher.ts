const GATEWAY_BASE_URL_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENCODE_BASE_URL",
  "CODEX_BASE_URL",
  "OLLAMA_HOST",
]);

export function isGatewayBaseUrl(key: string, extraEnvKeys: readonly string[] = []): boolean {
  if (GATEWAY_BASE_URL_KEYS.has(key) || key.endsWith("_BASE_URL")) {
    return true;
  }
  return extraEnvKeys.includes(key);
}

export interface EnrichUrlOptions {
  workspaceId: string;
  workspaceName?: string;
  source?: string;
  agentId?: string;
  includeAgentId?: boolean;
  includeWorkspaceName?: boolean;
  workspaceParamName?: string;
  workspaceNameParamName?: string;
  sourceParamName?: string;
  agentParamName?: string;
  targetHosts?: readonly string[];
}

export function matchesHostWhitelist(hostname: string, targetHosts?: readonly string[]): boolean {
  if (!targetHosts || targetHosts.length === 0) {
    return true;
  }
  return targetHosts.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed === "*") return true;
    if (trimmed.startsWith("*.")) {
      const suffix = trimmed.slice(2);
      return hostname.endsWith(suffix);
    }
    return hostname === trimmed;
  });
}

export function enrichUrlWithWorkspace(urlStr: string, options: EnrichUrlOptions): string {
  const source = options.source || "paseo";
  const workspaceId = options.workspaceId;
  const workspaceName = options.workspaceName;
  const agentId = options.agentId;
  const includeAgentId = options.includeAgentId ?? false;
  const includeWorkspaceName = options.includeWorkspaceName ?? false;

  const workspaceParam = options.workspaceParamName || "workspace_id";
  const workspaceNameParam = options.workspaceNameParamName || "workspace_name";
  const sourceParam = options.sourceParamName || "source";
  const agentParam = options.agentParamName || "agent_id";

  // 1. 如果包含占位符模板，优先进行占位符插值替换
  const hasPlaceholders =
    urlStr.includes("${PASEO_WORKSPACE_ID}") ||
    urlStr.includes("${workspace_id}") ||
    urlStr.includes("{workspace_id}") ||
    urlStr.includes("${PASEO_WORKSPACE_NAME}") ||
    urlStr.includes("${workspace_name}") ||
    urlStr.includes("{workspace_name}") ||
    urlStr.includes("${PASEO_SOURCE}") ||
    urlStr.includes("${source}") ||
    urlStr.includes("{source}") ||
    urlStr.includes("${PASEO_AGENT_ID}") ||
    urlStr.includes("${agent_id}") ||
    urlStr.includes("{agent_id}");

  if (hasPlaceholders) {
    let interpolated = urlStr
      .replaceAll("${PASEO_WORKSPACE_ID}", workspaceId)
      .replaceAll("${workspace_id}", workspaceId)
      .replaceAll("{workspace_id}", workspaceId)
      .replaceAll("${PASEO_SOURCE}", source)
      .replaceAll("${source}", source)
      .replaceAll("{source}", source);

    if (workspaceName) {
      interpolated = interpolated
        .replaceAll("${PASEO_WORKSPACE_NAME}", workspaceName)
        .replaceAll("${workspace_name}", workspaceName)
        .replaceAll("{workspace_name}", workspaceName);
    }

    if (agentId) {
      interpolated = interpolated
        .replaceAll("${PASEO_AGENT_ID}", agentId)
        .replaceAll("${agent_id}", agentId)
        .replaceAll("{agent_id}", agentId);
    }
    return interpolated;
  }

  // 2. 否则通过标准 URL 注入 query 参数（仅针对 HTTP/HTTPS 协议）
  try {
    const parsed = new URL(urlStr);
    if (!parsed.protocol.startsWith("http")) {
      return urlStr;
    }

    if (!matchesHostWhitelist(parsed.hostname, options.targetHosts)) {
      return urlStr;
    }

    parsed.searchParams.set(sourceParam, source);
    parsed.searchParams.set(workspaceParam, workspaceId);

    if (includeWorkspaceName && workspaceName && workspaceName.trim().length > 0) {
      parsed.searchParams.set(workspaceNameParam, workspaceName.trim());
    }

    if (includeAgentId && agentId) {
      parsed.searchParams.set(agentParam, agentId);
    }

    return parsed.toString();
  } catch {
    // 非合法绝对 URL（如局部相对路径），安全返回原字符串
    return urlStr;
  }
}
