import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gatewayTaggerSettings, type GatewayTaggerSettings } from "./shared/settings.js";
import {
  enrichUrlWithWorkspace,
  isGatewayBaseUrl,
  resolveGatewayBaseUrl,
} from "./shared/url-enricher.js";
import { resolveWorkspaceNameFast } from "./server/workspace-resolver.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(gatewayTaggerSettings);

  let cachedSettings: GatewayTaggerSettings = {
    enabled: true,
    source: "paseo",
    enableQueryString: false,
    defaultAnthropicBaseUrl: "https://llm.ezcloud.cc/anthropic",
    defaultOpenAiBaseUrl: "https://llm.ezcloud.cc/v1",
    workspaceParamName: "workspace_id",
    sourceParamName: "source",
    includeAgentId: true,
    agentParamName: "agent_id",
    includeWorkspaceName: true,
    workspaceNameParamName: "workspace_name",
    targetHosts: [],
    extraEnvKeys: [],
  };

  settings.read().then((state) => {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
    }
  });

  const unsubscribe = settings.subscribe((state) => {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
    }
  });

  const unregisterHook = server.before("agent.session_open", ({ request }) => {
    if (!cachedSettings.enabled) {
      return;
    }

    const workspaceId = request.workspaceId;
    if (!workspaceId) {
      return;
    }

    const source = cachedSettings.source || "paseo";
    const workspaceName = resolveWorkspaceNameFast(workspaceId, request.cwd);

    const nextEnv: Record<string, string> = {
      ...request.env,
      PASEO_WORKSPACE_ID: workspaceId,
      PASEO_WORKSPACE_NAME: workspaceName,
      PASEO_SOURCE: source,
    };

    if (request.agentId) {
      nextEnv.PASEO_AGENT_ID = request.agentId;
    }

    const enrichOpts = {
      workspaceId,
      workspaceName,
      source,
      agentId: request.agentId,
      includeAgentId: cachedSettings.includeAgentId,
      includeWorkspaceName: cachedSettings.includeWorkspaceName,
      workspaceParamName: cachedSettings.workspaceParamName,
      workspaceNameParamName: cachedSettings.workspaceNameParamName,
      sourceParamName: cachedSettings.sourceParamName,
      agentParamName: cachedSettings.agentParamName,
      targetHosts: cachedSettings.targetHosts,
      enableQueryString: cachedSettings.enableQueryString ?? false,
    };

    // 1. Explicitly enrich Anthropic Base URL with fallback
    const rawAnthropicUrl = resolveGatewayBaseUrl({
      envValue: nextEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
      defaultValue: cachedSettings.defaultAnthropicBaseUrl,
    });
    if (rawAnthropicUrl) {
      nextEnv.ANTHROPIC_BASE_URL = enrichUrlWithWorkspace(rawAnthropicUrl, enrichOpts);
    }

    // 2. Explicitly enrich OpenAI / Codex Base URL with fallback
    const rawOpenAiUrl = resolveGatewayBaseUrl({
      envValue:
        nextEnv.CODEX_BASE_URL ??
        nextEnv.OPENAI_BASE_URL ??
        process.env.OPENAI_BASE_URL ??
        process.env.CODEX_BASE_URL,
      defaultValue: cachedSettings.defaultOpenAiBaseUrl,
    });
    if (rawOpenAiUrl) {
      const enrichedOpenAi = enrichUrlWithWorkspace(rawOpenAiUrl, enrichOpts);
      nextEnv.CODEX_BASE_URL = enrichedOpenAi;
      nextEnv.OPENAI_BASE_URL = enrichedOpenAi;
    }

    // 3. For any other generic base URLs (e.g. GOOGLE_GEMINI_BASE_URL, extraEnvKeys)
    const keysToCheck = new Set([...Object.keys(process.env), ...Object.keys(nextEnv)]);
    for (const key of keysToCheck) {
      if (key === "ANTHROPIC_BASE_URL" || key === "CODEX_BASE_URL" || key === "OPENAI_BASE_URL") {
        continue;
      }
      if (isGatewayBaseUrl(key, cachedSettings.extraEnvKeys)) {
        const val = nextEnv[key] ?? process.env[key];
        if (typeof val === "string" && val.trim().length > 0) {
          nextEnv[key] = enrichUrlWithWorkspace(val, enrichOpts);
        }
      }
    }

    return {
      ...request,
      env: nextEnv,
    };
  });

  return () => {
    unsubscribe();
    unregisterHook();
  };
}
