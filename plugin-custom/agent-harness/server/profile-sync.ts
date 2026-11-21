import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { expandHomeDir, joinPosixPath } from "../shared/config-resolver.js";
import type { HarnessSpecialistConfig, RepoHarnessOverride } from "../shared/types.js";

export interface DiskProfileEntry {
  filename: string;
  role: string;
  name?: string;
  description?: string;
  exists: boolean;
  content?: Record<string, unknown>;
}

export function resolveDirectory(rawDir: string, homeDir?: string): string {
  const resolvedHome = homeDir || os.homedir();
  return expandHomeDir(rawDir, resolvedHome);
}

/**
 * Scans disk profiles directory (~/.agents/profiles/) for JSON files.
 */
export function scanDiskProfiles(profilesDir = "~/.agents/profiles"): DiskProfileEntry[] {
  const dir = resolveDirectory(profilesDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries: DiskProfileEntry[] = [];
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const role =
          typeof parsed.name === "string" && parsed.name.trim()
            ? parsed.name.trim()
            : path.basename(file, ".json");
        entries.push({
          filename: file,
          role,
          name: typeof parsed.name === "string" ? parsed.name : undefined,
          description: typeof parsed.description === "string" ? parsed.description : undefined,
          exists: true,
          content: parsed,
        });
      } catch {
        entries.push({
          filename: file,
          role: path.basename(file, ".json"),
          exists: true,
        });
      }
    }
  } catch (err) {
    console.error("[AgentHarness] Failed to scan disk profiles directory", err);
  }
  return entries;
}

/**
 * Scans lazy-tool YAML slices directory (~/.config/lazy-tool/profiles/).
 */
