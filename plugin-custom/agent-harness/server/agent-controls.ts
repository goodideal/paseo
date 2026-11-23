import type { PaseoAgentHandle, PaseoApi } from "@getpaseo/client";

type OptionalAgentHandleControls = PaseoAgentHandle & {
  setMode?: (modeId: string) => Promise<unknown>;
  setThinkingOption?: (thinkingOptionId: string | null) => Promise<unknown>;
};

function getAgentHandleControls(
  paseo: PaseoApi | null | undefined,
  agentId: string,
): OptionalAgentHandleControls | null {
  if (!agentId || !paseo?.agents?.ref) {
    return null;
  }
  return paseo.agents.ref(agentId) as OptionalAgentHandleControls;
}

/**
 * Applies a live session mode update when supported by the runtime PaseoAgentHandle.
 * Standard `@getpaseo/client` server handles only expose `setModel`/`setMetadata`/`setOptions`;
 * interactive UI mode sync uses `PluginComposer.setMode` via `useComposers`.
 */
export async function applyAgentModeOption(
  paseo: PaseoApi | null | undefined,
  agentId: string,
  modeId: string | null | undefined,
): Promise<boolean> {
  if (!modeId?.trim()) {
    return false;
  }
  const handle = getAgentHandleControls(paseo, agentId);
  if (typeof handle?.setMode !== "function") {
    return false;
  }
  try {
    await handle.setMode(modeId.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies a live thinking option update when supported by the runtime PaseoAgentHandle.
 * Interactive UI thinking sync uses `PluginComposer.setThinking` via `useComposers`.
 */
export async function applyAgentThinkingOption(
  paseo: PaseoApi | null | undefined,
  agentId: string,
  thinkingOptionId: string | null | undefined,
): Promise<boolean> {
  const handle = getAgentHandleControls(paseo, agentId);
  if (typeof handle?.setThinkingOption !== "function") {
    return false;
  }
  try {
    const normalized =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim()
        ? thinkingOptionId.trim()
        : null;
    await handle.setThinkingOption(normalized);
    return true;
  } catch {
    return false;
  }
}
