import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { execCommand } from "@getpaseo/plugin/server";
import {
  type AgentTeamCatalogCapability,
  type AgentTeamCatalogData,
  type AgentTeamCatalogGuard,
  type AgentTeamCatalogMcpSource,
  type AgentTeamCatalogRole,
  type AgentTeamEditableManifest,
  type AgentTeamPresetData,
  normalizeEditableManifest,
  sanitizeProjectSlug,
} from "../shared/team-editor-utils.js";
import {
  detectLocalFederatedTargets,
  invalidateWorkspaceAgentTeamCache,
  isSafePathIdentifier,
  loadWorkspaceAgentTeam,
  type RawAgentTeamManifest,
  resolveWorkspaceRepoRoots,
} from "./agent-team-loader.js";
import { scanLazyToolSlices } from "./profile-sync.js";

export interface ResolvedWorkspaceInfo {
  workspaceId: string;
  workspaceName: string;
  directory: string;
  checkoutRoot: string;
  mainRepoRoot: string;
  isWorktree: boolean;
}

export interface CompilerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CompilerRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<CompilerExecResult>;

export type WorkspaceDirResolver = (
  workspaceId: string,
) => Promise<{ directory: string; name?: string } | null>;

const checkoutLocks = new Map<string, Promise<void>>();

export function getActiveCheckoutLockCount(): number {
  return checkoutLocks.size;
}

/**
 * Serializes mutating and CLI operations on the same `checkoutRoot` in FIFO order.
 */
export async function withCheckoutLock<T>(checkoutRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(checkoutRoot);
  const previous = checkoutLocks.get(key) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const currentDone = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const nextTail = previous.then(() => currentDone);
  checkoutLocks.set(key, nextTail);

  await previous;
  try {
    return await fn();
  } finally {
    releaseCurrent?.();
    if (checkoutLocks.get(key) === nextTail) {
      checkoutLocks.delete(key);
    }
  }
}

