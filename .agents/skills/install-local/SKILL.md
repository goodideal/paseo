---
name: install-local
description: Use when building, installing, upgrading, or maintaining Paseo locally, syncing with official upstream releases (paseo-maintenance), rebasing custom-features branch, resolving workspace package version conflicts, or verifying custom modifications (dark terminal, bilingual STT, Chinese fonts, -custom version suffix).
user-invocable: true
---

# Paseo Maintenance & Local Install Guide (本地编译安装与官方更新维护指南)

## Overview

本项目技能整合了 **本地工程编译安装** 与 **官方上游更新维护 (Paseo Maintenance)** 两大核心能力，为 Paseo 深度定制开发提供全流程闭环：

1. **自动化编译与本地部署 (Auto Build & Local Deploy)**：自动化按 Monorepo 依赖拓扑编译 Paseo 服务端组件、按需打包内置 Web UI（智能跳过无变更 UI 打包）、Electron 桌面端主进程，并将产物增量同步到本地全局运行时（如 Volta 或全局 npm），提供守护进程运行态漂移比对与重启预警。
2. **官方更新无缝整合与上游版本显式输出 (Upstream Integration & Version Visibility)**：自动追踪官方上游仓库 (`getpaseo/paseo`)，显式提取并输出官方 upstream 最新版本（源码主干版本、Git Tag、npm 发布标签及提交动态），深度对比本地基线演进差距；提供一键拉取合并（或变基）、自动维护 `-custom` 自定义版本标识、秒级处理多包版本冲突、刷新第三方依赖及自动化编译安装的一站式流水线。
3. **定制特性与质量门禁守护 (Custom Features & Quality Gates)**：深度沉淀五大定制特性（纯黑终端、中英双语 STT、终端中文字体回退、`-custom` 全链路兼容、插件化 Usage Source 与 Workflow 引擎整合）的架构要点、编码规范（如 oxlint 圈复杂度、i18n 多语言类型约束与 Monorepo Workspace 依赖构建链）以及核心单测回归验证。

---

## Critical Safety & Version Redlines (绝对安全与版本规范红线)

> [!CAUTION]
> **严禁 Agent 自动终止或重启 6767 端口上的主守护进程！**
> 守护进程（Daemon）直接托管了当前运行中的 Agent 会话。如果 Agent 在脚本或命令中自动 kill/restart 该进程，会导致与客户端断连并强行杀死 Agent 自身进程。
> 本地安装部署完成后，**必须引导用户在宿主终端手动执行**：
>
> ```bash
> paseo restart
> ```

### 官方上游版本显式输出铁律 (Upstream Version Visibility Contract)

在执行状态巡检、版本对比或本地编译安装汇报时，**必须显式输出 Paseo 官方 upstream 的版本信息**：

1. **官方上游版本 (Upstream Version)**：输出 `upstream/main:package.json` 中的最新主干版本（如 `0.15.0`）及官方 npm 最新发布（latest/beta）；
2. **上游最新提交与 Tag**：输出上游最新提交 SHA、提交说明以及最新 Git Tag（如 `v0.13.0`）；
3. **本地基线与差距对比 (Baseline Gap)**：对比本地定制版本（如 `v0.14.0 [mod-291750]`）与官方上游版本的演进差距（领先/落后提交数、基线版本跨度），杜绝静默升级或版本黑盒。

---

## 0. 标准路径与环境配置

- **标准源码目录**：`~/projects/ai/paseo`（对应工作区根目录）。
  > [!IMPORTANT]
  > 所有源码维护、Git 变基、依赖构建与单测回归均在 Paseo 项目根目录执行。
- **全局 CLI 运行时**：推荐通过 Volta 管理（`~/.volta/bin/paseo`）。
  - 全局安装位置：`~/.volta/tools/image/packages/@getpaseo/cli`（或 `npm root -g` 下的 `@getpaseo/cli`）。
  - 官方发布版本升级：`volta install @getpaseo/cli@beta` 或 `@latest`。
  - 本地定制版本生效：在源码根目录下执行 `npm run install:local` 增量覆盖。
