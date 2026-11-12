import {
  HARNESS_METADATA_KEY,
  type DomainRole,
  type HandoffTargetRole,
  type HarnessAgentMetadata,
  type MatrixTier,
} from "../shared/types.js";
import { HarnessAgentMetadataSchema, type HarnessTransitionPayload } from "../shared/contracts.js";

/** Capitalizes the first character of a string. */
export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Formats a domain role for compact UI display (UI, PM, QA in all-caps, review as Gate, etc.) */
export function formatRoleDisplayName(role: DomainRole | HandoffTargetRole | string): string {
  const normalized = role.toLowerCase().trim();
  switch (normalized) {
    case "ui":
      return "UI";
    case "pm":
      return "PM";
    case "qa":
      return "QA";
    case "review":
      return "Gate";
    case "backend":
      return "Backend";
    case "architect":
      return "Architect";
    case "orchestrator":
      return "Orchestrator";
    case "scout":
      return "Scout";
    case "general":
      return "General";
    default:
      return capitalize(normalized);
  }
}

/**
 * Safely extracts and validates `HarnessAgentMetadata` from an agent metadata dictionary.
 * Returns null if missing or schema validation fails.
 */
export function extractAgentHarnessMetadata(metadata: unknown): HarnessAgentMetadata | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const rawHarness = (metadata as Record<string, unknown>)[HARNESS_METADATA_KEY];
  if (!rawHarness || typeof rawHarness !== "object") {
    return null;
  }
  const result = HarnessAgentMetadataSchema.safeParse(rawHarness);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Formats the Composer Pill button label for Agent Harness:
 * - `null` -> "Harness"
 * - Dual-state separation (lastBilledTier !== null && lastBilledTier !== currentTier):
 *   Honest dual-state copy, e.g. "Next: Flash · Billed: Plan"
 * - Unified state: Compact copy, e.g. "Plan · UI", "Flash · Backend", "Review · Gate"
 */
export function formatHarnessPillLabel(meta: HarnessAgentMetadata | null): string {
  if (!meta) {
    return "Harness";
  }

  const { currentTier, lastBilledTier, role } = meta;

  // Dual-state separation: pending next turn configuration differs from what billed the last turn
  if (lastBilledTier !== null && lastBilledTier !== currentTier) {
    return `Next: ${capitalize(currentTier)} · Billed: ${capitalize(lastBilledTier)}`;
  }

  const tierDisplay = capitalize(currentTier);
  const roleDisplay = formatRoleDisplayName(role);
  return `${tierDisplay} · ${roleDisplay}`;
}

/**
 * Resolves the Lucide icon for the Composer Pill:
 * - "plan" -> "Compass"
 * - "review" -> "ShieldCheck"
 * - others (flash, null) -> "Zap"
 */
export function resolveHarnessPillIcon(meta: HarnessAgentMetadata | null): string {
  if (!meta) {
    return "Zap";
  }
  switch (meta.currentTier) {
    case "plan":
      return "Compass";
    case "review":
      return "ShieldCheck";
    case "flash":
    default:
      return "Zap";
  }
}

export type TransitionBadgeCategory = "accent" | "success" | "warning";

export interface TransitionViewModel {
  title: string;
  badgeCategory: TransitionBadgeCategory;
  icon: string;
  tierSummary: string;
  modelSummary: string;
  fullMigrationSummary: string;
  readableReason: string;
  turnLabel: string;
  turnNumber: number;
  phase: string;
  childAgentId: string | null;
  childAgentTitle: string | null;
  timestamp: string;
}

const REASON_HUMAN_READABLE: Record<string, string> = {
  explicit_exec_intent: "User prompt requested immediate execution",
  write_tool_in_plan: "Write/modification tool detected during plan phase",
  plan_turn_soft_limit: "Soft turn limit reached during plan phase",
  plan_approved: "Plan mode exit approved by user",
  manual_switch: "Manual model tier switch",
  specialist_handoff: "Spawned dedicated specialist subagent",
  initial_route: "Initial domain role and model tier assigned",
};

/**
 * Transforms a raw HarnessTransitionPayload into a strongly-typed ViewModel
 * for the Transition Card timeline component.
 */
export function buildTransitionViewModel(payload: HarnessTransitionPayload): TransitionViewModel {
  let title = "Harness Transition";
  let badgeCategory: TransitionBadgeCategory = "accent";
  let icon = "Zap";

  switch (payload.transitionKind) {
    case "initial_route":
      title = "Initial Route";
      badgeCategory = "accent";
      icon = "Compass";
      break;
    case "plan_approved":
      title = "Plan Approved -> Flash";
      badgeCategory = "success";
      icon = "ShieldCheck";
      break;
    case "auto_downgrade":
      title = "Auto Downgraded -> Flash";
      badgeCategory = "warning";
      icon = "Zap";
      break;
    case "manual_switch":
      title = "Manual Tier Switch";
      badgeCategory = "accent";
      icon = "Sliders";
      break;
    case "specialist_handoff":
      title = "Specialist Handoff";
      badgeCategory = "accent";
      icon = "GitFork";
      break;
  }

  const tierSummary = payload.fromTier
    ? `${capitalize(payload.fromTier)} -> ${capitalize(payload.toTier)}`
    : capitalize(payload.toTier);

  const modelSummary = payload.fromModel
    ? `${payload.fromModel} -> ${payload.toModel ?? "—"}`
    : (payload.toModel ?? "—");

  const fullMigrationSummary = payload.fromTier
    ? `${payload.fromTier}${payload.fromModel ? ` (${payload.fromModel})` : ""} -> ${payload.toTier}${payload.toModel ? ` (${payload.toModel})` : ""}`
    : `${payload.toTier}${payload.toModel ? ` (${payload.toModel})` : ""}`;

  const readableReason = REASON_HUMAN_READABLE[payload.reason] ?? payload.reason;

  return {
    title,
    badgeCategory,
    icon,
    tierSummary,
    modelSummary,
    fullMigrationSummary,
    readableReason,
    turnLabel: `Turn #${payload.turnNumber}`,
    turnNumber: payload.turnNumber,
    phase: payload.phase,
    childAgentId: payload.childAgentId ?? null,
    childAgentTitle: payload.childAgentTitle ?? null,
    timestamp: payload.timestamp,
  };
}
