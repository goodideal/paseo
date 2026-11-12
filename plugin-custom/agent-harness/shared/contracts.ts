import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type {
  DomainRole,
  HandoffTargetRole,
  HarnessAgentMetadata,
  HarnessDowngradeReason,
  HarnessPhase,
  HarnessTransitionKind,
  MatrixTier,
} from "./types.js";

// ============================================================================
// Pure Wire Schemas (No .transform(), .catch(), or .preprocess())
// ============================================================================

export const MatrixTierSchema = z.enum(["plan", "review", "flash"]);
export const DomainRoleSchema = z.enum([
  "orchestrator",
  "ui",
  "backend",
  "pm",
  "architect",
  "qa",
  "review",
  "scout",
  "general",
]);
export const HandoffTargetRoleSchema = z.enum(["ui", "backend", "qa", "review"]);
export const HarnessPhaseSchema = z.enum(["design", "exec", "review"]);
export const HarnessDowngradeReasonSchema = z.enum([
  "explicit_exec_intent",
  "write_tool_in_plan",
  "plan_turn_soft_limit",
  "plan_approved",
  "manual_switch",
  "specialist_handoff",
]);
export const HarnessTransitionKindSchema = z.enum([
  "initial_route",
  "plan_approved",
  "auto_downgrade",
  "manual_switch",
  "specialist_handoff",
]);

export const HarnessAgentMetadataSchema = z.object({
  version: z.number().int(),
  role: DomainRoleSchema,
  initialTier: MatrixTierSchema,
  currentTier: MatrixTierSchema,
  currentModel: z.string().nullable(),
  phase: HarnessPhaseSchema,
  roleMatchedRule: z.string(),
  tierMatchedRule: z.string(),
  userModelLocked: z.boolean(),
  roleLockedByLabel: z.boolean(),
  turnCount: z.number().int(),
  planTurnCount: z.number().int(),
  writeToolDetectedInPlan: z.boolean(),
  handoffSuggestedAtTurn: z.number().int().nullable(),
  autoDowngradedAtTurn: z.number().int().nullable(),
  downgradeReason: HarnessDowngradeReasonSchema.nullable(),
  lastProcessedTurnId: z.string().nullable(),
  resumeModeId: z.string().nullable(),
  lastBilledTier: MatrixTierSchema.nullable(),
  lastBilledModel: z.string().nullable(),
});

// Compile-time structural parity guard between HarnessAgentMetadata and its Zod schema
type AssertMetadataParity =
  z.infer<typeof HarnessAgentMetadataSchema> extends HarnessAgentMetadata
    ? HarnessAgentMetadata extends z.infer<typeof HarnessAgentMetadataSchema>
      ? true
      : never
    : never;
const _assertMetadataParity: AssertMetadataParity = true;
void _assertMetadataParity;

// ============================================================================
// Timeline Transition Contract
// ============================================================================

export const HARNESS_TRANSITION_TIMELINE_KIND = "harness-transition" as const;
export const HARNESS_TRANSITION_TIMELINE_VERSION = 1 as const;

export const HarnessTransitionPayloadSchema = z.object({
  transitionKind: HarnessTransitionKindSchema,
  role: DomainRoleSchema,
  fromTier: MatrixTierSchema.nullable(),
  toTier: MatrixTierSchema,
  fromModel: z.string().nullable(),
  toModel: z.string().nullable(),
  phase: HarnessPhaseSchema,
  reason: z.string(),
  turnNumber: z.number().int().min(0),
  childAgentId: z.string().nullable().optional(),
  childAgentTitle: z.string().nullable().optional(),
  timestamp: z.string(),
});

export type HarnessTransitionPayload = z.infer<typeof HarnessTransitionPayloadSchema>;

/**
 * Strict JsonValue-compatible shape for `handle.timeline.append({ data })`
 * (uses explicit `| null` without `undefined`).
 */
export type HarnessTransitionWireData = {
  transitionKind: HarnessTransitionKind;
  role: DomainRole;
  fromTier: MatrixTier | null;
  toTier: MatrixTier;
  fromModel: string | null;
  toModel: string | null;
  phase: HarnessPhase;
  reason: string;
  turnNumber: number;
  childAgentId: string | null;
  childAgentTitle: string | null;
  timestamp: string;
};

export function createHarnessTransitionTimelineItem(
  data: HarnessTransitionWireData,
  id: string,
): {
  type: "plugin";
  id: string;
  kind: typeof HARNESS_TRANSITION_TIMELINE_KIND;
  version: typeof HARNESS_TRANSITION_TIMELINE_VERSION;
  data: HarnessTransitionWireData;
} {
  return {
    type: "plugin",
    id,
    kind: HARNESS_TRANSITION_TIMELINE_KIND,
    version: HARNESS_TRANSITION_TIMELINE_VERSION,
    data,
  };
}

// ============================================================================
// Host Agent Tool Contract (`harness_handoff`)
// ============================================================================

