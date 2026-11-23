import { defineAgentTool, type AgentToolDefinition } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import {
  findSpecialist,
  isNativePlanModeSupported,
  normalizeProviderName,
  normalizeTierAlias,
  resolveResumeExecutionMode,
  resolveTierTarget,
} from "../shared/config-resolver.js";
import {
  formatSpecialistRolePrefix,
  HARNESS_HANDOFF_TOOL_NAME,
  HarnessHandoffToolInputSchema,
  resolveResumeExecutionModeId,
  resolveSpecialistTargetTier,
  supportsNativePlanMode,
} from "../shared/contracts.js";
import { DEFAULT_PROVIDER_MAPPINGS } from "../shared/intent-detector.js";
import {
  HARNESS_LEAF_LABEL_KEY,
  parseHarnessMetadata,
  tierToPhase,
} from "../shared/lifecycle-state.js";
import { BUILTIN_PROVIDER_THINKING_MAPPINGS } from "../shared/presets.js";
import type {
  DomainRole,
  EffectiveHarnessConfig,
  HandoffTargetRole,
  HarnessAgentMetadata,
  HarnessPhase,
  HarnessTransitionKind,
  MatrixTier,
} from "../shared/types.js";
import { emitHarnessTimelineTransition } from "./timeline-emitter.js";

export interface SpawnSpecialistParams {
  paseo: PaseoApi;
  parentAgentId: string;
  parentProvider: string;
  parentCwd: string;
  workspaceId: string | null;
  targetRole: HandoffTargetRole;
  title: string;
  specPrompt: string;
  waitForCompletion?: boolean;
  config?: EffectiveHarnessConfig | null;
  getLatestMetadata?: (
    agentId: string,
  ) => Promise<HarnessAgentMetadata | null> | HarnessAgentMetadata | null;
  shouldEmitTimeline?: () => boolean;
  emitTimelineEvent?: (event: {
    transitionKind: HarnessTransitionKind;
    role: DomainRole;
    fromTier: MatrixTier | null;
    toTier: MatrixTier;
    fromModel: string | null;
    toModel: string | null;
    phase?: HarnessPhase;
    reason: string;
    childAgentId?: string | null;
    childAgentTitle?: string | null;
  }) => Promise<void>;
}

export interface SpawnSpecialistResult {
  childAgentId: string;
  childTitle: string;
  workspaceId: string | null;
  targetRole: HandoffTargetRole;
  targetTier: MatrixTier;
  targetModel: string;
  status: "spawned" | "completed" | "failed" | "timeout";
  finalText: string | null;
}