- **插件目录**：`plugins/`（用于存放官方内置插件及本地扩展插件软链接）。

---

## 1. 仓库与分支协同架构

Paseo 采用 **Upstream 官方追踪 + GitHub Fork 个人备份 + 本地专属特性分支协同** 的架构模式：

```
[官方上游 upstream] (getpaseo/paseo)
        │
        ▼ git fetch / pull --ff-only
[本地 main 分支] ──(纯净镜像，不含定制提交)──> [个人远端 origin/main] (goodideal/paseo)
        │
        ▼ git merge upstream/main (或 git rebase main)
[特性分支 custom-features] ──(承载定制功能提交)──> [个人远端 origin/custom-features]
        ├─ Commit 1: feat(app): add pureBlack and dark terminal appearance options
        ├─ Commit 2: feat(server): default STT to auto and add bilingual prompt
        ├─ Commit 3: feat(app): add chinese fonts and char remeasuring on font load
        ├─ Commit 4: feat(scripts): add local install script and custom version suffix support
        ├─ Commit 5: feat(workflows): integrate workflow preset registry into plugin process
        └─ Commit 6+: 其他特性分支与 PR 开发提交
```

### 同步策略选择 (Merge vs Rebase)

- **推荐策略：`git merge upstream/main`（保留历史追踪）**
  `custom-features` 分支包含了跨周期演进的多个功能分支合流记录。采用 `merge` 能够自然保留分支拓扑与合并节点，避免变基时对历史 Merge 节点进行平铺而引发反复解冲突，且无需 `--force` 破坏远端备份。
- **平坦历史策略：`git rebase main`**
  若当前分支仅承载极少数独立线性提交，且明确需要保持与主干一致的线性历史，方推荐使用 `--rebase`。

### 远程仓库定义

- **`upstream`**：`https://github.com/getpaseo/paseo.git`（官方仓库，只读追踪）
- **`origin`**：`https://github.com/goodideal/paseo.git`（个人 Fork，读写推送）

### 凭据与认证规范

推送 `origin` 时若遭遇 SSH Deploy Key 权限冲突（如 deploy key 绑定了其他仓库），优先使用 GitHub CLI 凭据助手：

```bash
gh auth setup-git
git remote set-url origin https://github.com/goodideal/paseo.git
```

---

## 2. 现有核心定制特性架构与关键门禁规范

在同步官方更新或合并变基时，必须保护以下五大定制特性不受破坏：

### 特性 A：前端纯黑与深色终端外观 (`packages/app`)

- **核心意图**：允许用户在设置中独立选择终端配色（`pureBlack` 纯黑、`dark` 深色、`follow-theme` 跟随主题），解决默认主题下终端背景对比度不足的问题。
- **涉及核心文件**：
  - `packages/app/src/components/terminal-pane.tsx`（终端渲染容器与 Xterm 主题挂载）
  - `packages/app/src/hooks/use-settings/storage.ts`（Settings 存储 schema 与默认值定义）
  - `packages/app/src/hooks/use-settings/index.ts`（类型导出）
  - `packages/app/src/screens/settings/appearance/appearance-section.tsx`（UI 设置项渲染）
  - `packages/app/src/i18n/resources/en.ts` 与 `zh-CN.ts`
- **i18n 类型兼容关键约束**：
  Paseo 的 `TranslationResources` 默认通过 `WidenStringLeaves<typeof en>` 进行全量语言完整性校验。为防止仅在 `en` 和 `zh-CN` 增加配置项导致日韩法德等其他多语言包抛出 `TS2741` 缺失属性错误，`en.ts` 导出类型必须对新特性字段做可选化映射：
  ```ts
  type BaseTranslation = WidenStringLeaves<typeof en>;
  export type TranslationResources = {
    [K in keyof BaseTranslation]: K extends "settings"
      ? Omit<BaseTranslation["settings"], "appearance"> & {
          appearance: Omit<BaseTranslation["settings"]["appearance"], "terminalAppearance"> & {
            terminalAppearance?: BaseTranslation["settings"]["appearance"]["terminalAppearance"];
          };
        }
      : BaseTranslation[K];
  };
  ```