const FALLBACK_CATALOG: AgentTeamCatalogData = {
  roles: [
    {
      id: "fe-pm",
      team: "fe",
      title: "Product Manager (Spec & Story Mapping)",
      readonly: false,
      recommended_model: "inherit",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "fe-uiux",
      team: "fe",
      title: "UI/UX & Design System Lead",
      readonly: false,
      recommended_model: "inherit",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "fe-architect",
      team: "fe",
      title: "Frontend Architect (Read-Only)",
      readonly: true,
      recommended_model: "pro",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem"],
    },
    {
      id: "fe-developer",
      team: "fe",
      title: "Frontend Engineer (TDD + unslop)",
      readonly: false,
      recommended_model: "inherit",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "fe-qa",
      team: "fe",
      title: "Frontend QA & 4-Viewport Verifier (Read-Only)",
      readonly: true,
      recommended_model: "inherit",
      requires_mcp: ["serena", "playwright"],
      requires_guards: ["guard-serena-nomem", "guard-macos-nobrowser"],
    },
    {
      id: "be-architect",
      team: "be",
      title: "Backend & Data Architect",
      readonly: false,
      recommended_model: "pro",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "be-developer",
      team: "be",
      title: "Backend Engineer (TDD + Serena AST)",
      readonly: false,
      recommended_model: "inherit",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "be-reviewer",
      team: "be",
      title: "Backend Two-Axis Code Reviewer (Read-Only)",
      readonly: true,
      recommended_model: "pro",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "ops-ci",
      team: "ops",
      title: "CI/CD & Containerization Engineer",
      readonly: false,
      recommended_model: "inherit",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
    {
      id: "ops-sre",
      team: "ops",
      title: "SRE & Observability Triage Engineer",
      readonly: false,
      recommended_model: "inherit",
      requires_mcp: ["serena", "kubernetes-ro", "prometheus"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety", "guard-k8s-ro"],
    },
    {
      id: "ops-auditor",
      team: "ops",
      title: "DevSecOps Auditor & Retro Lead (Read-Only)",
      readonly: true,
      recommended_model: "pro",
      requires_mcp: ["serena"],
      requires_guards: ["guard-serena-nomem", "guard-git-safety"],
    },
  ],
  capabilities: [
    {
      id: "pm-discovery",
      title: "Product Discovery & Story Mapping",
      description: "PRD authoring, user story mapping, and edge-case catalogs.",
      requires_mcp: [],
      requires_guards: [],
      enables_flow: {},
    },
    {
      id: "matt-sdd",
      title: "Matt Pocock Spec-Driven Development & TDD",
      description: "Domain modeling, deep modules, vertical-slice tickets, and two-axis review.",
      requires_mcp: [],
      requires_guards: [],
      enables_flow: {},
    },
    {
      id: "openspec",
      title: "OpenSpec Living Specs & Change Bundles",
      description: "Enable openspec/specs and openspec/changes workflows.",
      requires_mcp: [],
      requires_guards: [],
      enables_flow: { openspec: true },
    },
    {
      id: "ui-unslop",
      title: "UI Craft & Unslop Design System",
      description: "Design tokens, 9-pass unslop polish, and visual verification.",
      requires_mcp: [],
      requires_guards: [],
      enables_flow: {},
    },
    {
      id: "qa-4vp",
      title: "4-Viewport Browser QA & Test Hygiene",
      description: "Playwright multi-viewport QA and test-gardener hygiene.",
      requires_mcp: ["playwright"],
      requires_guards: ["guard-macos-nobrowser"],
      enables_flow: {},
    },
    {
      id: "data-pg-redis",
      title: "PostgreSQL & Redis Read-Only MCP Diagnostics",
      description: "PostgreSQL EXPLAIN ANALYZE and Redis inspection with SQL guards.",
      requires_mcp: ["postgres-ro", "redis-dev"],
      requires_guards: ["guard-sql-ro"],
      enables_flow: {},
    },
    {
      id: "gate-ocr",
      title: "Antigravity + OpenCodeReview Delegate (ocr delegate) & Two-Axis Review Gate",
      description:
        "Enforce two-axis diff review alongside LLM-free ocr delegate file/rule resolution driven by the host review agent.",
      requires_mcp: [],
      requires_guards: [],
      enables_flow: {},
    },
  ],
  mcp_sources: [
    {
      id: "serena",
      description: "Serena AST symbol navigation and safe refactoring (memory tools excluded).",
      implies_guards: ["guard-serena-nomem"],
    },
    {
      id: "playwright",
      description: "Playwright MCP browser automation and accessibility snapshots.",
      implies_guards: ["guard-macos-nobrowser"],
    },
    {
      id: "chrome-devtools",
      description: "Chrome DevTools MCP DOM/console/network inspection.",
      implies_guards: ["guard-macos-nobrowser"],
    },
    {
      id: "postgres-ro",
      description: "Read-only PostgreSQL schema & EXPLAIN ANALYZE inspection.",
      implies_guards: ["guard-sql-ro"],
    },
    {
      id: "redis-dev",
      description: "Local Redis key inspection.",
      implies_guards: [],
    },
    {
      id: "kubernetes-ro",
      description: "Read-only Kubernetes cluster resource inspection.",
      implies_guards: ["guard-k8s-ro"],
    },
    {
      id: "prometheus",
      description: "Prometheus PromQL metric querying.",
      implies_guards: [],
    },
  ],
  guards: [
    {
      id: "guard-serena-nomem",
      description: "Deny all serena__*memory* calls; restrict Serena strictly to AST symbols.",
    },
    {
      id: "guard-git-safety",
      description: "Prompt/block destructive git commands (push --force, reset --hard, clean -fd).",
    },
    {
      id: "guard-macos-nobrowser",
      description: "Block headless browser_subagent on macOS; route to Playwright/DevTools.",
    },
    {
      id: "guard-sql-ro",
      description: "Prompt/block destructive SQL mutations.",
    },
    {
      id: "guard-k8s-ro",
      description: "Prompt/block mutating Kubernetes/Helm/Terraform commands.",
    },
  ],
};

const FALLBACK_PRESETS: Record<string, AgentTeamPresetData> = {
  "fullstack-monorepo": {
    id: "fullstack-monorepo",
    title: "Fullstack Monorepo (FE + BE + Ops)",
    description: "Complete 11-role squad for FE + BE + Ops monorepos.",
    roles: [
      "fe-pm",
      "fe-uiux",
      "fe-architect",
      "fe-developer",
      "fe-qa",
      "be-architect",
      "be-developer",
      "be-reviewer",
      "ops-ci",
      "ops-sre",
      "ops-auditor",
    ],
    capabilities: ["pm-discovery", "matt-sdd", "ui-unslop", "qa-4vp", "data-pg-redis", "gate-ocr"],
    mcp_sources: [
      "serena",
      "playwright",
      "chrome-devtools",
      "postgres-ro",
      "redis-dev",
      "kubernetes-ro",
      "prometheus",
    ],
    guards: [
      "guard-serena-nomem",
      "guard-git-safety",
      "guard-macos-nobrowser",
      "guard-sql-ro",
      "guard-k8s-ro",
    ],
    flow: { scaffold_docs: true, openspec: false, contracts: true, workflows: true },
  },
  "web-react": {
    id: "web-react",
    title: "Web React / Next.js Product Team",
    description: "Frontend design tokens, React/Next.js architecture, and 4-viewport QA.",
    roles: ["fe-uiux", "fe-architect", "fe-developer", "fe-qa"],
    capabilities: ["matt-sdd", "ui-unslop", "qa-4vp", "gate-ocr"],
    mcp_sources: ["serena", "playwright", "chrome-devtools"],
    guards: ["guard-serena-nomem", "guard-git-safety", "guard-macos-nobrowser"],
    flow: { scaffold_docs: true, openspec: false, contracts: false, workflows: false },
  },
  "go-api": {
    id: "go-api",
    title: "Go API + PostgreSQL / Redis",
    description: "Contract-first Go backend squad with two-axis review.",
    roles: ["be-architect", "be-developer", "be-reviewer", "ops-ci"],
    capabilities: ["matt-sdd", "data-pg-redis", "gate-ocr"],
    mcp_sources: ["serena", "postgres-ro", "redis-dev"],
    guards: ["guard-serena-nomem", "guard-git-safety", "guard-macos-nobrowser", "guard-sql-ro"],
    flow: { scaffold_docs: true, openspec: false, contracts: true, workflows: false },
  },
  "lean-solo": {
    id: "lean-solo",
    title: "Lean Solo (Developer + Reviewer)",
    description: "Minimal pair with implementation + independent read-only review.",
    roles: ["be-developer", "be-reviewer"],
    capabilities: ["matt-sdd", "gate-ocr"],
    mcp_sources: ["serena"],
    guards: ["guard-serena-nomem", "guard-git-safety", "guard-macos-nobrowser"],
    flow: { scaffold_docs: false, openspec: false, contracts: false, workflows: false },
  },
};

const SYNTHESIZE_PY_SCRIPT = [
  "import json, sys",
  "from pathlib import Path",
  "scripts_dir, target_dir, manifest_json, reindex_flag = sys.argv[1:5]",
  "sys.path.insert(0, scripts_dir)",
  "from synthesizer import synthesize_project",
  "res = synthesize_project(Path(target_dir), json.loads(manifest_json), force_reindex=(reindex_flag == '1'))",
  "print(json.dumps(res, ensure_ascii=False, default=str))",
].join("\n");

const CLEAN_PY_SCRIPT = [
  "import json, sys",
  "from pathlib import Path",
  "scripts_dir, target_dir, remove_all_flag = sys.argv[1:4]",
  "sys.path.insert(0, scripts_dir)",
  "from synthesizer import clean_project",
  "removed = clean_project(Path(target_dir), remove_all=(remove_all_flag == '1'))",
  "print(json.dumps({'removed': removed}, ensure_ascii=False, default=str))",
].join("\n");

type JsonReadResult<T> =
  | { status: "missing" }
  | { status: "ok"; data: T }
  | { status: "invalid"; error: string };

function readJsonFileDetailed<T>(filePath: string): JsonReadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { status: "missing" };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { status: "ok", data: JSON.parse(raw) as T };
  } catch (err) {
    return {
      status: "invalid",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function readJsonFile<T>(filePath: string): T | null {
  const res = readJsonFileDetailed<T>(filePath);
  return res.status === "ok" ? res.data : null;
}

function normalizeEnablesFlow(rawFlow: unknown): Partial<AgentTeamEditableManifest["flow"]> {
  const normalized: Partial<AgentTeamEditableManifest["flow"]> = {};
  if (Array.isArray(rawFlow)) {
    for (const item of rawFlow) {
      if (item === "openspec") normalized.openspec = true;
      else if (item === "contracts") normalized.contracts = true;
      else if (item === "workflows") normalized.workflows = true;
      else if (item === "scaffold_docs") normalized.scaffold_docs = true;
    }
    return normalized;
  }
  if (rawFlow && typeof rawFlow === "object") {
    const obj = rawFlow as Record<string, unknown>;
    if (typeof obj.openspec === "boolean") normalized.openspec = obj.openspec;
    if (typeof obj.contracts === "boolean") normalized.contracts = obj.contracts;
    if (typeof obj.workflows === "boolean") normalized.workflows = obj.workflows;
    if (typeof obj.scaffold_docs === "boolean") normalized.scaffold_docs = obj.scaffold_docs;
  }
  return normalized;
}

const AGENT_TEAM_SKILL_ROOTS = [
  path.join(".agents", "skills", "gitea", "agent-team"),
  path.join(".agents", "skills", "agent-team"),
] as const;

function inferTeamFromId(id: string, rawTeam: unknown): "fe" | "be" | "ops" {
  if (rawTeam === "fe" || rawTeam === "be" || rawTeam === "ops") {
    return rawTeam;
  }
  if (id.startsWith("be-")) return "be";
  if (id.startsWith("ops-")) return "ops";
  return "fe";
}

export function loadHostCatalogAndPresets(homeDir = os.homedir()): {
  catalog: AgentTeamCatalogData;
  presets: Record<string, AgentTeamPresetData>;
} {
  const manifestRoots = AGENT_TEAM_SKILL_ROOTS.map((rel) => path.join(homeDir, rel, "manifests"));

  let catalog = FALLBACK_CATALOG;
  let presets = FALLBACK_PRESETS;

  for (const dir of manifestRoots) {
    let loadedCatalogFromDir = false;
    const rawCat = readJsonFile<Record<string, unknown>>(path.join(dir, "catalog.json"));
    if (rawCat && typeof rawCat === "object") {
      const rolesMap = (rawCat.roles as Record<string, Record<string, unknown> | undefined>) ?? {};
      const capsMap =
        (rawCat.capabilities as Record<string, Record<string, unknown> | undefined>) ?? {};
      const mcpsMap =
        (rawCat.mcp_sources as Record<string, Record<string, unknown> | undefined>) ?? {};
      const guardsMap =
        (rawCat.guards as Record<string, Record<string, unknown> | undefined>) ?? {};

      const roles: AgentTeamCatalogRole[] = Object.entries(rolesMap).map(([id, def]) => ({
        id,
        team: inferTeamFromId(id, def?.team),
        title: typeof def?.title === "string" && def.title.trim() ? def.title.trim() : id,
        readonly: Boolean(def?.readonly),
        recommended_model:
          typeof def?.recommended_model === "string" ? def.recommended_model : "inherit",
        requires_mcp: Array.isArray(def?.requires_mcp) ? def.requires_mcp.map(String) : [],
        requires_guards: Array.isArray(def?.requires_guards) ? def.requires_guards.map(String) : [],
      }));

      const capabilities: AgentTeamCatalogCapability[] = Object.entries(capsMap).map(
        ([id, def]) => ({
          id,
          title: typeof def?.title === "string" && def.title.trim() ? def.title.trim() : id,
          description: typeof def?.description === "string" ? def.description : "",
          requires_mcp: Array.isArray(def?.requires_mcp) ? def.requires_mcp.map(String) : [],
          requires_guards: Array.isArray(def?.requires_guards)
            ? def.requires_guards.map(String)
            : [],
          enables_flow: normalizeEnablesFlow(def?.enables_flow),
        }),
      );

      const mcp_sources: AgentTeamCatalogMcpSource[] = Object.entries(mcpsMap).map(([id, def]) => ({
        id,
        description: typeof def?.description === "string" ? def.description : "",
        implies_guards: Array.isArray(def?.implies_guards) ? def.implies_guards.map(String) : [],
      }));

      const guards: AgentTeamCatalogGuard[] = Object.entries(guardsMap).map(([id, def]) => ({
        id,
        description: typeof def?.description === "string" ? def.description : "",
      }));

      if (roles.length > 0) {
        catalog = { roles, capabilities, mcp_sources, guards };
        loadedCatalogFromDir = true;
      }
    }

    const rawPresets = readJsonFile<{
      presets?: Record<string, Record<string, unknown> | undefined>;
    }>(path.join(dir, "presets.json"));
    const presetsMap =
      rawPresets?.presets ??
      (rawPresets as Record<string, Record<string, unknown> | undefined> | null);
    let loadedPresetsFromDir = false;
    if (presetsMap && typeof presetsMap === "object") {
      const parsedPresets: Record<string, AgentTeamPresetData> = {};
      for (const [id, def] of Object.entries(presetsMap)) {
        if (!def || typeof def !== "object" || !Array.isArray(def.roles)) continue;
        const flowObj =
          def.flow && typeof def.flow === "object"
            ? (def.flow as Record<string, unknown>)
            : undefined;
        parsedPresets[id] = {
          id,
          title: typeof def.title === "string" && def.title.trim() ? def.title.trim() : id,
          description: typeof def.description === "string" ? def.description : "",
          roles: def.roles.map(String),
          capabilities: Array.isArray(def.capabilities)
            ? def.capabilities.map(String)
            : Array.isArray(def.caps)
              ? def.caps.map(String)
              : [],
          mcp_sources: Array.isArray(def.mcp_sources) ? def.mcp_sources.map(String) : [],
          guards: Array.isArray(def.guards) ? def.guards.map(String) : [],
          flow: {
            openspec: Boolean(flowObj?.openspec),
            contracts: Boolean(flowObj?.contracts),
            workflows: Boolean(flowObj?.workflows),
            scaffold_docs: Boolean(flowObj?.scaffold_docs),
          },
        };
      }
      if (Object.keys(parsedPresets).length > 0) {
        presets = parsedPresets;
        loadedPresetsFromDir = true;
      }
    }

    if (loadedCatalogFromDir || loadedPresetsFromDir) {
      break;
    }
  }

  return { catalog, presets };
}

function findExecutableOnPath(
  names: readonly string[],
  extraPaths: readonly string[],
): string | null {
  const pathDirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);
  for (const name of names) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // continue searching
      }
    }
  }
  for (const candidate of extraPaths) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // continue searching
    }
  }
  return null;
}

