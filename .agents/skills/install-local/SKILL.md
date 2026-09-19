---
name: install-local
description: Use when building, installing, upgrading, or maintaining Paseo locally, syncing with official upstream releases (paseo-maintenance), rebasing custom-features branch, resolving workspace package version conflicts, or verifying custom modifications (dark terminal, bilingual STT, Chinese fonts, -custom version suffix).
user-invocable: true
---

# Paseo Maintenance & Local Install Guide (本地编译安装与官方更新维护指南)

## Overview

本项目技能整合了 **本地工程编译安装** 与 **官方上游更新维护 (Paseo Maintenance)** 两大核心能力，为 Paseo 深度定制开发提供全流程闭环：

1. **自动化编译与本地部署 (Auto Build & Local Deploy)**：自动化按 Monorepo 依赖拓扑编译 Paseo 服务端组件、内置 Web UI、Electron 桌面端主进程，并将产物增量同步到本地全局运行时（如 Volta 或全局 npm），使本地终端命令 `paseo` 和后台守护进程立即生效。
2. **官方更新无缝整合 (Upstream Integration)**：自动追踪官方上游仓库 (`getpaseo/paseo`)，对比版本差异与最新提交，提供一键拉取合并（或变基）、自动维护 `-custom` 自定义版本标识、秒级处理多包版本冲突、刷新第三方依赖及自动化编译安装的一站式流水线。
3. **定制特性与质量门禁守护 (Custom Features & Quality Gates)**：深度沉淀四大定制特性（纯黑终端、中英双语 STT、中文字体与重测、`-custom` 全链路兼容）的架构要点、编码规范（如 oxlint 圈复杂度与 i18n 多语言类型约束）以及 5 大核心单测回归验证。

---

## Critical Safety Redlines (绝对安全红线)

> [!CAUTION]
> **严禁 Agent 自动终止或重启 6767 端口上的主守护进程！**
> 守护进程（Daemon）直接托管了当前运行中的 Agent 会话。如果 Agent 在脚本或命令中自动 kill/restart 该进程，会导致与客户端断连并强行杀死 Agent 自身进程。
> 本地安装部署完成后，**必须引导用户在宿主终端手动执行**：
>
> ```bash
> paseo restart
> ```

---

## 0. 标准路径与环境配置

- **标准源码目录**：`~/projects/ai/paseo`（对应工作区根目录）。
  > [!IMPORTANT]
  > 所有源码维护、Git 变基、依赖构建与单测回归均在 Paseo 项目根目录执行。
- **全局 CLI 运行时**：推荐通过 Volta 管理（`~/.volta/bin/paseo`）。
  - 全局安装位置：`~/.volta/tools/image/packages/@getpaseo/cli`（或 `npm root -g` 下的 `@getpaseo/cli`）。
  - 官方发布版本升级：`volta install @getpaseo/cli@beta` 或 `@latest`。
  - 本地定制版本生效：在源码根目录下执行 `npm run install:local` 增量覆盖。
- **插件目录**：`plugins/`（用于存放本地扩展插件）。

---

## 1. 仓库与分支协同架构

Paseo 采用 **Upstream 官方追踪 + GitHub Fork 个人备份 + 本地专属特性分支变基** 的架构模式：

```
[官方上游 upstream] (getpaseo/paseo)
        │
        ▼ git fetch / pull --ff-only
[本地 main 分支] ──(纯净镜像，不含定制提交)──> [个人远端 origin/main] (goodideal/paseo)
        │
        ▼ git rebase main
[特性分支 custom-features] ──(承载定制功能提交)──> [个人远端 origin/custom-features]
        ├─ Commit 1: feat(app): add pureBlack and dark terminal appearance options
        ├─ Commit 2: feat(server): default STT to auto and add bilingual prompt
        ├─ Commit 3: feat(app): add chinese fonts and char remeasuring on font load
        ├─ Commit 4: feat(scripts): add local install script and custom version suffix support
        └─ Commit 5+: 其他特性分支与 PR 开发提交
```

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

在同步官方更新或合并变基时，必须保护以下四大定制特性不受破坏：

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

### 特性 C：终端中文字体支持与动态字符尺寸重新测量 (`packages/app`)

- **核心意图**：在终端默认等宽字体栈中加入 `'PingFang SC'`、`'Microsoft YaHei'` 等中文字体回退，解决终端中文显示缺失/字形异常问题；针对 Web 字体异步加载后字符包围盒变化导致的字符重叠错位，引入动态重测机制。
- **涉及核心文件**：
  - `packages/app/src/terminal/runtime/terminal-font.ts`（默认字体族中补充常见中文字体）
  - `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`（在字体加载就绪 `fontSet.load` 后调用 `_charSizeService.measure()` 触发重测并重新触发 `fitAndEmitResize`）
  - `packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts`
  - `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts`