---

### 特性 B：服务端 STT 自动检测与中英文双语识别 (`packages/server`)

- **核心意图**：将默认的 STT 语言从单语 `"en"` 扩展为 `"auto"`，并在听写与对话流中注入中英文混合编程语音识别 Prompt，同时兼容非 auto 的显式指定。
- **涉及核心文件**：
  - `packages/server/src/server/dictation/dictation-stream-manager.ts`
  - `packages/server/src/server/session/voice/voice-session.ts`
  - `packages/server/src/server/speech/providers/local/config.ts`
  - `packages/server/src/server/speech/providers/openai/stt.ts`
  - `packages/server/src/server/speech/speech-runtime.ts`
  - `packages/server/src/server/websocket-server.ts`
- **代码复杂度与 Lint 门禁规范**：
  Paseo 代码库启用了极高严格度的 `oxlint`（`eslint(complexity)` 规则限制方法复杂度最大为 20）。在修改 `stt.ts` 的 `transcribeAudioInternal` 时，必须将分支判断抽取到顶层纯函数，否则会触发 pre-commit 拦截：
  ```ts
  function resolveTargetLanguage(language: string | undefined): string | undefined {
    if (!language || language === "auto" || language === "bilingual") {
      return undefined;
    }
    return language;
  }
  ```

---

### 特性 C：终端中文字体回退 (`packages/app`)

- **核心意图**：在终端默认等宽字体栈中加入 `'PingFang SC'`、`'Microsoft YaHei'` 等中文字体回退，确保 Web/Electron 终端渲染中文字符时优先回退到苹方/雅黑。
- **涉及核心文件**：
  - `packages/app/src/terminal/runtime/terminal-font.ts`（默认字体族中补充常见中文字体；`terminal-emulator-runtime.ts` 保持与上游零差异，因 xterm.js `CharSizeService` 仅测量 ASCII `"W"` 且终端无 `@font-face` WebFont，无需 `remeasureCharSize` 补丁）

---

### 特性 D：本地构建安装脚本与 `-custom` 版本后缀及 `[mod-DDhhmm]` 全链路兼容 (`packages/*` & `scripts/`)

- **核心意图**：
  1. 提供 `scripts/install-local.mjs`（`npm run install:local`），一键将本地定制源码编译并同步到本地全局 Volta 安装路径；
  2. **构建/安装期动态注入 `-custom.d<DDhhmm>`**：Git 源码中所有 13 个 `package.json` 保持与上游一致的纯净版本号（杜绝上游发版时的 13 处 `package.json` 冲突与 `package-lock.json` 脏污）；仅在执行 `npm run install:local` 构建 Daemon Web UI（通过 `EXPO_PUBLIC_PASEO_CUSTOM_VERSION` -> `packages/app/src/utils/app-version.ts`）与写入 Volta 全局运行时目标目录 `package.json` 时动态注入 `-custom.d<DDhhmm>`，在 UI 与 CLI 中统一展示为 `v<base> [mod-DDhhmm]`；
  3. 让原生版本号转换、桌面更新检测、设置面板及 Changelog 正确识别并剥离该后缀及 `[mod-DDhhmm]` 标签，避免本地客户端与服务端被误判为版本漂移，或在构建原生安装包时正则解析崩溃。
- **涉及核心文件**：
  - `scripts/install-local.mjs`（构建/安装期动态生成 `-custom.d<DDhhmm>` 并注入 Web UI 环境变量与 Volta 全局目标 `package.json`）
  - `packages/app/src/utils/app-version.ts`（优先读取构建期注入的 `EXPO_PUBLIC_PASEO_CUSTOM_VERSION`）
  - `packages/app/native-release-version.js` & `native-release-version.test.ts`（版本号正则允许 `-custom`、时间戳后缀及 `[mod-...]` 标签）
  - `packages/app/src/desktop/updates/desktop-updates.ts` & `desktop-updates.test.ts`（格式化为 `v<base> [mod-DDhhmm]`，并在版本比对归一化时剥离）
  - `packages/app/src/screens/settings-screen.tsx`（版本比对去除 `-custom` 与 `[mod-...]`，消除误报 mismatch）
  - `packages/app/src/changelog/internal/changelog-sheet.tsx`（更新日志展示时剥离 `-custom` 与 `[mod-...]`）
  - `packages/cli/src/version.ts` & `version.test.ts` & `cli.ts`（CLI `--version` 输出格式化为 `v<base> [mod-DDhhmm]`）

