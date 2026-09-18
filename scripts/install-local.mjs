import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    stdio: "inherit",
    cwd: repoRoot,
    ...options,
  });
}

console.log("=== [1/3] Building Paseo Server & Web UI ===");
run("npm", ["run", "build:server"]);
run("node", ["scripts/build-daemon-web-ui.mjs"], {
  env: {
    ...process.env,
    EXPO_NO_TELEMETRY: "1",
  },
});

console.log("\n=== [2/3] Building Paseo Desktop Client ===");
run("npm", ["run", "build:main", "--workspace=@getpaseo/desktop"]);

console.log("\n=== [3/3] Installing to Local Global Environment ===");

const targets = [];

// 1. Check Volta package location
const voltaCliDir = path.join(
  os.homedir(),
  ".volta",
  "tools",
  "image",
  "packages",
  "@getpaseo",
  "cli",
);
if (existsSync(voltaCliDir)) {
  targets.push({
    name: "Volta global install",
    cliDir: path.join(voltaCliDir, "lib", "node_modules", "@getpaseo", "cli"),
    modulesDir: path.join(
      voltaCliDir,
      "lib",
      "node_modules",
      "@getpaseo",
      "cli",
      "node_modules",
      "@getpaseo",
    ),
  });
}

// 2. Check npm global root
try {
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const npmCliDir = path.join(npmRoot, "@getpaseo", "cli");
  if (existsSync(npmCliDir) && !targets.some((t) => t.cliDir === npmCliDir)) {
    targets.push({
      name: "npm global install",
      cliDir: npmCliDir,
      modulesDir: path.join(npmCliDir, "node_modules", "@getpaseo"),
    });
  }
} catch {
  // ignore
}

if (targets.length === 0) {
  console.warn("⚠️ No global @getpaseo/cli installation detected (neither Volta nor npm global).");
  console.warn("To install globally first, run: npm install -g @getpaseo/cli");
} else {
  const subpackages = ["server", "client", "protocol", "highlight", "plugin", "relay"];

  for (const target of targets) {
    console.log(`Installing to ${target.name} at: ${target.cliDir}`);

    // Copy CLI files
    const cliSrc = path.join(repoRoot, "packages", "cli");
    cpSync(path.join(cliSrc, "dist"), path.join(target.cliDir, "dist"), { recursive: true });
    cpSync(path.join(cliSrc, "bin"), path.join(target.cliDir, "bin"), { recursive: true });
    cpSync(path.join(cliSrc, "package.json"), path.join(target.cliDir, "package.json"));

    // Copy subpackages
    for (const pkg of subpackages) {
      const pkgSrc = path.join(repoRoot, "packages", pkg);
      const pkgTarget = path.join(target.modulesDir, pkg);
      if (existsSync(pkgTarget)) {
        console.log(`  - Updating @getpaseo/${pkg}`);
        rmSync(path.join(pkgTarget, "dist"), { recursive: true, force: true });
        cpSync(path.join(pkgSrc, "dist"), path.join(pkgTarget, "dist"), { recursive: true });
        cpSync(path.join(pkgSrc, "package.json"), path.join(pkgTarget, "package.json"));
      }
    }
  }
}

console.log("\n=======================================================");
console.log("✅ Build and local installation completed successfully!");
console.log("=======================================================");
console.log("👉 请在你的终端执行重启服务以应用最新更改：");
console.log("   paseo restart");
console.log("=======================================================\n");
