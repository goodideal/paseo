import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  findSpecialist,
  isNativePlanModeSupported,
  normalizeProviderName,
  resolveEffectiveHarnessConfig,
  resolveResumeExecutionMode,
  resolveTierTarget,
} from "../shared/config-resolver.js";
import {
  formatSpecialistRolePrefix,
  harnessEffectiveConfigRpc,
  harnessHandoffRpc,
  harnessInspectEnvironmentRpc,
  harnessSwitchTierRpc,
  harnessSyncProfilesRpc,
  harnessTeamCleanRpc,
  harnessTeamDetectRpc,
  harnessTeamDoctorRpc,
  harnessTeamInspectRpc,
  harnessTeamSaveRpc,
  supportsNativePlanMode,
} from "../shared/contracts.js";
import { DEFAULT_PROVIDER_MAPPINGS, isModelBypassed } from "../shared/intent-detector.js";
import {
  HARNESS_BYPASSED_META_KEY,
  extractSnapshotModel,
  extractTimelineItems,
  parseHarnessMetadata,
} from "../shared/lifecycle-state.js";
import { BUILTIN_PROVIDER_THINKING_MAPPINGS } from "../shared/presets.js";
import type {
  EffectiveHarnessConfig,
  HarnessAgentMetadata,
  HarnessPhase,
  HarnessSpecialistConfig,
  MatrixTier,
} from "../shared/types.js";
import { applyAgentModeOption, applyAgentThinkingOption } from "./agent-controls.js";
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
import {
  cleanWorkspaceTeam,
  detectWorkspaceTeam,
  doctorWorkspaceTeam,
  inspectWorkspaceTeam,
  resolveHostCompiler,
  resolveRegisteredWorkspace,
  saveWorkspaceTeam,
  type CompilerRunner,
  type WorkspaceDirResolver,
} from "./team-editor-service.js";

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
  onPaseoAvailable?: (paseo: PluginHandlerContext["paseo"]) => void;
  onTeamUpdated?: (checkoutRoot?: string) => Promise<void> | void;
  resolveWorkspaceDir?: WorkspaceDirResolver;
  resolveCompiler?: typeof resolveHostCompiler;
  runTeamCompiler?: CompilerRunner;
}

function isReadOnlyHandoffRole(role: string, specialist?: { readonly?: boolean } | null): boolean {
  return Boolean(specialist?.readonly || role.trim().toLowerCase() === "review");
}

function extractParentTimelineSummary(rawTimeline: unknown): string {
  const items = extractTimelineItems(rawTimeline);
  let lastUserText = "";
  let lastAssistantText = "";
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text.trim()
        : typeof record.content === "string"
          ? record.content.trim()
          : "";
    if (!text) continue;
    if (
      !lastAssistantText &&
      (record.type === "assistant_message" ||
        (record.type === "message" && record.role === "assistant"))
    ) {
      lastAssistantText = text.slice(0, 400);
    } else if (
      !lastUserText &&
      (record.type === "user_message" || (record.type === "message" && record.role === "user"))
    ) {
      lastUserText = text.slice(0, 300);
    }
    if (lastUserText && lastAssistantText) break;
  }
  const parts: string[] = [];
  if (lastUserText) parts.push(`- Latest Request: ${lastUserText}`);
  if (lastAssistantText) parts.push(`- Latest Context: ${lastAssistantText}`);
  return parts.join("\n");
}

function pickWorkspaceDirectory(entry: Record<string, unknown>): string {
  for (const key of ["workspaceDirectory", "directory", "projectRootPath"] as const) {
    const val = entry[key];
    if (typeof val === "string" && val) {
      return val;
    }
  }
  return "";
}

function pickWorkspaceBranch(entry: Record<string, unknown>): string | null {
  if (typeof entry.branch === "string") {
    return entry.branch;
  }
  const gitRuntime = entry.gitRuntime;
  if (gitRuntime && typeof gitRuntime === "object") {
    const branch = (gitRuntime as Record<string, unknown>).currentBranch;
    if (typeof branch === "string") {
      return branch;
    }
  }
  return null;
}

