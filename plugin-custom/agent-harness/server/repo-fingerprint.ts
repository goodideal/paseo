import fs from "node:fs";
import path from "node:path";

export interface RepoFingerprint {
  cwd: string;
  hasFrontend: boolean;
  hasBackendOnlyStack: boolean;
  tags: string[];
}

const FINGERPRINT_CACHE_TTL_MS = 5 * 60_000;

const fingerprintCache = new Map<string, { expiresAt: number; value: RepoFingerprint }>();

const FRONTEND_EXACT_MARKERS = ["app.json", "components.json"] as const;
const FRONTEND_PREFIX_MARKERS = [
  "vite.config.",
  "next.config.",
  "nuxt.config.",
  "tailwind.config.",
] as const;

const FRONTEND_PACKAGE_DEPS = new Set([
  "react",
  "react-native",
  "expo",
  "vue",
  "svelte",
  "@getpaseo/plugin",
  "unistyles",
  "react-native-unistyles",
  "tailwindcss",
]);

const FRONTEND_WORKSPACE_DIRS = ["frontend", "web", "client"] as const;
const MONOREPO_CONTAINER_DIRS = ["apps", "packages"] as const;

function inspectDirectoryFrontendMarkers(
  dirPath: string,
  tags: Set<string>,
): { hasFrontend: boolean; hasPackageJson: boolean } {
  let hasFrontend = false;
  let hasPackageJson = false;
  try {
    const entries = fs.readdirSync(dirPath);
    const entrySet = new Set(entries);

    for (const marker of FRONTEND_EXACT_MARKERS) {
      if (entrySet.has(marker)) {
        hasFrontend = true;
        tags.add("frontend");
      }
    }

    for (const entry of entries) {
      for (const prefix of FRONTEND_PREFIX_MARKERS) {
        if (entry.startsWith(prefix)) {
          hasFrontend = true;
          tags.add("frontend");
          if (prefix.startsWith("vite")) tags.add("vite");
          if (prefix.startsWith("next")) tags.add("nextjs");
          if (prefix.startsWith("nuxt")) tags.add("nuxt");
          if (prefix.startsWith("tailwind")) tags.add("tailwind");
        }
      }
    }

    if (entrySet.has("package.json")) {
      hasPackageJson = true;
      try {
        const pkgRaw = fs.readFileSync(path.join(dirPath, "package.json"), "utf8");
        const pkg = JSON.parse(pkgRaw) as {
          dependencies?: Record<string, unknown>;
          devDependencies?: Record<string, unknown>;
          peerDependencies?: Record<string, unknown>;
        };
        const depNames = new Set([
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
          ...Object.keys(pkg.peerDependencies ?? {}),
        ]);
        for (const dep of FRONTEND_PACKAGE_DEPS) {
          if (depNames.has(dep)) {
            hasFrontend = true;
            tags.add("frontend");
            tags.add(dep);
          }
        }
      } catch {
        // Ignore malformed package.json
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return { hasFrontend, hasPackageJson };
}

/** Clears the cached repository stack fingerprints (used in tests and on repo updates). */
export function clearRepoFingerprintCache(): void {
  fingerprintCache.clear();
}

/**
 * Inspects root repository and shallow monorepo package markers to classify
 * frontend vs backend-only stacks, memoized for 5 minutes keyed by directory.
 */
export function detectRepoFingerprint(cwd?: string | null): RepoFingerprint {
  const trimmed = cwd?.trim();
  if (!trimmed) {
    return {
      cwd: "",
      hasFrontend: false,
      hasBackendOnlyStack: false,
      tags: [],
    };
  }

  const resolvedCwd = path.resolve(trimmed);
  const now = Date.now();
  const cached = fingerprintCache.get(resolvedCwd);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let value: RepoFingerprint = {
    cwd: resolvedCwd,
    hasFrontend: false,
    hasBackendOnlyStack: false,
    tags: [],
  };

  try {
    if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
      fingerprintCache.set(resolvedCwd, { expiresAt: now + FINGERPRINT_CACHE_TTL_MS, value });
      return value;
    }

    const entries = new Set(fs.readdirSync(resolvedCwd));
    const tags = new Set<string>();
    const rootScan = inspectDirectoryFrontendMarkers(resolvedCwd, tags);
    let hasFrontend = rootScan.hasFrontend;

    if (fs.existsSync(path.join(resolvedCwd, "packages", "app"))) {
      hasFrontend = true;
      tags.add("frontend");
      tags.add("monorepo");
    }

    for (const dirName of FRONTEND_WORKSPACE_DIRS) {
      if (entries.has(dirName)) {
        const subPath = path.join(resolvedCwd, dirName);
        if (fs.statSync(subPath).isDirectory()) {
          const scan = inspectDirectoryFrontendMarkers(subPath, tags);
          if (scan.hasFrontend) {
            hasFrontend = true;
          }
        }
      }
    }

    for (const container of MONOREPO_CONTAINER_DIRS) {
      if (!entries.has(container)) continue;
      const containerPath = path.join(resolvedCwd, container);
      try {
        if (!fs.statSync(containerPath).isDirectory()) continue;
        for (const child of fs.readdirSync(containerPath, { withFileTypes: true })) {
          if (!child.isDirectory()) continue;
          const scan = inspectDirectoryFrontendMarkers(path.join(containerPath, child.name), tags);
          if (scan.hasFrontend) {
            hasFrontend = true;
            tags.add("monorepo");
          }
        }
      } catch {
        // Ignore unreadable monorepo container directories
      }
    }

    if (rootScan.hasPackageJson && !hasFrontend) {
      tags.add("node");
    }

    const hasJvm =
      entries.has("pom.xml") || entries.has("build.gradle") || entries.has("build.gradle.kts");
    const hasGo = entries.has("go.mod");
    const hasRust = entries.has("Cargo.toml");
    const hasPython = entries.has("pyproject.toml") || entries.has("requirements.txt");

    if (hasJvm) tags.add("jvm");
    if (hasGo) tags.add("go");
    if (hasRust) tags.add("rust");
    if (hasPython) tags.add("python");

    const hasBackendOnlyStack = !hasFrontend && (hasJvm || hasGo || hasRust || hasPython);

    value = {
      cwd: resolvedCwd,
      hasFrontend,
      hasBackendOnlyStack,
      tags: Array.from(tags),
    };
  } catch {
    // Keep neutral fingerprint when directory is unreadable
  }

  fingerprintCache.set(resolvedCwd, { expiresAt: now + FINGERPRINT_CACHE_TTL_MS, value });
  return value;
}
