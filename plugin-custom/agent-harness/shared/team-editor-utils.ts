export type AgentTeamTargetId = "antigravity" | "claude" | "opencode" | "codex";
export type AgentTeamGitMode = "tracked-manifest" | "tracked-all" | "exclude";
export type AgentTeamTracker = "gitea" | "github" | "local";

export interface AgentTeamRoleBinding {
  provider?: string;
  tier?: string;
  model?: string;
  modeId?: string;
  lazyToolSlice?: string;
}

export interface AgentTeamFlowConfig {
  openspec: boolean;
  contracts: boolean;
  workflows: boolean;
  scaffold_docs: boolean;
}

export interface AgentTeamEditableManifest {
  schema_version: string;
  project_slug: string;
  preset: string;
  targets: string[];
  roles: string[];
  capabilities: string[];
  mcp_sources: string[];
  guards: string[];
  tracker: string;
  git_mode: string;
  flow: AgentTeamFlowConfig;
  bindings: Record<string, AgentTeamRoleBinding>;
}

export interface AgentTeamCatalogRole {
  id: string;
  team: "fe" | "be" | "ops";
  title: string;
  readonly: boolean;
  recommended_model: string;
  requires_mcp: string[];
  requires_guards: string[];
}

export interface AgentTeamCatalogCapability {
  id: string;
  title: string;
  description: string;
  requires_mcp: string[];
  requires_guards: string[];
  enables_flow: Partial<AgentTeamFlowConfig>;
}

export interface AgentTeamCatalogMcpSource {
  id: string;
  description: string;
  implies_guards: string[];
}

export interface AgentTeamCatalogGuard {
  id: string;
  description: string;
}

export interface AgentTeamCatalogData {
  roles: AgentTeamCatalogRole[];
  capabilities: AgentTeamCatalogCapability[];
  mcp_sources: AgentTeamCatalogMcpSource[];
  guards: AgentTeamCatalogGuard[];
}

export interface AgentTeamPresetData {
  id: string;
  title: string;
  description: string;
  roles: string[];
  capabilities: string[];
  mcp_sources: string[];
  guards: string[];
  flow: AgentTeamFlowConfig;
}

export const TEAM_TARGET_OPTIONS: ReadonlyArray<{
  id: AgentTeamTargetId;
  label: string;
  hint: string;
}> = [
  { id: "antigravity", label: "Antigravity", hint: ".agents/plugins/team-<slug>" },
  { id: "claude", label: "Claude", hint: ".claude/agents/*.md + PreToolUse" },
  { id: "opencode", label: "OpenCode", hint: ".opencode/agents/*.md + opencode.json" },
  { id: "codex", label: "Codex", hint: ".codex/agents/*.toml + config.toml" },
];

export const TEAM_GIT_MODE_OPTIONS: ReadonlyArray<{ label: string; value: AgentTeamGitMode }> = [
  { label: "Tracked manifest + local exclude", value: "tracked-manifest" },
  { label: "Tracked all generated artifacts", value: "tracked-all" },
  { label: "Exclude all (.git/info/exclude)", value: "exclude" },
];

export const TEAM_TRACKER_OPTIONS: ReadonlyArray<{ label: string; value: AgentTeamTracker }> = [
  { label: "Gitea", value: "gitea" },
  { label: "GitHub", value: "github" },
  { label: "Local", value: "local" },
];

export const TEAM_TIER_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Fast (Low-cost / Scouting)", value: "fast" },
  { label: "Standard (Daily Coding)", value: "standard" },
  { label: "Deep (Architecture / Review)", value: "deep" },
  { label: "Max (Manual Peak)", value: "max" },
];

export const TEAM_BINDING_PROVIDERS = ["antigravity", "claude", "codex", "opencode", "pi"] as const;

const VALID_TARGETS_SET = new Set<string>(TEAM_TARGET_OPTIONS.map((t) => t.id));
const VALID_GIT_MODES_SET = new Set<string>(TEAM_GIT_MODE_OPTIONS.map((m) => m.value));
const VALID_TRACKERS_SET = new Set<string>(TEAM_TRACKER_OPTIONS.map((t) => t.value));

export function dedupeOrdered(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function sanitizeProjectSlug(raw: string | undefined | null, fallback = "project"): string {
  const cleaned = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned) return cleaned;
  const fallbackClean = fallback
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fallbackClean || "project";
}

