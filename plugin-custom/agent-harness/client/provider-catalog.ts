import { normalizeProviderName } from "../shared/config-resolver.js";
import { isModelBypassed } from "../shared/intent-detector.js";
import { BUILTIN_BYPASS_MODELS, BUILTIN_PROVIDER_MAPPINGS } from "../shared/presets.js";
import type { HostProviderModelInfo, HostProviderRuntimeInfo } from "../shared/types.js";

export interface InspectAvailableProviderEntry {
  provider: string;
  enabled: boolean;
  status?: string;
  label?: string;
  defaultModel?: string;
  models: string[];
  modelDetails?: HostProviderModelInfo[];
}

export interface InspectedProviderEntry {
  provider: string;
  enabled: boolean;
  status?: string;
  label?: string;
  defaultModel?: string;
  models: string[];
  modelDetails: HostProviderModelInfo[];
  hostRuntimeInfo: HostProviderRuntimeInfo;
}

export const DEFAULT_KNOWN_PROVIDERS = [
  "antigravity",
  "claude",
  "codex",
  "opencode",
  "pi",
] as const;

export const ANTIGRAVITY_OFFLINE_MODELS = [
  "gemini-4-hydrogen",
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-4-neon",
] as const;

export function formatProviderDisplayLabel(providerId: string): string {
  switch (providerId) {
    case "antigravity":
      return "Antigravity";
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
    default:
      return providerId;
  }
}

export function formatProviderStatusSuffix(status: { enabled?: boolean } | undefined): string {
  if (!status) {
    return "";
  }
  return status.enabled ? " · Active" : " · Disabled";
}

export function isSelectableRoutingModel(
  _providerId: string,
  modelId: string,
  bypassModels: readonly string[] = BUILTIN_BYPASS_MODELS,
): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return false;
  }
  if (/^gemini-3/i.test(trimmed) || isModelBypassed(trimmed, bypassModels)) {
    return false;
  }
  return true;
}

export function buildInspectedProviderMap(
  availableProviders?: readonly InspectAvailableProviderEntry[] | null,
): Map<string, InspectedProviderEntry> {
  const map = new Map<string, InspectedProviderEntry>();
  if (!Array.isArray(availableProviders)) {
    return map;
  }
  for (const item of availableProviders) {
    if (!item || typeof item.provider !== "string") {
      continue;
    }
    const norm = normalizeProviderName(item.provider);
    if (!norm) {
      continue;
    }
    const models = Array.isArray(item.models)
      ? item.models.filter((m: unknown): m is string => typeof m === "string" && Boolean(m.trim()))
      : [];
    const rawDetails = Array.isArray(item.modelDetails) ? item.modelDetails : [];
    const modelDetails: HostProviderModelInfo[] =
      rawDetails.length > 0
        ? rawDetails.filter((d: unknown): d is HostProviderModelInfo =>
            Boolean(d && typeof (d as { id?: unknown }).id === "string"),
          )
        : models.map((id: string) => ({ id }));
    const hostRuntimeInfo: HostProviderRuntimeInfo = {
      provider: item.provider,
      enabled: Boolean(item.enabled),
      ...(typeof item.status === "string" ? { status: item.status } : {}),
      ...(typeof item.label === "string" ? { label: item.label } : {}),
      ...(typeof item.defaultModel === "string" ? { defaultModel: item.defaultModel } : {}),
      models: modelDetails,
    };
    map.set(norm, {
      provider: item.provider,
      enabled: Boolean(item.enabled),
      status: typeof item.status === "string" ? item.status : undefined,
      label: typeof item.label === "string" ? item.label : undefined,
      defaultModel: typeof item.defaultModel === "string" ? item.defaultModel : undefined,
      models,
      modelDetails,
      hostRuntimeInfo,
    });
  }
  return map;
}

export function resolveActiveHostProviderId(
  availableProviders?: readonly InspectAvailableProviderEntry[] | null,
  fallback = "antigravity",
): string {
  if (!Array.isArray(availableProviders) || availableProviders.length === 0) {
    return fallback;
  }
  const enabledList = availableProviders.filter(
    (item) => item && typeof item.provider === "string" && item.enabled === true,
  );
  const antigravityEntry = enabledList.find(
    (item) => normalizeProviderName(item.provider) === "antigravity",
  );
  if (antigravityEntry) {
    return normalizeProviderName(antigravityEntry.provider);
  }
  if (enabledList.length > 0) {
    return normalizeProviderName(enabledList[0]!.provider);
  }
  return fallback;
}

export function buildOrderedProviderIds(
  availableProviders?: readonly InspectAvailableProviderEntry[] | null,
  configuredProviderKeys: readonly string[] = DEFAULT_KNOWN_PROVIDERS,
): string[] {
  const enabledIds: string[] = [];
  const disabledIds: string[] = [];
  const seen = new Set<string>();

  for (const item of availableProviders ?? []) {
    if (!item || typeof item.provider !== "string") {
      continue;
    }
    const norm = normalizeProviderName(item.provider);
    if (!norm || seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    if (item.enabled) {
      enabledIds.push(norm);
    } else {
      disabledIds.push(norm);
    }
  }

  const remainingIds: string[] = [];
  for (const key of configuredProviderKeys) {
    const norm = normalizeProviderName(key);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      remainingIds.push(norm);
    }
  }

  return [...enabledIds, ...remainingIds, ...disabledIds];
}

export function resolveProviderSelectableModels(options: {
  providerId: string;
  inspectedProviderMap: ReadonlyMap<string, InspectedProviderEntry>;
  bypassModels?: readonly string[];
  configuredMappings?: Readonly<Record<string, Record<string, string>>>;
}): string[] {
  const {
    providerId,
    inspectedProviderMap,
    bypassModels = BUILTIN_BYPASS_MODELS,
    configuredMappings,
  } = options;
  const norm = normalizeProviderName(providerId);
  const liveSet = new Set<string>();
  const inspected = inspectedProviderMap.get(norm);

  if (inspected) {
    for (const detail of inspected.modelDetails) {
      if (isSelectableRoutingModel(norm, detail.id, bypassModels)) {
        liveSet.add(detail.id.trim());
      }
    }
    for (const model of inspected.models) {
      if (isSelectableRoutingModel(norm, model, bypassModels)) {
        liveSet.add(model.trim());
      }
    }
  }

  if (liveSet.size > 0) {
    return Array.from(liveSet);
  }

  const fallbackSet = new Set<string>();
  if (norm === "antigravity") {
    for (const model of ANTIGRAVITY_OFFLINE_MODELS) {
      if (isSelectableRoutingModel(norm, model, bypassModels)) {
        fallbackSet.add(model);
      }
    }
  }
  const configured = configuredMappings?.[norm];
  if (configured) {
    for (const model of Object.values(configured)) {
      if (typeof model === "string" && isSelectableRoutingModel(norm, model, bypassModels)) {
        fallbackSet.add(model.trim());
      }
    }
  }
  const builtin = BUILTIN_PROVIDER_MAPPINGS[norm];
  if (builtin) {
    for (const model of Object.values(builtin)) {
      if (typeof model === "string" && isSelectableRoutingModel(norm, model, bypassModels)) {
        fallbackSet.add(model.trim());
      }
    }
  }
  return Array.from(fallbackSet);
}
