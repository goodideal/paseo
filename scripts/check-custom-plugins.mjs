import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customPluginsRoot = path.join(repoRoot, "plugin-custom");
const RELEVANT_EXT_RE = /\.(?:ts|tsx|cts|mts|json)$/i;

function discoverPluginsWithTsconfig() {
  if (!existsSync(customPluginsRoot)) {
    return [];
  }
  return readdirSync(customPluginsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(customPluginsRoot, entry.name, "tsconfig.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

function parseCliArgs(argv) {
  let checkAll = false;
  let showHelp = false;
  const explicitPlugins = [];
  const positionalFiles = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      checkAll = true;
    } else if (arg === "-h" || arg === "--help") {
      showHelp = true;
    } else if (arg === "--plugin") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) {
        throw new Error("Missing plugin name after --plugin");
      }
      explicitPlugins.push(next);
    } else if (arg.startsWith("--plugin=")) {
      const value = arg.slice("--plugin=".length).trim();
      if (!value) {
        throw new Error("Empty plugin name in --plugin=");
      }
      explicitPlugins.push(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionalFiles.push(arg);
    }
  }

  return { checkAll, showHelp, explicitPlugins, positionalFiles };
}

function mapFilesToPlugins(files, availablePlugins) {
  const availableSet = new Set(availablePlugins);
  const selected = new Set();

  for (const rawFile of files) {
    const absPath = path.resolve(process.cwd(), rawFile);
    const relPath = path.relative(repoRoot, absPath).replaceAll("\\", "/");
    const match = /^plugin-custom\/([^/]+)\/.+$/.exec(relPath);
    if (!match) {
      continue;
    }
    const pluginName = match[1];
    if (!availableSet.has(pluginName) || !RELEVANT_EXT_RE.test(relPath)) {
      continue;
    }
    selected.add(pluginName);
  }

  return Array.from(selected).sort();
}

function resolveTypecheckerCommand() {
  const localTsgo = path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsgo.cmd" : "tsgo",
  );
  if (existsSync(localTsgo)) {
    return { bin: localTsgo, prefixArgs: [], label: "tsgo" };
  }
  return { bin: "npx", prefixArgs: ["--no-install", "tsgo"], label: "npx tsgo" };
}

function runPluginTypecheck(pluginName, checker) {
  const tsconfigRel = `plugin-custom/${pluginName}/tsconfig.json`;
  console.log(
    `[typecheck:custom-plugins] Checking ${pluginName} (${checker.label} -p ${tsconfigRel} --noEmit)`,
  );
  const result = spawnSync(checker.bin, [...checker.prefixArgs, "-p", tsconfigRel, "--noEmit"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32" && checker.bin === "npx",
  });
  if (result.error) {
    console.error(
      `[typecheck:custom-plugins] Failed to invoke ${checker.label}: ${result.error.message}`,
    );
    return false;
  }
  return result.status === 0;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/check-custom-plugins.mjs [options] [files...]",
      "",
      "Options:",
      "  --all             Typecheck every plugin-custom/* directory containing tsconfig.json",
      "  --plugin <name>   Typecheck a specific custom plugin (repeatable)",
      "  -h, --help        Show this help message",
      "",
      "When positional file paths are supplied (e.g. from lefthook {staged_files}),",
      "only matching plugin-custom/<plugin>/**/*.{ts,tsx,cts,mts,json} projects are checked.",
    ].join("\n"),
  );
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.showHelp) {
    printHelp();
    return;
  }

  const availablePlugins = discoverPluginsWithTsconfig();
  if (availablePlugins.length === 0) {
    console.log("[typecheck:custom-plugins] No custom plugins with tsconfig.json found.");
    return;
  }

  let targets;
  if (args.checkAll) {
    targets = availablePlugins;
  } else if (args.explicitPlugins.length > 0) {
    const availableSet = new Set(availablePlugins);
    const deduped = [];
    for (const pluginName of args.explicitPlugins) {
      if (!availableSet.has(pluginName)) {
        throw new Error(
          `Unknown custom plugin "${pluginName}" (expected tsconfig.json under plugin-custom/${pluginName}/). Available: ${availablePlugins.join(", ")}`,
        );
      }
      if (!deduped.includes(pluginName)) {
        deduped.push(pluginName);
      }
    }
    targets = deduped;
  } else if (args.positionalFiles.length > 0) {
    targets = mapFilesToPlugins(args.positionalFiles, availablePlugins);
    if (targets.length === 0) {
      console.log(
        "[typecheck:custom-plugins] No matching custom plugin TypeScript/JSON files staged.",
      );
      return;
    }
  } else {
    targets = availablePlugins;
  }

  const checker = resolveTypecheckerCommand();
  const failed = [];
  for (const pluginName of targets) {
    const ok = runPluginTypecheck(pluginName, checker);
    if (!ok) {
      failed.push(pluginName);
    }
  }

  if (failed.length > 0) {
    console.error(`[typecheck:custom-plugins] Failed plugins: ${failed.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[typecheck:custom-plugins] Passed (${targets.length} plugin(s) checked).`);
}

try {
  main();
} catch (error) {
  console.error(
    `[typecheck:custom-plugins] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
