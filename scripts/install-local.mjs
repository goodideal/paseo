import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    stdio: "inherit",
    cwd: repoRoot,
    ...options,
  });
}

function runCapture(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      cwd: repoRoot,
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

function printHelp() {
  console.log(`
Paseo Local Maintenance & Installer (paseo-maintenance / install-local)
=======================================================================

Usage:
  node scripts/install-local.mjs [options]
  npm run install:local [-- options]
  npm run maintenance [-- options]

Options:
  --status            显示当前本地分支、上游同步状态、全局安装位置与守护进程状态
  --check-upstream    检查官方 (upstream) 最新更新与版本差异，不执行合并或构建
  --sync-upstream     一键同步官方更新 (fetch + merge/rebase + 保持 -custom 后缀 + 构建安装)
  --sync              --sync-upstream 的别名
  --rebase            与 --sync-upstream 配合使用，使用 rebase 替代默认的 merge
  --stash             与 --sync-upstream 配合使用，如果有未提交的更改则自动 stash 并恢复
  --verify            运行核心质量门禁验证 (typecheck:server 与 5 个核心定制特性单测回归)
  --skip-ui           跳过 Web UI 编译打包 (仅构建服务端和桌面端，大幅提升快速调试效率)
  --skip-desktop      跳过 Electron 桌面端主进程编译
  --build-only        仅执行本地编译，不拷贝同步到全局安装目录 (Volta / npm global)
  --no-build          仅执行上游同步与依赖安装，不执行编译
  -h, --help          显示此帮助信息

Examples:
  npm run install:local                     # 一键全量编译并部署到本机
  npm run install:local -- --skip-ui        # 快速更新 CLI 和后端，跳过 Web UI 打包
  npm run install:local -- --status         # 查看当前代码与上游、全局运行环境状态
  npm run install:local -- --check-upstream # 仅检查官方是否有新版本发布
  npm run install:local -- --sync-upstream  # 拉取官方最新更新并重新编译安装到本机
  npm run install:local -- --verify         # 执行本地定制核心单测与类型检查验证
`);
}

const args = new Set(process.argv.slice(2));

if (args.has("-h") || args.has("--help")) {
  printHelp();
  process.exit(0);
}

const isStatusOnly = args.has("--status");
const isCheckUpstreamOnly = args.has("--check-upstream");
const shouldSyncUpstream = args.has("--sync-upstream") || args.has("--sync");
const useRebase = args.has("--rebase");
const autoStash = args.has("--stash");
const shouldVerify = args.has("--verify") || args.has("--test");
const skipUi = args.has("--skip-ui");
const skipDesktop = args.has("--skip-desktop");
const buildOnly = args.has("--build-only");
const noBuild = args.has("--no-build");

function ensureUpstreamRemote() {
  const remotes = runCapture("git", ["remote", "-v"]) ?? "";
  if (!remotes.includes("upstream")) {
    console.log("ℹ️ Configuring upstream remote -> https://github.com/getpaseo/paseo.git");
    run("git", ["remote", "add", "upstream", "https://github.com/getpaseo/paseo.git"]);
  }
}

function getGlobalInstallTargets() {
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
    const pkgJsonPath = path.join(
      voltaCliDir,
      "lib",
      "node_modules",
      "@getpaseo",
      "cli",
      "package.json",
    );
    let version = "unknown";
    try {
      version = JSON.parse(readFileSync(pkgJsonPath, "utf8")).version;
    } catch {
      // ignore
    }

    targets.push({
      type: "volta",
      name: "Volta global install",
      version,
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
      const pkgJsonPath = path.join(npmCliDir, "package.json");
      let version = "unknown";
      try {
        version = JSON.parse(readFileSync(pkgJsonPath, "utf8")).version;
      } catch {
        // ignore
      }

      targets.push({
        type: "npm",
        name: "npm global install",
        version,
        cliDir: npmCliDir,
        modulesDir: path.join(npmCliDir, "node_modules", "@getpaseo"),
      });
    }
  } catch {
    // ignore
  }

  return targets;
}

function showStatus() {
  console.log("=======================================================");
  console.log("🔍 Paseo 本地运行与环境状态报告 (Paseo Status)");
  console.log("=======================================================");

  // 1. Git status
  const currentBranch = runCapture("git", ["branch", "--show-current"]) || "HEAD";
  const currentCommit = runCapture("git", ["log", "-1", "--format=%h (%s, %cr)"]) || "unknown";
  console.log(`📌 当前 Git 分支:   ${currentBranch}`);
  console.log(`📌 当前 Git 提交:   ${currentCommit}`);

  ensureUpstreamRemote();
  const aheadBehind = runCapture("git", [
    "rev-list",
    "--left-right",
    "--count",
    "upstream/main...HEAD",
  ]);
  if (aheadBehind) {
    const [behind, ahead] = aheadBehind.split(/\s+/).map((n) => parseInt(n, 10));
    console.log(`📌 上游同步情况:   领先 upstream/main ${ahead} 个提交, 落后 ${behind} 个提交`);
  }

  // 2. Version
  const localPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  console.log(`📌 本地仓库版本:   ${localPkg.version}`);

  // 3. Global Install targets
  const targets = getGlobalInstallTargets();
  console.log(`\n📦 全局安装目录与版本:`);
  if (targets.length === 0) {
    console.log("   ⚠️ 未检测到全局安装的 @getpaseo/cli (Volta 或 npm -g)");
  } else {
    for (const t of targets) {
      console.log(`   - [${t.name}] 版本: ${t.version}`);
      console.log(`     路径: ${t.cliDir}`);
    }
  }

  // 4. Daemon status
  console.log(`\n⚡ 守护进程 (Daemon) 状态:`);
  const pidFile = path.join(os.homedir(), ".paseo", "paseo.pid");
  if (existsSync(pidFile)) {
    try {
      const pidInfo = JSON.parse(readFileSync(pidFile, "utf8"));
      console.log(
        `   - 配置文件记录 PID: ${pidInfo.pid}, 监听: ${pidInfo.listen}, 启动于: ${pidInfo.startedAt}`,
      );
    } catch {
      console.log(`   - 配置文件存在但无法读取: ${pidFile}`);
    }
  } else {
    console.log(`   - 未找到 ~/.paseo/paseo.pid 文件`);
  }

  const lsofOutput = runCapture("lsof", ["-i", ":6767"]);
  if (lsofOutput && lsofOutput.includes("LISTEN")) {
    console.log(`   - 6767 端口监听正常 (正在运行)`);
  } else {
    console.log(`   - 6767 端口未在监听`);
  }

  console.log("=======================================================\n");
}

function checkUpstream() {
  ensureUpstreamRemote();
  console.log("🔄 正在从官方上游仓库获取最新代码信息 (git fetch upstream)...");
  try {
    run("git", ["fetch", "upstream"]);
  } catch {
    console.warn("⚠️ 获取上游更新失败，可能需要提升权限或检查网络连接。");
  }

  const upstreamCommit = runCapture("git", ["log", "-1", "upstream/main", "--format=%h (%s, %cr)"]);
  console.log(`🌐 官方 upstream/main 最新提交: ${upstreamCommit}`);

  const aheadBehind = runCapture("git", [
    "rev-list",
    "--left-right",
    "--count",
    "upstream/main...HEAD",
  ]);
  let behindCount = 0;
  let aheadCount = 0;
  if (aheadBehind) {
    const parts = aheadBehind.split(/\s+/).map((n) => parseInt(n, 10));
    behindCount = parts[0] || 0;
    aheadCount = parts[1] || 0;
  }

  let upstreamVersion = "unknown";
  try {
    const upstreamPkgStr = runCapture("git", ["show", "upstream/main:package.json"]);
    if (upstreamPkgStr) {
      upstreamVersion = JSON.parse(upstreamPkgStr).version;
    }
  } catch {
    // ignore
  }

  const localPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

  console.log("\n-------------------------------------------------------");
  console.log(`📊 官方版本对比: 官方版本 ${upstreamVersion}  vs  本地版本 ${localPkg.version}`);
  console.log(`📊 提交差距: 本地领先 ${aheadCount} 个提交, 落后官方 ${behindCount} 个提交`);
  console.log("-------------------------------------------------------");

  if (behindCount > 0) {
    console.log(`\n📢 官方上游有 ${behindCount} 个新提交：`);
    const newCommits = runCapture("git", ["log", "--oneline", `HEAD..upstream/main`, "-n", "10"]);
    console.log(newCommits);
    console.log("\n👉 若要同步合并官方更新，请执行：");
    console.log("   npm run install:local -- --sync-upstream");
  } else {
    console.log("\n✅ 本地代码已包含官方 upstream/main 的所有最新提交，已处于最新状态。");
  }
}

function syncUpstream() {
  ensureUpstreamRemote();
  console.log("=== [1/4] 同步官方上游更新 (Upstream Sync) ===");
  run("git", ["fetch", "upstream"]);

  const aheadBehind = runCapture("git", [
    "rev-list",
    "--left-right",
    "--count",
    "upstream/main...HEAD",
  ]);
  let behindCount = 0;
  if (aheadBehind) {
    behindCount = parseInt(aheadBehind.split(/\s+/)[0], 10) || 0;
  }

  if (behindCount === 0) {
    console.log("✅ 本地已是最新的上游代码，无需合并。");
  } else {
    console.log(`🔄 正在将官方 ${behindCount} 个新提交整合到当前分支...`);

    const dirty = runCapture("git", ["status", "--porcelain"]);
    let stashed = false;
    if (dirty && dirty.length > 0) {
      if (autoStash) {
        console.log("📦 工作区存在未提交更改，自动执行 git stash...");
        run("git", ["stash", "push", "-m", "install-local-auto-stash"]);
        stashed = true;
      } else {
        console.error("❌ 工作区存在未提交的更改，请先提交或传入 --stash 参数。");
        process.exit(1);
      }
    }

    try {
      if (useRebase) {
        console.log("> git rebase upstream/main");
        run("git", ["rebase", "upstream/main"]);
      } else {
        console.log('> git merge upstream/main -m "merge: sync official upstream updates"');
        run("git", ["merge", "upstream/main", "-m", "merge: sync official upstream updates"]);
      }
    } catch {
      console.error("\n❌ 合并/变基官方更新时发生冲突，请手动解决冲突后再继续执行 install:local。");
      console.error("\n💡 批量解决 package.json 版本冲突技巧：");
      console.error(
        '   1. 在根目录 package.json 中仅将 version 冲突修改为最新上游版本加上 -custom（如 "0.9.0-beta.x-custom"）并保存',
      );
      console.error(
        "   2. 对所有子包 package.json 使用 ours 丢弃冲突标记：git checkout --ours packages/*/package.json",
      );
      console.error("   3. 运行版本同步脚本秒级重写：node scripts/sync-workspace-versions.mjs");
      console.error("   4. 标记解决：git add package.json packages/*/package.json");
      console.error(
        useRebase
          ? "   5. 解决业务代码冲突后执行: git rebase --continue"
          : "   5. 解决业务代码冲突后执行: git commit",
      );
      process.exit(1);
    } finally {
      if (stashed) {
        console.log("📦 恢复暂存的本地修改 (git stash pop)...");
        try {
          run("git", ["stash", "pop"]);
        } catch {
          console.warn("⚠️ 恢复暂存修改时可能需要手动处理冲突。");
        }
      }
    }

    // Ensure custom version suffix is preserved
    console.log("🏷️ 校验并维护自定义版本标识 (-custom)...");
    try {
      const rootPkgPath = path.join(repoRoot, "package.json");
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
      if (!rootPkg.version.endsWith("-custom")) {
        rootPkg.version = `${rootPkg.version}-custom`;
        writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
        console.log(`   -> 更新根版本号为: ${rootPkg.version}`);
      }
      run("node", ["scripts/sync-workspace-versions.mjs"]);
    } catch (err) {
      console.warn("⚠️ 同步子包版本号时出现提示:", err.message);
    }

    console.log("📦 刷新安装依赖 (npm install)...");
    run("npm", ["install"]);
  }
}

function verifyQuality() {
  console.log("\n=== [Verify] 运行质量门禁与核心定制特性单测回归 ===");
  console.log("🔍 运行服务端类型检查 (npm run typecheck:server)...");
  run("npm", ["run", "typecheck:server"]);

  console.log("🧪 运行 5 个核心定制特性单测回归 (vitest)...");
  const coreTests = [
    "packages/app/src/hooks/use-settings/storage.test.ts",
    "packages/server/src/server/session/voice/voice-session.test.ts",
    "packages/app/native-release-version.test.ts",
    "packages/app/src/desktop/updates/desktop-updates.test.ts",
    "packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts",
  ];
  run("npx", ["vitest", "run", ...coreTests, "--bail=1"]);
  console.log("✅ 质量门禁与核心回归测试全部通过！\n");
}

// -------------------------------------------------------------
// Main execution flow
// -------------------------------------------------------------

if (isStatusOnly) {
  showStatus();
  process.exit(0);
}

if (isCheckUpstreamOnly) {
  checkUpstream();
  process.exit(0);
}

if (shouldVerify && noBuild) {
  verifyQuality();
  process.exit(0);
}

if (shouldSyncUpstream) {
  syncUpstream();
  if (noBuild) {
    if (shouldVerify) {
      verifyQuality();
    }
    console.log("\n✅ 官方更新同步完成 (--no-build，跳过构建)。");
    process.exit(0);
  }
}

// Build Step
console.log("\n=== [Build] Building Paseo Server & Components ===");
run("npm", ["run", "build:server"]);

if (!skipUi) {
  console.log("\n=== [Build] Building Daemon Web UI ===");
  run("node", ["scripts/build-daemon-web-ui.mjs"], {
    env: {
      ...process.env,
      EXPO_NO_TELEMETRY: "1",
    },
  });
} else {
  console.log("⏩ 已跳过 Web UI 构建 (--skip-ui)");
}

if (!skipDesktop) {
  console.log("\n=== [Build] Building Paseo Desktop Client ===");
  run("npm", ["run", "build:main", "--workspace=@getpaseo/desktop"]);
} else {
  console.log("⏩ 已跳过 Desktop 构建 (--skip-desktop)");
}

if (shouldVerify) {
  verifyQuality();
}

function copySubpackageToTarget(target, pkg) {
  const pkgTarget = path.join(target.modulesDir, pkg);
  if (!existsSync(pkgTarget)) {
    return;
  }
  const pkgSrc = path.join(repoRoot, "packages", pkg);
  console.log(`  - 更新 @getpaseo/${pkg}`);
  rmSync(path.join(pkgTarget, "dist"), { recursive: true, force: true });
  cpSync(path.join(pkgSrc, "dist"), path.join(pkgTarget, "dist"), { recursive: true });
  cpSync(path.join(pkgSrc, "package.json"), path.join(pkgTarget, "package.json"));
}

// Local Install Step
if (!buildOnly) {
  console.log("\n=== [Install] Installing to Local Global Environment ===");
  const targets = getGlobalInstallTargets();

  if (targets.length === 0) {
    console.warn("⚠️ 未检测到全局 @getpaseo/cli 安装目录 (Volta 或 npm 全局)。");
    console.warn("若要在本机全局使用，请先执行: npm install -g @getpaseo/cli");
  } else {
    const subpackages = ["server", "client", "protocol", "highlight", "plugin", "relay"];

    for (const target of targets) {
      console.log(`正在安装到 ${target.name}: ${target.cliDir}`);

      // Copy CLI files
      const cliSrc = path.join(repoRoot, "packages", "cli");
      cpSync(path.join(cliSrc, "dist"), path.join(target.cliDir, "dist"), { recursive: true });
      cpSync(path.join(cliSrc, "bin"), path.join(target.cliDir, "bin"), { recursive: true });
      cpSync(path.join(cliSrc, "package.json"), path.join(target.cliDir, "package.json"));

      // Copy subpackages
      for (const pkg of subpackages) {
        copySubpackageToTarget(target, pkg);
      }
    }
  }
} else {
  console.log("⏩ 已跳过全局安装拷贝 (--build-only)");
}

console.log("\n=======================================================");
console.log("✅ Paseo 本地编译与安装全部就绪！");
console.log("=======================================================");
console.log("⚠️  重要提示 (Critical Safety Notice):");
console.log("   切勿让 AI Agent 自动 kill 或重启 6767 端口的守护进程！");
console.log("👉 请在你的宿主终端手动执行以下命令重启守护进程以生效：");
console.log("   paseo restart");
console.log("=======================================================\n");