---

### 特性 E：插件跨调用能力与 4 插件收敛架构 (`packages/client` & `plugin-custom/`)

- **核心意图**：
  1. **通用插件跨调用能力 (`PaseoApi.plugins.invoke`)**：在 `packages/client/src/index.ts` 暴露通用 `paseo.plugins.invoke(pluginId, method, input)`（直接复用官方 `DaemonClient.invokePluginRpc`，0 新增核心协议），彻底移除核心服务中的 Workflow 侵入代码；
  2. **4 个核心定制插件 (`plugin-custom/`)**：本地定制扩展收敛为 `agent-harness`、`gitea-workflow`（内聚原 `workflow-runs` 运行时与 `harness-bridge`）、`quick-tools` 与 `team-collab`（多开发者 Git Worktree 身份隔离、凭据路由与成员用量台账），通过 `~/.paseo/config.json` 以 directory source 挂载，保持官方 `plugins/` 目录纯净。
- **涉及核心文件**：
  - `packages/client/src/index.ts`（暴露通用 `PaseoPluginActions.invoke`）
  - `plugin-custom/agent-harness/`（Capability Harness 动态装配、层级模型路由与 Plan 模式策略）
  - `plugin-custom/gitea-workflow/`（自动化 Gitea Workflow 引擎与前端面板）
  - `plugin-custom/quick-tools/`（快捷工具与 Prompt 面板）
  - `plugin-custom/team-collab/`（多开发者 Git 身份/SSH/Token 隔离与用量审计）
  - `plugins/tsconfig.json`（与 `upstream/main` 保持一致）

---

### 特性 F：官方更新简述归纳与本地 Custom 插件生态兼容性守护 (`scripts/install-local.mjs` & `plugin-custom/`)

- **核心意图**：
  1. **自动化官方更新简述 (Upstream Updates Summary)**：每次同步上游更新（或执行 `--check-upstream` / `--changelog`）时，自动提取并分类归纳最新提交（流式渲染性能、新模型/Provider 支持、移动端与交互体验、问题修复与工程规范），让开发者对官方演进一目了然；
  2. **本地 Custom 插件生态兼容性巡检 (Plugin Compatibility Check)**：在升级合流与执行门禁（`--verify` 或 `--check-plugins`）时，自动扫描 `plugin-custom/{agent-harness,gitea-workflow,quick-tools,team-collab}` 的清单完整性（`paseo-plugin.json`）、入口有效性，并批量运行各插件的单元/契约测试，阻断上游 API 变更对定制插件的破坏。
- **涉及核心文件**：
  - `scripts/install-local.mjs`（内置 `generateUpdatesSummary` 与 `verifyCustomPlugins` 自动化流水线）
  - `plugin-custom/*` 下的全部定制插件

---

## 3. 全自动化维护与安装命令速查 (Quick Reference)

所有维护与安装操作均统一集成在 `scripts/install-local.mjs` 中（`npm run install:local` 与 `npm run maintenance` 互为别名）：

