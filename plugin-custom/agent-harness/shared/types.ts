export type MatrixTier = "plan" | "review" | "flash";

export type DomainRole =
  | "orchestrator"
  | "ui"
  | "backend"
  | "pm"
  | "architect"
  | "qa"
  | "review"
  | "scout"
  | "general";

export type HandoffTargetRole = "ui" | "backend" | "qa" | "review";

export type ProviderModelMapping = Record<MatrixTier, string>;

export interface RouterDecision {
  tier: MatrixTier;
  targetModel: string;
  reason: string;
  matchedRule: string;
  previousModel?: string;
}

export interface DomainRoleDecision {
  role: DomainRole;
  matchedRule: string;
  profilePath: string;
  lazyToolConfigPath: string;
}

/** Top-level key stored inside `agent.metadata` for Agent Harness lifecycle tracking. */
export const HARNESS_METADATA_KEY = "agentHarness" as const;

/** Schema version for persisted `HarnessAgentMetadata` records. */
export const HARNESS_METADATA_VERSION = 1 as const;

/** Execution lifecycle phase decoupled from domain role. */
export type HarnessPhase = "design" | "exec" | "review";

/** Trigger reason recorded when a model tier transition or specialist handoff occurs. */
export type HarnessDowngradeReason =
  | "explicit_exec_intent"
  | "write_tool_in_plan"
  | "plan_turn_soft_limit"
  | "plan_approved"
  | "manual_switch"
  | "specialist_handoff";

/** Timeline transition event classification emitted to Paseo timeline. */
export type HarnessTransitionKind =
  | "initial_route"
  | "plan_approved"
  | "auto_downgrade"
  | "manual_switch"
  | "specialist_handoff";

/**
 * Persisted per-agent lifecycle state stored under `agent.metadata.agentHarness`.
 *
 * Declared as a structural `type` alias with explicit `| null` fields (no `undefined`)
 * so instances are directly assignable to Paseo `JsonValue` and `Record<string, JsonValue>`.
 *
 * Mirrors DeepSeek Harness `{ lastUsed, pending }` dual-state projection:
 * - `currentTier` / `currentModel`: pending configuration that will execute the NEXT turn.
 * - `lastBilledTier` / `lastBilledModel`: actual configuration that billed the LAST completed turn.
 */
export type HarnessAgentMetadata = {
  version: number;
  role: DomainRole;
  initialTier: MatrixTier;
  currentTier: MatrixTier;
  currentModel: string | null;
  phase: HarnessPhase;
  roleMatchedRule: string;
  tierMatchedRule: string;
  userModelLocked: boolean;
  roleLockedByLabel: boolean;
  turnCount: number;
  planTurnCount: number;
  writeToolDetectedInPlan: boolean;
  handoffSuggestedAtTurn: number | null;
  autoDowngradedAtTurn: number | null;
  downgradeReason: HarnessDowngradeReason | null;
  lastProcessedTurnId: string | null;
  resumeModeId: string | null;
  lastBilledTier: MatrixTier | null;
  lastBilledModel: string | null;
};