---

### 特性 D：本地构建安装脚本与 `-custom` 版本后缀全链路兼容 (`packages/*` & `scripts/`)

- **核心意图**：
  1. 提供 `scripts/install-local.mjs`（`npm run install:local`），一键将本地定制源码编译并同步到本地全局 Volta 安装路径；
  2. 在全库 `package.json` 的版本号后追加 `-custom` 后缀（如 `0.9.0-beta.2-custom`），同时让原生版本号转换、桌面更新检测、设置面板及 Changelog 正确识别并剥离该后缀，避免本地客户端与服务端被误判为版本漂移，或在构建原生安装包时正则解析崩溃。
- **涉及核心文件**：
  - `scripts/install-local.mjs`（本地维护、上游同步、编译与全局 Volta 路径增量覆盖安装）
  - `.agents/skills/install-local/SKILL.md`（本指南）
  - `packages/app/native-release-version.js` & `native-release-version.test.ts`（版本号正则允许 `-custom`）
  - `packages/app/src/desktop/updates/desktop-updates.ts` & `desktop-updates.test.ts`（版本比对归一化时剥离 `-custom`）
  - `packages/app/src/screens/settings-screen.tsx`（版本比对去除 `-custom`，消除误报 mismatch）
  - `packages/app/src/changelog/internal/changelog-sheet.tsx`（更新日志展示时剥离 `-custom`）
  - 根目录及各子包 `package.json`（版本同步为 `<upstream_version>-custom`）

---

## 3. 全自动化维护与安装命令速查 (Quick Reference)

所有维护与安装操作均统一集成在 `scripts/install-local.mjs` 中（`npm run install:local` 与 `npm run maintenance` 互为别名）：

| 操作目标                         | 推荐命令                                              | 核心动作说明                                                           |
| :------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------- |
| **一键全量编译并部署到本机**     | `npm run install:local`                               | 编译 Server + Web UI + Desktop，同步至全局 Volta/npm 路径              |
| **一键同步官方更新并编译安装**   | `npm run install:local -- --sync-upstream`            | 自动 fetch 上游、合并最新提交、维护 `-custom` 后缀、刷新依赖并构建安装 |
| **同步官方更新时使用 rebase**    | `npm run install:local -- --sync-upstream --rebase`   | 采用变基方式保持线性的自定义提交历史                                   |
| **自动暂存工作区并同步上游**     | `npm run install:local -- --sync-upstream --stash`    | 若有未提交修改，自动 stash、同步上游后自动 pop 恢复                    |
| **执行质量门禁与核心单测回归**   | `npm run install:local -- --verify`                   | 运行 `typecheck:server` 与 5 大定制特性核心单测全量回归                |
| **查看运行状态与上游同步差距**   | `npm run install:local -- --status`                   | 显示当前 Git 分支/提交、官方落后/领先差距、全局安装位置及守护进程状态  |
| **仅检查官方是否有新版本**       | `npm run install:local -- --check-upstream`           | 获取并对比官方 upstream/main 最新提交与版本号，不修改代码              |
| **快速构建后端与 CLI (跳过 UI)** | `npm run install:local -- --skip-ui`                  | 修改后端/CLI 逻辑时极速编译，跳过耗时的 Web UI 打包                    |
| **仅在本地编译 (不安装到全局)**  | `npm run install:local -- --build-only`               | 仅验证打包输出，不覆盖本机全局 `@getpaseo/cli`                         |
| **仅同步依赖与代码 (不编译)**    | `npm run install:local -- --sync-upstream --no-build` | 仅执行上游同步与依赖安装，不执行后续编译步骤                           |

---

## 4. 升级与变基全流程标准规范 (SOP)

当官方发布新版本或上游有更新需要同步时，可以采用 **全自动一键同步** 或 **精细化分步手动操作**：

### 方案 A：全自动一键同步（推荐）

```bash
# 自动拉取上游、变基、同步 -custom 版本、刷新依赖、质量门禁验证并全量编译安装
npm run install:local -- --sync-upstream --rebase --verify
```

若在变基过程中遇到冲突，脚本会安全中断并输出清晰的处理指引，解决冲突后重新执行即可。

---

### 方案 B：精细化分步手动流程 (Manual SOP)

#### Step 1: 状态检查与环境评估