| 操作目标                         | 推荐命令                                              | 核心动作说明                                                                                         |
| :------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **一键全量编译并部署到本机**     | `npm run install:local`                               | 编译 Server + Web UI + Desktop，同步至全局 Volta/npm 路径                                            |
| **同步官方更新并编译安装**       | `npm run install:local -- --sync-upstream`            | 自动 fetch 上游、合并最新提交、维护 `-custom` 后缀、输出更新简述、校验插件兼容性、刷新依赖并构建安装 |
| **增量同步到远端 Linux 节点**    | `npm run install:local -- --sync-remote <hosts>`      | 自动比对版本（同版本仅打包 4 定制插件 + `~/.paseo/plugins` 托管社区插件，跳过 Volta 运行时）并重启   |
| **强制仅同步插件 / 强制全量**    | `--sync-plugins-only` / `--force-runtime`             | 配合 `--sync-remote` 使用：强制跳过运行时传输，或即使版本相同仍覆盖 Volta 运行时                     |
| **输出官方上游最新更新简述**     | `npm run install:local -- --changelog`                | 分类归纳展示官方最新提交（性能优化、新特性/Provider、UI 交互、修复等）                               |
| **检测本地自定义插件兼容性**     | `npm run install:local -- --check-plugins`            | 扫描 `plugin-custom/` 与 `plugins/`，校验清单规范并执行插件单元/契约测试                             |
| **同步官方更新时使用 rebase**    | `npm run install:local -- --sync-upstream --rebase`   | 采用变基方式保持线性的自定义提交历史                                                                 |
| **自动暂存工作区并同步上游**     | `npm run install:local -- --sync-upstream --stash`    | 若有未提交修改，自动 stash、同步上游后自动 pop 恢复                                                  |
| **执行质量门禁与核心单测回归**   | `npm run install:local -- --verify`                   | 门禁前置 (Fail-Fast)，批量秒测 Custom Plugins，运行 `typecheck:server` 及 5 大定制单测回归           |
| **查看运行状态与上游版本对比**   | `npm run install:local -- --status`                   | 显示当前 Git 分支/提交、官方 upstream 最新版本与基线对比、落后/领先差距、全局安装位置及守护进程状态  |
| **仅查看官方上游版本与发布信息** | `npm run install:local -- --upstream-version`         | 显示官方 upstream 最新源码版本、Git Tag、npm release (latest/beta) 及提交同步差距                    |
| **仅检查官方是否有新版本**       | `npm run install:local -- --check-upstream`           | 获取并对比官方 upstream/main 最新提交与版本号，输出更新简述，不修改代码                              |
| **快速构建后端与 CLI (跳过 UI)** | `npm run install:local -- --skip-ui`                  | 修改后端/CLI 逻辑时极速编译，跳过耗时的 Web UI 打包                                                  |
| **强制重新全量打包 Web UI**      | `npm run install:local -- --force-ui`                 | 默认在 packages/app 无修改且产物就绪时自动跳过，加此参数强制重新打包 Metro Web UI                    |
| **刷新构建时刻时间戳版本**       | `npm run install:local -- --bump`                     | 强制重新打包 Web UI 并在全局安装产物中刷新 `-custom.d<DDhhmm>`，不修改源码 `package.json`            |
| **仅在本地编译 (不安装到全局)**  | `npm run install:local -- --build-only`               | 仅验证打包输出，不覆盖本机全局 `@getpaseo/cli`                                                       |
| **仅同步依赖与代码 (不编译)**    | `npm run install:local -- --sync-upstream --no-build` | 仅执行上游同步与依赖安装，不执行后续编译步骤                                                         |

---

## 4. 升级与变基全流程标准规范 (SOP)

当官方发布新版本或上游有更新需要同步时，可以采用 **全自动一键同步** 或 **精细化分步手动操作**：

### 方案 A：全自动一键同步（推荐）

```bash
# 自动拉取上游、合并最新提交、同步 -custom 版本、刷新依赖、质量门禁验证并全量编译安装
npm run install:local -- --sync-upstream --verify
```

若在合并过程中遇到业务代码冲突，脚本会安全中断并输出清晰的处理指引，解决冲突后重新执行即可。

---

### 方案 B：精细化分步手动流程 (Manual SOP)

#### Step 1: 状态检查与环境评估

```bash
# 1. 查看本地工作区状态（确保工作区干净）
git status

# 2. 检查与官方差距
npm run install:local -- --check-upstream

# 3. 检查 npm 官方最新发布与 beta 标签
npm info @getpaseo/cli dist-tags
```

#### Step 2: 同步纯净主分支

```bash
git checkout main
git pull --ff-only upstream main
git push origin main
```

