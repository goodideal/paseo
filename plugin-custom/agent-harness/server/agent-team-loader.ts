import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FEDERATED_AGENT_PROBE_SPECS,
  VALID_FEDERATED_TARGET_IDS,
  canonicalizeProviderName,
  normalizeTierAlias,
} from "../shared/config-resolver.js";
import type { AgentTeamSummary, HarnessSpecialistConfig } from "../shared/types.js";

export interface AgentTeamRoleBinding {
  provider?: string;
  tier?: string;
  model?: string;
  modeId?: string;
  lazyToolSlice?: string;
}

export interface RawAgentTeamManifest {
  schema_version?: string;
  project_slug?: string;
  preset?: string;
  roles?: unknown;
  capabilities?: unknown;
  mcp_sources?: unknown;
  guards?: unknown;
  tracker?: unknown;
  git_mode?: unknown;
  flow?: unknown;
  targets?: unknown;
  bindings?: unknown;
}

export interface WorkspaceAgentTeamData {
  summary: AgentTeamSummary;
  specialists: HarnessSpecialistConfig[];
}

interface CatalogRoleEntry {
  team: "fe" | "be" | "ops";
  title: string;
  readonly: boolean;
  recommended_model: string;
}

const BUILTIN_AGENT_TEAM_CATALOG: Record<string, CatalogRoleEntry> = {
  "fe-pm": {
    team: "fe",
    title: "Product Manager (Spec & Story Mapping)",
    readonly: false,
    recommended_model: "inherit",
  },
  "fe-uiux": {
    team: "fe",
    title: "UI/UX & Design System Lead",
    readonly: false,
    recommended_model: "inherit",
  },
  "fe-architect": {
    team: "fe",
    title: "Frontend Architect (Read-Only)",
    readonly: true,
    recommended_model: "pro",
  },
  "fe-developer": {
    team: "fe",
    title: "Frontend Engineer (TDD + unslop)",
    readonly: false,
    recommended_model: "inherit",
  },
  "fe-qa": {
    team: "fe",
    title: "Frontend QA & 4-Viewport Verifier (Read-Only)",
    readonly: true,
    recommended_model: "inherit",
  },
  "be-architect": {
    team: "be",
    title: "Backend & Data Architect",
    readonly: false,
    recommended_model: "pro",
  },
  "be-developer": {
    team: "be",
    title: "Backend Engineer (TDD + Serena AST)",
    readonly: false,
    recommended_model: "inherit",
  },
  "be-reviewer": {
    team: "be",
    title: "Backend Two-Axis Code Reviewer (Read-Only)",
    readonly: true,
    recommended_model: "pro",
  },
  "ops-ci": {
    team: "ops",
    title: "CI/CD & Containerization Engineer",
    readonly: false,
    recommended_model: "inherit",
  },
  "ops-sre": {
    team: "ops",
    title: "Site Reliability & Diagnostics Engineer",
    readonly: false,
    recommended_model: "inherit",
  },
  "ops-auditor": {
    team: "ops",
    title: "Security, Infra & Compliance Auditor (Read-Only)",
    readonly: true,
    recommended_model: "pro",
  },
};

const manifestCache = new Map<string, { mtimeMs: number; data: RawAgentTeamManifest }>();
const catalogCache = new Map<
  string,
  { mtimeMs: number; entries: Record<string, CatalogRoleEntry> }
>();
const markdownCache = new Map<string, { mtimeMs: number; body: string }>();
const HEADER_PROBE_BYTES = 8192;
const MANAGED_MARKER_PATTERN = /generated_by:\s*agent-team:([a-zA-Z0-9][a-zA-Z0-9_-]*)?/;
const managedHeaderCache = new Map<
  string,
  { mtimeMs: number; size: number; hasMarker: boolean; slug: string | null }
>();

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function isSafePathIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_PATTERN.test(value);
}

