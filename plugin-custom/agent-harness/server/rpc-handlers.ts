import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  formatSpecialistRolePrefix,
  harnessHandoffRpc,
  harnessSwitchTierRpc,
  resolveResumeExecutionModeId,
} from "../shared/contracts.js";
import { DEFAULT_PROVIDER_MAPPINGS, normalizeProvider } from "../shared/intent-detector.js";
import { parseHarnessMetadata, tierToPhase } from "../shared/lifecycle-state.js";
import {
  HARNESS_METADATA_KEY,
  type HarnessAgentMetadata,
  type HarnessTransitionKind,
  type MatrixTier,
} from "../shared/types.js";
import { spawnHarnessSpecialist } from "./handoff-tool.js";
import {
  emitHarnessTimelineTransition,
  type EmitHarnessTransitionParams,
} from "./timeline-emitter.js";

export interface RpcHandlerDependencies {
  readLatestMetadata: (agentId: string) => Promise<HarnessAgentMetadata | null>;
  setLatestMetadata: (
    agentId: string,
    meta: HarnessAgentMetadata,
    handle: { setMetadata: (patch: Record<string, any>) => Promise<void> },
  ) => Promise<void>;
  emitTimelineEvent?: (
    agentId: string,
    params: Omit<EmitHarnessTransitionParams, "handle">,
  ) => Promise<void>;
  emitTimelineTransitionsEnabled?: () => boolean;
}