export function resolveHostCompiler(homeDir = os.homedir()): {
  available: boolean;
  pythonBin: string | null;
  scriptsDir: string | null;
  agentTeamPy: string | null;
  message: string | null;
} {
  const scriptCandidates = AGENT_TEAM_SKILL_ROOTS.map((rel) => path.join(homeDir, rel, "scripts"));
  let scriptsDir: string | null = null;
  let agentTeamPy: string | null = null;
  for (const dir of scriptCandidates) {
    const cli = path.join(dir, "agent_team.py");
    const synth = path.join(dir, "synthesizer.py");
    if (fs.existsSync(cli) && fs.existsSync(synth)) {
      scriptsDir = dir;
      agentTeamPy = cli;
      break;
    }
  }

  const pythonBin = findExecutableOnPath(
    ["python3", "python"],
    [
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
      "/usr/bin/python3",
      "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
    ],
  );

  if (!scriptsDir || !agentTeamPy) {
    return {
      available: false,
      pythonBin,
      scriptsDir: null,
      agentTeamPy: null,
      message: "agent_team.py / synthesizer.py compiler scripts not found under ~/.agents/skills.",
    };
  }
  if (!pythonBin) {
    return {
      available: false,
      pythonBin: null,
      scriptsDir,
      agentTeamPy,
      message: "python3 runtime not found on host PATH.",
    };
  }
  return { available: true, pythonBin, scriptsDir, agentTeamPy, message: null };
}

