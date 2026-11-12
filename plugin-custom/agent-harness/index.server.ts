import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  DEFAULT_PROVIDER_MAPPINGS,
  SAFETY_NET_PROVIDER,
  classifyIntentWithLlm,
  detectDomainRole,
  detectDomainRoleHybrid,
  normalizeProvider,
  resolveHarnessEnv,
  resolveMatrixModel,
} from "./shared/intent-detector.js";
import {
  createInitialHarnessMetadata,
  extractTimelineItems,
  hasExplicitExecTransitionIntent,
  hasShortAffirmativeExecConfirmation,
  inspectTurnTimeline,
  parseHarnessMetadata,
  shouldEnforceNativePlanMode,
  tierToPhase,
} from "./shared/lifecycle-state.js";
import { resolveResumeExecutionModeId } from "./shared/contracts.js";
import {
  DEFAULT_AGENT_HARNESS_SETTINGS,
  agentHarnessSettings,
  type AgentHarnessSettings,
} from "./shared/settings.js";
import {
  HARNESS_METADATA_KEY,
  type DomainRole,
  type DomainRoleDecision,
  type HarnessAgentMetadata,
  type HarnessDowngradeReason,
  type HarnessPhase,
  type HarnessTransitionKind,
  type MatrixTier,
  type RouterDecision,
} from "./shared/types.js";
import { createHarnessHandoffTool } from "./server/handoff-tool.js";
import { registerHarnessRpcHandlers } from "./server/rpc-handlers.js";
import { emitHarnessTimelineTransition } from "./server/timeline-emitter.js";

const PROMPT_CACHE_TTL_MS = 60_000;
const TITLE_PREVIEW_MAX_CODE_POINTS = 60;

const ROLE_PREFERRED_TIER: Partial<Record<DomainRole, MatrixTier>> = {
  orchestrator: "flash",
  pm: "plan",
  architect: "plan",
  review: "review",
  ui: "flash",
  backend: "flash",
  qa: "flash",
  scout: "flash",
};