/**
 * Invalidates cached workspace manifests and local federated artifact headers after edits.
 */
export function invalidateWorkspaceAgentTeamCache(checkoutRoot?: string): void {
  if (!checkoutRoot) {
    manifestCache.clear();
    managedHeaderCache.clear();
    markdownCache.clear();
    return;
  }
  const normalizedRoot = path.resolve(checkoutRoot);
  const prefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  for (const key of Array.from(manifestCache.keys())) {
    if (key === normalizedRoot || key.startsWith(prefix)) {
      manifestCache.delete(key);
    }
  }
  for (const key of Array.from(managedHeaderCache.keys())) {
    if (key === normalizedRoot || key.startsWith(prefix)) {
      managedHeaderCache.delete(key);
    }
  }
  // markdownCache keys are composite "${homeDir}\0${filePath}" (see extractRoleMarkdownBody),
  // so substring matching is required to invalidate all entries under checkoutRoot.
  for (const key of Array.from(markdownCache.keys())) {
    if (key.includes(prefix)) {
      markdownCache.delete(key);
    }
  }
}

function resolveOcrBinPath(homeDir: string): string {
  const candidates = [
    path.join(homeDir, ".local", "bin", "ocr"),
    path.join(homeDir, ".volta", "bin", "ocr"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function readJsonWithMtime<T>(
  filePath: string,
  cache: Map<string, { mtimeMs: number; data: T }>,
): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      cache.delete(filePath);
      return null;
    }
    const stat = fs.statSync(filePath);
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.data;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    cache.set(filePath, { mtimeMs: stat.mtimeMs, data: parsed });
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolves the git checkout root and, when running inside a linked git worktree,
 * resolves the primary repository checkout root via pure filesystem inspection.
 */
export function resolveWorkspaceRepoRoots(cwd: string): {
  checkoutRoot: string;
  mainRepoRoot: string;
} {
  const startDir = path.resolve(cwd);
  let cursor = startDir;
  let checkoutRoot = startDir;
  let gitEntryPath: string | null = null;

  while (true) {
    const candidateGit = path.join(cursor, ".git");
    if (fs.existsSync(candidateGit)) {
      checkoutRoot = cursor;
      gitEntryPath = candidateGit;
      break;
    }
    if (fs.existsSync(path.join(cursor, ".agents", "agent-team.json"))) {
      checkoutRoot = cursor;
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  let mainRepoRoot = checkoutRoot;
  if (gitEntryPath) {
    try {
      const stat = fs.statSync(gitEntryPath);
      if (stat.isFile()) {
        const content = fs.readFileSync(gitEntryPath, "utf8");
        const match = /^gitdir:\s*(.+)$/im.exec(content);
        if (match?.[1]) {
          const gitDir = path.resolve(checkoutRoot, match[1].trim());
          const commondirFile = path.join(gitDir, "commondir");
          let commonGitDir: string | null = null;
          if (fs.existsSync(commondirFile)) {
            const relCommon = fs.readFileSync(commondirFile, "utf8").trim();
            if (relCommon) {
              commonGitDir = path.resolve(gitDir, relCommon);
            }
          } else if (path.basename(path.dirname(gitDir)) === "worktrees") {
            commonGitDir = path.resolve(gitDir, "..", "..");
          }
          if (commonGitDir && fs.existsSync(commonGitDir)) {
            mainRepoRoot = path.dirname(commonGitDir);
          }
        }
      }
    } catch {
      // Fall back to checkoutRoot on unreadable gitdir files
    }
  }

  return { checkoutRoot, mainRepoRoot };
}

/**
 * Checks whether the active checkout itself contains a synthesized Antigravity team plugin
 * with its own `mcp_config.json`. Does NOT fall back to `mainRepoRoot`.
 */
export function hasLocalAntigravityTeamPlugin(
  checkoutRoot: string,
  projectSlug?: string | null,
): boolean {
  const pluginsDir = path.join(checkoutRoot, ".agents", "plugins");
  try {
    if (!fs.existsSync(pluginsDir)) {
      return false;
    }
    if (projectSlug && projectSlug.trim()) {
      const trimmedSlug = projectSlug.trim();
      if (isSafePathIdentifier(trimmedSlug)) {
        const targeted = path.join(pluginsDir, `team-${trimmedSlug}`, "mcp_config.json");
        if (fs.existsSync(targeted)) {
          return true;
        }
      }
    }
    for (const entry of fs.readdirSync(pluginsDir)) {
      if (!entry.startsWith("team-")) continue;
      if (fs.existsSync(path.join(pluginsDir, entry, "mcp_config.json"))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function isMissingFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function readManagedArtifactHeader(
  fullPath: string,
  stat: fs.Stats,
): {
  hasMarker: boolean;
  slug: string | null;
} {
  const cached = managedHeaderCache.get(fullPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }
  const fd = fs.openSync(fullPath, "r");
  try {
    const buf = Buffer.alloc(HEADER_PROBE_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_PROBE_BYTES, 0);
    const headerText = buf.subarray(0, bytesRead).toString("utf8");
    const match = MANAGED_MARKER_PATTERN.exec(headerText);
    const parsed = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hasMarker: Boolean(match),
      slug: match?.[1] ? match[1] : null,
    };
    managedHeaderCache.set(fullPath, parsed);
    return parsed;
  } finally {
    fs.closeSync(fd);
  }
}

function hasManagedAgentArtifacts(
  dirPath: string,
  suffix: string,
  expectedSlug?: string | null,
): boolean {
  const trimmedSlug = expectedSlug?.trim();
  const safeSlug = trimmedSlug && isSafePathIdentifier(trimmedSlug) ? trimmedSlug : "";
  try {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    for (const entry of fs.readdirSync(dirPath)) {
      if (!entry.endsWith(suffix)) continue;
      const fullPath = path.join(dirPath, entry);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      const parsed = readManagedArtifactHeader(fullPath, stat);
      if (!parsed.hasMarker) continue;
      if (!safeSlug || parsed.slug === safeSlug) {
        return true;
      }
    }
  } catch (err) {
    if (!isMissingFsError(err)) {
      console.warn(`[agent-harness] Failed probing federated artifacts in ${dirPath}:`, err);
    }
    return false;
  }
  return false;
}

/**
 * Probes the active `checkoutRoot` (without falling back to `mainRepoRoot`) for synthesized
 * native agent-team targets (`antigravity`, `claude`, `opencode`, `codex`).
 */
export function detectLocalFederatedTargets(
  checkoutRoot: string,
  projectSlug?: string | null,
): string[] {
  const detected: string[] = [];
  if (hasLocalAntigravityTeamPlugin(checkoutRoot, projectSlug)) {
    detected.push("antigravity");
  }
  for (const spec of FEDERATED_AGENT_PROBE_SPECS) {
    const dirPath = path.join(checkoutRoot, ...spec.relDirParts);
    if (hasManagedAgentArtifacts(dirPath, spec.suffix, projectSlug)) {
      detected.push(spec.target);
    }
  }
  return detected;
}

function loadAgentTeamCatalog(homeDir: string): Record<string, CatalogRoleEntry> {
  const candidates = [
    path.join(homeDir, ".agents", "skills", "gitea", "agent-team", "manifests", "catalog.json"),
    path.join(homeDir, ".agents", "skills", "agent-team", "manifests", "catalog.json"),
  ];
  for (const catalogPath of candidates) {
    try {
      if (!fs.existsSync(catalogPath)) continue;
      const stat = fs.statSync(catalogPath);
      const cached = catalogCache.get(catalogPath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.entries;
      }
      const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
        roles?: Record<string, Partial<CatalogRoleEntry>>;
      };
      if (raw?.roles && typeof raw.roles === "object") {
        const entries: Record<string, CatalogRoleEntry> = { ...BUILTIN_AGENT_TEAM_CATALOG };
        for (const [roleId, info] of Object.entries(raw.roles)) {
          if (!info || typeof info !== "object") continue;
          const inferredTeam = inferTeamFromRoleId(roleId);
          entries[roleId] = {
            team:
              info.team === "fe" || info.team === "be" || info.team === "ops"
                ? info.team
                : inferredTeam,
            title: typeof info.title === "string" && info.title.trim() ? info.title : roleId,
            readonly: Boolean(info.readonly),
            recommended_model:
              typeof info.recommended_model === "string" && info.recommended_model.trim()
                ? info.recommended_model
                : "inherit",
          };
        }
        catalogCache.set(catalogPath, { mtimeMs: stat.mtimeMs, entries });
        return entries;
      }
    } catch {
      // Try next candidate
    }
  }
  return BUILTIN_AGENT_TEAM_CATALOG;
}

function inferTeamFromRoleId(roleId: string): "fe" | "be" | "ops" {
  if (roleId.startsWith("be-")) return "be";
  if (roleId.startsWith("ops-")) return "ops";
  return "fe";
}

function inferRoleIcon(roleId: string): string {
  switch (roleId) {
    case "fe-pm":
      return "FileText";
    case "fe-uiux":
    case "fe-developer":
      return "Palette";
    case "fe-architect":
    case "be-architect":
      return "Compass";
    case "fe-qa":
      return "CheckCircle";
    case "be-reviewer":
    case "ops-auditor":
      return "ShieldCheck";
    case "ops-ci":
    case "ops-sre":
      return "Terminal";
    default:
      if (roleId.startsWith("be-")) {
        return "Server";
      }
      if (roleId.startsWith("ops-")) {
        return "Terminal";
      }
      return "Bot";
  }
}

function inferRoleColor(team: "fe" | "be" | "ops", readonly: boolean): string {
  if (readonly) return "orange";
  switch (team) {
    case "fe":
      return "pink";
    case "be":
      return "cyan";
    case "ops":
      return "emerald";
  }
}

function inferDefaultTier(roleId: string, cat?: CatalogRoleEntry): string {
  if (
    roleId.includes("reviewer") ||
    roleId.includes("auditor") ||
    roleId.includes("architect") ||
    roleId.endsWith("-pm") ||
    roleId === "pm" ||
    cat?.recommended_model === "pro"
  ) {
    return "deep";
  }
  return "standard";
}

function inferDefaultLazySlice(roleId: string, team: "fe" | "be" | "ops"): string {
  if (roleId === "fe-pm") return "pm.yaml";
  if (roleId.includes("reviewer") || roleId.includes("auditor")) return "review.yaml";
  if (team === "fe") return "ui.yaml";
  return "backend.yaml";
}

function extractRoleMarkdownBody(filePath: string, homeDir: string): string {
  const cacheKey = `${homeDir}\0${filePath}`;
  try {
    if (!fs.existsSync(filePath)) {
      markdownCache.delete(cacheKey);
      return "";
    }
    const stat = fs.statSync(filePath);
    const cached = markdownCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.body;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
    const expanded = stripped
      .replace(/\{\{HOME\}\}/g, homeDir)
      .replace(/\{\{OCR_BIN\}\}/g, resolveOcrBinPath(homeDir))
      .replace(/\{\{PLAYWRIGHT_CLI_BIN\}\}/g, `${homeDir}/.volta/bin/playwright-cli`);
    markdownCache.set(cacheKey, { mtimeMs: stat.mtimeMs, body: expanded });
    return expanded;
  } catch {
    return "";
  }
}

function loadRoleMarkdownPrompt(
  roleId: string,
  team: "fe" | "be" | "ops",
  projectSlug: string,
  checkoutRoot: string,
  mainRepoRoot: string,
  homeDir: string,
): string {
  if (!isSafePathIdentifier(roleId)) {
    return "";
  }
  const safeSlug = isSafePathIdentifier(projectSlug) ? projectSlug : "";
  const candidates = [
    ...(safeSlug
      ? [
          path.join(
            checkoutRoot,
            ".agents",
            "plugins",
            `team-${safeSlug}`,
            "agents",
            `${roleId}.md`,
          ),
          ...(mainRepoRoot !== checkoutRoot
            ? [
                path.join(
                  mainRepoRoot,
                  ".agents",
                  "plugins",
                  `team-${safeSlug}`,
                  "agents",
                  `${roleId}.md`,
                ),
              ]
            : []),
        ]
      : []),
    path.join(homeDir, ".gemini", "team-kits", "plugins", `team-${team}`, "agents", `${roleId}.md`),
    path.join(
      homeDir,
      ".agents",
      "skills",
      "gitea",
      "agent-team",
      "team-kits",
      "plugins",
      `team-${team}`,
      "agents",
      `${roleId}.md`,
    ),
  ];

  for (const filePath of candidates) {
    const body = extractRoleMarkdownBody(filePath, homeDir);
    if (body) {
      return body;
    }
  }
  return "";
}

function assignCoarseAliases(roles: readonly string[]): Map<string, string[]> {
  const aliasesByRole = new Map<string, string[]>();
  const claims: Array<{ alias: string; preferredOrder: string[] }> = [
    { alias: "ui", preferredOrder: ["fe-developer", "fe-uiux"] },
    { alias: "frontend", preferredOrder: ["fe-developer", "fe-uiux"] },
    { alias: "backend", preferredOrder: ["be-developer", "ops-ci", "ops-sre"] },
    { alias: "server", preferredOrder: ["be-developer", "ops-ci"] },
    { alias: "review", preferredOrder: ["be-reviewer", "ops-auditor"] },
    { alias: "reviewer", preferredOrder: ["be-reviewer", "ops-auditor"] },
    { alias: "qa", preferredOrder: ["fe-qa"] },
    { alias: "pm", preferredOrder: ["fe-pm"] },
    { alias: "architect", preferredOrder: ["be-architect", "fe-architect"] },
  ];

  const roleSet = new Set(roles);
  for (const { alias, preferredOrder } of claims) {
    const matched = preferredOrder.find((r) => roleSet.has(r));
    if (!matched) continue;
    const list = aliasesByRole.get(matched) ?? [];
    list.push(alias);
    aliasesByRole.set(matched, list);
  }
  return aliasesByRole;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferRoleMatchPatterns(roleId: string, team: "fe" | "be" | "ops"): string[] {
  const idPattern = `\\b${escapeRegexLiteral(roleId)}\\b`;
  if (roleId.endsWith("-pm") || roleId === "pm") {
    return [
      idPattern,
      "\\b(?:pm-prd|pm-user-stories|pm-edge-cases|pm-problem|prd|user\\s*stories|jtbd|story\\s*mapping)\\b",
      "痛点|用户故事|产品需求|验收条件",
    ];
  }
  if (roleId.includes("architect")) {
    if (team === "fe") {
      return [
        idPattern,
        "\\b(?:frontend\\s*architect|ui\\s*architect|design\\s*system\\s*architect|state\\s*architecture)\\b",
        "前端架构|组件架构|状态架构",
      ];
    }
    return [
      idPattern,
      "\\b(?:codebase-design|domain-modeling|deep\\s*modules?|adr|glossary|system\\s*architecture|schema\\s*design)\\b",
      "深模块|领域建模|系统架构|整体架构|架构设计|模块划分",
    ];
  }
  if (roleId.includes("reviewer") || roleId.includes("auditor") || roleId === "review") {
    if (team === "ops") {
      return [
        idPattern,
        "\\b(?:sre\\s*audit|dockerfile\\s*audit|k8s\\s*audit|security\\s*audit|cve)\\b",
        "容器安全|镜像加固|运维审计|权限审计",
      ];
    }
    return [
      idPattern,
      "\\b(?:ocr|code-review|security-review|dual-axis\\s*review|pr\\s*review)\\b",
      "代码审查|安全审计|双轴审查|质量门禁",
    ];
  }
  if (roleId.includes("qa")) {
    return [
      idPattern,
      "\\b(?:test-gardener|vitest|playwright|e2e|maestro|qa|viewport)\\b",
      "测试健康度|回归测试|边缘用例|多视口|端到端测试",
    ];
  }
  if (roleId.includes("uiux")) {
    return [
      idPattern,
      "\\b(?:ui-ux-pro-max|design\\s*system|design\\s*tokens?|figma|wireframe|palette|typography)\\b",
      "设计系统|视觉规范|配色方案|字体排版|交互原型",
    ];
  }
  if (team === "fe") {
    return [
      idPattern,
      "\\b(?:ui|ux|unslop|visual-verdict|unistyles|popover|sheet|pill|hover|tailwind|expo|react\\s*native|css)\\b",
      "前端|界面|样式|弹窗|组件|面板|视觉|移动端|响应式|布局",
    ];
  }
  if (team === "ops") {
    return [
      idPattern,
      "\\b(?:dockerfile|docker-compose|kubernetes|k8s|helm|prometheus|grafana|gitea\\s*actions|ci\\/cd|pipeline|reviewdog)\\b",
      "流水线|容器编排|监控告警|持续集成|部署脚本|运维排障",
    ];
  }
  return [
    idPattern,
    "\\b(?:backend|daemon|websocket|rpc|sqlite|postgres|redis|dbx|worktree|protocol|zod-aot|relay|gateway|scheduler|rest\\s*api|endpoint|database|sql)\\b",
    "后端|协议兼容|数据库|进程通信|服务端|网关|接口实现|数据存储",
  ];
}

/**
 * Loads `.agents/agent-team.json` for a workspace (falling back to the main git repo
 * checkout when running inside a git worktree) and maps its enabled roles into
 * `HarnessSpecialistConfig[]`. Returns `null` when the repository has no manifest.
 */
export function loadWorkspaceAgentTeam(
  cwd?: string | null,
  homeDir = os.homedir(),
): WorkspaceAgentTeamData | null {
  if (!cwd || !cwd.trim()) {
    return null;
  }

  const { checkoutRoot, mainRepoRoot } = resolveWorkspaceRepoRoots(cwd);
  const checkoutManifestPath = path.join(checkoutRoot, ".agents", "agent-team.json");
  const mainManifestPath = path.join(mainRepoRoot, ".agents", "agent-team.json");

  let manifestPath = checkoutManifestPath;
  let manifest = readJsonWithMtime<RawAgentTeamManifest>(checkoutManifestPath, manifestCache);

  if (!manifest && mainRepoRoot !== checkoutRoot) {
    manifestPath = mainManifestPath;
    manifest = readJsonWithMtime<RawAgentTeamManifest>(mainManifestPath, manifestCache);
  }

  if (!manifest || !Array.isArray(manifest.roles)) {
    return null;
  }

  const roles = manifest.roles
    .filter((r): r is string => typeof r === "string" && isSafePathIdentifier(r.trim()))
    .map((r) => r.trim());
  if (roles.length === 0) {
    return null;
  }

  const rawSlug = typeof manifest.project_slug === "string" ? manifest.project_slug.trim() : "";
  const projectSlug = isSafePathIdentifier(rawSlug) ? rawSlug : path.basename(mainRepoRoot);
  const preset =
    typeof manifest.preset === "string" && manifest.preset.trim()
      ? manifest.preset.trim()
      : "custom";

  const rawBindings =
    manifest.bindings && typeof manifest.bindings === "object" && !Array.isArray(manifest.bindings)
      ? (manifest.bindings as Record<string, AgentTeamRoleBinding>)
      : {};

  const catalog = loadAgentTeamCatalog(homeDir);
  const aliasesByRole = assignCoarseAliases(roles);
  const localFederatedTargets = detectLocalFederatedTargets(checkoutRoot, projectSlug);
  const hasLocalPlugin = localFederatedTargets.includes("antigravity");
  const targets = Array.isArray(manifest.targets)
    ? Array.from(
        new Set(
          manifest.targets
            .filter((t): t is string => typeof t === "string")
            .map(canonicalizeProviderName)
            .filter((t) => VALID_FEDERATED_TARGET_IDS.has(t)),
        ),
      )
    : undefined;

  const specialists: HarnessSpecialistConfig[] = roles.map((roleId, index) => {
    const cat = catalog[roleId];
    const team = cat?.team ?? inferTeamFromRoleId(roleId);
    const readonly = Boolean(cat?.readonly);
    const defaultTier = inferDefaultTier(roleId, cat);
    const defaultSlice = inferDefaultLazySlice(roleId, team);
    const binding = rawBindings[roleId];

    const rawProvider = typeof binding?.provider === "string" ? binding.provider.trim() : "";
    const normProvider = rawProvider ? canonicalizeProviderName(rawProvider) : "";
    const preferredProvider = VALID_FEDERATED_TARGET_IDS.has(normProvider)
      ? normProvider
      : rawProvider;
    const preferredTier =
      typeof binding?.tier === "string" && binding.tier.trim()
        ? normalizeTierAlias(binding.tier)
        : defaultTier;
    const modelOverride = typeof binding?.model === "string" ? binding.model.trim() : "";
    const defaultModeId = typeof binding?.modeId === "string" ? binding.modeId.trim() : "";
    const lazyToolSlice =
      typeof binding?.lazyToolSlice === "string" && binding.lazyToolSlice.trim()
        ? binding.lazyToolSlice.trim()
        : defaultSlice;

    const markdownBody = loadRoleMarkdownPrompt(
      roleId,
      team,
      projectSlug,
      checkoutRoot,
      mainRepoRoot,
      homeDir,
    );

    return {
      id: roleId,
      name: cat?.title || roleId,
      shortLabel: roleId,
      description: cat?.title || `Workspace role (${roleId})`,
      icon: inferRoleIcon(roleId),
      color: inferRoleColor(team, readonly),
      enabled: true,
      builtIn: false,
      readonly,
      preferredProvider,
      preferredTier,
      modelOverride,
      defaultModeId,
      lockTierOnLabel: readonly || preferredTier === "deep",
      handoffEnabled: true,
      handoffPriority: index * 10 + 10,
      handoffTitlePrefix: `[${roleId}]`,
      handoffDefaultPrompt: `Act as workspace role ${roleId} (${cat?.title || roleId}).`,
      syncToDaemonProfile: false,
      primarySkills: [],
      mandatorySkillActivation: false,
      skillsRoot: `${homeDir}/.agents/skills`,
      docsFocus: [],
      qualityGates: [],
      ssotOutputTarget: "",
      rolePromptTemplate: markdownBody,
      lazyToolSlice,
      allowedMcpServers: [],
      excludedMcpServers: [],
      injectedMcpServers: [],
      extraEnv: {},
      aliases: aliasesByRole.get(roleId) ?? [],
      matchPatterns: inferRoleMatchPatterns(roleId, team),
      profileFilename: `${roleId}.json`,
    };
  });

  return {
    summary: {
      projectSlug,
      preset,
      manifestPath,
      checkoutRoot,
      mainRepoRoot,
      hasLocalAntigravityPlugin: hasLocalPlugin,
      ...(targets ? { targets } : {}),
      localFederatedTargets,
      roles,
    },
    specialists,
  };
}