export const defaultCompilerRunner: CompilerRunner = async (command, args, options) => {
  try {
    const res = await execCommand(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    return {
      exitCode: 0,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } catch (err: unknown) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : (e.message ?? String(err)),
    };
  }
};

/**
 * Resolves a registered Paseo workspaceId to its on-disk directory and git checkout roots.
 * Throws if the workspaceId is not registered on the Paseo daemon.
 */
export async function resolveRegisteredWorkspace(
  paseo: PaseoApi,
  workspaceId: string,
  overrideResolver?: WorkspaceDirResolver,
): Promise<ResolvedWorkspaceInfo> {
  let directory: string | null = null;
  let workspaceName = workspaceId;

  if (overrideResolver) {
    const resolved = await overrideResolver(workspaceId);
    if (resolved?.directory) {
      directory = resolved.directory;
      workspaceName = resolved.name?.trim() || path.basename(resolved.directory) || workspaceId;
    }
  } else {
    try {
      const ref = paseo.workspaces?.ref?.(workspaceId);
      const snap = ref?.current?.() ?? (await ref?.refresh?.());
      if (snap?.workspaceDirectory) {
        directory = snap.workspaceDirectory;
        workspaceName = snap.title?.trim() || snap.name?.trim() || path.basename(directory);
      } else if (ref?.directory) {
        directory = ref.directory;
        workspaceName = ref.name?.trim() || path.basename(directory);
      }
    } catch {
      // Fall back to list() lookup
    }

    if (!directory && typeof paseo.workspaces?.list === "function") {
      const listed = await paseo.workspaces.list({ includeBackground: true });
      const entries = (listed as { entries?: Array<Record<string, any>> })?.entries ?? [];
      const found = entries.find((w) => (w.id ?? w.workspaceId) === workspaceId);
      if (found) {
        const cand = found.workspaceDirectory ?? found.directory ?? found.cwd;
        if (typeof cand === "string" && cand.trim()) {
          directory = cand.trim();
          workspaceName =
            (typeof found.title === "string" && found.title.trim()) ||
            (typeof found.name === "string" && found.name.trim()) ||
            path.basename(directory);
        }
      }
    }
  }

  if (!directory || !fs.existsSync(directory)) {
    throw new Error(`Unknown or unavailable registered workspace: ${workspaceId}`);
  }

  const { checkoutRoot, mainRepoRoot } = resolveWorkspaceRepoRoots(directory);
  return {
    workspaceId,
    workspaceName,
    directory,
    checkoutRoot,
    mainRepoRoot,
    isWorktree: path.resolve(checkoutRoot) !== path.resolve(mainRepoRoot),
  };
}