```bash
# 1. 查看本地工作区状态
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

#### Step 3: 特性分支变基与冲突处理

```bash
git checkout custom-features
git rebase main
```

#### 🌟 核心技巧：秒级解决 `package.json` 的批量版本冲突

因定制分支版本带有 `-custom` 后缀，在上游切新版本后变基或合并时，所有子包的 `package.json` 会因为版本号和内部依赖版本产生冲突。**严禁手动逐个编辑十几个文件**，使用以下步骤秒级解决：

```bash
# 1. 在根目录 package.json 中仅将 version 冲突修改为最新上游版本加上 -custom（如 "0.9.0-beta.3-custom"）并保存
# 2. 对所有子包 package.json 使用 ours 丢弃冲突标记：
git checkout --ours packages/*/package.json

# 3. 运行官方同步脚本，自动精准级联重写所有子包版本及内部依赖引用：
node scripts/sync-workspace-versions.mjs

# 4. 标记解决并继续：
git add package.json packages/*/package.json
# 若在 rebase 冲突中：git rebase --continue
# 若在 merge 冲突中：git commit
```

> [!NOTE]
> 若冲突涉及业务代码（如 `stt.ts` 或 `terminal-pane.tsx`）：保留本地定制逻辑并适配上游新参数，`git add <file>` 后执行 `git rebase --continue`。

#### Step 4: 安装与依赖同步

```bash
npm install
```

- 注意：`postinstall` 钩子会自动运行 `scripts/postinstall-patches.mjs` 给 Expo / React Native 相关包打补丁。
- 若 `package-lock.json` 出现非预期格式扰动，使用 `git checkout -- package-lock.json` 恢复，保持与上游一致。

#### Step 5: 构建与质量门禁验证

Paseo 是典型的 Monorepo 架构，类型检查和子包间存在严格的构建依赖链：

```bash
# 1. 构建底层依赖
npm run build:protocol
npm run build:client
npm run build:highlight && npm run build:plugin && npm run build:relay

# 2. 构建核心服务端与 CLI
npm run build --workspace=@getpaseo/server
npm run build --workspace=@getpaseo/cli

# 3. 运行全库 Typecheck
npm run typecheck:server
npm run typecheck --workspace=@getpaseo/app

# 4. 代码格式与 Lint 校验（按项目规范严格使用 npm 脚本）
npm run lint
npm run format:check

# 5. 核心单测全量回归（涵盖全部 4 大定制特性）
npx vitest run \
  packages/app/src/hooks/use-settings/storage.test.ts \
  packages/server/src/server/session/voice/voice-session.test.ts \
  packages/app/native-release-version.test.ts \
  packages/app/src/desktop/updates/desktop-updates.test.ts \
  packages/app/src/terminal/runtime/terminal-emulator-runtime.test.ts \
  --bail=1
```

#### Step 6: 推送更新到个人远端 Fork

```bash
git push origin custom-features --force-with-lease
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

| 问题现象                                                              | 根因分析                                               | 解决方案                                                                                                                    |
| :-------------------------------------------------------------------- | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module '@getpaseo/protocol/messages'`                    | Monorepo 子包未构建，缺少 generated validators 或 dist | 先执行 `npm run build:protocol && npm run build:client`                                                                     |
| `Property 'terminalAppearance' is missing in type ... in ja.ts/ar.ts` | `TranslationResources` 严格校验所有语言 key            | 检查 `en.ts` 中 `TranslationResources` 是否已对新字段配置了可选映射（见特性 A）                                             |
| 变基或合并时所有 `package.json` 报冲突                                | 上游版本迭代与本地 `-custom` 后缀冲突                  | 见 SOP Step 3：改根目录版本后运行 `git checkout --ours packages/*/package.json && node scripts/sync-workspace-versions.mjs` |
| 客户端与服务端连接后提示 `Version Mismatch`                           | 本地安装了 `-custom` 但判断逻辑未放行                  | 检查 `desktop-updates.ts` 与 `settings-screen.tsx` 中的版本比对是否已剔除 `-custom`                                         |
| `oxlint: private async method has a complexity of 22 (Max 20)`        | `transcribeAudioInternal` 分支过多                     | 将多条件判断与 logprob 分析抽离为顶层纯函数（见特性 B）                                                                     |
| `oxfmt: Format issues found in above 1 files`                         | 文件存在格式缩进/尾逗号不符合规范                      | 严格运行 `npm run format` 自动修正，切勿手动硬改                                                                            |
| `git push: deploy key permission denied`                              | SSH 默认尝试了其他项目的 deploy key                    | 运行 `gh auth setup-git`，改用已授权的个人 HTTPS 协议推送                                                                   |
| 终端中文字符重叠、光标对不准                                          | 异步中文字体加载后未重算 cell 宽高                     | 确保 `terminal-emulator-runtime.ts` 中在 `fontSet.load` 后调用了 `remeasureCharSize()`                                      |
| `git fetch upstream` 权限报错或失败                                   | 远端未配置或沙盒限制                                   | 脚本已内置 `ensureUpstreamRemote()`，若网络受限可先在宿主终端执行一次 `git fetch upstream`                                  |
