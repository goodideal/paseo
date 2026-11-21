import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  findSpecialist,
  normalizeProviderName,
  resolveResumeExecutionMode,
  resolveTargetModelForTier,
} from "../shared/config-resolver.js";
import {
  formatSpecialistRolePrefix,
  harnessEffectiveConfigRpc,
  harnessHandoffRpc,
  harnessInspectEnvironmentRpc,
  harnessSwitchTierRpc,
  harnessSyncProfilesRpc,
} from "../shared/contracts.js";
import { DEFAULT_PROVIDER_MAPPINGS } from "../shared/intent-detector.js";
import { parseHarnessMetadata, tierToPhase } from "../shared/lifecycle-state.js";
import type {
  EffectiveHarnessConfig,
  HarnessAgentMetadata,
  HarnessSpecialistConfig,
  HarnessTransitionKind,
  MatrixTier,
} from "../shared/types.js";
import { spawnHarnessSpecialist } from "./handoff-tool.js";
import {
  exportSpecialistsToDisk,
  importSpecialistsFromDisk,
  loadRepoHarnessOverride,
  scanDiskProfiles,
  scanLazyToolSlices,
  syncDaemonAgentProfiles,
} from "./profile-sync.js";
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
  getConfig?: (workspaceId?: string | null, cwd?: string | null) => EffectiveHarnessConfig;
  saveSpecialists?: (specialists: HarnessSpecialistConfig[]) => Promise<void>;
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

    if (!meta && agentSnapshot?.metadata) {
      meta = parseHarnessMetadata(agentSnapshot.metadata);
      if (meta) {
        await deps.setLatestMetadata(agentId, meta, handle);
      }
    }

    const effectiveConfig = deps.getConfig?.(agentSnapshot?.workspaceId, agentSnapshot?.cwd);
    const provider = agentSnapshot?.provider ?? "claude";
    const normalizedProvider = normalizeProviderName(provider);

    let targetModel = "";
    if (effectiveConfig) {
      targetModel = resolveTargetModelForTier(effectiveConfig, normalizedProvider, targetTier);
    } else {
      const mapping = DEFAULT_PROVIDER_MAPPINGS[normalizedProvider];
      targetModel = mapping?.[targetTier] ?? targetTier;
    }

    const previousTier = meta?.currentTier ?? null;
    const previousModel: string | null =
      meta?.currentModel ??
      (typeof agentSnapshot?.options?.model === "string" ? agentSnapshot.options.model : null);
    const nextPhase = tierToPhase(targetTier, meta?.role, effectiveConfig);

    let recommendedModeId: string | null = null;
    if ((previousTier === "plan" || currentModeId === "plan") && targetTier !== "plan") {
      recommendedModeId = effectiveConfig
        ? resolveResumeExecutionMode(
            effectiveConfig,
            normalizedProvider,
            meta?.resumeModeId ?? currentModeId,
          )
        : (meta?.resumeModeId ?? currentModeId ?? null);
    } else if (targetTier === "plan") {
      recommendedModeId = "plan";
    }

    await handle.setModel(targetModel);

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

    const effectiveConfig = deps.getConfig?.(parentWorkspaceId, parentCwd);
    const specialist = effectiveConfig ? findSpecialist(effectiveConfig, targetRole) : undefined;

    const defaultPrompt =
      specialist?.handoffDefaultPrompt?.trim() ||
      `Execute implementation for specialist task as role ${targetRole}.`;
    const promptText = summaryOverride?.trim() || defaultPrompt;

    const prefix = specialist?.handoffTitlePrefix?.trim() || formatSpecialistRolePrefix(targetRole);
    const title = `${prefix} Task Execution`;

    const res = await spawnHarnessSpecialist({
      paseo: context.paseo,
      parentAgentId: agentId,
      parentProvider,
      parentCwd,
      workspaceId: parentWorkspaceId,
      targetRole,
      title,
      specPrompt: promptText,
      config: effectiveConfig,
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

  // 3. harnessInspectEnvironmentRpc
  server.handle(harnessInspectEnvironmentRpc, async (input, context: PluginHandlerContext) => {
    const effectiveConfig = deps.getConfig?.(input.workspaceId, input.cwd);
    const profilesDir = effectiveConfig?.profilesDir ?? "~/.agents/profiles";
    const sliceDir = effectiveConfig?.lazyToolProfilesDir ?? "~/.config/lazy-tool/profiles";

    const diskProfiles = scanDiskProfiles(profilesDir).map((p) => ({
      filename: p.filename,
      role: p.role,
      name: p.name,
      exists: p.exists,
    }));

    const lazyToolSlices = scanLazyToolSlices(sliceDir);

    let hasRepoOverride = false;
    let repoOverridePath: string | null = null;

    if (input.cwd) {
      const relPath = effectiveConfig?.repoConfigRelativePath ?? ".paseo/agent-harness.json";
      const override = loadRepoHarnessOverride(input.cwd, relPath);
      if (override) {
        hasRepoOverride = true;
        repoOverridePath = `${input.cwd}/${relPath}`;
      }
    }

    const availableProviders: Array<{ provider: string; enabled: boolean; models: string[] }> = [];
    if (context.paseo.providers?.snapshot) {
      try {
        const snap = await context.paseo.providers.snapshot();
        for (const [providerId, entry] of Object.entries(snap.providers ?? {})) {
          availableProviders.push({
            provider: providerId,
            enabled: entry.enabled,
            models: (entry.models ?? []).map((m) => m.id),
          });
        }
      } catch {
        // Fallback to built-in provider list if snapshot fails
      }
    }

    return {
      availableProviders,
      diskProfiles,
      lazyToolSlices,
      hasRepoOverride,
      repoOverridePath,
    };
  });

  // 4. harnessSyncProfilesRpc
  server.handle(harnessSyncProfilesRpc, async (input, context: PluginHandlerContext) => {
    const { action } = input;
    const effectiveConfig = deps.getConfig?.();
    const profilesDir = effectiveConfig?.profilesDir ?? "~/.agents/profiles";
    const specialists = effectiveConfig?.specialists ?? [];

    if (action === "export_to_disk") {
      const { exported, errors } = exportSpecialistsToDisk(specialists, profilesDir);
      return {
        success: errors.length === 0,
        message: `Exported ${exported} specialist profiles to ${profilesDir}`,
        exportedCount: exported,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    if (action === "import_from_disk") {
      const { specialists: importedSpecialists, importedCount } = importSpecialistsFromDisk(
        specialists,
        profilesDir,
      );
      if (deps.saveSpecialists) {
        await deps.saveSpecialists(importedSpecialists);
      }
      return {
        success: true,
        message: `Imported ${importedCount} profiles from ${profilesDir}`,
        importedCount,
      };
    }

    if (action === "sync_daemon_profiles") {
      const { syncedCount, errors } = await syncDaemonAgentProfiles(context.paseo, specialists);
      return {
        success: errors.length === 0,
        message: `Synchronized ${syncedCount} specialist profiles to Paseo Agent Profiles`,
        syncedCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    return {
      success: false,
      message: `Unknown action: ${action}`,
    };
  });

  // 5. harnessEffectiveConfigRpc
  server.handle(harnessEffectiveConfigRpc, async (input) => {
    const effectiveConfig = deps.getConfig?.(input.workspaceId, input.cwd);
    return {
      config: (effectiveConfig ?? {}) as Record<string, unknown>,
    };
  });
}