export function scanLazyToolSlices(sliceDir = "~/.config/lazy-tool/profiles"): string[] {
  const dir = resolveDirectory(sliceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  try {
    const files = fs.readdirSync(dir);
    return files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  } catch {
    return [];
  }
}

/**
 * Exports configured specialists to disk JSON files (~/.agents/profiles/<file>.json).
 */
export function exportSpecialistsToDisk(
  specialists: HarnessSpecialistConfig[],
  profilesDir = "~/.agents/profiles",
): { exported: number; errors: string[] } {
  const dir = resolveDirectory(profilesDir);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { exported: 0, errors: [`Failed to create directory ${dir}: ${String(err)}`] };
    }
  }

  let exported = 0;
  const errors: string[] = [];

  for (const s of specialists) {
    if (!s.enabled) continue;
    const filename = s.profileFilename?.trim() || `${s.id}.json`;
    const targetPath = path.join(dir, filename);

    const doc: Record<string, unknown> = {
      name: s.id,
      description: s.description || undefined,
      preferred_provider: s.preferredProvider || undefined,
      default_model: s.preferredTier || s.modelOverride || undefined,
      primary_skills: s.primarySkills,
      skills_root: s.skillsRoot || undefined,
      mcp_servers: s.allowedMcpServers,
      excluded_mcp_servers: s.excludedMcpServers,
      docs_focus: s.docsFocus,
      quality_gates: s.qualityGates,
      ssot_output_target: s.ssotOutputTarget || undefined,
    };

    // Clean undefined fields
    for (const key of Object.keys(doc)) {
      if (doc[key] === undefined) {
        delete doc[key];
      }
    }

    try {
      const jsonContent = `${JSON.stringify(doc, null, 2)}\n`;
      const tmpPath = `${targetPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, jsonContent, "utf8");
      fs.renameSync(tmpPath, targetPath);
      exported++;
    } catch (err) {
      errors.push(`Failed to write ${targetPath}: ${String(err)}`);
    }
  }

  return { exported, errors };
}

/**
 * Imports specialists from disk JSON files and merges them into the specialists array.
 */
export function importSpecialistsFromDisk(
  existingSpecialists: HarnessSpecialistConfig[],
  profilesDir = "~/.agents/profiles",
): { specialists: HarnessSpecialistConfig[]; importedCount: number } {
  const diskEntries = scanDiskProfiles(profilesDir);
  let importedCount = 0;
  const specialistMap = new Map<string, HarnessSpecialistConfig>();

  for (const s of existingSpecialists) {
    specialistMap.set(s.id, { ...s });
  }

  for (const entry of diskEntries) {
    if (!entry.content) continue;
    const raw = entry.content;
    const id =
      (typeof raw.name === "string" && raw.name.trim()) || path.basename(entry.filename, ".json");
    const existing = specialistMap.get(id);

    const primarySkills = Array.isArray(raw.primary_skills)
      ? raw.primary_skills.filter((x): x is string => typeof x === "string")
      : (existing?.primarySkills ?? []);

    const allowedMcp = Array.isArray(raw.mcp_servers)
      ? raw.mcp_servers.filter((x): x is string => typeof x === "string")
      : (existing?.allowedMcpServers ?? []);

    const excludedMcp = Array.isArray(raw.excluded_mcp_servers)
      ? raw.excluded_mcp_servers.filter((x): x is string => typeof x === "string")
      : (existing?.excludedMcpServers ?? []);

    const docsFocus = Array.isArray(raw.docs_focus)
      ? raw.docs_focus.filter((x): x is string => typeof x === "string")
      : (existing?.docsFocus ?? []);

    const qualityGates = Array.isArray(raw.quality_gates)
      ? raw.quality_gates.filter((x): x is string => typeof x === "string")
      : (existing?.qualityGates ?? []);

    const updated: HarnessSpecialistConfig = {
      id,
      name:
        existing?.name ?? (typeof raw.description === "string" ? raw.description.slice(0, 30) : id),
      shortLabel: existing?.shortLabel ?? id.toUpperCase().slice(0, 8),
      description:
        typeof raw.description === "string" ? raw.description : (existing?.description ?? ""),
      icon: existing?.icon ?? "Bot",
      color: existing?.color ?? "slate",
      enabled: true,
      builtIn: existing?.builtIn ?? false,
      preferredProvider:
        typeof raw.preferred_provider === "string"
          ? raw.preferred_provider
          : (existing?.preferredProvider ?? ""),
      preferredTier:
        typeof raw.default_model === "string"
          ? raw.default_model
          : (existing?.preferredTier ?? "flash"),
      modelOverride: existing?.modelOverride ?? "",
      defaultModeId: existing?.defaultModeId ?? "",
      thinkingOptionId: existing?.thinkingOptionId ?? "",
      lockTierOnLabel: existing?.lockTierOnLabel ?? false,
      handoffEnabled: existing?.handoffEnabled ?? true,
      handoffPriority: existing?.handoffPriority ?? 50,
      handoffTitlePrefix: existing?.handoffTitlePrefix ?? `[${id.toUpperCase()}]`,
      handoffDefaultPrompt: existing?.handoffDefaultPrompt ?? `Execute task as ${id}.`,
      syncToDaemonProfile: existing?.syncToDaemonProfile ?? true,
      primarySkills,
      mandatorySkillActivation: existing?.mandatorySkillActivation ?? true,
      skillsRoot:
        typeof raw.skills_root === "string" ? raw.skills_root : (existing?.skillsRoot ?? ""),
      docsFocus,
      qualityGates,
      ssotOutputTarget:
        typeof raw.ssot_output_target === "string"
          ? raw.ssot_output_target
          : (existing?.ssotOutputTarget ?? ""),
      rolePromptTemplate: existing?.rolePromptTemplate ?? "",
      lazyToolSlice: existing?.lazyToolSlice ?? `${id}.yaml`,
      allowedMcpServers: allowedMcp,
      excludedMcpServers: excludedMcp,
      injectedMcpServers: existing?.injectedMcpServers ?? [],
      extraEnv: existing?.extraEnv ?? {},
      aliases: existing?.aliases ?? [],
      matchPatterns: existing?.matchPatterns ?? [],
      profileFilename: entry.filename,
    };

    specialistMap.set(id, updated);
    importedCount++;
  }

  return {
    specialists: Array.from(specialistMap.values()),
    importedCount,
  };
}

// In-memory cache for repo overrides: repoRoot -> { mtime, override }
const repoOverrideCache = new Map<
  string,
  { mtime: number; override: RepoHarnessOverride | null }
>();

/**
 * Loads `<repoRoot>/.paseo/agent-harness.json` with mtime caching.
 */
export function loadRepoHarnessOverride(
  repoRoot?: string | null,
  relativeConfigPath = ".paseo/agent-harness.json",
): RepoHarnessOverride | null {
  if (!repoRoot || !repoRoot.trim()) {
    return null;
  }
  const fullPath = path.resolve(repoRoot, relativeConfigPath);
  try {
    if (!fs.existsSync(fullPath)) {
      repoOverrideCache.delete(fullPath);
      return null;
    }
    const stat = fs.statSync(fullPath);
    const cached = repoOverrideCache.get(fullPath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.override;
    }

    const raw = fs.readFileSync(fullPath, "utf8");
    const parsed = JSON.parse(raw) as RepoHarnessOverride;
    repoOverrideCache.set(fullPath, { mtime: stat.mtimeMs, override: parsed });
    return parsed;
  } catch {
    return null;
  }
}

const MANAGED_PROFILE_PREFIX = "harness-";

/**
 * Synchronizes enabled specialists to Paseo daemon's native agentProfiles.
 * Only updates or removes profiles managed by agent-harness (prefixed with harness-),
 * preserving user-defined profiles completely.
 */
export async function syncDaemonAgentProfiles(
  paseo: PaseoApi,
  specialists: HarnessSpecialistConfig[],
): Promise<{ syncedCount: number; errors: string[] }> {
  if (!paseo.config?.get || !paseo.config?.patch) {
    return { syncedCount: 0, errors: ["Paseo config API not available"] };
  }

  try {
    const configResp = await paseo.config.get();
    const existingProfiles = (configResp?.config?.agentProfiles ?? []) as Array<
      Record<string, unknown>
    >;

    // Keep all non-harness-managed profiles
    const preservedProfiles = existingProfiles.filter((p) => {
      const id = typeof p.id === "string" ? p.id : "";
      return !id.startsWith(MANAGED_PROFILE_PREFIX);
    });

    const harnessProfiles: Array<Record<string, unknown>> = [];
    let syncedCount = 0;

    for (const s of specialists) {
      if (!s.enabled || !s.syncToDaemonProfile) {
        continue;
      }

      harnessProfiles.push({
        id: `${MANAGED_PROFILE_PREFIX}${s.id}`,
        name: s.name,
        icon: s.icon.toLowerCase(),
        color: s.color || "slate",
        provider: s.preferredProvider || "claude",
        model: s.preferredTier || "flash",
        ...(s.defaultModeId ? { modeId: s.defaultModeId } : {}),
        ...(s.thinkingOptionId ? { thinkingOptionId: s.thinkingOptionId } : {}),
        notes: `role: ${s.id} | managed by agent-harness | ${s.description}`,
        harnessManaged: true,
      });
      syncedCount++;
    }

    const nextProfiles = [...preservedProfiles, ...harnessProfiles];
    await paseo.config.patch({ agentProfiles: nextProfiles as any });

    return { syncedCount, errors: [] };
  } catch (err) {
    return { syncedCount: 0, errors: [String(err)] };
  }
}
