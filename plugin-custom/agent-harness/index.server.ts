import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  DEFAULT_PROVIDER_MAPPINGS,
  SAFETY_NET_PROVIDER,
  normalizeProvider,
  detectDomainRole,
  resolveHarnessEnv,
  resolveMatrixModel,
} from "./shared/intent-detector.js";
import { agentHarnessSettings, type AgentHarnessSettings } from "./shared/settings.js";
import type { DomainRole, MatrixTier } from "./shared/types.js";

const PROMPT_CACHE_TTL_MS = 60_000;
const TITLE_PREVIEW_MAX_CODE_POINTS = 60;

const ROLE_PREFERRED_TIER: Partial<Record<DomainRole, MatrixTier>> = {
  pm: "plan",
  architect: "plan",
  review: "review",
  ui: "flash",
  backend: "flash",
  qa: "flash",
  scout: "flash",
};

function readStringLabels(obj: unknown): Record<string, string> | undefined {
  if (typeof obj !== "object" || obj === null || !("labels" in obj)) {
    return undefined;
  }
  const candidate = (obj as { labels?: unknown }).labels;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeLabels(
  primary: Readonly<Record<string, string>> | null | undefined,
  secondary: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> | undefined {
  if (!primary && !secondary) {
    return undefined;
  }
  const merged = { ...(secondary ?? {}), ...(primary ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function truncateByCodePoints(text: string, maxCodePoints: number): string {
  return Array.from(text).slice(0, maxCodePoints).join("");
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(agentHarnessSettings);
  let cachedSettings: AgentHarnessSettings = {
    enabled: true,
    overrideIfDefaultOnly: true,
    debugLogs: false,
  };
  let hasSubscriptionUpdate = false;

  function applySettings(state: Awaited<ReturnType<typeof settings.read>>) {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
    }
  }

  const unsubscribeSettings = settings.subscribe((state) => {
    if (state.status === "ready") {
      hasSubscriptionUpdate = true;
    }
    applySettings(state);
  });

  settings
    .read()
    .then((state) => {
      if (!hasSubscriptionUpdate) {
        applySettings(state);
      }
    })
    .catch((error) => {
      console.error("[AgentHarness] Failed to read settings", error);
    });

  // Short-lived cache of creation context by normalized cwd (replaced on each new creation, consumed on open)
  const recentCreationContext = new Map<
    string,
    { prompt: string; labels?: Record<string, string>; timestamp: number }
  >();

  function cleanupOldPrompts() {
    const now = Date.now();
    for (const [key, val] of recentCreationContext.entries()) {
      if (now - val.timestamp > PROMPT_CACHE_TTL_MS) {
        recentCreationContext.delete(key);
      }
    }
  }

  function rememberCreationContext(
    cwd: string | undefined,
    prompt: string,
    labels?: Readonly<Record<string, string>>,
  ) {
    if (!cwd || (!prompt && !labels)) {
      return;
    }
    const key = path.resolve(cwd);
    const existing = recentCreationContext.get(key);
    recentCreationContext.set(key, {
      prompt: prompt || existing?.prompt || "",
      labels: mergeLabels(labels, existing?.labels),
      timestamp: Date.now(),
    });
  }

  function resolveContextText(cwd: string | undefined, title: string | null | undefined): string {
    const trimmedTitle = title?.trim() ?? "";
    const cachedPrompt = cwd ? (recentCreationContext.get(path.resolve(cwd))?.prompt ?? "") : "";
    if (cachedPrompt && (!trimmedTitle || cachedPrompt.startsWith(trimmedTitle))) {
      return cachedPrompt;
    }
    return trimmedTitle || cachedPrompt;
  }

  function consumeContextLabels(
    cwd: string | undefined,
    labels: Readonly<Record<string, string>> | null | undefined,
  ): Record<string, string> | undefined {
    const normalizedRequestLabels =
      labels && Object.keys(labels).length > 0 ? { ...labels } : undefined;
    if (!cwd) {
      return normalizedRequestLabels;
    }
    const key = path.resolve(cwd);
    const cached = recentCreationContext.get(key);
    if (cached) {
      recentCreationContext.delete(key);
    }
    return mergeLabels(normalizedRequestLabels, cached?.labels);
  }

  function routeAgentConfig<
    T extends {
      provider: string;
      model?: string | null;
      title?: string | null;
    },
  >(
    config: T,
    text: string,
    hookStage: string,
    mergedLabels?: Readonly<Record<string, string>>,
  ): T {
    const roleDecision = detectDomainRole({ text, labels: mergedLabels, homeDir: os.homedir() });

    let decision = resolveMatrixModel({
      provider: config.provider,
      currentModel: config.model,
      text,
      overrideIfDefaultOnly: cachedSettings.overrideIfDefaultOnly,
    });

    const normalizedProvider = normalizeProvider(config.provider);
    // If an explicit role label is provided (e.g. role: review or role: pm) and model wasn't locked by user choice
    if (
      roleDecision.matchedRule.startsWith("label:") &&
      normalizedProvider !== SAFETY_NET_PROVIDER &&
      !decision.matchedRule.startsWith("preserve_user_choice")
    ) {
      const preferredTier = ROLE_PREFERRED_TIER[roleDecision.role];
      const mapping = Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, normalizedProvider)
        ? DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]
        : undefined;
      if (preferredTier && mapping) {
        decision = {
          tier: preferredTier,
          targetModel: mapping[preferredTier],
          reason: `Routed to ${preferredTier} model '${mapping[preferredTier]}' by explicit role label '${roleDecision.role}'`,
          matchedRule: `role_tier:${roleDecision.role}`,
          previousModel: config.model ?? undefined,
        };
      }
    }

    const hasTitle = Boolean(config.title?.trim());
    let nextTitle = config.title;
    if (!hasTitle && text) {
      nextTitle = truncateByCodePoints(text, TITLE_PREVIEW_MAX_CODE_POINTS);
    }
    const nextModel =
      decision.targetModel && decision.targetModel !== config.model
        ? decision.targetModel
        : config.model;

    if (nextModel !== config.model || nextTitle !== config.title) {
      if (cachedSettings.debugLogs && nextModel !== config.model) {
        console.log(
          `[AgentHarness] (${hookStage}) Routed agent (${config.provider}, len=${text.length}): ` +
            `'${config.model ?? "(default)"}' -> '${nextModel}' [tier: ${decision.tier}, rule: ${decision.matchedRule}]`,
        );
      }

      return {
        ...config,
        model: nextModel,
        title: nextTitle,
      };
    }

    return config;
  }

  // Hook 1: workspace.create.before
  const removeWorkspaceHook = server.addHook("workspace.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    const prompt =
      request.firstAgentContext?.prompt?.trim() ||
      request.agent?.initialPrompt?.trim() ||
      request.title?.trim() ||
      "";

    const mergedLabels = mergeLabels(
      readStringLabels(request.agent?.config),
      readStringLabels(request),
    );

    if (!prompt && !mergedLabels) {
      return request;
    }

    if (request.source.kind === "directory" && request.source.path) {
      rememberCreationContext(request.source.path, prompt, mergedLabels);
    }

    if (request.agent?.config) {
      const nextConfig = routeAgentConfig(
        request.agent.config,
        prompt,
        "workspace.create",
        mergedLabels,
      );
      if (nextConfig !== request.agent.config) {
        return {
          ...request,
          agent: {
            ...request.agent,
            config: nextConfig,
          },
        };
      }
    }

    return request;
  });

  // Hook 2: agent.create.before
  const removeAgentHook = server.addHook("agent.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    const config = request.config;
    const explicitTitle = config.title?.trim() ?? "";
    const promptOrTitle = resolveContextText(config.cwd, config.title);
    const cachedLabels = config.cwd
      ? recentCreationContext.get(path.resolve(config.cwd))?.labels
      : undefined;
    const mergedLabels = mergeLabels(
      mergeLabels(readStringLabels(config), readStringLabels(request)),
      cachedLabels,
    );

    if (config.cwd && (explicitTitle || mergedLabels)) {
      rememberCreationContext(config.cwd, promptOrTitle || explicitTitle, mergedLabels);
    }

    const nextConfig = routeAgentConfig(config, promptOrTitle, "agent.create", mergedLabels);
    if (nextConfig !== config) {
      return {
        ...request,
        config: nextConfig,
      };
    }

    return request;
  });

  // Hook 3: agent.open.before
  // Injects Capability Harness environment variables (PASEO_HARNESS_ROLE, PASEO_HARNESS_PROFILE, LAZY_TOOL_CONFIG)
  const removeOpenHook = server.addHook("agent.open.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    if (normalizeProvider(request.provider) === SAFETY_NET_PROVIDER) {
      consumeContextLabels(request.cwd, request.labels);
      return request;
    }

    const textContext = resolveContextText(request.cwd, request.title);
    const labelsContext = consumeContextLabels(request.cwd, request.labels);

    const roleDecision = detectDomainRole({
      text: textContext,
      labels: labelsContext,
      homeDir: os.homedir(),
    });

    const nextEnv = resolveHarnessEnv({
      role: roleDecision.role,
      existingEnv: request.env,
      homeDir: os.homedir(),
    });

    if (cachedSettings.debugLogs) {
      console.log(
        `[AgentHarness] (agent.open) Mounted Capability Harness for ${request.agentId} (${request.provider}): ` +
          `role='${roleDecision.role}' [rule: ${roleDecision.matchedRule}]`,
      );
    }

    return {
      ...request,
      env: nextEnv,
    };
  });

  return () => {
    unsubscribeSettings();
    removeWorkspaceHook();
    removeAgentHook();
    removeOpenHook();
    recentCreationContext.clear();
  };
}