#### Step 3: 特性分支合流与冲突处理

```bash
git checkout custom-features
git merge upstream/main -m "merge: sync official upstream updates"
# 或者使用 rebase: git rebase main
```

> [!NOTE]
>
> - **源码 `package.json` 保持纯净版本**：Git 中的 13 个 `package.json` 严格与 `upstream/main` 保持一致（不再维护源码 `-custom` 后缀，`-custom.d<DDhhmm>` 仅在 `install:local` 构建与全局安装阶段动态注入）。若合流时遇到业务代码冲突，解决冲突并执行 `npm run format:files` 后继续下一步。
> - **`lefthook pre-commit` 前置构建链**：本仓库在 `git commit` 时会自动触发全库 `npm run typecheck`。若合流中断后手动解决冲突，**必须先在提交前刷新依赖与跨包类型声明并清理锁文件漂移**，再执行 `git commit --no-edit`：
>   ```bash
>   npm install && npm run build:server
>   git checkout -- package-lock.json
>   git add <resolved-files> && git commit --no-edit
>   ```

#### Step 4: 安装与依赖同步

```bash
npm install
```

- 注意：`postinstall` 钩子会自动运行 `scripts/postinstall-patches.mjs` 给 Expo / React Native 相关包打补丁。
- 若 `package-lock.json` 出现非预期格式扰动，使用 `git checkout -- package-lock.json` 恢复，保持与上游一致。

#### Step 5: 跨包依赖构建链与质量门禁验证

Paseo 是典型的 Monorepo 架构，类型检查（typecheck）和子包间存在严格的构建依赖链。**在合流了 protocol/client/plugin 等基础包后，直接执行 typecheck 会因缺少 generated declaration 报错，必须遵循以下前置构建链**：

```bash
# 1. 构建底层依赖与类型声明文件（关键！）
npm run build:client
npm run build --workspace=@getpaseo/plugin
npm run build:highlight && npm run build:relay

# 2. 构建核心服务端与 CLI
npm run build --workspace=@getpaseo/server
npm run build --workspace=@getpaseo/cli

# 3. 运行全库 Typecheck
npm run typecheck:server
npm run typecheck --workspace=@getpaseo/app
npm run typecheck --workspace=@getpaseo/builtin-plugins

# 4. 代码格式与 Lint 校验（按项目规范严格使用 npm 脚本）
npm run lint
npm run format:check

# 5. 核心单测全量回归（涵盖全部定制特性）
npx vitest run \
  packages/app/src/hooks/use-settings/storage.test.ts \
  packages/server/src/server/session/voice/voice-session.test.ts \
  packages/app/native-release-version.test.ts \
  packages/app/src/desktop/updates/desktop-updates.test.ts \
  packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts \
  --bail=1

# 6. 本地 Custom 插件全生态规范与契约兼容性测试
npm run install:local -- --check-plugins
```

#### Step 6: 推送同步与全量构建部署

完成合并提交与验证后，推送个人远端分支并执行本地构建安装（`-custom.d<DDhhmm>` 会在构建期自动注入，无需提交版本变更）：

```bash
git push origin main custom-features
npm run install:local -- --verify --force-ui
```

#### Step 7: 本地编译部署与服务重启提示

```bash
npm run install:local
```

该脚本将自动编译服务端、内置 Web UI 及桌面端主进程，并增量同步至 Volta 全局路径（`~/.volta/tools/image/packages/@getpaseo/cli`）。
完成后，提示用户在宿主终端执行：

```bash
paseo restart
```

---

## 5. 本地定制版的日常运行与调试

如果需要启动带有“纯黑终端 + 双语 STT + 中文字体”定制特性的开发实例：

- **启动本地开发服务端 (Daemon)**：
  ```bash
  # 监听独立 6768 端口，不与生产 6767 冲突
  npm run dev:server
  # 或显式指定
  cross-env PASEO_LISTEN=127.0.0.1:6768 ./scripts/dev-daemon.sh
  ```
- **启动本地前端应用 (App/Web)**：
  ```bash
  npm run dev:app
  ```

---

