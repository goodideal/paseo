---
name: install-local
description: Use when building and installing Paseo server and desktop locally, updating the local daemon runtime, or deploying local changes to the local machine.
user-invocable: true
---

# Install Local Paseo (本机编译并安装服务端与桌面端)

## Overview

编译当前 Paseo 仓库的服务端（含内置 Web UI）、桌面端（Electron main），并将构建产物同步安装到本机全局环境（如 Volta 或全局 npm），以便本地全局命令 `paseo` 和运行中的守护进程生效。安装完成后，明确提示用户重启守护进程。

## Critical Invariant (至关重要)

- **严禁 Agent 自动 kill 或重启 6767 端口上的主守护进程**：因为该守护进程直接托管了当前运行中的 Agent 会话，一旦重启会立刻切断通信并强制终止 Agent 自身进程。
- **构建安装完成后，必须由用户在外部终端手动执行 `paseo restart`**。

## Quick Start (一键执行)

在项目根目录下直接运行：

```bash
npm run install:local
```

该脚本将自动依次执行：

1. 编译服务端组件 (`npm run build:server`)
2. 编译并打包 Web UI 到服务端 (`node scripts/build-daemon-web-ui.mjs`)
3. 编译桌面端主进程 (`npm run build:main --workspace=@getpaseo/desktop`)
4. 检测本机全局环境（Volta / npm 全局），将最新的 CLI 与服务端依赖增量同步安装
5. 输出完成信息，并提示用户手动执行 `paseo restart`

## Step-by-Step Procedure (手动分步流程)

如需手动调试或精细化控制各构建步骤：

### 1. 编译服务端与依赖

```bash
npm run build:server
```

### 2. 编译并打包内置 Web UI

```bash
EXPO_NO_TELEMETRY=1 node scripts/build-daemon-web-ui.mjs
```

### 3. 编译桌面端

```bash
npm run build:main --workspace=@getpaseo/desktop
```

### 4. 同步更新本机全局包

将 `packages/cli/dist` 以及 `packages/{server,client,protocol,highlight,plugin,relay}/dist` 覆盖到本机全局 `@getpaseo/cli` 所在路径（如 `~/.volta/tools/image/packages/@getpaseo/cli`）。

### 5. 提示用户重启

向用户说明安装已就绪，请在终端执行：

```bash
paseo restart
```
