import { evaluateQuickPrompts } from "./quick-prompt-matcher";
import type { QuickPromptItem, QuickPromptAgentStatus } from "@getpaseo/protocol/quick-prompts";

export interface ResolveEffectiveQuickPromptsInput {
  globalItems: readonly QuickPromptItem[];
  projectItems?: readonly QuickPromptItem[] | null;
  disabledGlobalIds?: readonly string[] | null;
  lastAssistantText?: string | null;
  agentStatus?: QuickPromptAgentStatus | null;
  locale?: string;
  disableEphemeral?: boolean;
}

export function resolveEffectiveQuickPrompts(
  input: ResolveEffectiveQuickPromptsInput,
): QuickPromptItem[] {
  const disabledSet = new Set(input.disabledGlobalIds ?? []);

  // Filter global items: must not be disabled for this project
  const activeGlobals = input.globalItems.filter(
    (item) => item.enabled && !disabledSet.has(item.id),
  );

  // Project items: must be enabled
  const activeProject = (input.projectItems ?? []).filter((item) => item.enabled);

  // Project items first, then global items
  const combined = [...activeProject, ...activeGlobals];

  return evaluateQuickPrompts({
    items: combined,
    lastAssistantText: input.lastAssistantText,
    agentStatus: input.agentStatus,
    locale: input.locale,
    disableEphemeral: input.disableEphemeral,
  });
}