## 6. 常见问题排查手册 (Troubleshooting FAQ)

| 问题现象                                                                                                         | 根因分析                                                                                                      | 解决方案                                                                                                                                              |
| :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module '@getpaseo/protocol/messages'` 或缺少 response 类型                                          | Monorepo 子包未构建，缺少 generated validators 或 dist declarations                                           | 先执行 `npm run build:protocol && npm run build:client`                                                                                               |
| `error TS17004: Cannot use JSX unless the '--jsx' flag is provided` in `plugins/*`                               | 官方新增 `plugins` workspace 后，`plugins/tsconfig.json` 的 include 误扫了本地软链接挂载的自定义外部 JSX 插件 | 将 `plugins/tsconfig.json` 的 `include` 限制为 `["*-usage-source/**/*.ts"]`，杜绝扫入外部插件                                                         |
| `error TS2741: Property 'registerUsageSource' is missing in type ... but required in type 'PluginServerContext'` | 官方在 `PluginServerContext` 引入了 `registerUsageSource`，导致自定义插件单元测试的 mock 对象属性缺失         | 在测试的 `fakeServer: PluginServerContext` mock 中补齐 `registerUsageSource: vi.fn()`                                                                 |
| `Property 'terminalAppearance' is missing in type ... in ja.ts/ar.ts`                                            | `TranslationResources` 严格校验所有语言 key                                                                   | 检查 `en.ts` 中 `TranslationResources` 是否已对新字段配置了可选映射（见特性 A）                                                                       |
| 变基或合并时所有 `package.json` 报冲突                                                                           | 误向 Git 提交了带 `-custom` 后缀的版本号                                                                      | 源码中 13 个 `package.json` 应保持与 `upstream/main` 一致（`-custom` 仅在 `install:local` 构建期注入）；直接 `git checkout --theirs` 恢复上游版本即可 |
| 客户端与服务端连接后提示 `Version Mismatch`                                                                      | 本地安装了 `-custom` 但判断逻辑未放行                                                                         | 检查 `desktop-updates.ts` 与 `settings-screen.tsx` 中的版本比对是否已剔除 `-custom`                                                                   |
| `oxlint: private async method has a complexity of 22 (Max 20)`                                                   | `transcribeAudioInternal` 分支过多                                                                            | 将多条件判断与 logprob 分析抽离为顶层纯函数（见特性 B）                                                                                               |
| `oxfmt: Format issues found in above 1 files`                                                                    | 文件存在格式缩进/尾逗号不符合规范                                                                             | 严格运行 `npm run format` 自动修正，切勿手动硬改                                                                                                      |
| `git push: deploy key permission denied`                                                                         | SSH 默认尝试了其他项目的 deploy key                                                                           | 运行 `gh auth setup-git`，改用已授权的个人 HTTPS 协议推送                                                                                             |
| `git fetch upstream` 权限报错或失败                                                                              | 远端未配置或沙盒限制                                                                                          | 脚本已内置 `ensureUpstreamRemote()`，若网络受限可先在宿主终端执行一次 `git fetch upstream`                                                            |

---

## 7. 远端 Linux 节点（`ez-nuc1` / `ez-nuc2`）同构部署与增量同步 SOP

> 若需向全新 Linux 主机部署全套 AI 开发环境，直接遵循 [`/ai-env-deploy`](/Users/jerry/.agents/skills/ai-env-deploy/SKILL.md)；若需将本机更新后的 Paseo 运行时、4 个定制插件及 `~/.paseo/plugins` 托管社区插件增量推送至现有节点，直接执行 `npm run install:local -- --sync-remote nuc1-ezpro,nuc2-ezpro`（运行时版本一致时自动仅同步插件）。

手工排查或编排跨系统部署时，必须遵守以下陷阱防护准则：