function toEditableManifest(
  raw: RawAgentTeamManifest,
  fallbackSlug: string,
): AgentTeamEditableManifest {
  const rawBindings =
    raw.bindings && typeof raw.bindings === "object" && !Array.isArray(raw.bindings)
      ? (raw.bindings as Record<string, Record<string, unknown>>)
      : {};

  const bindings: AgentTeamEditableManifest["bindings"] = {};
  for (const [roleId, cfg] of Object.entries(rawBindings)) {
    if (!cfg || typeof cfg !== "object") continue;
    bindings[roleId] = {
      provider: typeof cfg.provider === "string" ? cfg.provider : undefined,
      tier: typeof cfg.tier === "string" ? cfg.tier : undefined,
      model: typeof cfg.model === "string" ? cfg.model : undefined,
      modeId: typeof cfg.modeId === "string" ? cfg.modeId : undefined,
      lazyToolSlice: typeof cfg.lazyToolSlice === "string" ? cfg.lazyToolSlice : undefined,
    };
  }

  const rawRoles = Array.isArray(raw.roles) ? raw.roles.map(String) : [];

  const rawFlow =
    raw.flow && typeof raw.flow === "object" ? (raw.flow as Record<string, unknown>) : {};
  return normalizeEditableManifest(
    {
      schema_version: typeof raw.schema_version === "string" ? raw.schema_version : "1.0.0",
      project_slug:
        typeof raw.project_slug === "string" && isSafePathIdentifier(raw.project_slug.trim())
          ? raw.project_slug.trim()
          : fallbackSlug,
      preset: typeof raw.preset === "string" ? raw.preset : "custom",
      targets: Array.isArray(raw.targets) ? raw.targets.map(String) : undefined,
      roles: rawRoles,
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
      mcp_sources: Array.isArray(raw.mcp_sources) ? raw.mcp_sources.map(String) : [],
      guards: Array.isArray(raw.guards) ? raw.guards.map(String) : [],
      tracker: typeof raw.tracker === "string" ? raw.tracker : "local",
      git_mode: typeof raw.git_mode === "string" ? raw.git_mode : "tracked-manifest",
      flow: {
        openspec: Boolean(rawFlow.openspec),
        contracts: Boolean(rawFlow.contracts),
        workflows: Boolean(rawFlow.workflows),
        scaffold_docs: Boolean(rawFlow.scaffold_docs),
      },
      bindings,
    },
    fallbackSlug,
  );
}