export async function spawnHarnessSpecialist(
  params: SpawnSpecialistParams,
): Promise<SpawnSpecialistResult> {
  const {
    paseo,
    parentAgentId,
    parentProvider,
    parentCwd,
    workspaceId,
    targetRole,
    title,
    specPrompt,
    waitForCompletion,
    config,
    getLatestMetadata,
    shouldEmitTimeline,
    emitTimelineEvent,
  } = params;

  const specialist = config ? findSpecialist(config, targetRole) : undefined;

  // Resolve target provider: honor specialist's preferredProvider if configured
  let targetProvider = parentProvider;
  if (config?.honorSpecialistPreferredProvider && specialist?.preferredProvider?.trim()) {
    targetProvider = specialist.preferredProvider.trim();
  }

  const normalizedProvider = normalizeProviderName(targetProvider);

  // Resolve target tier
  const targetTier = normalizeTierAlias(
    specialist?.preferredTier || resolveSpecialistTargetTier(targetRole),
  );

  // Resolve target model & thinking option (only apply modelOverride when compatible with resolved target provider)
  const preferredSpecProvider = specialist?.preferredProvider?.trim()
    ? normalizeProviderName(specialist.preferredProvider)
    : "";
  const canApplyModelOverride =
    Boolean(specialist?.modelOverride?.trim()) &&
    (!preferredSpecProvider || normalizedProvider === preferredSpecProvider);

  const tierResolved = resolveTierTarget(
    config ?? {
      providerMappings: DEFAULT_PROVIDER_MAPPINGS,
      providerThinkingMappings: BUILTIN_PROVIDER_THINKING_MAPPINGS,
    },
    normalizedProvider,
    targetTier,
  );
  const targetModel = canApplyModelOverride
    ? specialist!.modelOverride!.trim()
    : tierResolved.model;
  const effectiveThinkingOptionId =
    specialist?.thinkingOptionId?.trim() || tierResolved.thinkingOptionId || undefined;

  // Resolve default mode id (read-only enforcement takes precedence over custom defaultModeId)
  const supportsPlanMode = config
    ? isNativePlanModeSupported(config, normalizedProvider)
    : supportsNativePlanMode(normalizedProvider);
  let execModeId: string | null = null;
  if (specialist?.readonly && supportsPlanMode) {
    execModeId = "plan";
  } else if (specialist?.defaultModeId?.trim()) {
    execModeId = specialist.defaultModeId.trim();
  } else if (config) {
    execModeId = resolveResumeExecutionMode(config, normalizedProvider, null);
  } else {
    execModeId = resolveResumeExecutionModeId(normalizedProvider, null);
  }

  const rolePrefix =
    specialist?.handoffTitlePrefix?.trim() || formatSpecialistRolePrefix(targetRole);
  const trimmedTitle = title.trim();
  const normalizedTitle = trimmedTitle.startsWith(rolePrefix)
    ? trimmedTitle
    : `${rolePrefix} ${trimmedTitle}`;

  const agentConfig = {
    provider: `${normalizedProvider}/${targetModel}`,
    ...(execModeId ? { modeId: execModeId } : {}),
    ...(effectiveThinkingOptionId ? { thinkingOptionId: effectiveThinkingOptionId } : {}),
  };

  const spawnLabels = {
    role: targetRole,
    [HARNESS_LEAF_LABEL_KEY]: "1",
  };

  let childHandle;
  if (workspaceId && paseo.workspaces) {
    childHandle = await paseo.workspaces.ref(workspaceId).agents.create({
      config: agentConfig,
      parent: parentAgentId,
      title: normalizedTitle,
      prompt: specPrompt,
      labels: spawnLabels,
    });
  } else {
    childHandle = await paseo.agents.create({
      config: agentConfig,
      cwd: parentCwd,
      parent: parentAgentId,
      title: normalizedTitle,
      prompt: specPrompt,
      labels: spawnLabels,
    });
  }

  const childAgentId = childHandle.id;
  const parentHandle = paseo.agents.ref(parentAgentId);
  let parentMeta = await getLatestMetadata?.(parentAgentId);
  if (!parentMeta) {
    try {
      const parentSnapshot = parentHandle?.current?.() ?? (await parentHandle?.refresh?.())?.agent;
      parentMeta = parseHarnessMetadata(parentSnapshot?.metadata);
    } catch {
      // Fallback gracefully if parent handle cannot be refreshed
      parentMeta = null;
    }
  }

  const fromTier = parentMeta?.currentTier ?? null;
  const fromModel = parentMeta?.currentModel ?? null;
  const turnNumber = parentMeta?.turnCount ?? 0;
  const targetPhase = tierToPhase(targetTier, targetRole, config);

  const timelineEnabled = !shouldEmitTimeline || shouldEmitTimeline();
  if (timelineEnabled && parentHandle) {
    try {
      await emitHarnessTimelineTransition(parentHandle, {
        transitionKind: "specialist_handoff",
        role: targetRole,
        fromTier,
        toTier: targetTier,
        fromModel,
        toModel: targetModel,
        phase: targetPhase,
        reason: "specialist_handoff",
        turnNumber,
        childAgentId,
        childAgentTitle: normalizedTitle,
      });
    } catch {
      // Ignore timeline emission error during handoff
    }
  }

  if (timelineEnabled && emitTimelineEvent) {
    try {
      await emitTimelineEvent({
        transitionKind: "specialist_handoff",
        role: targetRole,
        fromTier,
        toTier: targetTier,
        fromModel,
        toModel: targetModel,
        phase: targetPhase,
        reason: "specialist_handoff",
        childAgentId,
        childAgentTitle: normalizedTitle,
      });
    } catch {
      // Ignore backwards-compatible timeline emission error during handoff
    }
  }

  let status: "spawned" | "completed" | "failed" | "timeout" = "spawned";
  let finalText: string | null = null;

  if (waitForCompletion && childHandle.waitForFinish) {
    try {
      const runResult = (await childHandle.waitForFinish()) as
        | { status?: string; error?: unknown; lastMessage?: unknown; text?: unknown }
        | undefined
        | null;
      if (!runResult) {
        status = "spawned";
      } else if (runResult.status === "timeout") {
        status = "timeout";
      } else if (runResult.status === "error" || Boolean(runResult.error)) {
        status = "failed";
      } else {
        status = "completed";
      }

      if (runResult && typeof runResult === "object") {
        if (typeof runResult.lastMessage === "string" && runResult.lastMessage.trim()) {
          finalText = runResult.lastMessage;
        } else if (typeof runResult.text === "string" && runResult.text.trim()) {
          finalText = runResult.text;
        } else if (typeof runResult.error === "string" && runResult.error.trim()) {
          finalText = runResult.error;
        }
      }
    } catch {
      // Return spawned status if waiting fails or times out
      status = "spawned";
    }
  }

  return {
    childAgentId,
    childTitle: normalizedTitle,
    workspaceId: workspaceId ?? null,
    targetRole,
    targetTier,
    targetModel,
    status,
    finalText,
  };
}