export function registerHarnessRpcHandlers(
  server: PluginServerContext,
  deps: RpcHandlerDependencies,
): void {
  if (typeof server.handle !== "function") {
    return;
  }

  // 1. harnessSwitchTierRpc
  server.handle(harnessSwitchTierRpc, async (input, context: PluginHandlerContext) => {
    const { agentId, targetTier, currentModeId, reason } = input;
    const handle = context.paseo.agents.ref(agentId);

    let meta = await deps.readLatestMetadata(agentId);
    const agentSnapshot = handle.current?.() ?? (await handle.refresh?.())?.agent;

    // Fallback: If in-memory cache missed (e.g. after plugin reload), restore from agent snapshot metadata
    if (!meta && agentSnapshot?.metadata) {
      meta = parseHarnessMetadata(agentSnapshot.metadata);
      if (meta) {
        await deps.setLatestMetadata(agentId, meta, handle);
      }
    }

    const provider = agentSnapshot?.provider ?? "claude";
    const normalizedProvider = normalizeProvider(provider);
    const mapping = DEFAULT_PROVIDER_MAPPINGS[normalizedProvider];
    const targetModel = mapping?.[targetTier] ?? targetTier;

    const previousTier = meta?.currentTier ?? null;
    const previousModel: string | null =
      meta?.currentModel ??
      (typeof agentSnapshot?.options?.model === "string" ? agentSnapshot.options.model : null);
    const nextPhase = tierToPhase(targetTier, meta?.role);

    // If switching out of plan, determine recommendedModeId
    let recommendedModeId: string | null = null;
    if ((previousTier === "plan" || currentModeId === "plan") && targetTier !== "plan") {
      recommendedModeId = resolveResumeExecutionModeId(
        normalizedProvider,
        meta?.resumeModeId ?? currentModeId,
      );
    } else if (targetTier === "plan") {
      recommendedModeId = "plan";
    }

    // Call handle.setModel to update the running agent's model
    await handle.setModel(targetModel);

    // If switching mode, synchronize daemon agent mode
    if (recommendedModeId) {
      try {
        const daemonClient = (
          context.paseo as unknown as {
            daemonClient?: { setAgentMode?: (id: string, mode: string) => Promise<unknown> };
          }
        ).daemonClient;
        if (daemonClient?.setAgentMode) {
          await daemonClient.setAgentMode(agentId, recommendedModeId);
        }
      } catch {
        // Ignore setAgentMode fallback error
      }
    }

    const nowTurn = meta ? meta.turnCount : 0;
    const nextMeta: HarnessAgentMetadata = {
      version: 1,
      role: meta?.role ?? "general",
      initialTier: meta?.initialTier ?? targetTier,
      currentTier: targetTier,
      currentModel: targetModel,
      phase: nextPhase,
      roleMatchedRule: meta?.roleMatchedRule ?? "rpc",
      tierMatchedRule: "rpc:manual_switch",
      userModelLocked: meta?.userModelLocked ?? false,
      roleLockedByLabel: meta?.roleLockedByLabel ?? false,
      turnCount: nowTurn,
      planTurnCount: meta?.planTurnCount ?? 0,
      writeToolDetectedInPlan: meta?.writeToolDetectedInPlan ?? false,
      handoffSuggestedAtTurn: meta?.handoffSuggestedAtTurn ?? null,
      autoDowngradedAtTurn:
        targetTier === "flash" && previousTier === "plan"
          ? nowTurn
          : (meta?.autoDowngradedAtTurn ?? null),
      downgradeReason:
        targetTier === "flash" && previousTier === "plan"
          ? "manual_switch"
          : (meta?.downgradeReason ?? null),
      lastProcessedTurnId: meta?.lastProcessedTurnId ?? null,
      resumeModeId:
        targetTier === "plan" && currentModeId && currentModeId !== "plan"
          ? currentModeId
          : (meta?.resumeModeId ?? null),
      lastBilledTier: meta?.lastBilledTier ?? previousTier,
      lastBilledModel: meta?.lastBilledModel ?? previousModel,
    };

    await deps.setLatestMetadata(agentId, nextMeta, handle);

    const shouldEmit =
      !deps.emitTimelineTransitionsEnabled || deps.emitTimelineTransitionsEnabled();

    if (shouldEmit && handle) {
      await emitHarnessTimelineTransition(handle, {
        transitionKind: "manual_switch",
        role: nextMeta.role,
        fromTier: previousTier,
        toTier: targetTier,
        fromModel: previousModel,
        toModel: targetModel,
        phase: nextPhase,
        reason:
          reason ?? `Manual tier switch via RPC: ${previousTier ?? "unknown"} -> ${targetTier}`,
        turnNumber: nowTurn,
      });
    }

    if (shouldEmit && deps.emitTimelineEvent) {
      await deps.emitTimelineEvent(agentId, {
        transitionKind: "manual_switch",
        role: nextMeta.role,
        fromTier: previousTier,
        toTier: targetTier,
        fromModel: previousModel,
        toModel: targetModel,
        phase: nextPhase,
        reason:
          reason ?? `Manual tier switch via RPC: ${previousTier ?? "unknown"} -> ${targetTier}`,
        turnNumber: nowTurn,
      });
    }

    return {
      agentId,
      previousTier,
      currentTier: targetTier,
      previousModel,
      currentModel: targetModel,
      phase: nextPhase,
      recommendedModeId,
      metadata: nextMeta,
    };
  });

  // 2. harnessHandoffRpc
  server.handle(harnessHandoffRpc, async (input, context: PluginHandlerContext) => {
    const { agentId, workspaceId, targetRole, summaryOverride } = input;
    const parentHandle = context.paseo.agents.ref(agentId);
    const parentSnapshot = parentHandle.current?.() ?? (await parentHandle.refresh?.())?.agent;

    const parentProvider = parentSnapshot?.provider ?? "claude";
    const parentCwd = parentSnapshot?.cwd ?? process.cwd();
    const parentWorkspaceId = workspaceId ?? parentSnapshot?.workspaceId ?? null;

    const promptText =
      summaryOverride?.trim() ||
      `Execute implementation for specialist task as role ${targetRole}.`;
    const title = `${formatSpecialistRolePrefix(targetRole)} Task Execution`;

    const res = await spawnHarnessSpecialist({
      paseo: context.paseo,
      parentAgentId: agentId,
      parentProvider,
      parentCwd,
      workspaceId: parentWorkspaceId,
      targetRole,
      title,
      specPrompt: promptText,
      getLatestMetadata: deps.readLatestMetadata,
      shouldEmitTimeline: deps.emitTimelineTransitionsEnabled,
    });

    return {
      parentAgentId: agentId,
      childAgentId: res.childAgentId,
      childTitle: res.childTitle,
      workspaceId: res.workspaceId,
      targetRole: res.targetRole,
      targetTier: res.targetTier,
      targetModel: res.targetModel,
    };
  });
}