export async function inspectWorkspaceTeam(options: {
  paseo: PaseoApi;
  workspaceId: string;
  lazyToolSlicesDir?: string;
  homeDir?: string;
  resolveWorkspaceDir?: WorkspaceDirResolver;
  resolveCompiler?: (homeDir: string) => ReturnType<typeof resolveHostCompiler>;
}) {
  const homeDir = options.homeDir ?? os.homedir();
  const ws = await resolveRegisteredWorkspace(
    options.paseo,
    options.workspaceId,
    options.resolveWorkspaceDir,
  );
  const { catalog, presets } = loadHostCatalogAndPresets(homeDir);
  const compiler = (options.resolveCompiler ?? resolveHostCompiler)(homeDir);

  const { manifestState, manifestPath, manifest, manifestError, localFederatedTargets } =
    await withCheckoutLock(ws.checkoutRoot, async () => {
      const checkoutManifestPath = path.join(ws.checkoutRoot, ".agents", "agent-team.json");
      const mainManifestPath = path.join(ws.mainRepoRoot, ".agents", "agent-team.json");
      const checkoutRead = readJsonFileDetailed<RawAgentTeamManifest>(checkoutManifestPath);
      const mainRead = ws.isWorktree
        ? readJsonFileDetailed<RawAgentTeamManifest>(mainManifestPath)
        : ({ status: "missing" } as const);

      let nextState: "present" | "inherited_from_main" | "absent" = "absent";
      let nextPath = checkoutManifestPath;
      let nextManifest: AgentTeamEditableManifest | null = null;
      let nextError: string | null = null;
      const fallbackSlug = sanitizeProjectSlug(path.basename(ws.mainRepoRoot), "project");

      if (checkoutRead.status === "ok") {
        nextState = "present";
        nextPath = checkoutManifestPath;
        nextManifest = toEditableManifest(checkoutRead.data, fallbackSlug);
      } else if (checkoutRead.status === "invalid") {
        nextState = "present";
        nextPath = checkoutManifestPath;
        nextManifest = null;
        nextError = `Invalid JSON in ${checkoutManifestPath}: ${checkoutRead.error}`;
      } else if (mainRead.status === "ok") {
        nextState = "inherited_from_main";
        nextPath = mainManifestPath;
        nextManifest = toEditableManifest(mainRead.data, fallbackSlug);
      } else if (mainRead.status === "invalid") {
        nextState = "absent";
        nextPath = mainManifestPath;
        nextManifest = null;
        nextError = `Invalid JSON in ${mainManifestPath}: ${mainRead.error}`;
      }

      const teamData = loadWorkspaceAgentTeam(ws.checkoutRoot, homeDir);
      const nextTargets =
        teamData?.summary.localFederatedTargets ??
        detectLocalFederatedTargets(ws.checkoutRoot, nextManifest?.project_slug ?? fallbackSlug);

      return {
        manifestState: nextState,
        manifestPath: nextPath,
        manifest: nextManifest,
        manifestError: nextError,
        localFederatedTargets: nextTargets,
      };
    });

  const availableProviders: Array<{ provider: string; enabled: boolean; models: string[] }> = [];
  if (options.paseo.providers?.snapshot) {
    try {
      const snap = await options.paseo.providers.snapshot();
      for (const entry of snap.entries ?? []) {
        availableProviders.push({
          provider: entry.provider,
          enabled: entry.enabled,
          models: (entry.models ?? []).map((m) => m.id),
        });
      }
    } catch {
      // Optional provider snapshot
    }
  }

  return {
    workspaceId: ws.workspaceId,
    workspaceName: ws.workspaceName,
    checkoutRoot: ws.checkoutRoot,
    mainRepoRoot: ws.mainRepoRoot,
    isWorktree: ws.isWorktree,
    manifestState,
    manifestPath,
    manifest,
    manifestError,
    localFederatedTargets,
    compilerAvailable: compiler.available,
    compilerMessage: compiler.message,
    catalog,
    presets,
    availableProviders,
    lazyToolSlices: scanLazyToolSlices(options.lazyToolSlicesDir ?? "~/.config/lazy-tool/profiles"),
  };
}

function detectRepoStackFallback(checkoutRoot: string): {
  presetId: string;
  notes: string[];
} {
  const pkgJson = readJsonFile<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(checkoutRoot, "package.json"));
  if (pkgJson) {
    const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
    if (deps.react || deps.next) {
      return {
        presetId: "web-react",
        notes: ["Detected React/Next.js dependencies in package.json (fallback detector)."],
      };
    }
  }
  if (fs.existsSync(path.join(checkoutRoot, "go.mod"))) {
    return {
      presetId: "go-api",
      notes: ["Detected go.mod in workspace root (fallback detector)."],
    };
  }
  return {
    presetId: "lean-solo",
    notes: ["Defaulted to lean-solo team composition."],
  };
}

export async function detectWorkspaceTeam(options: {
  paseo: PaseoApi;
  workspaceId: string;
  homeDir?: string;
  resolveWorkspaceDir?: WorkspaceDirResolver;
  resolveCompiler?: (homeDir: string) => ReturnType<typeof resolveHostCompiler>;
  runCompiler?: CompilerRunner;
}) {
  const homeDir = options.homeDir ?? os.homedir();
  const ws = await resolveRegisteredWorkspace(
    options.paseo,
    options.workspaceId,
    options.resolveWorkspaceDir,
  );
  const { presets } = loadHostCatalogAndPresets(homeDir);
  const compiler = (options.resolveCompiler ?? resolveHostCompiler)(homeDir);
  const runner = options.runCompiler ?? defaultCompilerRunner;
  const fallbackSlug = sanitizeProjectSlug(path.basename(ws.mainRepoRoot), "project");

  if (compiler.available && compiler.pythonBin && compiler.agentTeamPy) {
    const res = await runner(
      compiler.pythonBin,
      [compiler.agentTeamPy, "detect", ws.checkoutRoot, "--json"],
      { cwd: ws.checkoutRoot, timeoutMs: 12_000 },
    );
    if (res.exitCode === 0 && res.stdout.trim()) {
      try {
        const parsed = JSON.parse(res.stdout) as {
          preset?: string;
          recommended_preset?: string;
          recommended_manifest?: RawAgentTeamManifest;
          manifest?: RawAgentTeamManifest;
          resolution_notes?: unknown;
        };
        const rawMan = parsed.recommended_manifest ?? parsed.manifest;
        const recommendedPreset =
          parsed.preset ?? parsed.recommended_preset ?? rawMan?.preset ?? "lean-solo";
        if (rawMan) {
          return {
            workspaceId: ws.workspaceId,
            checkoutRoot: ws.checkoutRoot,
            recommendedPreset: String(recommendedPreset),
            manifest: toEditableManifest(rawMan, fallbackSlug),
            notes: Array.isArray(parsed.resolution_notes)
              ? parsed.resolution_notes.map(String)
              : [`Detected preset '${recommendedPreset}' via agent_team.py.`],
            usedCompiler: true,
          };
        }
      } catch {
        // Fall through to heuristic fallback
      }
    }
  }

  const fb = detectRepoStackFallback(ws.checkoutRoot);
  const presetObj = presets[fb.presetId] ?? Object.values(presets)[0];
  const manifest = normalizeEditableManifest(
    {
      schema_version: "1.0.0",
      project_slug: fallbackSlug,
      preset: presetObj.id,
      targets: ["antigravity"],
      roles: presetObj.roles,
      capabilities: presetObj.capabilities,
      mcp_sources: presetObj.mcp_sources,
      guards: presetObj.guards,
      tracker: fs.existsSync(path.join(ws.checkoutRoot, ".gitea-skills.json")) ? "gitea" : "local",
      git_mode: "tracked-manifest",
      flow: presetObj.flow,
      bindings: {},
    },
    fallbackSlug,
  );
  return {
    workspaceId: ws.workspaceId,
    checkoutRoot: ws.checkoutRoot,
    recommendedPreset: presetObj.id,
    manifest,
    notes: fb.notes,
    usedCompiler: false,
  };
}