export const HARNESS_HANDOFF_TOOL_NAME = "harness_handoff" as const;

export const HarnessHandoffToolInputSchema = z.object({
  targetRole: HandoffTargetRoleSchema.describe(
    "Specialist domain role to spawn in the current workspace: ui, backend, qa, or review.",
  ),
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Concise task title for the spawned specialist agent."),
  specPrompt: z
    .string()
    .min(1)
    .describe(
      "Self-contained specification, file boundaries, and verification commands for the specialist.",
    ),
  waitForCompletion: z
    .boolean()
    .optional()
    .describe(
      "When true, waits for the specialist first turn to complete and returns its final text; defaults to false.",
    ),
});

export type HarnessHandoffToolInput = z.infer<typeof HarnessHandoffToolInputSchema>;

export const HarnessHandoffToolOutputSchema = z.object({
  childAgentId: z.string(),
  childTitle: z.string(),
  workspaceId: z.string().nullable(),
  targetRole: HandoffTargetRoleSchema,
  targetTier: MatrixTierSchema,
  targetModel: z.string(),
  status: z.enum(["spawned", "completed", "failed", "timeout"]),
  finalText: z.string().nullable(),
});

export type HarnessHandoffToolOutput = z.infer<typeof HarnessHandoffToolOutputSchema>;

// ============================================================================
// Client <-> Server RPC Contracts
// ============================================================================

export const harnessSwitchTierRpc = defineRpc({
  name: "agent_harness.tier.switch.request",
  input: z.object({
    agentId: z.string().min(1),
    targetTier: MatrixTierSchema,
    currentModeId: z.string().nullable().optional(),
    reason: z.string().optional(),
  }),
  output: z.object({
    agentId: z.string(),
    previousTier: MatrixTierSchema.nullable(),
    currentTier: MatrixTierSchema,
    previousModel: z.string().nullable(),
    currentModel: z.string(),
    phase: HarnessPhaseSchema,
    /**
     * Mode ID that the client composer should synchronize via `composers[0]?.setMode(recommendedModeId)`
     * when non-null (e.g. restoring `resumeModeId` / `"acceptEdits"` / `"build"` when switching out of `plan`).
     */
    recommendedModeId: z.string().nullable(),
    metadata: HarnessAgentMetadataSchema,
  }),
});

export type HarnessSwitchTierInput = z.infer<typeof harnessSwitchTierRpc.input>;
export type HarnessSwitchTierOutput = z.infer<typeof harnessSwitchTierRpc.output>;

export const harnessHandoffRpc = defineRpc({
  name: "agent_harness.specialist.handoff.request",
  input: z.object({
    agentId: z.string().min(1),
    workspaceId: z.string().nullable().optional(),
    targetRole: HandoffTargetRoleSchema,
    summaryOverride: z.string().optional(),
  }),
  output: z.object({
    parentAgentId: z.string(),
    childAgentId: z.string(),
    childTitle: z.string(),
    workspaceId: z.string().nullable(),
    targetRole: HandoffTargetRoleSchema,
    targetTier: MatrixTierSchema,
    targetModel: z.string(),
  }),
});

export type HarnessHandoffInput = z.infer<typeof harnessHandoffRpc.input>;
export type HarnessHandoffOutput = z.infer<typeof harnessHandoffRpc.output>;

// ============================================================================
// Shared Pure Helpers (Provider Plan Mode & Specialist Tier Mapping)
// ============================================================================

export const NATIVE_PLAN_MODE_PROVIDERS = ["claude", "opencode"] as const;

export function supportsNativePlanMode(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === "claude" || normalized === "claude-code" || normalized === "opencode";
}

/**
 * Resolves the execution mode to restore when exiting native `"plan"` mode:
 * - Uses `resumeModeId` if saved and not `"plan"`.
 * - Falls back to `"acceptEdits"` for Claude and `"build"` for OpenCode.
 */
export function resolveResumeExecutionModeId(
  provider: string,
  resumeModeId: string | null | undefined,
): string | null {
  if (resumeModeId && resumeModeId.trim() && resumeModeId.trim() !== "plan") {
    return resumeModeId.trim();
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code") {
    return "acceptEdits";
  }
  if (normalized === "opencode") {
    return "build";
  }
  return null;
}

export function resolveSpecialistTargetTier(role: HandoffTargetRole): MatrixTier {
  return role === "review" ? "review" : "flash";
}

export function formatSpecialistRolePrefix(role: HandoffTargetRole | DomainRole): string {
  switch (role) {
    case "ui":
      return "[UI]";
    case "backend":
      return "[Backend]";
    case "qa":
      return "[QA]";
    case "review":
      return "[Review]";
    case "architect":
      return "[Architect]";
    case "pm":
      return "[PM]";
    case "orchestrator":
      return "[Orchestrator]";
    case "scout":
      return "[Scout]";
    default:
      return "[Specialist]";
  }
}

export type { HarnessDowngradeReason };
