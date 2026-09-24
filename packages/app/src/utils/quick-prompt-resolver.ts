import { evaluateQuickPrompts } from "./quick-prompt-matcher";
import type { QuickPromptItem, QuickPromptAgentStatus } from "@getpaseo/protocol/quick-prompts";

export interface ResolveEffectiveQuickPromptsInput {
  globalItems: readonly QuickPromptItem[];
  projectItems?: readonly QuickPromptItem[] | null;
  disabledGlobalIds?: readonly string[] | null;
  order?: readonly string[] | null;
  lastAssistantText?: string | null;
  agentStatus?: QuickPromptAgentStatus | null;
  agentProfileId?: string | readonly string[] | null;
  locale?: string;
  disableEphemeral?: boolean;
}

export interface AgentProfileMatchCandidate {
  provider?: string | null;
  model?: string | null;
  currentModeId?: string | null;
  thinkingOptionId?: string | null;
  labels?: Record<string, string> | null;
}

export interface AgentProfileDefinition {
  id: string;
  name: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
}

export function resolveActiveAgentProfileIds(
  agent: AgentProfileMatchCandidate | null | undefined,
  profiles?: readonly AgentProfileDefinition[] | null,
): string[] {
  if (!agent) return [];
  const matched = new Set<string>();

  if (agent.labels) {
    if (agent.labels.profileId) matched.add(agent.labels.profileId);
    if (agent.labels.profile) matched.add(agent.labels.profile);
  }

  if (profiles && agent.provider) {
    for (const p of profiles) {
      if (p.provider !== agent.provider) continue;
      if (p.model && p.model.trim() && p.model.trim() !== agent.model) continue;
      if (p.modeId && p.modeId.trim() && p.modeId.trim() !== agent.currentModeId) continue;
      if (
        p.thinkingOptionId &&
        p.thinkingOptionId.trim() &&
        p.thinkingOptionId.trim() !== agent.thinkingOptionId
      ) {
        continue;
      }
      matched.add(p.id);
      matched.add(p.name);
    }
  }

  return Array.from(matched);
}

export function resolveEffectiveQuickPrompts(
  input: ResolveEffectiveQuickPromptsInput,
): QuickPromptItem[] {
  const disabledSet = new Set(input.disabledGlobalIds ?? []);

  // Filter global items: must not be disabled for this project, sorted by their order
  const activeGlobals = input.globalItems
    .filter((item) => item.enabled && !disabledSet.has(item.id))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Project items: must be enabled
  const rawProject = (input.projectItems ?? []).filter((item) => item.enabled);
  const activeProject = rawProject.slice().sort((a, b) => {
    if (input.order && input.order.length > 0) {
      const idxA = input.order.indexOf(a.id);
      const idxB = input.order.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
    }
    return (a.order ?? 0) - (b.order ?? 0);
  });

  // Project items first, then global items.
  // Re-index orders sequentially so that evaluateQuickPrompts's internal sort
  // preserves project items strictly before global items and preserves their respective orders!
  const combined = [
    ...activeProject.map((item, index) => Object.assign({}, item, { order: index })),
    ...activeGlobals.map((item, index) =>
      Object.assign({}, item, { order: activeProject.length + index }),
    ),
  ];

  return evaluateQuickPrompts({
    items: combined,
    lastAssistantText: input.lastAssistantText,
    agentStatus: input.agentStatus,
    agentProfileId: input.agentProfileId,
    locale: input.locale,
    disableEphemeral: input.disableEphemeral,
  });
}
