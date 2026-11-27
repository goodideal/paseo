import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { HarnessSpecialistConfigSchema } from "./settings.js";
import type {
  DomainRole,
  HandoffTargetRole,
  HarnessAgentMetadata,
  HarnessDowngradeReason,
  HarnessPhase,
  HarnessTransitionKind,
  MatrixTier,
} from "./types.js";

/* Pure Wire Schemas (No .transform(), .catch(), or .preprocess()) */

export const MatrixTierSchema = z.string().min(1).max(64);
export const DomainRoleSchema = z.string().min(1).max(64);
export const HandoffTargetRoleSchema = z.string().min(1).max(64);
export const HarnessPhaseSchema = z.string().min(1).max(64);

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
  currentThinking: z.string().nullable().optional(),
  lastBilledThinking: z.string().nullable().optional(),
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

/* Timeline Transition Contract */

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
// oxlint-disable-next-line typescript/consistent-type-definitions -- structural type alias required for JsonValue assignability
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

/* Host Agent Tool Contract (`harness_handoff`) */

export const HARNESS_HANDOFF_TOOL_NAME = "harness_handoff" as const;

export const HarnessHandoffToolInputSchema = z.object({
  targetRole: HandoffTargetRoleSchema.describe(
    "Specialist domain role to spawn in the current workspace (e.g. ui, backend, qa, review, or custom specialist).",
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

/* Client <-> Server RPC Contracts */

export const harnessSwitchTierRpc = defineRpc({
  name: "agent_harness.tier.switch.request",
  input: z.object({
    agentId: z.string().min(1),
    targetTier: MatrixTierSchema,
    targetPhase: HarnessPhaseSchema.optional(),
    currentModeId: z.string().nullable().optional(),
    reason: z.string().optional(),
  }),
  output: z.object({
    agentId: z.string(),
    previousTier: MatrixTierSchema.nullable(),
    currentTier: MatrixTierSchema,
    previousModel: z.string().nullable(),
    currentModel: z.string(),
    currentThinking: z.string().nullable().optional(),
    phase: HarnessPhaseSchema,
    /**
     * Mode ID that the client composer should synchronize via `composers[0]?.setMode(recommendedModeId)`
     * when non-null (e.g. restoring `resumeModeId` / `"acceptEdits"` / `"build"` when switching out of `plan`).
     */
    recommendedModeId: z.string().nullable(),
    recommendedThinkingOptionId: z.string().nullable().optional(),
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

export const harnessInspectEnvironmentRpc = defineRpc({
  name: "agent_harness.environment.inspect.request",
  input: z.object({
    workspaceId: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
  }),
  output: z.object({
    availableProviders: z.array(
      z.object({
        provider: z.string(),
        enabled: z.boolean(),
        status: z.string().optional(),
        label: z.string().optional(),
        defaultModel: z.string().optional(),
        models: z.array(z.string()),
        modelDetails: z
          .array(
            z.object({
              id: z.string(),
              label: z.string().optional(),
              isDefault: z.boolean().optional(),
              thinkingOptions: z
                .array(
                  z.object({
                    id: z.string(),
                    label: z.string().optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      }),
    ),
    diskProfiles: z.array(
      z.object({
        filename: z.string(),
        role: z.string(),
        name: z.string().optional(),
        exists: z.boolean(),
      }),
    ),
    lazyToolSlices: z.array(z.string()),
    hasRepoOverride: z.boolean(),
    repoOverridePath: z.string().nullable(),
    agentTeam: z
      .object({
        projectSlug: z.string(),
        preset: z.string(),
        rolesCount: z.number().int(),
        manifestPath: z.string(),
        hasLocalAntigravityPlugin: z.boolean(),
        targets: z.array(z.string()).optional(),
        localFederatedTargets: z.array(z.string()).optional(),
      })
      .nullable()
      .optional(),
    workspaces: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          title: z.string().nullable(),
          cwd: z.string(),
          branch: z.string().nullable(),
        }),
      )
      .optional(),
  }),
});

export type HarnessInspectEnvironmentInput = z.infer<typeof harnessInspectEnvironmentRpc.input>;
export type HarnessInspectEnvironmentOutput = z.infer<typeof harnessInspectEnvironmentRpc.output>;

export const harnessSyncProfilesRpc = defineRpc({
  name: "agent_harness.profiles.sync.request",
  input: z.object({
    action: z.enum(["import_from_disk", "export_to_disk", "sync_daemon_profiles"]),
  }),
  output: z.object({
    success: z.boolean(),
    message: z.string(),
    importedCount: z.number().int().optional(),
    exportedCount: z.number().int().optional(),
    syncedCount: z.number().int().optional(),
    specialists: z.array(HarnessSpecialistConfigSchema).optional(),
    errors: z.array(z.string()).optional(),
  }),
});

export type HarnessSyncProfilesInput = z.infer<typeof harnessSyncProfilesRpc.input>;
export type HarnessSyncProfilesOutput = z.infer<typeof harnessSyncProfilesRpc.output>;

/**
 * Cross-plugin RPC contract consumed by `plugin-custom/gitea-workflow/server/harness-bridge.ts`
 * (`fetchEffectiveHarnessConfig`), which reads `config` fields (`enabled`, `defaultFallbackRole`,
 * `honorSpecialistPreferredProvider`, `specialists`, `providerMappings`, `providerThinkingMappings`,
 * `agentTeam?.preset`, and `agentTeamPreset`). Verify compatibility in `harness-bridge.ts` when changing fields.
 */
export const harnessEffectiveConfigRpc = defineRpc({
  name: "agent_harness.config.effective.request",
  input: z.object({
    workspaceId: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
  }),
  output: z.object({
    config: z.record(z.string(), z.unknown()),
  }),
});

export type HarnessEffectiveConfigInput = z.infer<typeof harnessEffectiveConfigRpc.input>;
export type HarnessEffectiveConfigOutput = z.infer<typeof harnessEffectiveConfigRpc.output>;

/* Workspace Agent-Team Visual Editor RPC Contracts */

export const AgentTeamRoleBindingSchema = z.object({
  provider: z.string().optional(),
  tier: z.string().optional(),
  model: z.string().optional(),
  modeId: z.string().optional(),
  lazyToolSlice: z.string().optional(),
});

export const AgentTeamFlowSchema = z.object({
  openspec: z.boolean(),
  contracts: z.boolean(),
  workflows: z.boolean(),
  scaffold_docs: z.boolean(),
});

export const AgentTeamEditableManifestSchema = z.object({
  schema_version: z.string(),
  project_slug: z.string().min(1),
  preset: z.string(),
  targets: z.array(z.string()).min(1),
  roles: z.array(z.string()),
  capabilities: z.array(z.string()),
  mcp_sources: z.array(z.string()),
  guards: z.array(z.string()),
  tracker: z.string(),
  git_mode: z.string(),
  flow: AgentTeamFlowSchema,
  bindings: z.record(z.string(), AgentTeamRoleBindingSchema),
});

export const AgentTeamCatalogRoleSchema = z.object({
  id: z.string(),
  team: z.enum(["fe", "be", "ops"]),
  title: z.string(),
  readonly: z.boolean(),
  recommended_model: z.string(),
  requires_mcp: z.array(z.string()),
  requires_guards: z.array(z.string()),
});

export const AgentTeamCatalogCapabilitySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  requires_mcp: z.array(z.string()),
  requires_guards: z.array(z.string()),
  enables_flow: AgentTeamFlowSchema.partial(),
});

export const AgentTeamCatalogMcpSourceSchema = z.object({
  id: z.string(),
  description: z.string(),
  implies_guards: z.array(z.string()),
});

export const AgentTeamCatalogGuardSchema = z.object({
  id: z.string(),
  description: z.string(),
});

export const AgentTeamCatalogSchema = z.object({
  roles: z.array(AgentTeamCatalogRoleSchema),
  capabilities: z.array(AgentTeamCatalogCapabilitySchema),
  mcp_sources: z.array(AgentTeamCatalogMcpSourceSchema),
  guards: z.array(AgentTeamCatalogGuardSchema),
});

export const AgentTeamPresetSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  roles: z.array(z.string()),
  capabilities: z.array(z.string()),
  mcp_sources: z.array(z.string()),
  guards: z.array(z.string()),
  flow: AgentTeamFlowSchema,
});

export const harnessTeamInspectRpc = defineRpc({
  name: "agent_harness.team.inspect.request",
  input: z.object({
    workspaceId: z.string().min(1),
  }),
  output: z.object({
    workspaceId: z.string(),
    workspaceName: z.string(),
    checkoutRoot: z.string(),
    mainRepoRoot: z.string(),
    isWorktree: z.boolean(),
    manifestState: z.enum(["present", "inherited_from_main", "absent"]),
    manifestPath: z.string(),
    manifest: AgentTeamEditableManifestSchema.nullable(),
    manifestError: z.string().nullable().optional(),
    localFederatedTargets: z.array(z.string()),
    compilerAvailable: z.boolean(),
    compilerMessage: z.string().nullable(),
    catalog: AgentTeamCatalogSchema,
    presets: z.record(z.string(), AgentTeamPresetSchema),
    availableProviders: z.array(
      z.object({
        provider: z.string(),
        enabled: z.boolean(),
        status: z.string().optional(),
        label: z.string().optional(),
        defaultModel: z.string().optional(),
        models: z.array(z.string()),
        modelDetails: z
          .array(
            z.object({
              id: z.string(),
              label: z.string().optional(),
              isDefault: z.boolean().optional(),
              thinkingOptions: z
                .array(
                  z.object({
                    id: z.string(),
                    label: z.string().optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      }),
    ),
    lazyToolSlices: z.array(z.string()),
  }),
});

export type HarnessTeamInspectInput = z.infer<typeof harnessTeamInspectRpc.input>;
export type HarnessTeamInspectOutput = z.infer<typeof harnessTeamInspectRpc.output>;

export const harnessTeamDetectRpc = defineRpc({
  name: "agent_harness.team.detect.request",
  input: z.object({
    workspaceId: z.string().min(1),
  }),
  output: z.object({
    workspaceId: z.string(),
    checkoutRoot: z.string(),
    recommendedPreset: z.string(),
    manifest: AgentTeamEditableManifestSchema,
    notes: z.array(z.string()),
    usedCompiler: z.boolean(),
  }),
});

export type HarnessTeamDetectInput = z.infer<typeof harnessTeamDetectRpc.input>;
export type HarnessTeamDetectOutput = z.infer<typeof harnessTeamDetectRpc.output>;

export const harnessTeamSaveRpc = defineRpc({
  name: "agent_harness.team.save.request",
  input: z.object({
    workspaceId: z.string().min(1),
    manifest: AgentTeamEditableManifestSchema,
    reindex: z.boolean().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    compiled: z.boolean(),
    checkoutRoot: z.string(),
    manifestPath: z.string(),
    manifest: AgentTeamEditableManifestSchema,
    localFederatedTargets: z.array(z.string()),
    warnings: z.array(z.string()),
    message: z.string(),
    error: z.string().nullable().optional(),
  }),
});

export type HarnessTeamSaveInput = z.infer<typeof harnessTeamSaveRpc.input>;
export type HarnessTeamSaveOutput = z.infer<typeof harnessTeamSaveRpc.output>;

export const harnessTeamDoctorRpc = defineRpc({
  name: "agent_harness.team.doctor.request",
  input: z.object({
    workspaceId: z.string().min(1),
  }),
  output: z.object({
    passed: z.boolean(),
    exitCode: z.number().int(),
    passCount: z.number().int(),
    warnCount: z.number().int(),
    failCount: z.number().int(),
    output: z.string(),
    compilerAvailable: z.boolean(),
  }),
});

export type HarnessTeamDoctorInput = z.infer<typeof harnessTeamDoctorRpc.input>;
export type HarnessTeamDoctorOutput = z.infer<typeof harnessTeamDoctorRpc.output>;

export const harnessTeamCleanRpc = defineRpc({
  name: "agent_harness.team.clean.request",
  input: z.object({
    workspaceId: z.string().min(1),
    deleteManifest: z.boolean().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    checkoutRoot: z.string().optional(),
    removedCount: z.number().int(),
    removed: z.array(z.string()),
    localFederatedTargets: z.array(z.string()),
    message: z.string(),
    error: z.string().nullable().optional(),
  }),
});

export type HarnessTeamCleanInput = z.infer<typeof harnessTeamCleanRpc.input>;
export type HarnessTeamCleanOutput = z.infer<typeof harnessTeamCleanRpc.output>;

/* Debug Trace Engine RPC Contracts */

export const HarnessDebugLogLevelSchema = z.enum(["info", "warn", "error"]);

export const HarnessDebugLogEntrySchema = z.object({
  ts: z.string(),
  event: z.string(),
  level: HarnessDebugLogLevelSchema,
  agentId: z.string().optional(),
  role: z.string().optional(),
  phase: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type HarnessDebugLogLevel = z.infer<typeof HarnessDebugLogLevelSchema>;
export type HarnessDebugLogEntry = z.infer<typeof HarnessDebugLogEntrySchema>;

export const harnessDebugStatusRpc = defineRpc({
  name: "agent_harness.debug.status.request",
  input: z.object({
    limit: z.number().int().min(1).optional(),
  }),
  output: z.object({
    enabled: z.boolean(),
    logFilePath: z.string(),
    totalLines: z.number().int(),
    fileSizeBytes: z.number().int(),
    rotatedExists: z.boolean(),
    entries: z.array(HarnessDebugLogEntrySchema),
  }),
});

export type HarnessDebugStatusInput = z.infer<typeof harnessDebugStatusRpc.input>;
export type HarnessDebugStatusOutput = z.infer<typeof harnessDebugStatusRpc.output>;

export const harnessDebugToggleRpc = defineRpc({
  name: "agent_harness.debug.toggle.request",
  input: z.object({
    enabled: z.boolean(),
  }),
  output: z.object({
    enabled: z.boolean(),
    logFilePath: z.string(),
  }),
});

export type HarnessDebugToggleInput = z.infer<typeof harnessDebugToggleRpc.input>;
export type HarnessDebugToggleOutput = z.infer<typeof harnessDebugToggleRpc.output>;

export const harnessDebugClearRpc = defineRpc({
  name: "agent_harness.debug.clear.request",
  input: z.object({}),
  output: z.object({
    cleared: z.boolean(),
    removedBytes: z.number().int(),
  }),
});

export type HarnessDebugClearInput = z.infer<typeof harnessDebugClearRpc.input>;
export type HarnessDebugClearOutput = z.infer<typeof harnessDebugClearRpc.output>;

/* Shared Pure Helpers (Provider Plan Mode & Specialist Tier Mapping) */

export const NATIVE_PLAN_MODE_PROVIDERS = ["claude", "opencode"] as const;

export function supportsNativePlanMode(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === "claude" || normalized === "claude-code" || normalized === "opencode";
}

/**
 * Resolves the execution mode to restore when exiting native `"plan"` mode:
 * - Uses `resumeModeId` if saved and not `"plan"`.
 * - Falls back to `"acceptEdits"` for Claude, `"build"` for OpenCode, and `"full-access"` for Antigravity.
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
  if (normalized === "antigravity") {
    return "full-access";
  }
  return null;
}

export function resolveSpecialistTargetTier(role: HandoffTargetRole): MatrixTier {
  const norm = role.toLowerCase().trim();
  if (norm === "orchestrator" || norm === "scout" || norm === "lead" || norm === "dispatcher") {
    return "fast";
  }
  if (norm === "review" || norm === "be-reviewer" || norm === "ops-auditor") {
    return "review";
  }
  if (
    norm === "architect" ||
    norm === "fe-architect" ||
    norm === "be-architect" ||
    norm === "pm" ||
    norm === "fe-pm"
  ) {
    return "plan";
  }
  return "standard";
}

export function formatSpecialistRolePrefix(role: HandoffTargetRole | DomainRole): string {
  const trimmed = role.trim();
  const norm = trimmed.toLowerCase();
  switch (norm) {
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
      return `[${trimmed}]`;
  }
}

export type { HarnessDowngradeReason };
