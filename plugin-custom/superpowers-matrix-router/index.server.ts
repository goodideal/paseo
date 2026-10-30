import type { PluginServerContext } from "@getpaseo/plugin/server";
import { resolveMatrixModel } from "./shared/intent-detector.js";
import {
  superpowersMatrixRouterSettings,
  type SuperpowersMatrixRouterSettings,
} from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(superpowersMatrixRouterSettings);
  let cachedSettings: SuperpowersMatrixRouterSettings = {
    enabled: true,
    overrideIfDefaultOnly: true,
    debugLogs: true,
  };

  settings.read().then((state) => {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
    }
  });

  const unsubscribeSettings = settings.subscribe((state) => {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
    }
  });

  // Short-lived cache of prompt by normalized cwd or worktree slug
  const recentCreationPrompts = new Map<string, { prompt: string; timestamp: number }>();

  function cleanupOldPrompts() {
    const now = Date.now();
    for (const [key, val] of recentCreationPrompts.entries()) {
      if (now - val.timestamp > 60_000) {
        recentCreationPrompts.delete(key);
      }
    }
  }

  // Hook 1: workspace.create.before
  // Fires when a user starts a task by creating a workspace (has firstAgentContext & initial prompt)
  const removeWorkspaceHook = server.addHook("workspace.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    const prompt =
      request.firstAgentContext?.prompt ?? request.agent?.initialPrompt ?? request.title ?? "";

    if (!prompt.trim()) {
      return request;
    }

    // Cache prompt by destination path if predictable
    if (request.source.kind === "directory" && request.source.path) {
      recentCreationPrompts.set(request.source.path, { prompt, timestamp: Date.now() });
    }

    if (request.agent?.config) {
      const config = request.agent.config;
      const provider = config.provider;
      const decision = resolveMatrixModel({
        provider,
        currentModel: config.model,
        text: prompt,
        overrideIfDefaultOnly: cachedSettings.overrideIfDefaultOnly,
      });

      if (decision.targetModel && decision.targetModel !== config.model) {
        if (cachedSettings.debugLogs) {
          console.log(
            `[SuperpowersMatrixRouter] (workspace.create) Routed agent "${prompt.slice(0, 50)}" (${provider}): ` +
              `'${config.model ?? "(default)"}' -> '${decision.targetModel}' [tier: ${decision.tier}, rule: ${decision.matchedRule}]`,
          );
        }

        return {
          ...request,
          agent: {
            ...request.agent,
            config: {
              ...config,
              model: decision.targetModel,
              title: config.title ?? prompt.slice(0, 60),
            },
          },
        };
      }
    }

    return request;
  });

  // Hook 2: agent.create.before
  // Fires when an agent is created directly or inside an existing workspace
  const removeAgentHook = server.addHook("agent.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    const config = request.config;
    let promptOrTitle = config.title ?? "";

    // If title was not populated, check recent creation cache by cwd
    if (!promptOrTitle && config.cwd && recentCreationPrompts.has(config.cwd)) {
      promptOrTitle = recentCreationPrompts.get(config.cwd)!.prompt;
    }

    const provider = config.provider;

    const decision = resolveMatrixModel({
      provider,
      currentModel: config.model,
      text: promptOrTitle,
      overrideIfDefaultOnly: cachedSettings.overrideIfDefaultOnly,
    });

    if (decision.targetModel && decision.targetModel !== config.model) {
      if (cachedSettings.debugLogs) {
        console.log(
          `[SuperpowersMatrixRouter] (agent.create) Routed agent "${promptOrTitle.slice(0, 50)}" (${provider}): ` +
            `'${config.model ?? "(default)"}' -> '${decision.targetModel}' [tier: ${decision.tier}, rule: ${decision.matchedRule}]`,
        );
      }

      return {
        ...request,
        config: {
          ...config,
          model: decision.targetModel,
          title: config.title ?? (promptOrTitle ? promptOrTitle.slice(0, 60) : undefined),
        },
      };
    }

    return request;
  });

  return () => {
    unsubscribeSettings();
    if (typeof removeWorkspaceHook === "function") removeWorkspaceHook();
    if (typeof removeAgentHook === "function") removeAgentHook();
  };
}