export function createHarnessHandoffTool(options: {
  getConfig?: (cwd?: string | null) => EffectiveHarnessConfig | null;
  getLatestMetadata?: (
    agentId: string,
  ) => Promise<HarnessAgentMetadata | null> | HarnessAgentMetadata | null;
  shouldEmitTimeline?: () => boolean;
  emitTimelineEvent?: (
    agentId: string,
    event: {
      transitionKind: HarnessTransitionKind;
      role: DomainRole;
      fromTier: MatrixTier | null;
      toTier: MatrixTier;
      fromModel: string | null;
      toModel: string | null;
      reason: string;
      childAgentId?: string | null;
      childAgentTitle?: string | null;
    },
  ) => Promise<void>;
}): AgentToolDefinition {
  const currentConfig = options.getConfig ? options.getConfig() : null;
  const enabledHandoffIds = currentConfig
    ? currentConfig.specialists.filter((s) => s.enabled && s.handoffEnabled).map((s) => s.id)
    : [];
  const availableHandoffs =
    enabledHandoffIds.length > 0 ? enabledHandoffIds.join(", ") : "ui, backend, qa, review";

  return defineAgentTool({
    name: HARNESS_HANDOFF_TOOL_NAME,
    title: "Harness Specialist Handoff",
    description: `Spawns a domain specialist (${availableHandoffs}) in the current workspace with clean context to execute the confirmed plan.`,
    input: HarnessHandoffToolInputSchema,
    execute: async (input, context) => {
      const { agent, paseo } = context;
      const effectiveConfig = options.getConfig ? options.getConfig(agent.cwd) : null;
      const res = await spawnHarnessSpecialist({
        paseo,
        parentAgentId: agent.id,
        parentProvider: agent.provider,
        parentCwd: agent.cwd,
        workspaceId: agent.workspaceId,
        targetRole: input.targetRole,
        title: input.title,
        specPrompt: input.specPrompt,
        waitForCompletion: input.waitForCompletion,
        config: effectiveConfig,
        getLatestMetadata: options.getLatestMetadata,
        shouldEmitTimeline: options.shouldEmitTimeline,
        emitTimelineEvent: options.emitTimelineEvent
          ? (ev) => options.emitTimelineEvent!(agent.id, ev)
          : undefined,
      });

      return {
        text: `Spawned specialist agent ${res.childTitle} (id: ${res.childAgentId}) on tier ${res.targetTier} (model: ${res.targetModel}).`,
        structuredContent: res,
      };
    },
  });
}
