import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import {
  canonicalizeProviderName,
  isModelCompatibleWithProvider,
  normalizeProviderName,
  resolveTierTarget,
} from "../shared/config-resolver.js";
import { coerceAutoRoutingTier, sanitizePromptForRouting } from "../shared/intent-detector.js";
import type {
  DomainRole,
  EffectiveHarnessConfig,
  HarnessPhase,
  HostProviderRuntimeInfo,
  MatrixTier,
} from "../shared/types.js";
import { detectRepoFingerprint, type RepoFingerprint } from "./repo-fingerprint.js";

export type CliRunner = (
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  },
) => Promise<{ stdout: string; stderr: string }>;

export interface SemanticRouterTarget {
  provider: string;
  model: string;
}

export interface SemanticRouterInput {
  prompt: string;
  cwd?: string | null;
  config: EffectiveHarnessConfig;
  hostProviders?: readonly HostProviderRuntimeInfo[] | null;
  activeSessionProvider?: string | null;
  lockedRole?: DomainRole | null;
}

export interface SemanticRouterDecision {
  role: DomainRole;
  tier: MatrixTier;
  phase: HarnessPhase;
  confidence: number;
  reason: string;
  matchedRule: string;
}

const SUPPORTED_ROUTER_PROVIDERS = ["antigravity", "claude", "codex", "opencode"] as const;
const DEFAULT_ROUTER_WORKDIR_PREFIX = "paseo-harness-router-";
const DEFAULT_CACHE_SIZE = 100;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;

function findEnabledHostProvider(
  hostProviders: readonly HostProviderRuntimeInfo[] | null | undefined,
  providerName: string,
): HostProviderRuntimeInfo | undefined {
  if (!hostProviders?.length || !providerName.trim()) {
    return undefined;
  }
  const norm = normalizeProviderName(providerName);
  const canon = canonicalizeProviderName(providerName);
  return hostProviders.find(
    (entry) =>
      entry.enabled &&
      (normalizeProviderName(entry.provider) === norm ||
        canonicalizeProviderName(entry.provider) === canon),
  );
}

/**
 * Resolves the CLI provider and lightweight `fast` model used by the semantic router,
 * honoring enabled host providers (`Agent -> Model`) and falling back cleanly when
 * configured overrides are disabled or invalid.
 */
export function resolveRouterTarget(
  config: Pick<
    EffectiveHarnessConfig,
    "routerProvider" | "routerModel" | "providerMappings" | "providerThinkingMappings"
  >,
  hostProviders?: readonly HostProviderRuntimeInfo[] | null,
  activeSessionProvider?: string | null,
): SemanticRouterTarget | null {
  const hasSnapshot = Boolean(hostProviders && hostProviders.length > 0);
  const configuredProvider = config.routerProvider?.trim() || "";
  const activeProv = activeSessionProvider?.trim() || "";

  let chosenProvider = "";
  let hostEntry: HostProviderRuntimeInfo | undefined;

  const candidateOrder = [configuredProvider, activeProv, ...SUPPORTED_ROUTER_PROVIDERS].filter(
    (p, idx, arr) => Boolean(p) && arr.indexOf(p) === idx,
  );

  for (const cand of candidateOrder) {
    const canon = canonicalizeProviderName(cand);
    if (
      !SUPPORTED_ROUTER_PROVIDERS.includes(canon as (typeof SUPPORTED_ROUTER_PROVIDERS)[number])
    ) {
      continue;
    }
    if (hasSnapshot) {
      const enabled = findEnabledHostProvider(hostProviders, cand);
      if (enabled) {
        chosenProvider = canonicalizeProviderName(enabled.provider);
        hostEntry = enabled;
        break;
      }
    } else {
      chosenProvider = canon;
      break;
    }
  }

  if (!chosenProvider) {
    return null;
  }

  const resolveUsableModelId = (candidate: string): string | null => {
    const trimmed = candidate.trim();
    if (!trimmed || !isModelCompatibleWithProvider(chosenProvider, trimmed, hostEntry)) {
      return null;
    }
    if (hostEntry && hostEntry.models.length > 0) {
      const lowered = trimmed.toLowerCase();
      return hostEntry.models.find((m) => m.id.trim().toLowerCase() === lowered)?.id ?? trimmed;
    }
    return trimmed;
  };

  let chosenModel = "";
  if (config.routerModel?.trim()) {
    const matchedConfigured = resolveUsableModelId(config.routerModel);
    if (matchedConfigured) {
      chosenModel = matchedConfigured;
    }
  }

  if (!chosenModel) {
    const fastTarget = resolveTierTarget(config, chosenProvider, "fast").model;
    const matchedFast = resolveUsableModelId(fastTarget);
    if (matchedFast) {
      chosenModel = matchedFast;
    } else if (hostEntry && hostEntry.models.length > 0) {
      const defaultCandidate = hostEntry.defaultModel
        ? resolveUsableModelId(hostEntry.defaultModel)
        : null;
      const firstValid = hostEntry.models
        .map((m) => resolveUsableModelId(m.id))
        .find((id): id is string => Boolean(id));
      chosenModel = defaultCandidate || firstValid || fastTarget;
    } else {
      chosenModel = fastTarget;
    }
  }

  return chosenModel ? { provider: chosenProvider, model: chosenModel } : null;
}

