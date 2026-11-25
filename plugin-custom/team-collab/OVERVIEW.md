# Team Collab

Team Collab 为单机共享 Paseo 守护进程的多人研发环境提供工作区身份归属、Git Worktree 凭据隔离、未认领提交拦截以及按成员维度的用量台账。

## 核心机制

### 1. 工作区身份归属与继承

- 每个工作区通过 `team-collab.owner` 元数据记录当前归属成员（`member`）或自动化系统身份（`system-bot`）。
- 开启 `enforceWorktreeOnCreate` 后，基于已包含提交记录的本地 Git 主检出目录创建工作区时，自动转换为独立 `worktree` 分支工作区；非 Git 目录与空仓库保持原创建方式不变。
- 工作区内新建的子代理自动继承所属工作区的成员身份；包含无人值守工作流标记（如 `gitea-workflow`）的自动化任务优先按指派人匹配成员名录，未匹配时归入 `system-bot`。

### 2. Git Worktree 配置与凭据隔离

- 绑定成员至独立 Worktree 时，插件启用 `extensions.worktreeConfig`，仅向当前 Worktree 写入 `user.name`、`user.email`、`core.sshCommand`、`credential.helper` 与按需转换的 `url.<https>/.pushInsteadOf`，不修改主检出仓库配置。
- 成员 Token 与 SSH 密钥路径集中保存在 `<PASEO_HOME>/plugin-data/team-collab/secrets.json`（文件权限 `0600`），所有对外 RPC 仅返回掩码预览，不写入 `.git` 目录配置文件。
- 会话启动（`agent.open.before`）时按有效归属成员注入 `GIT_AUTHOR_*`、`GIT_COMMITTER_*`、`GH_TOKEN`、`GITEA_TOKEN` 及专属 `tea` CLI 包装器 `PATH`。

### 3. 未认领工作区提交防护

- 开启 `blockUnclaimedGitCommitPush` 后，未认领工作区及默认禁止直接提交的共享主检出目录会在交互式会话追加系统提示词约束，并在 `agent.permission.before` 阶段拦截 `git commit`、`git push`、`gh pr create` 与 `tea pr create` 审批请求。

### 4. SQLite 成员用量台账

- 基于 Node.js 内置 `node:sqlite` 在 `<PASEO_HOME>/plugin-data/team-collab/usage.sqlite` 维护 `turn_events` 单轮明细与 `daily_rollups` 日聚合表。
- 自动识别累计型与单轮重置型 Provider 的 Token/费用增量，按 `retentionDays` 清理过期单轮明细并保留历史日汇总，支持按日期区间与成员查询及导出 CSV/JSON。

## 已知边界

- `secrets.json` 采用宿主机文件系统 `0600` 权限保护，面向同一受信研发节点上的团队协作与身份防串号场景，不替代操作系统级多租户强隔离沙箱。
- 共享主检出目录（Main Checkout）默认不允许直接提交，如需在非 Worktree 主目录提交需显式开启 `allowSharedLocalCheckoutCommit`。