function readStringLabels(obj: unknown): Record<string, string> | undefined {
  if (typeof obj !== "object" || obj === null || !("labels" in obj)) {
    return undefined;
  }
  const candidate = (obj as { labels?: unknown }).labels;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeLabels(
  primary: Readonly<Record<string, string>> | null | undefined,
  secondary: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> | undefined {
  if (!primary && !secondary) {
    return undefined;
  }
  const merged = { ...secondary, ...primary };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function truncateByCodePoints(text: string, maxCodePoints: number): string {
  return Array.from(text).slice(0, maxCodePoints).join("");
}

interface HarnessProfileSpec {
  name?: string;
  description?: string;
  primary_skills?: string[];
  mcp_servers?: string[];
  excluded_mcp_servers?: string[];
  docs_focus?: string[];
  quality_gates?: string[];
  ssot_output_target?: string;
}

function readHarnessProfileSpec(profilePath: string): HarnessProfileSpec | null {
  if (!profilePath) {
    return null;
  }
  try {
    const raw = fs.readFileSync(profilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as HarnessProfileSpec;
    }
  } catch {
    // Ignore missing or unreadable profile spec on disk
  }
  return null;
}

interface RoutedAgentConfigResult<T> {
  config: T;
  roleDecision: DomainRoleDecision;
  routerDecision: RouterDecision;
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(agentHarnessSettings);
  let cachedSettings: AgentHarnessSettings = { ...DEFAULT_AGENT_HARNESS_SETTINGS };
  let hasSubscriptionUpdate = false;

  function applySettings(state: Awaited<ReturnType<typeof settings.read>>) {
    if (state.status === "ready") {
      cachedSettings = { ...cachedSettings, ...state.values };
    }
  }

  const unsubscribeSettings = settings.subscribe((state) => {
    if (state.status === "ready") {
      hasSubscriptionUpdate = true;
    }
    applySettings(state);
  });

  settings
    .read()
    .then((state) => {
      if (!hasSubscriptionUpdate) {
        applySettings(state);
      }
    })
    .catch((error) => {
      console.error("[AgentHarness] Failed to read settings", error);
    });

  // In-memory shadow metadata cache: agentId -> HarnessAgentMetadata
  const latestMetadataByAgent = new Map<string, HarnessAgentMetadata>();

  // In-flight plan permission requests: requestId -> { agentId, createdAt }
  const pendingPlanPermissions = new Map<string, { agentId: string; createdAt: number }>();

  function readLatestMetadata(agent: {
    id: string;
    metadata?: unknown;
  }): HarnessAgentMetadata | null {
    const cached = latestMetadataByAgent.get(agent.id);
    if (cached) {
      return cached;
    }
    const parsed = parseHarnessMetadata(agent.metadata);
    if (parsed) {
      latestMetadataByAgent.set(agent.id, parsed);
    }
    return parsed;
  }

  async function updateAgentMetadata(
    agentId: string,
    meta: HarnessAgentMetadata,
    handle: { setMetadata: (patch: Record<string, any>) => Promise<void> },
  ): Promise<void> {
    latestMetadataByAgent.set(agentId, meta);
    try {
      await handle.setMetadata({ [HARNESS_METADATA_KEY]: meta });
    } catch (error) {
      if (cachedSettings.debugLogs) {
        console.error(`[AgentHarness] Failed to update metadata for ${agentId}`, error);
      }
    }
  }

  // Short-lived cache of creation context by normalized cwd (replaced on each new creation, consumed on open)
  const recentCreationContext = new Map<
    string,
    { prompt: string; labels?: Record<string, string>; timestamp: number }
  >();
  let lastWorkspaceCreationContext: {
    prompt: string;
    labels?: Record<string, string>;
    timestamp: number;
  } | null = null;

  function cleanupOldPrompts() {
    const now = Date.now();
    for (const [key, val] of recentCreationContext.entries()) {
      if (now - val.timestamp > PROMPT_CACHE_TTL_MS) {
        recentCreationContext.delete(key);
      }
    }
    if (
      lastWorkspaceCreationContext &&
      now - lastWorkspaceCreationContext.timestamp > PROMPT_CACHE_TTL_MS
    ) {
      lastWorkspaceCreationContext = null;
    }
    for (const [reqId, info] of pendingPlanPermissions.entries()) {
      if (now - info.createdAt > 300_000) {
        pendingPlanPermissions.delete(reqId);
      }
    }
  }

  function rememberCreationContext(
    cwd: string | undefined,
    prompt: string,
    labels?: Readonly<Record<string, string>>,
  ) {
    if (!cwd || (!prompt && !labels)) {
      return;
    }
    const key = path.resolve(cwd);
    const existing = recentCreationContext.get(key);
    recentCreationContext.set(key, {
      prompt: prompt || existing?.prompt || "",
      labels: mergeLabels(labels, existing?.labels),
      timestamp: Date.now(),
    });
  }

  function resolveContextText(cwd: string | undefined, title: string | null | undefined): string {
    const trimmedTitle = title?.trim() ?? "";
    const cachedPrompt = cwd ? (recentCreationContext.get(path.resolve(cwd))?.prompt ?? "") : "";
    if (cachedPrompt && (!trimmedTitle || cachedPrompt.startsWith(trimmedTitle))) {
      return cachedPrompt;
    }
    return trimmedTitle || cachedPrompt;
  }

  function consumeContextLabels(
    cwd: string | undefined,
    labels: Readonly<Record<string, string>> | null | undefined,
  ): Record<string, string> | undefined {
    const normalizedRequestLabels =
      labels && Object.keys(labels).length > 0 ? { ...labels } : undefined;
    if (!cwd) {
      return normalizedRequestLabels;
    }
    const key = path.resolve(cwd);
    const cached = recentCreationContext.get(key);
    if (cached) {
      recentCreationContext.delete(key);
    }
    return mergeLabels(normalizedRequestLabels, cached?.labels);
  }

  async function routeAgentConfig<
    T extends {
      provider: string;
      model?: string | null;
      title?: string | null;
      systemPrompt?: string;
      modeId?: string;
    },
  >(
    config: T,
    text: string,
    hookStage: string,
    mergedLabels?: Readonly<Record<string, string>>,
    parentAgentCheck?: boolean,
  ): Promise<RoutedAgentConfigResult<T>> {
    const roleDecision = detectDomainRole({ text, labels: mergedLabels, homeDir: os.homedir() });

    let decision = resolveMatrixModel({
      provider: config.provider,
      currentModel: config.model,
      text,
      overrideIfDefaultOnly: cachedSettings.overrideIfDefaultOnly,
    });

    const normalizedProvider = normalizeProvider(config.provider);
    if (
      text.trim() &&
      cachedSettings.llmFallbackEnabled &&
      normalizedProvider !== SAFETY_NET_PROVIDER &&
      roleDecision.matchedRule === "default_general" &&
      decision.matchedRule === "default_fallback" &&
      !decision.matchedRule.startsWith("preserve_user_choice")
    ) {
      const llmResult = await classifyIntentWithLlm({
        text,
        endpoint: cachedSettings.llmFallbackEndpoint,
        apiKey: cachedSettings.llmFallbackApiKey,
        model: cachedSettings.llmFallbackModel,
        timeoutMs: cachedSettings.llmFallbackTimeoutMs,
      });
      if (llmResult && llmResult.tier !== "flash") {
        const mapping = Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, normalizedProvider)
          ? DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]
          : undefined;
        const targetModel = mapping?.[llmResult.tier] ?? llmResult.tier;
        decision = {
          tier: llmResult.tier,
          targetModel,
          reason: `Routed to ${llmResult.tier} model '${targetModel}' via L2 LLM fallback`,
          matchedRule: `llm_fallback:${llmResult.tier}`,
          previousModel: config.model ?? undefined,
        };
      }
    }

    // If an explicit role label is provided (e.g. role: review or role: pm) or role is orchestrator (Thin Dispatcher -> flash), enforce role tier
    if (
      (roleDecision.matchedRule.startsWith("label:") || roleDecision.role === "orchestrator") &&
      normalizedProvider !== SAFETY_NET_PROVIDER &&
      !decision.matchedRule.startsWith("preserve_user_choice")
    ) {
      const preferredTier = ROLE_PREFERRED_TIER[roleDecision.role];
      const mapping = Object.hasOwn(DEFAULT_PROVIDER_MAPPINGS, normalizedProvider)
        ? DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]
        : undefined;
      const shouldKeepTextTier =
        decision.matchedRule.startsWith("review:") && roleDecision.role === "qa";
      if (preferredTier && mapping && !shouldKeepTextTier) {
        decision = {
          tier: preferredTier,
          targetModel: mapping[preferredTier],
          reason: `Routed to ${preferredTier} model '${mapping[preferredTier]}' by role '${roleDecision.role}'`,
          matchedRule: `role_tier:${roleDecision.role}`,
          previousModel: config.model ?? undefined,
        };
      }
    }

    const hasTitle = Boolean(config.title?.trim());
    let nextTitle = config.title;
    if (!hasTitle && text) {
      nextTitle = truncateByCodePoints(text, TITLE_PREVIEW_MAX_CODE_POINTS);
    }
    const nextModel =
      decision.targetModel && decision.targetModel !== config.model
        ? decision.targetModel
        : config.model;

    // Enforce native plan mode if applicable
    let nextModeId = config.modeId;
    const userModelLocked = decision.matchedRule.startsWith("preserve_user_choice");
    const roleLockedByLabel =
      roleDecision.matchedRule.startsWith("label:") || Boolean(mergedLabels?.role);
    const hasParentAgent = Boolean(parentAgentCheck);

    const mustEnforcePlanMode = shouldEnforceNativePlanMode({
      phaseLifecycleEnabled: cachedSettings.phaseLifecycleEnabled,
      enforceNativePlanMode: cachedSettings.enforceNativePlanMode,
      tier: decision.tier,
      role: roleDecision.role,
      userModelLocked,
      roleLockedByLabel,
      hasParentAgent,
      provider: config.provider,
    });

    if (mustEnforcePlanMode) {
      // In workspace.create, keep the original requested mode in config so agent.create.before can capture resumeModeId
      if (hookStage !== "workspace.create") {
        nextModeId = "plan";
      }
    }

    let nextSystemPrompt = config.systemPrompt;
    if (
      normalizedProvider !== SAFETY_NET_PROVIDER &&
      text.trim() &&
      !config.systemPrompt?.includes("[Capability Harness Active Profile]")
    ) {
      const profileSpec = readHarnessProfileSpec(roleDecision.profilePath);
      const primarySkills = profileSpec?.primary_skills?.filter(Boolean) ?? [];
      const allowedMcp = profileSpec?.mcp_servers?.filter(Boolean) ?? [];
      const excludedMcp = profileSpec?.excluded_mcp_servers?.filter(Boolean) ?? [];
      const qualityGates = profileSpec?.quality_gates?.filter(Boolean) ?? [];

      const phaseRule =
        roleDecision.role === "orchestrator"
          ? '- Paseo Thin Dispatcher Rule: As `role=orchestrator` (running on fast `flash` model), DO NOT write complex architecture or business code yourself, and DO NOT use Claude\'s internal `Agent` tool! Instead, act strictly as a fast Thin Dispatcher: 1) Spawn `role=architect` (`plan` model) and `role=pm` (`plan` model) via `paseo run --workspace "$PASEO_WORKSPACE_ID" --provider claude --mode bypassPermissions --label role=<architect|pm> --title "<Role Task>" "<Prompt>"` (preserving `PASEO_AGENT_ID` so they group cleanly in your Subagents Track pill) to define `design.md`, shared contracts, and `proposal.md`/`spec.md`; 2) Once contracts are ready, spawn `role=backend` (`flash`) and `role=ui` (`flash`) in parallel (`--no-wait` + `paseo wait`); 3) Spawn `role=review` (`review`) for dual-axis gate verification, run final `npm test`, and report the summary.'
          : decision.tier === "plan"
            ? "- [Phase: Design & Planning] Rule: You are running on the high-reasoning plan model (phase=design). Present concise architectural proposals, trade-offs, and specs (for UI tasks, present concise visual concepts, layout wireframes, and UX trade-offs — DO NOT dump long HTML/React code blocks). Except for spec/contract docs (openspec/**/*.md, design.md, proposal.md, spec.md, tasks.md, GLOSSARY.md), DO NOT directly edit business source files in this plan session! Once the plan is confirmed, you or the user can exit plan mode via the `ExitPlanMode` permission or invoke the host tool `harness_handoff` (targetRole: ui, backend, qa, or review) to hand off execution to a fast flash specialist."
            : decision.tier === "flash"
              ? "- [Phase: Fast Execution] Rule: You are running on the fast flash model (phase=exec). Implement minimal, targeted code changes per spec and verify with targeted tests (npx vitest run <file> --bail=1, NEVER full suite), npm run typecheck, and npm run lint. Review Gate: For non-trivial changes (>3 modified files or core state/protocol/security logic), once green, spawn or hand off via paseo-handoff to Reviewer (Gate) (--label role=review) for dual-axis review (Standards + Spec) and local ocr scan."
              : decision.tier === "review"
                ? "- [Phase: Review Gate] Rule: You are running on the review model (phase=review). Perform read-only dual-axis audit (Standards + Spec) and ocr gate verification; do not author large feature implementations directly."
                : "";

      const harnessBanner = [
        "[Capability Harness Active Profile]",
        `- Role: ${roleDecision.role} (rule: ${roleDecision.matchedRule})${profileSpec?.description ? ` — ${profileSpec.description}` : ""}`,
        `- Matrix Tier: ${decision.tier} (model: ${nextModel ?? "default"})`,
        `- Profile Spec: ${roleDecision.profilePath}`,
        `- Lazy-Tool Slice: ${roleDecision.lazyToolConfigPath}`,
        ...(primarySkills.length > 0 ? [`- Primary Skills: ${primarySkills.join(", ")}`] : []),
        ...(allowedMcp.length > 0
          ? [`- Allowed MCP Servers (via lazy-tool): ${allowedMcp.join(", ")}`]
          : []),
        ...(excludedMcp.length > 0 ? [`- Excluded MCP Servers: ${excludedMcp.join(", ")}`] : []),
        ...(qualityGates.length > 0 ? [`- Quality Gates: ${qualityGates.join(", ")}`] : []),
        ...(profileSpec?.ssot_output_target
          ? [`- SSOT Output Target: ${profileSpec.ssot_output_target}`]
          : []),
        `- Workspace Boundary Guardrail (CRITICAL): You are strictly bound to your current working directory (\`process.cwd()\`). NEVER search, read, or modify files in other repositories outside your current workspace/repo root without explicit confirmation! If the user's request or screenshot targets code that does not exist in the current repository, STOP immediately, inform the user which project you are currently in (and which project the target likely belongs to), and ask them to confirm or switch projects before touching any external files.`,
        ...(primarySkills.length > 0
          ? [
              `- Mandatory Skill Activation: Before authoring domain deliverables or code, you MUST invoke the \`Skill\` tool to load at least one of your Primary Skills (${primarySkills.map((s) => `\`${s}\``).join(", ")}) so its domain rules govern your implementation.`,
            ]
          : []),
        ...(phaseRule ? [phaseRule] : []),
      ].join("\n");
      nextSystemPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\n${harnessBanner}`
        : harnessBanner;
    }

    const nextConfig =
      nextModel !== config.model ||
      nextTitle !== config.title ||
      nextModeId !== config.modeId ||
      nextSystemPrompt !== config.systemPrompt
        ? {
            ...config,
            model: nextModel,
            title: nextTitle,
            ...(nextModeId !== undefined ? { modeId: nextModeId } : {}),
            ...(nextSystemPrompt !== undefined ? { systemPrompt: nextSystemPrompt } : {}),
          }
        : config;

    if (cachedSettings.debugLogs && nextModel !== config.model) {
      console.log(
        `[AgentHarness] (${hookStage}) Routed agent (${config.provider}, len=${text.length}): ` +
          `'${config.model ?? "(default)"}' -> '${nextModel}' [tier: ${decision.tier}, rule: ${decision.matchedRule}]`,
      );
    }

    return {
      config: nextConfig,
      roleDecision,
      routerDecision: decision,
    };
  }

  // Hook 1: workspace.create.before
  const removeWorkspaceHook = server.addHook("workspace.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    const prompt =
      request.firstAgentContext?.prompt?.trim() ||
      request.agent?.initialPrompt?.trim() ||
      request.title?.trim() ||
      "";

    const mergedLabels = mergeLabels(
      readStringLabels(request.agent?.config),
      readStringLabels(request),
    );

    if (!prompt && !mergedLabels) {
      return request;
    }

    const sourcePath =
      request.source.kind === "directory"
        ? request.source.path
        : (request.source as { cwd?: string }).cwd || request.agent?.config?.cwd;
    if (sourcePath) {
      rememberCreationContext(sourcePath, prompt, mergedLabels);
    }
    lastWorkspaceCreationContext = {
      prompt,
      labels: mergedLabels,
      timestamp: Date.now(),
    };

    if (request.agent?.config) {
      const parentAgentCheck = Boolean(
        (request as { parentAgentId?: string | null }).parentAgentId ||
        mergedLabels?.["paseo.parent-agent-id"],
      );
      const { config: nextConfig } = await routeAgentConfig(
        request.agent.config,
        prompt,
        "workspace.create",
        mergedLabels,
        parentAgentCheck,
      );
      if (nextConfig !== request.agent.config) {
        return {
          ...request,
          agent: {
            ...request.agent,
            config: nextConfig,
          },
        };
      }
    }

    return undefined;
  });

  // Hook 1b: worktree.create.before
  const removeWorktreeHook = server.addHook("worktree.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return undefined;
    }
    cleanupOldPrompts();
    const repoContext = recentCreationContext.get(path.resolve(request.repoRoot));
    const sourceContext = recentCreationContext.get(path.resolve(request.sourceCheckout));
    const pending = repoContext ?? sourceContext ?? lastWorkspaceCreationContext;
    if (pending && request.path) {
      rememberCreationContext(request.path, pending.prompt, pending.labels);
      lastWorkspaceCreationContext = null;
    }
    return undefined;
  });

  // Hook 2: agent.create.before
  const removeAgentHook = server.addHook("agent.create.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    const config = request.config;
    const reqWithInitialPrompt = request as {
      initialPrompt?: string;
      labels?: Record<string, string>;
      parentAgentId?: string | null;
    };
    const initialPrompt = reqWithInitialPrompt.initialPrompt?.trim() ?? "";
    const explicitTitle = config.title?.trim() ?? "";
    const promptOrTitle = initialPrompt || resolveContextText(config.cwd, config.title);
    const cachedLabels = config.cwd
      ? recentCreationContext.get(path.resolve(config.cwd))?.labels
      : undefined;
    const mergedLabels = mergeLabels(
      mergeLabels(
        readStringLabels(config),
        mergeLabels(readStringLabels(request), reqWithInitialPrompt.labels),
      ),
      cachedLabels,
    );

    const hasParentAgent = Boolean(
      reqWithInitialPrompt.parentAgentId ||
      (request as { parent?: string | null }).parent ||
      mergedLabels?.["paseo.parent-agent-id"],
    );

    if (config.cwd && (promptOrTitle || mergedLabels)) {
      rememberCreationContext(config.cwd, promptOrTitle || explicitTitle, mergedLabels);
    }

    const {
      config: nextConfig,
      roleDecision,
      routerDecision,
    } = await routeAgentConfig(config, promptOrTitle, "agent.create", mergedLabels, hasParentAgent);

    const isSafetyNet = normalizeProvider(config.provider) === SAFETY_NET_PROVIDER;

    if (cachedSettings.phaseLifecycleEnabled && !isSafetyNet) {
      const userModelLocked = routerDecision.matchedRule.startsWith("preserve_user_choice");
      const roleLockedByLabel =
        roleDecision.matchedRule.startsWith("label:") || Boolean(mergedLabels?.role);

      const resumeModeId = config.modeId && config.modeId !== "plan" ? config.modeId : null;

      const initialMetadata = createInitialHarnessMetadata({
        role: roleDecision.role,
        tier: routerDecision.tier,
        model: nextConfig.model ?? config.model ?? null,
        roleMatchedRule: roleDecision.matchedRule,
        tierMatchedRule: routerDecision.matchedRule,
        userModelLocked,
        roleLockedByLabel,
        resumeModeId,
      });

      return {
        ...request,
        config: nextConfig,
        metadata: {
          ...request.metadata,
          [HARNESS_METADATA_KEY]: initialMetadata,
        },
      };
    }

    if (nextConfig !== config) {
      return {
        ...request,
        config: nextConfig,
      };
    }

    return request;
  });

  // Hook 2b: agent.create.after — Emits initial_route timeline transition event
  const removeAgentCreateAfterHook = server.addHook(
    "agent.create.after",
    async ({ agent }, context) => {
      if (
        !cachedSettings.enabled ||
        !cachedSettings.phaseLifecycleEnabled ||
        !cachedSettings.emitTimelineTransitions
      ) {
        return;
      }
      const meta = parseHarnessMetadata(agent.metadata);
      if (!meta) {
        return;
      }
      latestMetadataByAgent.set(agent.id, meta);

      // If routed to plan/review or changed model from default, emit initial_route
      if (meta.currentTier !== "flash" || meta.currentModel) {
        if (context.paseo?.agents) {
          try {
            const handle = context.paseo.agents.ref(agent.id);
            await emitHarnessTimelineTransition({
              handle,
              transitionKind: "initial_route",
              role: meta.role,
              fromTier: null,
              toTier: meta.currentTier,
              fromModel: null,
              toModel: meta.currentModel,
              phase: meta.phase,
              reason: `Initial route to ${meta.currentTier} (rule: ${meta.tierMatchedRule})`,
              turnNumber: 0,
            });
          } catch {
            // Ignore timeline append failures on creation
          }
        }
      }
    },
  );

  // Hook 3: agent.open.before
  // Injects Capability Harness environment variables and registers harness_handoff host tool
  const removeOpenHook = server.addHook("agent.open.before", async ({ request }) => {
    if (!cachedSettings.enabled) {
      return request;
    }

    cleanupOldPrompts();

    if (normalizeProvider(request.provider) === SAFETY_NET_PROVIDER) {
      consumeContextLabels(request.cwd, request.labels);
      return request;
    }

    const existingMeta =
      latestMetadataByAgent.get(request.agentId) ??
      parseHarnessMetadata((request as { metadata?: unknown }).metadata);
    if (existingMeta) {
      latestMetadataByAgent.set(request.agentId, existingMeta);
    }

    const isExistingSession = request.reason !== "create" && Boolean(existingMeta);
    const textContext = resolveContextText(request.cwd, request.title);
    const labelsContext = isExistingSession
      ? request.labels && Object.keys(request.labels).length > 0
        ? { ...request.labels }
        : undefined
      : consumeContextLabels(request.cwd, request.labels);

    const roleDecision = existingMeta
      ? {
          role: existingMeta.role,
          matchedRule: existingMeta.roleMatchedRule,
          profilePath: "",
          lazyToolConfigPath: "",
        }
      : await detectDomainRoleHybrid({
          text: textContext,
          labels: labelsContext,
          homeDir: os.homedir(),
          llmFallback: {
            enabled: cachedSettings.llmFallbackEnabled,
            endpoint: cachedSettings.llmFallbackEndpoint,
            apiKey: cachedSettings.llmFallbackApiKey,
            model: cachedSettings.llmFallbackModel,
            timeoutMs: cachedSettings.llmFallbackTimeoutMs,
          },
        });

    const nextEnv = resolveHarnessEnv({
      role: roleDecision.role,
      existingEnv: request.env,
      homeDir: os.homedir(),
    });

    let nextTools = request.tools;
    if (
      request.purpose === "interactive" &&
      normalizeProvider(request.provider) !== SAFETY_NET_PROVIDER
    ) {
      const hasTool = request.tools.some((t) => t.name === "harness_handoff");
      if (!hasTool) {
        const handoffTool = createHarnessHandoffTool({
          getLatestMetadata: (id) => latestMetadataByAgent.get(id) ?? null,
          shouldEmitTimeline: () => cachedSettings.emitTimelineTransitions,
        });
        nextTools = [...request.tools, handoffTool];
      }
    }

    if (cachedSettings.debugLogs) {
      console.log(
        `[AgentHarness] (agent.open) Mounted Capability Harness for ${request.agentId} (${request.provider}): ` +
          `role='${roleDecision.role}' [rule: ${roleDecision.matchedRule}]`,
      );
    }

    return {
      ...request,
      env: nextEnv,
      tools: nextTools,
    };
  });

  // Hook 3b: agent.permission.before & agent.permission.after for ExitPlanMode approval -> immediate flash downgrade
  const removePermissionBeforeHook = server.addHook(
    "agent.permission.before",
    async ({ agent, request }) => {
      if (!cachedSettings.enabled || !cachedSettings.phaseLifecycleEnabled) {
        return;
      }
      if (request.kind === "plan" || request.name === "ExitPlanMode") {
        pendingPlanPermissions.set(request.id, {
          agentId: agent.id,
          createdAt: Date.now(),
        });
      }
    },
  );

  const removePermissionAfterHook = server.addHook(
    "agent.permission.after",
    async ({ agent, requestId, resolution }, context) => {
      if (!cachedSettings.enabled || !cachedSettings.phaseLifecycleEnabled) {
        return;
      }
      const pending = pendingPlanPermissions.get(requestId);
      if (!pending) {
        return;
      }
      pendingPlanPermissions.delete(requestId);

      if (resolution.behavior === "allow") {
        const meta = readLatestMetadata(agent);
        if (meta && meta.currentTier === "plan" && !meta.userModelLocked && context.paseo?.agents) {
          const normalizedProvider = normalizeProvider(agent.provider);
          const flashModel = DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]?.flash ?? "flash";
          const handle = context.paseo.agents.ref(agent.id);

          try {
            await handle.setModel(flashModel);
            const nextMeta: HarnessAgentMetadata = {
              ...meta,
              lastBilledTier: meta.lastBilledTier ?? "plan",
              lastBilledModel: meta.lastBilledModel ?? meta.currentModel,
              currentTier: "flash",
              currentModel: flashModel,
              phase: "exec",
              autoDowngradedAtTurn: Math.max(1, meta.turnCount),
              downgradeReason: "plan_approved",
            };

            await updateAgentMetadata(agent.id, nextMeta, handle);

            if (cachedSettings.emitTimelineTransitions) {
              await emitHarnessTimelineTransition({
                handle,
                transitionKind: "plan_approved",
                role: meta.role,
                fromTier: "plan",
                toTier: "flash",
                fromModel: meta.currentModel,
                toModel: flashModel,
                phase: "exec",
                reason: "Plan mode approved by user (ExitPlanMode) -> switched to flash tier",
                turnNumber: meta.turnCount,
              });
            }
          } catch (error) {
            if (cachedSettings.debugLogs) {
              console.error(
                "[AgentHarness] (permission.after) Failed to switch model on plan approval",
                error,
              );
            }
          }
        }
      }
    },
  );

  const switchedFirstTurnAgents = new Set<string>();

  // Hook 4: agent.turn.before — Pre-turn check: dynamic first-turn upgrade OR proactive short affirmation downgrade
  const removeTurnHook = server.addHook("agent.turn.before", async ({ agent }, context) => {
    if (
      !cachedSettings.enabled ||
      normalizeProvider(agent.provider) === SAFETY_NET_PROVIDER ||
      !context.paseo?.agents
    ) {
      return;
    }

    const meta = readLatestMetadata(agent);

    // Pre-turn proactive downgrade on short affirmative confirmation
    if (
      meta &&
      meta.currentTier === "plan" &&
      meta.phase === "design" &&
      meta.planTurnCount >= 1 &&
      cachedSettings.autoDowngradePlanOnExec &&
      meta.autoDowngradedAtTurn === null &&
      !meta.userModelLocked &&
      !(meta.roleLockedByLabel && (meta.role === "pm" || meta.role === "architect"))
    ) {
      const handle = context.paseo.agents.ref(agent.id);
      try {
        const rawTimeline = await handle.timeline.refetch({ direction: "tail", limit: 8 });
        const timelineItems = extractTimelineItems(rawTimeline);
        const { latestUserText, handoffInvoked } = inspectTurnTimeline(timelineItems);

        const hasAffirmative =
          !handoffInvoked &&
          (hasExplicitExecTransitionIntent(latestUserText) ||
            hasShortAffirmativeExecConfirmation(latestUserText, meta.planTurnCount));

        if (hasAffirmative) {
          const normalizedProvider = normalizeProvider(agent.provider);
          const flashModel = DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]?.flash ?? "flash";
          await handle.setModel(flashModel);

          const nextMeta: HarnessAgentMetadata = {
            ...meta,
            lastBilledTier: meta.currentTier,
            lastBilledModel: meta.currentModel,
            currentTier: "flash",
            currentModel: flashModel,
            phase: "exec",
            autoDowngradedAtTurn: meta.turnCount + 1,
            downgradeReason: "explicit_exec_intent",
          };

          // If session was locked in native plan mode, request daemon to resume prior execution mode
          const recommendedModeId = resolveResumeExecutionModeId(agent.provider, meta.resumeModeId);
          if (recommendedModeId) {
            try {
              const daemonClient = (
                context.paseo as unknown as {
                  daemonClient?: { setAgentMode?: (id: string, mode: string) => Promise<unknown> };
                }
              ).daemonClient;
              if (daemonClient?.setAgentMode) {
                await daemonClient.setAgentMode(agent.id, recommendedModeId);
              }
            } catch {
              // Ignore daemonClient setAgentMode fallback error
            }
          }

          await updateAgentMetadata(agent.id, nextMeta, handle);

          if (cachedSettings.emitTimelineTransitions) {
            await emitHarnessTimelineTransition({
              handle,
              transitionKind: "auto_downgrade",
              role: meta.role,
              fromTier: "plan",
              toTier: "flash",
              fromModel: meta.currentModel,
              toModel: flashModel,
              phase: "exec",
              reason: `Pre-turn auto-downgrade on affirmative execution confirmation: '${latestUserText}'`,
              turnNumber: meta.turnCount,
            });
          }
          return;
        }
      } catch {
        // Ignore pre-turn timeline inspection failures
      }
    }

    // Dynamic first-turn model upgrade when agent was created with empty prompt
    if (!switchedFirstTurnAgents.has(agent.id)) {
      switchedFirstTurnAgents.add(agent.id);
      if (
        (meta?.turnCount ?? 0) > 0 ||
        meta?.userModelLocked ||
        meta?.roleLockedByLabel ||
        !agent.title
      ) {
        return;
      }

      const decision = resolveMatrixModel({
        provider: agent.provider,
        text: agent.title,
        overrideIfDefaultOnly: cachedSettings.overrideIfDefaultOnly,
      });

      if (decision.tier !== "flash" && decision.targetModel) {
        try {
          const handle = context.paseo.agents.ref(agent.id);
          await handle.setModel(decision.targetModel);
          if (cachedSettings.debugLogs) {
            console.log(
              `[AgentHarness] (agent.turn.before) Upgraded first-turn model for ${agent.id} (${agent.provider}) -> '${decision.targetModel}' [tier: ${decision.tier}, rule: ${decision.matchedRule}]`,
            );
          }
          if (cachedSettings.phaseLifecycleEnabled && meta) {
            const updatedMeta: HarnessAgentMetadata = {
              ...meta,
              currentTier: decision.tier,
              currentModel: decision.targetModel,
              phase: tierToPhase(decision.tier, meta.role),
              tierMatchedRule: decision.matchedRule,
            };
            await updateAgentMetadata(agent.id, updatedMeta, handle);
          }
        } catch {
          // Ignore if agent is already running or provider rejects mid-turn model switch
        }
      }
    }
  });

  // Hook 5: agent.turn.after — Stealth lifecycle state machine and auto-downgrade
  const removeTurnAfterHook = server.addHook(
    "agent.turn.after",
    async ({ agent, turnId, outcome }, context) => {
      if (
        !cachedSettings.enabled ||
        !cachedSettings.phaseLifecycleEnabled ||
        outcome.kind !== "completed" ||
        normalizeProvider(agent.provider) === SAFETY_NET_PROVIDER ||
        !context.paseo?.agents
      ) {
        return;
      }

      const meta = readLatestMetadata(agent);
      if (!meta || (turnId !== null && meta.lastProcessedTurnId === turnId)) {
        return;
      }

      const handle = context.paseo.agents.ref(agent.id);
      const isPlanDesign = meta.currentTier === "plan" && meta.phase === "design";
      const nextTurnCount = meta.turnCount + 1;
      const nextPlanTurnCount = isPlanDesign ? meta.planTurnCount + 1 : meta.planTurnCount;

      // I/O pruning: If not in plan/design or already downgraded, skip timeline refetch
      if (!isPlanDesign || meta.autoDowngradedAtTurn !== null) {
        const nextMeta: HarnessAgentMetadata = {
          ...meta,
          turnCount: nextTurnCount,
          planTurnCount: nextPlanTurnCount,
          lastProcessedTurnId: turnId,
          lastBilledTier: meta.currentTier,
          lastBilledModel: meta.currentModel,
        };
        await updateAgentMetadata(agent.id, nextMeta, handle);
        return;
      }

      // In plan/design and not yet downgraded: refetch timeline for inspection
      let rawTimeline: unknown = null;
      try {
        rawTimeline = await handle.timeline.refetch({ direction: "tail", limit: 20 });
      } catch (error) {
        if (cachedSettings.debugLogs) {
          console.error("[AgentHarness] (agent.turn.after) Failed to refetch timeline", error);
        }
      }

      const timelineItems = extractTimelineItems(rawTimeline);
      const timelineInspection = inspectTurnTimeline(timelineItems);

      let handoffSuggestedAtTurn = meta.handoffSuggestedAtTurn;
      if (
        nextPlanTurnCount >= cachedSettings.planTurnSoftLimit &&
        handoffSuggestedAtTurn === null
      ) {
        handoffSuggestedAtTurn = nextTurnCount;
      }

      const canAutoDowngrade =
        cachedSettings.autoDowngradePlanOnExec &&
        meta.autoDowngradedAtTurn === null &&
        !meta.userModelLocked &&
        !(meta.roleLockedByLabel && (meta.role === "pm" || meta.role === "architect"));

      const hasExecIntent =
        nextTurnCount >= 2 &&
        !timelineInspection.handoffInvoked &&
        (hasExplicitExecTransitionIntent(timelineInspection.latestUserText) ||
          hasShortAffirmativeExecConfirmation(
            timelineInspection.latestUserText,
            meta.planTurnCount,
          ));

      const shouldDowngrade =
        canAutoDowngrade && (timelineInspection.detectedCodeWrite || hasExecIntent);

      const billedTier = meta.currentTier;
      const billedModel = meta.currentModel;
      let currentTier: MatrixTier = meta.currentTier;
      let currentModel: string | null = meta.currentModel;
      let phase: HarnessPhase = meta.phase;
      let autoDowngradedAtTurn: number | null = meta.autoDowngradedAtTurn;
      let downgradeReason: HarnessDowngradeReason | null = meta.downgradeReason;

      if (shouldDowngrade) {
        const normalizedProvider = normalizeProvider(agent.provider);
        const flashModel = DEFAULT_PROVIDER_MAPPINGS[normalizedProvider]?.flash ?? "flash";
        const reason: HarnessDowngradeReason = timelineInspection.detectedCodeWrite
          ? "write_tool_in_plan"
          : "explicit_exec_intent";

        try {
          await handle.setModel(flashModel);
          currentTier = "flash";
          currentModel = flashModel;
          phase = "exec";
          autoDowngradedAtTurn = nextTurnCount;
          downgradeReason = reason;

          // If session was locked in native plan mode, request daemon to resume prior execution mode
          const recommendedModeId = resolveResumeExecutionModeId(agent.provider, meta.resumeModeId);
          if (recommendedModeId) {
            try {
              const daemonClient = (
                context.paseo as unknown as {
                  daemonClient?: { setAgentMode?: (id: string, mode: string) => Promise<unknown> };
                }
              ).daemonClient;
              if (daemonClient?.setAgentMode) {
                await daemonClient.setAgentMode(agent.id, recommendedModeId);
              }
            } catch {
              // Ignore daemonClient setAgentMode fallback error
            }
          }

          if (cachedSettings.emitTimelineTransitions) {
            await emitHarnessTimelineTransition({
              handle,
              transitionKind: "auto_downgrade",
              role: meta.role,
              fromTier: "plan",
              toTier: "flash",
              fromModel: meta.currentModel,
              toModel: flashModel,
              phase: "exec",
              reason: `Auto-downgraded plan -> flash (reason: ${reason})`,
              turnNumber: nextTurnCount,
            });
          }

          if (cachedSettings.debugLogs) {
            console.log(
              `[AgentHarness] (agent.turn.after) Auto-downgraded ${agent.id} from plan -> flash (${flashModel}) [reason: ${reason}]`,
            );
          }
        } catch (error) {
          if (cachedSettings.debugLogs) {
            console.error(
              `[AgentHarness] (agent.turn.after) Failed to setModel for auto-downgrade`,
              error,
            );
          }
        }
      }

      const nextMeta: HarnessAgentMetadata = {
        ...meta,
        turnCount: nextTurnCount,
        planTurnCount: nextPlanTurnCount,
        writeToolDetectedInPlan:
          meta.writeToolDetectedInPlan || timelineInspection.detectedCodeWrite,
        handoffSuggestedAtTurn,
        currentTier,
        currentModel,
        phase,
        autoDowngradedAtTurn,
        downgradeReason,
        lastProcessedTurnId: turnId,
        lastBilledTier: billedTier,
        lastBilledModel: billedModel,
      };

      await updateAgentMetadata(agent.id, nextMeta, handle);
    },
  );

  // Hook 6: Cleanup on agent close / archive
  const removeCloseHook = server.addHook("agent.close.after", async ({ agent }) => {
    latestMetadataByAgent.delete(agent.id);
    switchedFirstTurnAgents.delete(agent.id);
  });

  const removeArchiveHook = server.addHook("agent.archive.after", async ({ agent }) => {
    latestMetadataByAgent.delete(agent.id);
    switchedFirstTurnAgents.delete(agent.id);
  });

  // Register Client RPC handlers
  registerHarnessRpcHandlers(server, {
    readLatestMetadata: async (id) => latestMetadataByAgent.get(id) ?? null,
    setLatestMetadata: async (id, meta, handle) => {
      await updateAgentMetadata(id, meta, handle);
    },
    emitTimelineTransitionsEnabled: () => cachedSettings.emitTimelineTransitions,
  });

  return () => {
    unsubscribeSettings();
    removeWorkspaceHook();
    removeWorktreeHook();
    removeAgentHook();
    removeAgentCreateAfterHook();
    removeOpenHook();
    removePermissionBeforeHook();
    removePermissionAfterHook();
    removeTurnHook();
    removeTurnAfterHook();
    removeCloseHook();
    removeArchiveHook();
    recentCreationContext.clear();
    lastWorkspaceCreationContext = null;
    switchedFirstTurnAgents.clear();
    latestMetadataByAgent.clear();
    pendingPlanPermissions.clear();
  };
}
