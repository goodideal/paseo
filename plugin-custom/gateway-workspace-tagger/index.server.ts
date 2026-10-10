import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gatewayTaggerSettings, type GatewayTaggerSettings } from "./shared/settings.js";
import { enrichUrlWithWorkspace, isGatewayBaseUrl } from "./shared/url-enricher.js";
import { resolveWorkspaceNameFast } from "./server/workspace-resolver.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(gatewayTaggerSettings);

  let cachedSettings: GatewayTaggerSettings = {
    enabled: true,
    source: "paseo",
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

    const keysToCheck = new Set([...Object.keys(process.env), ...Object.keys(nextEnv)]);

    for (const key of keysToCheck) {
      if (isGatewayBaseUrl(key, cachedSettings.extraEnvKeys)) {
        const val = nextEnv[key] ?? process.env[key];
        if (typeof val === "string" && val.trim().length > 0) {
          nextEnv[key] = enrichUrlWithWorkspace(val, {
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
          });
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