function buildJsonSchema(roleIds: readonly string[]): string {
  const uniqueRoles = roleIds.length > 0 ? Array.from(new Set(roleIds)) : ["general"];
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["role", "tier", "phase", "confidence"],
    properties: {
      role: { type: "string", enum: uniqueRoles },
      tier: { type: "string", enum: ["fast", "standard", "plan", "review"] },
      phase: { type: "string", enum: ["design", "exec", "review"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
    },
  });
}

function buildRouterPrompt(params: {
  sanitizedPrompt: string;
  config: EffectiveHarnessConfig;
  fingerprint: RepoFingerprint;
  roleDescriptions: string[];
}): string {
  const stackInfo =
    params.fingerprint.tags.length > 0
      ? `Repository stack tags: ${params.fingerprint.tags.join(", ")}${params.fingerprint.hasBackendOnlyStack && !params.fingerprint.hasFrontend ? " (backend-only repo, no frontend stack)" : ""}.`
      : "Repository stack: unknown.";

  return [
    "Classify this coding user request into a single JSON object with these exact keys (output JSON only, no markdown fences or extra commentary):",
    '{"role": "<candidate role id>", "tier": "fast" | "standard" | "plan" | "review", "phase": "design" | "exec" | "review", "confidence": 0.0, "reason": "<short string>"}',
    "Rules:",
    "- phase='design' and tier='plan' ONLY when the user asks for proposals, architecture, CTO analysis, trade-offs, planning, root-cause exploration without editing files yet.",
    "- phase='review' and tier='review' ONLY for code review, security audit, PR diff review, quality gate inspection.",
    "- phase='exec' and tier='standard' for implementing features, fixing bugs, refactoring, adding tests, releasing, or service operations.",
    "- phase='exec' and tier='fast' for trivial lookups, typos, simple docs, or quick status checks.",
    "- Pick 'role' ONLY when clearly specialized; otherwise pick 'general'.",
    stackInfo,
    `Candidate roles:\n${params.roleDescriptions.join("\n")}`,
    `User request:\n${params.sanitizedPrompt}`,
  ].join("\n\n");
}

function parseJsonObjectCandidate(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Attempt extracting JSON block from prose / markdown fences
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRouterPayloadObject(
  obj: Record<string, unknown> | null,
): obj is Record<string, unknown> {
  return Boolean(obj && (obj.role || obj.tier || obj.phase));
}

function tryParseNestedPayload(candidate: unknown): Record<string, unknown> | null {
  if (typeof candidate === "string") {
    const parsed = parseJsonObjectCandidate(candidate);
    return isRouterPayloadObject(parsed) ? parsed : null;
  }
  if (!Array.isArray(candidate)) {
    return null;
  }
  for (let i = candidate.length - 1; i >= 0; i--) {
    const entry = asRecord(candidate[i]);
    if (!entry) continue;
    const nested = tryParseNestedPayload(entry.text) ?? tryParseNestedPayload(entry.content);
    if (nested) return nested;
  }
  return null;
}

function extractNestedFromJsonObject(obj: Record<string, unknown>): Record<string, unknown> | null {
  const item = asRecord(obj.item);
  const part = asRecord(obj.part);
  const message = asRecord(obj.message);
  const candidates: unknown[] = [
    obj.text,
    obj.content,
    obj.response,
    obj.result,
    item?.text,
    item?.content,
    part?.text,
    message?.content,
  ];
  for (const candidate of candidates) {
    const nested = tryParseNestedPayload(candidate);
    if (nested) return nested;
  }
  return null;
}

function extractRouterPayloadFromStdout(stdout: string): Record<string, unknown> | null {
  const direct = parseJsonObjectCandidate(stdout);
  if (direct) {
    const directStructured = asRecord(direct.structured_output);
    if (directStructured) {
      return directStructured;
    }
    const directNested = extractNestedFromJsonObject(direct);
    if (directNested) {
      return directNested;
    }
    if (isRouterPayloadObject(direct)) {
      return direct;
    }
  }

  // Handle JSONL streaming output (codex / opencode)
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const obj = parseJsonObjectCandidate(lines[i]!);
    if (!obj) continue;
    const structured = asRecord(obj.structured_output);
    if (structured) {
      return structured;
    }
    const nested = extractNestedFromJsonObject(obj);
    if (nested) {
      return nested;
    }
    if (isRouterPayloadObject(obj)) {
      return obj;
    }
  }
  return null;
}

function buildSanitizedRouterEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LAZY_TOOL_CONFIG;
  delete env.PASEO_HARNESS_ROLE;
  delete env.PASEO_HARNESS_PROFILE;
  delete env.PASEO_HARNESS_LEAF;
  delete env.PASEO_HARNESS_SKILLS_ROOT;
  env.PASEO_HARNESS_INTERNAL_ROUTER = "1";
  return env;
}

function buildCliInvocation(params: {
  provider: string;
  model: string;
  promptText: string;
  schemaJson: string;
  schemaFilePath?: string;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
}): { bin: string; args: string[] } {
  const { provider, model, promptText, schemaJson, schemaFilePath, effort, timeoutMs } = params;
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));

  switch (provider) {
    case "antigravity":
      return {
        bin: process.env.PASEO_AGY_BIN?.trim() || "agy",
        args: [
          "-p",
          promptText,
          "--output-format",
          "json",
          "--json-schema",
          schemaJson,
          "--disable-slash-commands",
          "--model",
          model,
          "--effort",
          effort,
          "--mode",
          "plan",
          "--print-timeout",
          `${timeoutSec}s`,
        ],
      };
    case "claude":
      return {
        bin: process.env.PASEO_CLAUDE_BIN?.trim() || "claude",
        args: [
          "-p",
          promptText,
          "--output-format",
          "json",
          "--json-schema",
          schemaJson,
          "--model",
          model,
          "--tools",
          "",
          "--no-session-persistence",
        ],
      };
    case "codex":
      return {
        bin: process.env.PASEO_CODEX_BIN?.trim() || "codex",
        args: [
          "exec",
          "--sandbox",
          "read-only",
          "--json",
          "--model",
          model,
          ...(schemaFilePath ? ["--output-schema", schemaFilePath] : []),
          promptText,
        ],
      };
    case "opencode":
    default:
      return {
        bin: process.env.PASEO_OPENCODE_BIN?.trim() || "opencode",
        args: ["run", "--format", "json", "--model", model, promptText],
      };
  }
}

export class AgentIntentRouter {
  private readonly cliRunner: CliRunner;
  private readonly configuredWorkDir?: string;
  private resolvedWorkDir: string | null = null;
  private readonly maxCacheSize: number;
  private readonly onDebugLog?: (message: string) => void;
  private readonly lruCache = new Map<
    string,
    { expiresAt: number; decision: SemanticRouterDecision }
  >();
  private readonly inFlight = new Map<string, Promise<SemanticRouterDecision | null>>();

  constructor(options?: {
    cliRunner?: CliRunner;
    routerWorkDir?: string;
    maxCacheSize?: number;
    onDebugLog?: (message: string) => void;
  }) {
    this.cliRunner =
      options?.cliRunner ??
      ((command, args, opts) =>
        execCommand(command, args, {
          cwd: opts?.cwd,
          env: opts?.env,
          timeout: opts?.timeout,
          maxBuffer: 1024 * 1024,
        }));
    this.configuredWorkDir = options?.routerWorkDir?.trim() || undefined;
    this.maxCacheSize = Math.max(10, options?.maxCacheSize ?? DEFAULT_CACHE_SIZE);
    this.onDebugLog = options?.onDebugLog;
  }