export function normalizeRoleBinding(
  raw: AgentTeamRoleBinding | undefined | null,
): AgentTeamRoleBinding | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const clean: AgentTeamRoleBinding = {};
  if (typeof raw.provider === "string" && raw.provider.trim()) {
    const norm = raw.provider.trim().toLowerCase();
    clean.provider = norm === "claude-code" ? "claude" : norm;
  }
  if (typeof raw.tier === "string" && raw.tier.trim()) {
    clean.tier = raw.tier.trim();
  }
  if (typeof raw.model === "string" && raw.model.trim()) {
    clean.model = raw.model.trim();
  }
  if (typeof raw.modeId === "string" && raw.modeId.trim()) {
    clean.modeId = raw.modeId.trim();
  }
  if (typeof raw.lazyToolSlice === "string" && raw.lazyToolSlice.trim()) {
    clean.lazyToolSlice = raw.lazyToolSlice.trim();
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

const SAFE_ROLE_IDENTIFIER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * Normalizes a manifest object deterministically for safe equality comparison and disk persistence.
 */
export function normalizeEditableManifest(
  raw: Partial<AgentTeamEditableManifest>,
  fallbackSlug = "project",
): AgentTeamEditableManifest {
  const roles = dedupeOrdered(Array.isArray(raw.roles) ? raw.roles : []).filter((r) =>
    SAFE_ROLE_IDENTIFIER_RE.test(r),
  );
  const roleSet = new Set(roles);

  const normalizedTargets = dedupeOrdered(
    (Array.isArray(raw.targets) ? raw.targets : []).map((t) => {
      const lower = typeof t === "string" ? t.trim().toLowerCase() : "";
      return lower === "claude-code" ? "claude" : lower;
    }),
  ).filter((t) => VALID_TARGETS_SET.has(t));

  const normalizedBindings: Record<string, AgentTeamRoleBinding> = {};
  const rawBindings = raw.bindings && typeof raw.bindings === "object" ? raw.bindings : {};
  for (const [roleId, cfg] of Object.entries(rawBindings)) {
    const trimmedRole = roleId.trim();
    if (!trimmedRole || (roleSet.size > 0 && !roleSet.has(trimmedRole))) {
      continue;
    }
    const cleanBinding = normalizeRoleBinding(cfg);
    if (cleanBinding) {
      normalizedBindings[trimmedRole] = cleanBinding;
    }
  }

  // Ensure default target union includes antigravity when omitted
  const targetList = normalizedTargets.length > 0 ? normalizedTargets : ["antigravity"];
  const rawTracker = typeof raw.tracker === "string" ? raw.tracker.trim().toLowerCase() : "local";
  const rawGitMode =
    typeof raw.git_mode === "string" ? raw.git_mode.trim().toLowerCase() : "tracked-manifest";

  return {
    schema_version:
      typeof raw.schema_version === "string" && raw.schema_version.trim()
        ? raw.schema_version.trim()
        : "1.0.0",
    project_slug: sanitizeProjectSlug(raw.project_slug, fallbackSlug),
    preset: typeof raw.preset === "string" && raw.preset.trim() ? raw.preset.trim() : "custom",
    targets: targetList,
    roles,
    capabilities: dedupeOrdered(Array.isArray(raw.capabilities) ? raw.capabilities : []).filter(
      (c) => SAFE_ROLE_IDENTIFIER_RE.test(c),
    ),
    mcp_sources: dedupeOrdered(Array.isArray(raw.mcp_sources) ? raw.mcp_sources : []).filter((m) =>
      SAFE_ROLE_IDENTIFIER_RE.test(m),
    ),
    guards: dedupeOrdered(Array.isArray(raw.guards) ? raw.guards : []).filter((g) =>
      SAFE_ROLE_IDENTIFIER_RE.test(g),
    ),
    tracker: VALID_TRACKERS_SET.has(rawTracker) ? rawTracker : "local",
    git_mode: VALID_GIT_MODES_SET.has(rawGitMode) ? rawGitMode : "tracked-manifest",
    flow: {
      openspec: Boolean(raw.flow?.openspec),
      contracts: Boolean(raw.flow?.contracts),
      workflows: Boolean(raw.flow?.workflows),
      scaffold_docs: Boolean(raw.flow?.scaffold_docs),
    },
    bindings: normalizedBindings,
  };
}

export function createManifestFromPreset(
  presetId: string,
  preset: AgentTeamPresetData,
  projectSlug: string,
  options?: {
    targets?: readonly string[];
    tracker?: string;
    gitMode?: string;
    existingBindings?: Record<string, AgentTeamRoleBinding>;
  },
): AgentTeamEditableManifest {
  return normalizeEditableManifest(
    {
      schema_version: "1.0.0",
      project_slug: projectSlug,
      preset: presetId,
      targets: options?.targets ? [...options.targets] : ["antigravity"],
      roles: [...preset.roles],
      capabilities: [...preset.capabilities],
      mcp_sources: [...preset.mcp_sources],
      guards: [...preset.guards],
      tracker: options?.tracker ?? "local",
      git_mode: options?.gitMode ?? "tracked-manifest",
      flow: { ...preset.flow },
      bindings: options?.existingBindings ?? {},
    },
    projectSlug,
  );
}

function appendUniqueWithImpliedGuards(
  mcps: string[],
  guards: string[],
  addMcps: readonly string[],
  addGuards: readonly string[],
  catalog: AgentTeamCatalogData,
): { nextMcps: string[]; nextGuards: string[]; autoAdded: string[] } {
  const nextMcps = [...mcps];
  const nextGuards = [...guards];
  const autoAdded: string[] = [];

  const mcpById = new Map(catalog.mcp_sources.map((m) => [m.id, m]));
  for (const mcpId of addMcps) {
    if (!nextMcps.includes(mcpId)) {
      nextMcps.push(mcpId);
      autoAdded.push(`MCP: ${mcpId}`);
    }
    const mcpEntry = mcpById.get(mcpId);
    if (mcpEntry) {
      for (const impGuard of mcpEntry.implies_guards) {
        if (!nextGuards.includes(impGuard)) {
          nextGuards.push(impGuard);
          autoAdded.push(`Guard: ${impGuard}`);
        }
      }
    }
  }

  for (const guardId of addGuards) {
    if (!nextGuards.includes(guardId)) {
      nextGuards.push(guardId);
      autoAdded.push(`Guard: ${guardId}`);
    }
  }

  return { nextMcps, nextGuards, autoAdded };
}

export interface AutoDepsToggleResult {
  manifest: AgentTeamEditableManifest;
  autoAdded: string[];
}

export function toggleRoleWithAutoDeps(
  manifest: AgentTeamEditableManifest,
  roleId: string,
  catalog: AgentTeamCatalogData,
): AutoDepsToggleResult {
  const exists = manifest.roles.includes(roleId);
  if (exists) {
    return {
      manifest: {
        ...manifest,
        roles: manifest.roles.filter((r) => r !== roleId),
      },
      autoAdded: [],
    };
  }
  const roleMeta = catalog.roles.find((r) => r.id === roleId);
  const { nextMcps, nextGuards, autoAdded } = appendUniqueWithImpliedGuards(
    manifest.mcp_sources,
    manifest.guards,
    roleMeta?.requires_mcp ?? [],
    roleMeta?.requires_guards ?? [],
    catalog,
  );
  return {
    manifest: {
      ...manifest,
      roles: [...manifest.roles, roleId],
      mcp_sources: nextMcps,
      guards: nextGuards,
    },
    autoAdded,
  };
}

export function toggleCapabilityWithAutoDeps(
  manifest: AgentTeamEditableManifest,
  capId: string,
  catalog: AgentTeamCatalogData,
): AutoDepsToggleResult {
  const exists = manifest.capabilities.includes(capId);
  if (exists) {
    return {
      manifest: {
        ...manifest,
        capabilities: manifest.capabilities.filter((c) => c !== capId),
      },
      autoAdded: [],
    };
  }
  const capMeta = catalog.capabilities.find((c) => c.id === capId);
  const { nextMcps, nextGuards, autoAdded } = appendUniqueWithImpliedGuards(
    manifest.mcp_sources,
    manifest.guards,
    capMeta?.requires_mcp ?? [],
    capMeta?.requires_guards ?? [],
    catalog,
  );

  const nextFlow: AgentTeamFlowConfig = { ...manifest.flow };
  if (capMeta?.enables_flow) {
    for (const key of ["openspec", "contracts", "workflows", "scaffold_docs"] as const) {
      if (capMeta.enables_flow[key] && !nextFlow[key]) {
        nextFlow[key] = true;
        autoAdded.push(`Flow: ${key}`);
      }
    }
  }

  return {
    manifest: {
      ...manifest,
      capabilities: [...manifest.capabilities, capId],
      mcp_sources: nextMcps,
      guards: nextGuards,
      flow: nextFlow,
    },
    autoAdded,
  };
}

export function toggleMcpWithAutoDeps(
  manifest: AgentTeamEditableManifest,
  mcpId: string,
  catalog: AgentTeamCatalogData,
): AutoDepsToggleResult {
  const exists = manifest.mcp_sources.includes(mcpId);
  if (exists) {
    return {
      manifest: {
        ...manifest,
        mcp_sources: manifest.mcp_sources.filter((m) => m !== mcpId),
      },
      autoAdded: [],
    };
  }
  const { nextMcps, nextGuards, autoAdded } = appendUniqueWithImpliedGuards(
    manifest.mcp_sources,
    manifest.guards,
    [mcpId],
    [],
    catalog,
  );
  return {
    manifest: {
      ...manifest,
      mcp_sources: nextMcps,
      guards: nextGuards,
    },
    autoAdded,
  };
}

export function toggleGuardItem(
  manifest: AgentTeamEditableManifest,
  guardId: string,
): AgentTeamEditableManifest {
  const exists = manifest.guards.includes(guardId);
  return {
    ...manifest,
    guards: exists ? manifest.guards.filter((g) => g !== guardId) : [...manifest.guards, guardId],
  };
}

export function toggleTargetItem(
  manifest: AgentTeamEditableManifest,
  targetId: AgentTeamTargetId,
): { manifest: AgentTeamEditableManifest; blockedLastTarget: boolean } {
  const exists = manifest.targets.includes(targetId);
  if (exists) {
    if (manifest.targets.length <= 1) {
      return { manifest, blockedLastTarget: true };
    }
    return {
      manifest: {
        ...manifest,
        targets: manifest.targets.filter((t) => t !== targetId),
      },
      blockedLastTarget: false,
    };
  }
  const nextSet = new Set([...manifest.targets, targetId]);
  const ordered = TEAM_TARGET_OPTIONS.map((opt) => opt.id).filter((id) => nextSet.has(id));
  return {
    manifest: {
      ...manifest,
      targets: ordered,
    },
    blockedLastTarget: false,
  };
}

export function computeMissingRecommendedDeps(
  manifest: AgentTeamEditableManifest,
  catalog: AgentTeamCatalogData,
): { missingMcp: string[]; missingGuards: string[] } {
  const recommendedMcp = new Set<string>();
  const recommendedGuards = new Set<string>();

  for (const roleId of manifest.roles) {
    const meta = catalog.roles.find((r) => r.id === roleId);
    for (const m of meta?.requires_mcp ?? []) recommendedMcp.add(m);
    for (const g of meta?.requires_guards ?? []) recommendedGuards.add(g);
  }
  for (const capId of manifest.capabilities) {
    const meta = catalog.capabilities.find((c) => c.id === capId);
    for (const m of meta?.requires_mcp ?? []) recommendedMcp.add(m);
    for (const g of meta?.requires_guards ?? []) recommendedGuards.add(g);
  }
  for (const mcpId of manifest.mcp_sources) {
    const meta = catalog.mcp_sources.find((m) => m.id === mcpId);
    for (const g of meta?.implies_guards ?? []) recommendedGuards.add(g);
  }

  const activeMcp = new Set(manifest.mcp_sources);
  const activeGuards = new Set(manifest.guards);
  return {
    missingMcp: Array.from(recommendedMcp).filter((m) => !activeMcp.has(m)),
    missingGuards: Array.from(recommendedGuards).filter((g) => !activeGuards.has(g)),
  };
}

function sortedArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  for (let i = 0; i < sortedLeft.length; i++) {
    if (sortedLeft[i] !== sortedRight[i]) return false;
  }
  return true;
}