1. **macOS 跨端打包防属主污染与 xattr 扩展属性噪音**：
   - macOS 本地执行 `tar` 打包传给 Linux 时，除设置 `COPYFILE_DISABLE=1` 排除 `._*` 文件外，必须传入 `--no-xattrs --no-mac-metadata` 禁止写入 `LIBARCHIVE.xattr.com.apple.provenance` 扩展头；Linux 端解压附加 `--warning=no-unknown-keyword`；
   - 切忌以 `root` 执行 `tar -xzf ... -C /home/ezpro` 时包含 `.` 顶层目录条目（会把 `/home/ezpro` 属主改成 macOS UID `502:root`，导致 `serena` 等工具报 `PermissionError`）；解压后务必核验并修正 `chown ezpro:ezpro /home/ezpro`。
2. **原生二进制保留与纯 JS 产物覆盖**：
   - 先在远端使用对应用户的 Volta 安装官方同基线版本（如 `volta install @getpaseo/cli@0.17.3`）以获取 Linux x64 原生二进制（`node-pty`、`esbuild`、`sharp`）；
   - 再用本机 `~/.volta/tools/image/packages/@getpaseo/cli` 中的纯 JS `dist/` 与带 `-custom` 戳的 `package.json` 覆盖，并补齐本地定制新增的第三方运行时依赖（如 `smol-toml`、`@modelcontextprotocol/*`、`@hono/node-server`、`hono`）。
3. **脱离 Monorepo 的 `custom-plugins` 与托管插件依赖解析**：
   - `plugin-custom/` 脱离源码仓库后，需在 `~/.paseo/custom-plugins/node_modules/` 中软链 `$VOLTA_CLI/node_modules/@getpaseo` 与 `zod`；
   - 同步 `~/.paseo/plugins` Registry 托管插件时，需保留 `checkout/.git`（供 `ManagedPluginSources` 读取 `currentRevision`），并过滤 `node_modules/{.bin,fsevents,react-native,@react-native,react-devtools-core,typescript,@babel,@esbuild,esbuild,@playwright,playwright,playwright-core}` 剔除 macOS 原生二进制与构建期依赖。
4. **节点身份隔离、Provider 启用时序与无头插件 RPC 调用范式**：
   - 不复制本机 `server-id` 与 `daemon-keypair.json`（保留远端独立身份）；
   - 先完成 `claude`/`codex`/`opencode`/`pi` CLI 安装再启服务，或安装后显式将 `~/.paseo/config.json` 中 `agents.providers.<id>.enabled` 置为 `true` 并重启 `systemctl --user restart paseo.service`，防止首次启动把未就绪 Provider 持久化为禁用；
   - **远端插件 RPC 自动化调用范式**：在节点本地通过 Node 连接运行中的守护进程（如配置 `team-collab` 成员、凭据、工作区归属或读写插件 Host Settings），直接导入全局 Volta 中的 `@getpaseo/client/dist/node/index.js`（无需额外引入 `@getpaseo/server` 内部路径）：
     ```javascript
     const { createHostClient } = await import(
       `${process.env.HOME}/.volta/tools/image/packages/@getpaseo/cli/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/client/dist/node/index.js`
     );
     const client = createHostClient("127.0.0.1:6767", {
       clientId: `cli_rpc_${process.pid}`,
       clientType: "cli",
       appVersion: "0.17.3",
       password: process.env.PASEO_PASSWORD,
       reconnect: { enabled: false },
     });
     await client.connect();
     await client.invokePluginRpc("team-collab", "team_collab.roster.status.request", {});
     await client.close();
     ```
5. **远端 SSH 进程清理与嵌套 SSH 规则**：
   - 在 `ssh host "..."` 中使用 `pkill -f` 时必须对模式首字符加方括号转义（如 `pkill -f "[p]attern"`），禁止裸字符串匹配自身 `bash -c` 命令行导致 SSH 会话中断（退出码 `255`）。
   - 在 `ssh -T <host> 'bash -s' <<'EOF'` 内调用 `ssh` 访问第三台主机时，内层必须显式加 `ssh -n`，防止内层 `ssh` 吞掉外层 heredoc 标准输入造成静默提前退出。
   - 通过 Tailscale 连接算力节点一律使用非 root 别名（`nuc1-ezpro` / `nuc2-ezpro`），避免 `root@` 触发 Tailscale SSH Check Mode 网页二次认证拦截。