  private getOrCreateRouterWorkDir(): string {
    if (this.configuredWorkDir) {
      try {
        fs.mkdirSync(this.configuredWorkDir, { recursive: true, mode: 0o700 });
      } catch {
        // Ignore mkdir failures in sandboxed test environments
      }
      return this.configuredWorkDir;
    }
    if (!this.resolvedWorkDir) {
      try {
        this.resolvedWorkDir = fs.mkdtempSync(
          path.join(os.tmpdir(), DEFAULT_ROUTER_WORKDIR_PREFIX),
        );
      } catch {
        this.resolvedWorkDir = os.tmpdir();
      }
    }
    return this.resolvedWorkDir;
  }

  clearCache(): void {
    this.lruCache.clear();
  }

  dispose(): void {
    this.clearCache();
    this.inFlight.clear();
    if (!this.configuredWorkDir && this.resolvedWorkDir && this.resolvedWorkDir !== os.tmpdir()) {
      try {
        fs.rmSync(this.resolvedWorkDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on temp router workdir
      }
    }
    this.resolvedWorkDir = null;
  }

  private readCache(key: string): SemanticRouterDecision | undefined {
    const existing = this.lruCache.get(key);
    if (!existing) {
      return undefined;
    }
    if (Date.now() >= existing.expiresAt) {
      this.lruCache.delete(key);
      return undefined;
    }
    this.lruCache.delete(key);
    this.lruCache.set(key, existing);
    return existing.decision;
  }

  private writeCache(key: string, decision: SemanticRouterDecision): void {
    if (this.lruCache.has(key)) {
      this.lruCache.delete(key);
    }
    this.lruCache.set(key, {
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
      decision,
    });
    while (this.lruCache.size > this.maxCacheSize) {
      const oldestKey = this.lruCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.lruCache.delete(oldestKey);
    }
  }

  async route(input: SemanticRouterInput): Promise<SemanticRouterDecision | null> {
    if (process.env.PASEO_HARNESS_INTERNAL_ROUTER === "1") {
      return null;
    }
    const { config } = input;
    if (!config.routerEnabled) {
      return null;
    }

    const sanitizedPrompt = sanitizePromptForRouting(input.prompt);
    if (!sanitizedPrompt) {
      return null;
    }

    const target = resolveRouterTarget(config, input.hostProviders, input.activeSessionProvider);
    if (!target) {
      return null;
    }

    const fallbackRole =
      config.defaultFallbackRole && config.defaultFallbackRole !== "orchestrator"
        ? config.defaultFallbackRole
        : "general";

    const fingerprint = detectRepoFingerprint(input.cwd);
    const excludeFrontendRoles = fingerprint.hasBackendOnlyStack && !fingerprint.hasFrontend;
    const candidateSpecialists = config.specialists.filter(
      (s) =>
        s.enabled &&
        s.id !== "orchestrator" &&
        !(excludeFrontendRoles && (s.id === "ui" || s.id.startsWith("fe-"))),
    );
    const candidateRoleIds = candidateSpecialists.map((s) => s.id);
    if (!candidateRoleIds.includes(fallbackRole)) {
      candidateRoleIds.push(fallbackRole);
    }
    const roleDescriptions = candidateSpecialists.map(
      (s) => `- ${s.id} (${s.shortLabel}): ${s.description}`,
    );
    const cacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          prompt: sanitizedPrompt,
          provider: target.provider,
          model: target.model,
          effort: config.routerEffort ?? "low",
          cwd: fingerprint.cwd,
          roles: candidateRoleIds,
          roleDescriptions,
          fallbackRole,
          lockedRole: input.lockedRole ?? null,
          confidenceThreshold: config.routerConfidenceThreshold ?? 0.85,
        }),
      )
      .digest("hex");

    const cached = this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const task = this.executeRoute({
      sanitizedPrompt,
      target,
      config,
      fingerprint,
      candidateRoleIds,
      roleDescriptions,
      fallbackRole,
      lockedRole: input.lockedRole ?? null,
      cacheKey,
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, task);
    return task;
  }

  private async executeRoute(params: {
    sanitizedPrompt: string;
    target: SemanticRouterTarget;
    config: EffectiveHarnessConfig;
    fingerprint: RepoFingerprint;
    candidateRoleIds: string[];
    roleDescriptions: string[];
    fallbackRole: DomainRole;
    lockedRole: DomainRole | null;
    cacheKey: string;
  }): Promise<SemanticRouterDecision | null> {
    const {
      sanitizedPrompt,
      target,
      config,
      fingerprint,
      candidateRoleIds,
      roleDescriptions,
      fallbackRole,
      lockedRole,
      cacheKey,
    } = params;

    const routerWorkDir = this.getOrCreateRouterWorkDir();

    const promptText = buildRouterPrompt({
      sanitizedPrompt,
      config,
      fingerprint,
      roleDescriptions,
    });
    const schemaJson = buildJsonSchema(candidateRoleIds);
    let schemaFilePath: string | undefined;
    if (target.provider === "codex") {
      const schemaHash = createHash("sha256").update(schemaJson).digest("hex").slice(0, 12);
      schemaFilePath = path.join(routerWorkDir, `router-schema-${schemaHash}.json`);
      try {
        fs.writeFileSync(schemaFilePath, schemaJson, { encoding: "utf8", mode: 0o600 });
      } catch {
        schemaFilePath = undefined;
      }
    }
    const timeoutMs = config.routerTimeoutMs ?? 10000;
    const { bin, args } = buildCliInvocation({
      provider: target.provider,
      model: target.model,
      promptText,
      schemaJson,
      schemaFilePath,
      effort: config.routerEffort ?? "low",
      timeoutMs,
    });

    try {
      const { stdout } = await this.cliRunner(bin, args, {
        cwd: routerWorkDir,
        env: buildSanitizedRouterEnv(),
        timeout: timeoutMs,
      });

      const payload = extractRouterPayloadFromStdout(stdout);
      if (!payload) {
        this.onDebugLog?.("[AgentIntentRouter] Failed to parse structured JSON output from CLI");
        return null;
      }

      if (typeof payload.confidence !== "number" || !Number.isFinite(payload.confidence)) {
        this.onDebugLog?.("[AgentIntentRouter] Missing or non-numeric confidence in CLI output");
        return null;
      }
      const rawConfidence = Math.max(0, Math.min(1, payload.confidence));

      if (rawConfidence < 0.6) {
        return null;
      }

      const rawPhase = typeof payload.phase === "string" ? payload.phase.trim().toLowerCase() : "";
      let phase: HarnessPhase =
        rawPhase === "design" || rawPhase === "review" || rawPhase === "exec" ? rawPhase : "exec";

      let tier = coerceAutoRoutingTier(
        typeof payload.tier === "string" ? payload.tier : "standard",
        phase,
      );
      if (tier === "plan" && rawPhase !== "exec" && rawPhase !== "review") {
        phase = "design";
      } else if (tier === "review") {
        phase = "review";
      } else if (phase === "review") {
        tier = "review";
      } else if (phase === "design") {
        tier = "plan";
      } else {
        phase = "exec";
        if (tier !== "fast" && tier !== "standard") {
          tier = "standard";
        }
      }

      const threshold = config.routerConfidenceThreshold ?? 0.85;
      const rawRole = typeof payload.role === "string" ? payload.role.trim().toLowerCase() : "";
      const candidateSet = new Set(candidateRoleIds.map((r) => r.toLowerCase()));

      let resolvedRole: DomainRole = fallbackRole;
      let matchedRule = "semantic_router:tier_only";
      let reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

      if (lockedRole) {
        resolvedRole = lockedRole;
        matchedRule = `semantic_router:locked_role:${lockedRole}`;
      } else if (
        rawConfidence >= threshold &&
        rawRole &&
        rawRole !== "orchestrator" &&
        candidateSet.has(rawRole)
      ) {
        const matchedCanon = candidateRoleIds.find((r) => r.toLowerCase() === rawRole)!;
        if (
          fingerprint.hasBackendOnlyStack &&
          !fingerprint.hasFrontend &&
          (matchedCanon === "ui" || matchedCanon.startsWith("fe-"))
        ) {
          resolvedRole = fallbackRole;
          matchedRule = `semantic_router:${fallbackRole}`;
          reason = reason
            ? `${reason} (blocked_frontend_role_on_backend_repo)`
            : "blocked_frontend_role_on_backend_repo";
        } else {
          resolvedRole = matchedCanon;
          matchedRule = `semantic_router:${matchedCanon}`;
        }
      } else if (rawRole === "orchestrator") {
        resolvedRole = fallbackRole;
        matchedRule = `semantic_router:${fallbackRole}`;
      }

      const decision: SemanticRouterDecision = {
        role: resolvedRole,
        tier,
        phase,
        confidence: rawConfidence,
        reason,
        matchedRule,
      };

      this.writeCache(cacheKey, decision);
      return decision;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onDebugLog?.(`[AgentIntentRouter] CLI routing failed (${bin}): ${msg}`);
      return null;
    }
  }
}
