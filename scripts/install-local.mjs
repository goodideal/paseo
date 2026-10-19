import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

function getModTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `d${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function formatModDisplayVersion(version) {
  if (!version) return "unknown";
  const val = String(version).trim();
  const bracketMatch = val.match(
    /^(?:v)?(\d+\.\d+\.\d+(?:-beta\.\d+)?)\s*\[(?:mod-|m)?([^\]]+)\]$/i,
  );
  if (bracketMatch) {
    return `v${bracketMatch[1]} [mod-${bracketMatch[2]}]`;
  }
  const customTimestampMatch = val.match(
    /^(?:v)?(\d+\.\d+\.\d+(?:-beta\.\d+)?)-custom(?:(?:\.|-))(?:mod-|d)?(\d{6}|\w+)$/i,
  );
  if (customTimestampMatch) {
    return `v${customTimestampMatch[1]} [mod-${customTimestampMatch[2]}]`;
  }
  const plainCustomMatch = val.match(/^(?:v)?(\d+\.\d+\.\d+(?:-beta\.\d+)?)-custom$/i);
  if (plainCustomMatch) {
    return `v${plainCustomMatch[1]} [mod-${getModTimestamp()}]`;
  }
  return val.startsWith("v") ? val : `v${val}`;
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
  --changelog, --summary 显示官方更新简述 (分类展示最新提交核心变更)
  --check-plugins     检测本地自定义插件 (Custom Plugins) 清单规范及单元/契约测试兼容性
  --plugins           --check-plugins 的别名
  --status            显示当前本地分支、上游同步状态、全局安装位置与守护进程状态
  --check-upstream    检查官方 (upstream) 最新更新与版本差异，不执行合并或构建
  --sync-upstream     一键同步官方更新 (fetch + merge/rebase + 保持 -custom 后缀 + 构建安装)
  --sync              --sync-upstream 的别名
  --rebase            与 --sync-upstream 配合使用，使用 rebase 替代默认的 merge
  --stash             与 --sync-upstream 配合使用，如果有未提交的更改则自动 stash 并恢复
  --verify            运行核心质量门禁验证 (typecheck:server 与 5 个核心定制特性单测回归，失败即停)
  --bump, --stamp     刷新当前构建时刻版本标识 (-custom.<DDhhmm>) 并同步各子包
  --force-ui          强制重新打包编译 Web UI (默认在 packages/app 无改动且产物就绪时自动跳过)
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
const showChangelog = args.has("--changelog") || args.has("--summary");
const checkPluginsOnly = args.has("--check-plugins") || args.has("--plugins");
const shouldSyncUpstream = args.has("--sync-upstream") || args.has("--sync");
const useRebase = args.has("--rebase");
const autoStash = args.has("--stash");
const shouldVerify = args.has("--verify") || args.has("--test");
const skipUi = args.has("--skip-ui");
const forceUi = args.has("--force-ui") || args.has("--build-ui");
const shouldBump = args.has("--bump") || args.has("--stamp");
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

function ensureBuiltinPluginsTsconfig() {
  const tsconfigPath = path.join(repoRoot, "plugins", "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const content = JSON.parse(readFileSync(tsconfigPath, "utf8"));
      // 官方 plugins workspace 专属于内置 usage-source 插件。
      // 若 include 包含 **/*.tsx，可能会把用户软链接到 plugins/ 的自定义外部插件扫入导致 TS17004 JSX 报错。
      if (
        Array.isArray(content.include) &&
        content.include.some((p) => p.includes("**/*.tsx") || p === "**/*.ts")
      ) {
        content.include = ["*-usage-source/**/*.ts"];
        writeFileSync(tsconfigPath, `${JSON.stringify(content, null, 2)}\n`);
        console.log(
          "🛡️ 已自动防御配置 plugins/tsconfig.json，收敛 include 仅检查内置 usage-source 插件。",
        );
      }
    } catch {
      // ignore
    }
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

function checkDaemonDrift() {
  const pidFile = path.join(os.homedir(), ".paseo", "paseo.pid");
  if (!existsSync(pidFile)) return null;
  try {
    const pidInfo = JSON.parse(readFileSync(pidFile, "utf8"));
    const startedAt = new Date(pidInfo.startedAt);
    if (Number.isNaN(startedAt.getTime())) return null;

    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - startedAt.getTime());
    const diffHours = (diffMs / (1000 * 60 * 60)).toFixed(1);
    const diffDays = (diffMs / (1000 * 60 * 60 * 24)).toFixed(1);

    const ageStr = Number(diffDays) >= 1 ? `${diffDays} 天前` : `${diffHours} 小时前`;

    // Check Volta/npm global installed mtime
    const targets = getGlobalInstallTargets();
    let isStale = false;
    let mtimeStr = null;
    if (targets.length > 0) {
      const cliEntry = path.join(targets[0].cliDir, "dist", "index.js");
      if (existsSync(cliEntry)) {
        const installedMtime = statSync(cliEntry).mtime;
        mtimeStr = installedMtime.toLocaleString();
        if (installedMtime.getTime() > startedAt.getTime() + 5000) {
          isStale = true;
        }
      }
    }

    return {
      pid: pidInfo.pid,
      listen: pidInfo.listen,
      startedAt: pidInfo.startedAt,
      diffHours,
      diffDays,
      ageStr,
      isStale,
      mtimeStr,
    };
  } catch {
    return null;
  }
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
  console.log(
    `📌 本地仓库版本:   ${formatModDisplayVersion(localPkg.version)} (${localPkg.version})`,
  );

  // 3. Global Install targets
  const targets = getGlobalInstallTargets();
  console.log(`\n📦 全局安装目录与版本:`);
  if (targets.length === 0) {
    console.log("   ⚠️ 未检测到全局安装的 @getpaseo/cli (Volta 或 npm -g)");
  } else {
    for (const t of targets) {
      console.log(`   - [${t.name}] 版本: ${formatModDisplayVersion(t.version)} (${t.version})`);
      console.log(`     路径: ${t.cliDir}`);
    }
  }

  // 4. Daemon status
  console.log(`\n⚡ 守护进程 (Daemon) 状态:`);
  const drift = checkDaemonDrift();
  if (drift) {
    console.log(
      `   - 配置文件记录 PID: ${drift.pid}, 监听: ${drift.listen}, 启动于: ${drift.startedAt} (${drift.ageStr})`,
    );
    if (drift.isStale) {
      console.log(
        `   ⚠️ 运行态漂移: 守护进程启动于 ${drift.ageStr}，早于全局最新构建 (${drift.mtimeStr})！`,
      );
      console.log(`   👉 建议在宿主终端执行: paseo restart 载入最新运行时`);
    } else {
      console.log(`   ✅ 守护进程运行正常，已是最新构建实例`);
    }
  } else {
    const pidFile = path.join(os.homedir(), ".paseo", "paseo.pid");
    if (!existsSync(pidFile)) {
      console.log(`   - 未找到 ~/.paseo/paseo.pid 文件`);
    } else {
      console.log(`   - 配置文件存在但无法读取: ${pidFile}`);
    }
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
  console.log(
    `📊 官方版本对比: 官方版本 ${upstreamVersion}  vs  本地版本 ${formatModDisplayVersion(localPkg.version)}`,
  );
  console.log(`📊 提交差距: 本地领先 ${aheadCount} 个提交, 落后官方 ${behindCount} 个提交`);
  console.log("-------------------------------------------------------");

  if (behindCount > 0) {
    generateUpdatesSummary("HEAD..upstream/main");
    console.log("👉 若要同步合并官方更新，请执行：");
    console.log("   npm run install:local -- --sync-upstream");
  } else {
    console.log("\n✅ 本地代码已包含官方 upstream/main 的所有最新提交，已处于最新状态。");
  }
}

function bumpCustomVersion() {
  console.log("🏷️ 校验并维护自定义版本标识 (-custom)...");
  try {
    const rootPkgPath = path.join(repoRoot, "package.json");
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
    const baseVersion = rootPkg.version
      .replace(/^v/i, "")
      .replace(/-custom(?:\.[\w-]+)?$/, "")
      .replace(/\s*\[[^\]]+\]$/, "");
    rootPkg.version = `${baseVersion}-custom.${getModTimestamp()}`;
    writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
    console.log(
      `   -> 更新根版本号为: ${rootPkg.version} (${formatModDisplayVersion(rootPkg.version)})`,
    );
    run("node", ["scripts/sync-workspace-versions.mjs"]);
  } catch (err) {
    console.warn("⚠️ 同步子包版本号时出现提示:", err.message);
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

    const prevHead = runCapture("git", ["rev-parse", "HEAD"]);
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

    bumpCustomVersion();

    console.log("📦 刷新安装依赖 (npm install)...");
    run("npm", ["install"]);

    if (prevHead) {
      generateUpdatesSummary(`${prevHead}..HEAD`);
    }
    verifyCustomPlugins();
  }
}

const PERF_PATTERNS = ["perf", "rendering", "render cost", "stream", "delta", "memory"];
const FEAT_PATTERNS = ["feat", "hoplite", "provider", "model discovery", "worktree", "download"];
const UI_PATTERNS = [
  "sheet",
  "mobile",
  "composer",
  "keyboard",
  "image",
  "markdown",
  "font",
  "density",
];
const FIX_PATTERNS = ["fix", "reject", "prevent", "restore", "error", "fail", "timeout"];

function matchesAny(str, patterns) {
  return patterns.some((p) => str.includes(p));
}

function classifyCommit(msg) {
  const lower = msg.toLowerCase();
  if (matchesAny(lower, PERF_PATTERNS)) return "perf";
  if (matchesAny(lower, FEAT_PATTERNS)) return "feat";
  if (matchesAny(lower, UI_PATTERNS)) return "ui";
  if (matchesAny(lower, FIX_PATTERNS)) return "fix";
  return "docs";
}

function generateUpdatesSummary(range) {
  if (!range) return;
  const logOutput = runCapture("git", ["log", "--no-merges", "--format=%h|%s", range]);
  if (!logOutput) return;
  const lines = logOutput.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const categories = {
    perf: { title: "🚀 性能与流式渲染优化 (Performance & Streaming)", items: [] },
    feat: { title: "🛠️ 新增特性与模型提供商 (Features & Providers)", items: [] },
    ui: { title: "📱 界面交互与移动端体验 (UI, Sheets & Mobile UX)", items: [] },
    fix: { title: "🐛 问题修复与系统健壮性 (Bug Fixes & Reliability)", items: [] },
    docs: { title: "📖 文档、测试与工程规范 (Docs & Chores)", items: [] },
  };

  for (const line of lines) {
    const firstPipe = line.indexOf("|");
    if (firstPipe === -1) continue;
    const sha = line.slice(0, firstPipe).trim();
    const msg = line.slice(firstPipe + 1).trim();
    const cat = classifyCommit(msg);
    categories[cat].items.push({ sha, msg });
  }

  console.log("\n=======================================================");
  console.log(`📋 官方更新简述 (Upstream Updates Summary - 共 ${lines.length} 个提交)`);
  console.log("=======================================================");
  for (const cat of Object.values(categories)) {
    if (cat.items.length > 0) {
      console.log(`\n${cat.title} [${cat.items.length} 项]:`);
      for (const item of cat.items.slice(0, 10)) {
        console.log(`   • [${item.sha}] ${item.msg}`);
      }
      if (cat.items.length > 10) {
        console.log(`     ... 另有 ${cat.items.length - 10} 项`);
      }
    }
  }
  console.log("=======================================================\n");
}

function findTestFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) &&
        !entry.name.includes("playwright") &&
        !entry.name.includes("live")
      ) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

function findPluginManifest(dir) {
  try {
    const stat = statSync(dir);
    if (!stat.isDirectory()) return null;
    const real = realpathSync(dir);
    const manifestPath = path.join(real, "paseo-plugin.json");
    if (existsSync(manifestPath)) {
      return real;
    }
  } catch {
    // ignore
  }
  return null;
}

function collectCustomPluginDirs() {
  const pluginDirs = new Map();

  // 1. Scan plugin-custom
  const customRoot = path.join(repoRoot, "plugin-custom");
  if (existsSync(customRoot)) {
    for (const item of readdirSync(customRoot)) {
      const real = findPluginManifest(path.join(customRoot, item));
      if (real) pluginDirs.set(item, real);
    }
  }

  // 2. Scan plugins (e.g. desktop-pet or custom symlinks)
  const pluginsRoot = path.join(repoRoot, "plugins");
  if (existsSync(pluginsRoot)) {
    for (const item of readdirSync(pluginsRoot)) {
      if (
        item.endsWith("-usage-source") ||
        item === "hoplite-provider" ||
        item === "muse-provider" ||
        item === "antigravity-provider"
      ) {
        continue;
      }
      const real = findPluginManifest(path.join(pluginsRoot, item));
      if (real && !pluginDirs.has(item)) {
        pluginDirs.set(item, real);
      }
    }
  }

  return pluginDirs;
}

function readPluginManifestInfo(dirPath) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(dirPath, "paseo-plugin.json"), "utf8"));
    const manifestOk = Boolean(manifest.id || manifest.name);
    const manifestInfo = manifest.requirements?.paseo
      ? `req: ${manifest.requirements.paseo}`
      : "valid";
    return { manifestOk, manifestInfo };
  } catch {
    return { manifestOk: false, manifestInfo: "invalid json" };
  }
}

function countAssertions(results) {
  let passed = 0;
  let failed = 0;
  for (const res of results) {
    for (const a of res.assertionResults || []) {
      if (a.status === "passed") passed++;
      else if (a.status === "failed") failed++;
    }
  }
  return { passed, failed };
}

function runBatchPluginTests(pluginDirs) {
  const pluginTestStats = new Map();
  const cacheDir = path.join(repoRoot, "node_modules", ".cache");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  const tempConfigPath = path.join(cacheDir, "vitest.plugins.config.ts");
  const resultsJsonPath = path.join(cacheDir, "vitest.plugins.results.json");

  const includeGlobs = Array.from(pluginDirs.values()).map((dir) => {
    const rel = path.relative(repoRoot, dir);
    return `${rel}/tests/**/*.{test,spec}.{ts,tsx}`;
  });

  const configContent = `import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "${path.join(repoRoot, "vitest.config.ts")}";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ${JSON.stringify(includeGlobs)},
      exclude: ["**/*playwright*", "**/*live*", "**/node_modules/**"]
    }
  })
);
`;
  writeFileSync(tempConfigPath, configContent);

  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "run",
        "-c",
        tempConfigPath,
        "--bail=1",
        "--reporter=json",
        `--outputFile=${resultsJsonPath}`,
      ],
      {
        encoding: "utf8",
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    // Vitest exits with 1 on test failure, resultsJsonPath is still populated
  }

  if (existsSync(resultsJsonPath)) {
    try {
      const report = JSON.parse(readFileSync(resultsJsonPath, "utf8"));
      const testResults = report.testResults || [];
      for (const [id, dirPath] of pluginDirs.entries()) {
        const matching = testResults.filter((r) => r.name.startsWith(dirPath));
        if (matching.length === 0) continue;
        const { passed, failed } = countAssertions(matching);
        const isOk = failed === 0 && passed > 0;
        pluginTestStats.set(id, { passed, failed, isOk });
      }
    } catch (e) {
      console.warn("⚠️ 解析测试报告失败:", e.message);
    } finally {
      try {
        rmSync(tempConfigPath, { force: true });
        rmSync(resultsJsonPath, { force: true });
      } catch {}
    }
  }

  return pluginTestStats;
}

function verifyCustomPlugins() {
  console.log("\n=======================================================");
  console.log("🧩 检测本地自定义插件 (Custom Plugins) 兼容性与质量门禁");
  console.log("=======================================================");

  const pluginDirs = collectCustomPluginDirs();
  if (pluginDirs.size === 0) {
    console.log("ℹ️ 未发现任何本地自定义插件。");
    return true;
  }

  console.log(`📦 共发现 ${pluginDirs.size} 个本地自定义插件:\n`);

  const pluginManifests = new Map();
  const pluginsWithTests = new Map();
  for (const [id, dirPath] of pluginDirs.entries()) {
    pluginManifests.set(id, readPluginManifestInfo(dirPath));
    const testFiles = findTestFiles(path.join(dirPath, "tests"));
    if (testFiles.length > 0) {
      pluginsWithTests.set(id, testFiles);
    }
  }

  let pluginTestStats = new Map();
  if (pluginsWithTests.size > 0) {
    pluginTestStats = runBatchPluginTests(pluginDirs);
  }

  let allPassed = true;
  for (const [id, dirPath] of pluginDirs.entries()) {
    const relPath = path.relative(repoRoot, dirPath);
    const { manifestOk, manifestInfo } = pluginManifests.get(id);
    let testsOk = true;
    let testSummary = "无单测";

    if (pluginsWithTests.has(id)) {
      const stats = pluginTestStats.get(id);
      if (stats) {
        testsOk = stats.isOk;
        testSummary =
          stats.failed > 0
            ? `${stats.failed} failed, ${stats.passed} passed`
            : `${stats.passed} passed`;
      } else {
        testsOk = false;
        testSummary = "测试未通过";
      }
    }

    if (!manifestOk || !testsOk) {
      allPassed = false;
    }

    const isHealthy = manifestOk && testsOk;
    console.log(
      `  ${isHealthy ? "✅" : "❌"} ${id.padEnd(26)} [${manifestInfo.padEnd(14)}] -> ${testSummary} (${relPath})`,
    );
  }

  console.log("-------------------------------------------------------");
  if (allPassed) {
    console.log("🎉 所有 Custom Plugin 规范检验与回归测试全部通过！\n");
  } else {
    console.warn("⚠️ 存在不兼容或测试失败的 Custom Plugin，请根据上方详情检查修复。\n");
  }
  return allPassed;
}

function shouldBuildWebUi() {
  if (skipUi) return false;
  if (forceUi) return true;

  const targetUi = path.join(
    repoRoot,
    "packages",
    "server",
    "dist",
    "server",
    "web-ui",
    "index.html",
  );
  if (!existsSync(targetUi)) {
    return true;
  }

  // Check if packages/app has changes in working tree or staged
  const appStatus = runCapture("git", ["status", "--porcelain", "packages/app"]) || "";
  if (appStatus.trim().length > 0) {
    return true;
  }

  // Check if HEAD commit touched packages/app
  const headDiff =
    runCapture("git", [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-m",
      "HEAD",
      "--",
      "packages/app",
    ]) || "";
  if (headDiff.trim().length > 0) {
    return true;
  }

  return false;
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

  verifyCustomPlugins();
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

if (showChangelog) {
  ensureUpstreamRemote();
  let range = "";
  const behindCountStr = runCapture("git", ["rev-list", "--count", "HEAD..upstream/main"]);
  const behindCount = parseInt(behindCountStr, 10) || 0;
  if (behindCount > 0) {
    range = "HEAD..upstream/main";
  } else {
    const merges = runCapture("git", [
      "log",
      "--grep=merge: sync official upstream updates",
      "-n",
      "2",
      "--format=%H",
    ]);
    const mergeList = merges ? merges.split("\n").filter(Boolean) : [];
    if (mergeList.length >= 2) {
      range = `${mergeList[1]}^2..${mergeList[0]}^2`;
    } else if (mergeList.length === 1) {
      range = `${mergeList[0]}^1..${mergeList[0]}^2`;
    } else {
      range = "upstream/main~30..upstream/main";
    }
  }
  generateUpdatesSummary(range);
  process.exit(0);
}

if (checkPluginsOnly) {
  const ok = verifyCustomPlugins();
  process.exit(ok ? 0 : 1);
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
} else if (shouldBump) {
  bumpCustomVersion();
}

// Build Step
ensureBuiltinPluginsTsconfig();
console.log("\n=== [Build] Building Paseo Server & Components ===");
run("npm", ["run", "build:server"]);

// 1. Fail-Fast: 质量门禁前置 (若有错误立即中断，避免耗费数分钟构建 UI)
if (shouldVerify) {
  verifyQuality();
}

// 2. 按需构建 Web UI (若 packages/app 无改动且产物就绪则自动复用，传入 --force-ui 强制重新打包)
if (shouldBuildWebUi()) {
  console.log("\n=== [Build] Building Daemon Web UI ===");
  run("node", ["scripts/build-daemon-web-ui.mjs"], {
    env: {
      ...process.env,
      EXPO_NO_TELEMETRY: "1",
    },
  });
} else {
  console.log(
    "⏩ 跳过 Web UI 构建 (packages/app 无代码变更且产物就绪；传入 --force-ui 强制重新打包)",
  );
}

// 3. 构建桌面端主进程
if (!skipDesktop) {
  console.log("\n=== [Build] Building Paseo Desktop Client ===");
  run("npm", ["run", "build:main", "--workspace=@getpaseo/desktop"]);
} else {
  console.log("⏩ 已跳过 Desktop 构建 (--skip-desktop)");
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
const driftAfterInstall = checkDaemonDrift();
if (driftAfterInstall && driftAfterInstall.isStale) {
  console.log(
    `🚨 运行态漂移告警: 守护进程 (PID ${driftAfterInstall.pid}) 启动于 ${driftAfterInstall.ageStr}，落后于刚刚安装的最新版本！`,
  );
}
console.log("👉 请在你的宿主终端手动执行以下命令重启守护进程以生效：");
console.log("   paseo restart");
console.log("=======================================================\n");