export function areManifestsEqual(
  a: AgentTeamEditableManifest | null | undefined,
  b: AgentTeamEditableManifest | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const na = normalizeEditableManifest(a);
  const nb = normalizeEditableManifest(b);
  if (
    na.schema_version !== nb.schema_version ||
    na.project_slug !== nb.project_slug ||
    na.preset !== nb.preset ||
    na.tracker !== nb.tracker ||
    na.git_mode !== nb.git_mode ||
    na.flow.openspec !== nb.flow.openspec ||
    na.flow.contracts !== nb.flow.contracts ||
    na.flow.workflows !== nb.flow.workflows ||
    na.flow.scaffold_docs !== nb.flow.scaffold_docs
  ) {
    return false;
  }
  if (
    !sortedArraysEqual(na.targets, nb.targets) ||
    !sortedArraysEqual(na.roles, nb.roles) ||
    !sortedArraysEqual(na.capabilities, nb.capabilities) ||
    !sortedArraysEqual(na.mcp_sources, nb.mcp_sources) ||
    !sortedArraysEqual(na.guards, nb.guards)
  ) {
    return false;
  }
  const keysA = Object.keys(na.bindings).sort();
  const keysB = Object.keys(nb.bindings).sort();
  if (!sortedArraysEqual(keysA, keysB)) return false;
  for (const key of keysA) {
    const ba = na.bindings[key];
    const bb = nb.bindings[key];
    if (
      (ba?.provider ?? "") !== (bb?.provider ?? "") ||
      (ba?.tier ?? "") !== (bb?.tier ?? "") ||
      (ba?.model ?? "") !== (bb?.model ?? "") ||
      (ba?.modeId ?? "") !== (bb?.modeId ?? "") ||
      (ba?.lazyToolSlice ?? "") !== (bb?.lazyToolSlice ?? "")
    ) {
      return false;
    }
  }
  return true;
}