function writeAtomicJsonFile(targetPath: string, payload: unknown): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.agent-team.json.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

export async function saveWorkspaceTeam(options: {
  paseo: PaseoApi;
  workspaceId: string;
  manifest: AgentTeamEditableManifest;
  reindex?: boolean;
  homeDir?: string;
  resolveWorkspaceDir?: WorkspaceDirResolver;
  resolveCompiler?: (homeDir: string) => ReturnType<typeof resolveHostCompiler>;
  runCompiler?: CompilerRunner;
}) {
  const homeDir = options.homeDir ?? os.homedir();
  const ws = await resolveRegisteredWorkspace(
    options.paseo,
    options.workspaceId,
    options.resolveWorkspaceDir,
  );

  return withCheckoutLock(ws.checkoutRoot, async () => {
    const fallbackSlug = sanitizeProjectSlug(path.basename(ws.mainRepoRoot), "project");
    const cleanManifest = normalizeEditableManifest(options.manifest, fallbackSlug);
    if (cleanManifest.roles.length === 0) {
      return {
        success: false,
        compiled: false,
        checkoutRoot: ws.checkoutRoot,
        manifestPath: path.join(ws.checkoutRoot, ".agents", "agent-team.json"),
        manifest: cleanManifest,
        localFederatedTargets: detectLocalFederatedTargets(
          ws.checkoutRoot,
          cleanManifest.project_slug,
        ),
        warnings: [],
        message: "At least one role must be enabled before saving.",
        error: "At least one role must be enabled.",
      };
    }

    const compiler = (options.resolveCompiler ?? resolveHostCompiler)(homeDir);
    const runner = options.runCompiler ?? defaultCompilerRunner;
    const manifestPath = path.join(ws.checkoutRoot, ".agents", "agent-team.json");

    if (compiler.available && compiler.pythonBin && compiler.scriptsDir) {
      const res = await runner(
        compiler.pythonBin,
        [
          "-c",
          SYNTHESIZE_PY_SCRIPT,
          compiler.scriptsDir,
          ws.checkoutRoot,
          JSON.stringify(cleanManifest),
          options.reindex ? "1" : "0",
        ],
        { cwd: ws.checkoutRoot, timeoutMs: 22_000 },
      );

      if (res.exitCode !== 0) {
        const detail = (res.stderr || res.stdout || "Multi-target compilation failed.").trim();
        return {
          success: false,
          compiled: false,
          checkoutRoot: ws.checkoutRoot,
          manifestPath,
          manifest: cleanManifest,
          localFederatedTargets: detectLocalFederatedTargets(
            ws.checkoutRoot,
            cleanManifest.project_slug,
          ),
          warnings: [],
          message: "Compilation failed; draft preserved.",
          error: detail,
        };
      }

      let warnings: string[] = [];
      try {
        const parsed = JSON.parse(res.stdout) as { warnings?: unknown };
        if (Array.isArray(parsed?.warnings)) {
          warnings = parsed.warnings.map(String);
        }
      } catch {
        // Non-fatal if stdout wasn't JSON
      }

      invalidateWorkspaceAgentTeamCache(ws.checkoutRoot);
      const localFederatedTargets = detectLocalFederatedTargets(
        ws.checkoutRoot,
        cleanManifest.project_slug,
      );
      return {
        success: true,
        compiled: true,
        checkoutRoot: ws.checkoutRoot,
        manifestPath,
        manifest: cleanManifest,
        localFederatedTargets,
        warnings,
        message: `Saved manifest & compiled targets (${localFederatedTargets.join(", ") || cleanManifest.targets.join(", ")}). Applies to new agents and handoffs.`,
        error: null,
      };
    }

    writeAtomicJsonFile(manifestPath, cleanManifest);
    invalidateWorkspaceAgentTeamCache(ws.checkoutRoot);
    const localFederatedTargets = detectLocalFederatedTargets(
      ws.checkoutRoot,
      cleanManifest.project_slug,
    );
    return {
      success: true,
      compiled: false,
      checkoutRoot: ws.checkoutRoot,
      manifestPath,
      manifest: cleanManifest,
      localFederatedTargets,
      warnings: [
        compiler.message ??
          "Host compiler unavailable; saved .agents/agent-team.json without regenerating native target files.",
      ],
      message:
        "Saved .agents/agent-team.json (compiler unavailable; native artifacts not updated).",
      error: null,
    };
  });
}

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