async function resolveWorkspaceCwd(
  paseo: PluginHandlerContext["paseo"] | undefined,
  input: { cwd?: string | null; workspaceId?: string | null },
  listedWorkspaces: ReadonlyArray<{ id: string; cwd: string }>,
  overrideResolver?: WorkspaceDirResolver,
): Promise<string | null> {
  if (input.cwd) {
    return input.cwd;
  }
  if (!input.workspaceId) {
    return null;
  }
  const match = listedWorkspaces.find((w) => w.id === input.workspaceId);
  if (match) {
    return match.cwd;
  }
  if (!paseo) {
    return null;
  }
  try {
    return (await resolveRegisteredWorkspace(paseo, input.workspaceId, overrideResolver))
      .checkoutRoot;
  } catch {
    return null;
  }
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
    deps.onPaseoAvailable?.(context.paseo);
    const { agentId, targetTier, targetPhase, currentModeId, reason } = input;
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
    const snapshotModel = extractSnapshotModel(agentSnapshot);
    const isBypassedSession =
      Boolean(
        (agentSnapshot?.metadata as Record<string, unknown> | undefined)?.[
          HARNESS_BYPASSED_META_KEY
        ],
      ) || isModelBypassed(snapshotModel, effectiveConfig?.bypassModels);
    if (isBypassedSession) {
      throw new Error(
        "Tier switching is disabled for sessions managed natively by Antigravity Orchestrator.",
      );
    }

    const provider = agentSnapshot?.provider ?? "claude";
    const normalizedProvider = normalizeProviderName(provider);

    const resolvedTarget = resolveTierTarget(
      effectiveConfig ?? {
        providerMappings: DEFAULT_PROVIDER_MAPPINGS,
        providerThinkingMappings: BUILTIN_PROVIDER_THINKING_MAPPINGS,
      },
      normalizedProvider,
      targetTier,
    );
    const canonicalTier = resolvedTarget.canonicalTier;
    const targetModel = resolvedTarget.model;
    const targetThinking = resolvedTarget.thinkingOptionId;

    const previousTier = meta?.currentTier ?? null;
    const previousModel: string | null = meta?.currentModel ?? snapshotModel;
    const previousThinking: string | null = meta?.currentThinking ?? null;
    const specialist =
      meta?.role && effectiveConfig ? findSpecialist(effectiveConfig, meta.role) : undefined;
    const planModeSupported = effectiveConfig
      ? isNativePlanModeSupported(effectiveConfig, normalizedProvider)
      : supportsNativePlanMode(normalizedProvider);
    const isReadonlyPlanLocked = Boolean(specialist?.readonly && planModeSupported);

    // Manual tier switches default to writable "exec" phase unless the role is readonly
    // or the caller explicitly passed targetPhase ("design" | "review").
    let nextPhase: HarnessPhase = "exec";
    if (specialist?.readonly) {
      nextPhase =
        meta?.role === "architect" || meta?.role?.includes("architect") ? "design" : "review";
    } else if (targetPhase) {
      nextPhase = targetPhase;
    }

    let recommendedModeId: string | null = null;
    if (isReadonlyPlanLocked) {
      recommendedModeId = "plan";
    } else if ((nextPhase === "design" || nextPhase === "review") && planModeSupported) {
      recommendedModeId = "plan";
    } else if (
      currentModeId === "plan" ||
      meta?.phase === "design" ||
      meta?.phase === "review" ||
      previousTier === "plan"
    ) {
      recommendedModeId = effectiveConfig
        ? resolveResumeExecutionMode(
            effectiveConfig,
            normalizedProvider,
            meta?.resumeModeId ?? currentModeId,
          )
        : (meta?.resumeModeId ?? currentModeId ?? null);
    }

    await handle.setModel(targetModel);
    await applyAgentThinkingOption(context.paseo, agentId, targetThinking);
    await applyAgentModeOption(context.paseo, agentId, recommendedModeId);

    const nowTurn = meta ? meta.turnCount : 0;
    const isManualStepDown =
      (meta?.phase === "design" || previousTier === "plan") &&
      (canonicalTier === "fast" || canonicalTier === "standard");
    const nextMeta: HarnessAgentMetadata = {
      version: 1,
      role: meta?.role ?? "general",
      initialTier: meta?.initialTier ?? canonicalTier,
      currentTier: canonicalTier,
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
      autoDowngradedAtTurn: isManualStepDown ? nowTurn : (meta?.autoDowngradedAtTurn ?? null),
      downgradeReason: isManualStepDown ? "manual_switch" : (meta?.downgradeReason ?? null),
      lastProcessedTurnId: meta?.lastProcessedTurnId ?? null,
      resumeModeId:
        recommendedModeId === "plan" && currentModeId && currentModeId !== "plan"
          ? currentModeId
          : (meta?.resumeModeId ?? null),
      lastBilledTier: meta?.lastBilledTier ?? previousTier,
      lastBilledModel: meta?.lastBilledModel ?? previousModel,
      currentThinking: targetThinking,
      lastBilledThinking: meta?.lastBilledThinking ?? previousThinking,
    };

    await deps.setLatestMetadata(agentId, nextMeta, handle);

    const shouldEmit =
      !deps.emitTimelineTransitionsEnabled || deps.emitTimelineTransitionsEnabled();

    if (shouldEmit && handle) {
      await emitHarnessTimelineTransition(handle, {
        transitionKind: "manual_switch",
        role: nextMeta.role,
        fromTier: previousTier,
        toTier: canonicalTier,
        fromModel: previousModel,
        toModel: targetModel,
        phase: nextPhase,
        reason:
          reason ?? `Manual tier switch via RPC: ${previousTier ?? "unknown"} -> ${canonicalTier}`,
        turnNumber: nowTurn,
      });
    }

    if (shouldEmit && deps.emitTimelineEvent) {
      await deps.emitTimelineEvent(agentId, {
        transitionKind: "manual_switch",
        role: nextMeta.role,
        fromTier: previousTier,
        toTier: canonicalTier,
        fromModel: previousModel,
        toModel: targetModel,
        phase: nextPhase,
        reason:
          reason ?? `Manual tier switch via RPC: ${previousTier ?? "unknown"} -> ${canonicalTier}`,
        turnNumber: nowTurn,
      });
    }

    return {
      agentId,
      previousTier,
      currentTier: canonicalTier,
      previousModel,
      currentModel: targetModel,
      currentThinking: targetThinking,
      phase: nextPhase,
      recommendedModeId,
      recommendedThinkingOptionId: targetThinking,
      metadata: nextMeta,
    };
  });

  // 2. harnessHandoffRpc
  server.handle(harnessHandoffRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
    const { agentId, workspaceId, targetRole, summaryOverride } = input;
    const parentHandle = context.paseo.agents.ref(agentId);
    const parentSnapshot = parentHandle.current?.() ?? (await parentHandle.refresh?.())?.agent;

    const parentProvider = parentSnapshot?.provider ?? "claude";
    const parentCwd = parentSnapshot?.cwd ?? process.cwd();
    const parentWorkspaceId = workspaceId ?? parentSnapshot?.workspaceId ?? null;

    const effectiveConfig = deps.getConfig?.(parentWorkspaceId, parentCwd);
    const specialist = effectiveConfig ? findSpecialist(effectiveConfig, targetRole) : undefined;
    const isReadOnly = isReadOnlyHandoffRole(targetRole, specialist);

    if (parentSnapshot?.status === "running" && !isReadOnly) {
      throw new Error(
        "Parent agent is currently running in this workspace. Wait for the active turn to finish before spawning a writable specialist, or spawn a read-only reviewer.",
      );
    }

    const defaultPrompt =
      specialist?.handoffDefaultPrompt?.trim() ||
      `Execute implementation for specialist task as role ${targetRole}.`;
    let promptText = summaryOverride?.trim() || "";
    if (!promptText) {
      const contextLines: string[] = [];
      const parentTitle =
        typeof parentSnapshot?.title === "string" ? parentSnapshot.title.trim() : "";
      if (parentTitle) {
        contextLines.push(`- Parent Task: ${parentTitle}`);
      }
      if (typeof parentHandle.timeline?.refetch === "function") {
        try {
          const rawTimeline = await parentHandle.timeline.refetch({
            direction: "tail",
            limit: 6,
          });
          const timelineSummary = extractParentTimelineSummary(rawTimeline);
          if (timelineSummary) {
            contextLines.push(timelineSummary);
          }
        } catch {
          // Optional parent timeline enrichment
        }
      }
      contextLines.push(
        "- Shared Workspace Discipline: Only stage files you explicitly modified; never run git add -A blindly in a shared workspace.",
      );
      promptText = `${defaultPrompt}\n\n[Parent Session Context]\n${contextLines.join("\n")}`;
    }

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
    deps.onPaseoAvailable?.(context.paseo);

    const listedWorkspaces: Array<{
      id: string;
      name: string;
      title: string | null;
      cwd: string;
      branch: string | null;
    }> = [];
    if (typeof context.paseo.workspaces?.list === "function") {
      try {
        const listed = await context.paseo.workspaces.list({ includeBackground: false });
        const entries = (listed as { entries?: Array<Record<string, unknown>> })?.entries ?? [];
        for (const entry of entries) {
          const id = typeof entry.id === "string" ? entry.id : "";
          const cwdVal = pickWorkspaceDirectory(entry);
          if (!id || !cwdVal) continue;
          listedWorkspaces.push({
            id,
            name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id,
            title: typeof entry.title === "string" ? entry.title : null,
            cwd: cwdVal,
            branch: pickWorkspaceBranch(entry),
          });
        }
      } catch {
        // Optional workspace discovery
      }
    }

    const resolvedCwd = await resolveWorkspaceCwd(
      context.paseo,
      input,
      listedWorkspaces,
      deps.resolveWorkspaceDir,
    );

    const effectiveConfig = deps.getConfig?.(input.workspaceId, resolvedCwd);
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

    if (resolvedCwd) {
      const relPath = effectiveConfig?.repoConfigRelativePath ?? ".paseo/agent-harness.json";
      const override = loadRepoHarnessOverride(resolvedCwd, relPath);
      if (override) {
        hasRepoOverride = true;
        repoOverridePath = `${resolvedCwd}/${relPath}`;
      }
    }

    const availableProviders: Array<{ provider: string; enabled: boolean; models: string[] }> = [];
    if (context.paseo.providers?.snapshot) {
      try {
        const snap = await context.paseo.providers.snapshot();
        for (const entry of snap.entries ?? []) {
          availableProviders.push({
            provider: entry.provider,
            enabled: entry.enabled,
            models: (entry.models ?? []).map((m) => m.id),
          });
        }
      } catch {
        // Fallback to built-in provider list if snapshot fails
      }
    }

    const agentTeam = effectiveConfig?.agentTeam
      ? {
          projectSlug: effectiveConfig.agentTeam.projectSlug,
          preset: effectiveConfig.agentTeam.preset,
          rolesCount: effectiveConfig.agentTeam.roles.length,
          manifestPath: effectiveConfig.agentTeam.manifestPath,
          hasLocalAntigravityPlugin: effectiveConfig.agentTeam.hasLocalAntigravityPlugin,
          ...(effectiveConfig.agentTeam.targets
            ? { targets: effectiveConfig.agentTeam.targets }
            : {}),
          ...(effectiveConfig.agentTeam.localFederatedTargets
            ? { localFederatedTargets: effectiveConfig.agentTeam.localFederatedTargets }
            : {}),
        }
      : null;

    return {
      availableProviders,
      diskProfiles,
      lazyToolSlices,
      hasRepoOverride,
      repoOverridePath,
      agentTeam,
      ...(listedWorkspaces.length > 0 ? { workspaces: listedWorkspaces } : {}),
    };
  });

  // 4. harnessSyncProfilesRpc
  server.handle(harnessSyncProfilesRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
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
      const { syncedCount, errors } = await syncDaemonAgentProfiles(
        context.paseo,
        specialists,
        effectiveConfig,
      );
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
  server.handle(harnessEffectiveConfigRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context?.paseo);
    const resolvedCwd = await resolveWorkspaceCwd(
      context?.paseo,
      input,
      [],
      deps.resolveWorkspaceDir,
    );
    const effectiveConfig = deps.getConfig?.(input.workspaceId, resolvedCwd);
    return {
      config: (effectiveConfig ?? {}) as Record<string, unknown>,
    };
  });

  // 6. harnessTeamInspectRpc
  server.handle(harnessTeamInspectRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
    const effective = deps.getConfig?.(input.workspaceId, null);
    return inspectWorkspaceTeam({
      paseo: context.paseo,
      workspaceId: input.workspaceId,
      lazyToolSlicesDir: effective?.lazyToolProfilesDir,
      resolveWorkspaceDir: deps.resolveWorkspaceDir,
      resolveCompiler: deps.resolveCompiler,
    });
  });

  // 7. harnessTeamDetectRpc
  server.handle(harnessTeamDetectRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
    return detectWorkspaceTeam({
      paseo: context.paseo,
      workspaceId: input.workspaceId,
      resolveWorkspaceDir: deps.resolveWorkspaceDir,
      resolveCompiler: deps.resolveCompiler,
      runCompiler: deps.runTeamCompiler,
    });
  });

  // 8. harnessTeamSaveRpc
  server.handle(harnessTeamSaveRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
    const result = await saveWorkspaceTeam({
      paseo: context.paseo,
      workspaceId: input.workspaceId,
      manifest: input.manifest,
      reindex: input.reindex,
      resolveWorkspaceDir: deps.resolveWorkspaceDir,
      resolveCompiler: deps.resolveCompiler,
      runCompiler: deps.runTeamCompiler,
    });
    if (result.success) {
      await deps.onTeamUpdated?.(result.checkoutRoot);
    }
    return result;
  });

  // 9. harnessTeamDoctorRpc
  server.handle(harnessTeamDoctorRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
    return doctorWorkspaceTeam({
      paseo: context.paseo,
      workspaceId: input.workspaceId,
      resolveWorkspaceDir: deps.resolveWorkspaceDir,
      resolveCompiler: deps.resolveCompiler,
      runCompiler: deps.runTeamCompiler,
    });
  });

  // 10. harnessTeamCleanRpc
  server.handle(harnessTeamCleanRpc, async (input, context: PluginHandlerContext) => {
    deps.onPaseoAvailable?.(context.paseo);
    const result = await cleanWorkspaceTeam({
      paseo: context.paseo,
      workspaceId: input.workspaceId,
      deleteManifest: input.deleteManifest,
      resolveWorkspaceDir: deps.resolveWorkspaceDir,
      resolveCompiler: deps.resolveCompiler,
      runCompiler: deps.runTeamCompiler,
    });
    if (result.success) {
      await deps.onTeamUpdated?.(result.checkoutRoot);
    }
    return result;
  });
}