export async function doctorWorkspaceTeam(options: {
  paseo: PaseoApi;
  workspaceId: string;
  homeDir?: string;
  resolveWorkspaceDir?: WorkspaceDirResolver;
  resolveCompiler?: (homeDir: string) => ReturnType<typeof resolveHostCompiler>;
  runCompiler?: CompilerRunner;
}) {
  const homeDir = options.homeDir ?? os.homedir();
  const ws = await resolveRegisteredWorkspace(
    options.paseo,
    options.workspaceId,
    options.resolveWorkspaceDir,
  );
  return withCheckoutLock(ws.checkoutRoot, async () => {
    const compiler = (options.resolveCompiler ?? resolveHostCompiler)(homeDir);
    if (!compiler.available || !compiler.pythonBin || !compiler.agentTeamPy) {
      return {
        passed: false,
        exitCode: 1,
        passCount: 0,
        warnCount: 0,
        failCount: 1,
        output: compiler.message ?? "agent_team.py compiler is unavailable on this host.",
        compilerAvailable: false,
      };
    }

    const runner = options.runCompiler ?? defaultCompilerRunner;
    const res = await runner(
      compiler.pythonBin,
      [compiler.agentTeamPy, "doctor", ws.checkoutRoot],
      { cwd: ws.checkoutRoot, timeoutMs: 22_000 },
    );
    const combined = stripAnsi([res.stdout, res.stderr].filter(Boolean).join("\n")).trim();
    const lines = combined.split(/\r?\n/).map((ln) => ln.trimStart());
    const passCount = lines.filter((ln) => ln.startsWith("[PASS]")).length;
    const warnCount = lines.filter((ln) => ln.startsWith("[WARN]")).length;
    const failCount = lines.filter((ln) => ln.startsWith("[FAIL]")).length;
    return {
      passed: res.exitCode === 0 && failCount === 0,
      exitCode: res.exitCode,
      passCount,
      warnCount,
      failCount,
      output: combined || "(no output)",
      compilerAvailable: true,
    };
  });
}

export async function cleanWorkspaceTeam(options: {
  paseo: PaseoApi;
  workspaceId: string;
  deleteManifest?: boolean;
  homeDir?: string;
  resolveWorkspaceDir?: WorkspaceDirResolver;
  resolveCompiler?: (homeDir: string) => ReturnType<typeof resolveHostCompiler>;
  runCompiler?: CompilerRunner;
}) {
  const homeDir = options.homeDir ?? os.homedir();
  const ws = await resolveRegisteredWorkspace(
    options.paseo,
    options.workspaceId,
    options.resolveWorkspaceDir,
  );

  return withCheckoutLock(ws.checkoutRoot, async () => {
    const compiler = (options.resolveCompiler ?? resolveHostCompiler)(homeDir);
    const runner = options.runCompiler ?? defaultCompilerRunner;
    let removed: string[] = [];

    if (compiler.available && compiler.pythonBin && compiler.scriptsDir) {
      const res = await runner(
        compiler.pythonBin,
        [
          "-c",
          CLEAN_PY_SCRIPT,
          compiler.scriptsDir,
          ws.checkoutRoot,
          options.deleteManifest ? "1" : "0",
        ],
        { cwd: ws.checkoutRoot, timeoutMs: 22_000 },
      );
      if (res.exitCode !== 0) {
        const detail = (res.stderr || res.stdout || "Clean failed.").trim();
        return {
          success: false,
          checkoutRoot: ws.checkoutRoot,
          removedCount: 0,
          removed: [],
          localFederatedTargets: detectLocalFederatedTargets(ws.checkoutRoot),
          message: "Failed to clean generated artifacts.",
          error: detail,
        };
      }
      try {
        const parsed = JSON.parse(res.stdout) as { removed?: unknown };
        if (Array.isArray(parsed?.removed)) {
          removed = parsed.removed.map(String);
        }
      } catch {
        // ignore non-json
      }
    } else {
      const existingTargets = detectLocalFederatedTargets(ws.checkoutRoot);
      if (options.deleteManifest && existingTargets.length === 0) {
        const manifestPath = path.join(ws.checkoutRoot, ".agents", "agent-team.json");
        if (fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
          removed.push(manifestPath);
        }
      } else {
        return {
          success: false,
          checkoutRoot: ws.checkoutRoot,
          removedCount: 0,
          removed: [],
          localFederatedTargets: existingTargets,
          message:
            existingTargets.length > 0
              ? "Compiler unavailable while compiled target artifacts still exist; cannot clean targets safely."
              : "Compiler unavailable; cannot clean target artifacts automatically.",
          error:
            existingTargets.length > 0
              ? `Compiler unavailable while compiled artifacts remain (${existingTargets.join(", ")}); install agent-team scripts or clean targets manually.`
              : (compiler.message ?? "agent-team compiler scripts unavailable."),
        };
      }
    }

    invalidateWorkspaceAgentTeamCache(ws.checkoutRoot);
    const localFederatedTargets = detectLocalFederatedTargets(ws.checkoutRoot);
    return {
      success: true,
      checkoutRoot: ws.checkoutRoot,
      removedCount: removed.length,
      removed,
      localFederatedTargets,
      message:
        removed.length > 0
          ? `Cleaned ${removed.length} generated item(s) under this workspace.`
          : "No managed generated artifacts found to clean.",
      error: null,
    };
  });
}
