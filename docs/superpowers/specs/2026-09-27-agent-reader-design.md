# Workspace Agent Reader Specification & Design

## 1. Executive Summary & Problem Statement

Paseo 目前的核心交互聚焦于单会话的实时执行（**Agent Runner / Console**），关注 Token 流式渲染、实时工具调用与单轮次交互。然而，在复杂项目（如 `glorious-eagle` 集群化改造）的演进过程中，一个特性往往经历多代、多个 Agent 的接力协作（架构预研、方案改造、服务调试、代码审计）。

当前缺乏面向工作区（Workspace）维度的全局视角，导致用户无法直观理解：

1. 本工作区历经了哪些阶段？各 Agent 分别解决了什么问题？
2. 沉淀了哪些核心技术决策与架构发现？
3. 哪些文件被修改、产生了哪些 Commit？整体处于什么推进阶段？

**Agent Reader（智能体运作全景阅读器）** 旨在提供以“**任务与演进脉络流（Timeline & Task Evolution）**”为主轴的工作区级阅读视窗，结合“**智能提炼决策摘要（AI Digest & Key Decisions）**”与“**增量本地缓存**”，让开发者以极高的信息密度一览项目的全生命周期演进。

---

## 2. Architecture & Data Flow

```text
[Client / App UI]
  └─ Workspace Reader View (演进故事线 + 决策卡片 + 交付物变更)
       ▲
       │ WebSocket RPC (`workspace.evolution.get_digest.request`)
       ▼
[Daemon / Server]
  ├─ WorkspaceEvolutionService
  │    ├─ AgentMilestoneSummarizer (轻量模型提炼：意图、决策、改动、结论)
  │    └─ EvolutionCacheManager (落盘于 ~/.paseo/cache/workspace-evolution/<wks_id>/)
  ├─ AgentManager & AgentStorage (监听 Agent 状态迁移: idle / archived)
  └─ GitMutationService / WorkspaceRegistry (关联 Commit 差异与工作区分支)
```

### 核心处理原则

- **工作区边界**：以 Worktree/Workspace 实例为聚合单元。
- **不可变单 Agent 缓存**：单个 Agent 运行完毕后，其提炼结果持久化落盘，再次查看时零 Token 消耗、零延迟直读。
- **增量响应与流式更新**：优先返回已有缓存快照；若存在进行中的 Agent 或新增未提炼 Agent，后台异步生成并通过事件补丁广播。

---

## 3. Data Model (`packages/protocol`)

```typescript
export interface AgentMilestoneRecord {
  agentId: string;
  provider: string;
  model?: string | null;
  startedAt: string;
  completedAt?: string | null;
  durationMs: number;
  status: "running" | "completed" | "error" | "cancelled";

  // 意图与智能提炼
  intentPrompt: string; // 原始首条 Prompt 或主要目标
  executiveSummary: string; // AI 提炼的核心总结
  keyDecisions: string[]; // 关键技术决策 / 架构发现列表
  blockersResolved?: string[]; // 解决的障碍/边界问题

  // 影响面与实体关联
  modifiedFiles: string[]; // 实际改动的文件列表
  createdArtifacts?: string[]; // 新建的关键文档/配置
  commits?: Array<{ hash: string; message: string }>; // 关联的 Git Commit
}

export interface WorkspaceEvolutionDigest {
  workspaceId: string;
  workspaceTitle: string;
  branch: string;
  executiveSummary: string; // 工作区全局演进概述
  currentStage: string; // 当前阶段（如："质量验证与评审中"）
  overallStatus: "in_progress" | "ready_for_review" | "blocked" | "completed";
  updatedAt: string;
  milestones: AgentMilestoneRecord[]; // 按时间正序排列的里程碑链
}
```

---

## 4. WebSocket Protocol

遵照 `docs/rpc-namespacing.md` 命名规范：

- **获取演进大盘**：
  - `workspace.evolution.get_digest.request`
    ```typescript
    {
      type: "workspace.evolution.get_digest.request",
      requestId: string,
      workspaceId: string,
      forceRefresh?: boolean
    }
    ```
  - `workspace.evolution.get_digest.response`
    ```typescript
    {
      type: "workspace.evolution.get_digest.response",
      requestId: string,
      workspaceId: string,
      digest: WorkspaceEvolutionDigest | null,
      isAnalyzing?: boolean
    }
    ```

- **实时变更通知**：
  - `workspace.evolution.updated`
    ```typescript
    {
      type: "workspace.evolution.updated",
      payload: {
        workspaceId: string,
        digest: WorkspaceEvolutionDigest
      }
    }
    ```

---

## 5. UI & Interaction Design

### 5.1 工作区 Tab 栏集成

在 `packages/app/src/workspace-tabs/model.ts` 中注册 `{ kind: "reader"; workspaceId: string }`，作为工作区原生视窗，支持分屏对照：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [📖 Reader]  [🤖 #1 架构调研]  [🤖 #2 集群改造]  [📁 Changes (4)]  [⌨️ Terminal]  [+] │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 界面 ASCII 结构原型

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  Workspace: glorious-eagle  |  Branch: feat/cluster-migration  |  4 Agents   │
├──────────────────────────────────────────────────────────────────────────────┤
│ 📌 【工作区演进综述 Executive Summary】                                       │
│ 本工作区目标为完成 DocDB 集群化改造并解耦 Hub 独立部署。历经架构调研、双模式    │
│ 兼容设计、核心代码实现及 Superpowers 质量审查。当前已通过本地验证并完成评审。 │
│ 状态: ✅ 待合流 (Ready for PR)   共修改: 12 文件 (+450 / -82)   提交: 5 commits │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⏳ 【任务与演进脉络流 Evolution Timeline】                                    │
│                                                                              │
│  ○ 2026-09-27 09:16  [阶段 1: 架构预研]                                       │
│  │  🤖 Agent: codex (gemini-flash) · 耗时 33m · 状态: ✅ Completed            │
│  │  🎯 目标: 调研 DocDB 集群部署方式、底层存储机制及连接接口设计              │
│  │  💡 关键决策/发现:                                                         │
│  │     • 选定 Raft 复制协议搭配 S3 共享持久层存储                             │
│  │     • 对外暴露兼容 MongoDB 4.2 wire protocol，应用层透明接入               │
│  │  📄 产出: docs/arch/docdb-cluster.md                                      │
│  │  🔗 [查看原始对话]  [查看产物]                                            │
│  │                                                                           │
│  │─────────────────────────────────────────────────────────────              │
│  │                                                                           │
│  ○ 2026-09-27 10:58  [阶段 2: 方案与代码改造]                                 │
│  │  🤖 Agent: codex (gpt-5.4) · 耗时 2h 17m · 状态: ✅ Completed             │
│  │  🎯 目标: 解决 Standalone 与 Cluster 动态切换问题，重构服务初始化链路      │
│  │  💡 关键决策/发现:                                                         │
│  │     • 引入 ClusterConnectionManager 抽象连接池与故障转移                   │
│  │     • 移除 hardcoded standalone 环境变量，改为配置中心驱动                 │
│  │  📦 改动: 8 files (+320, -45) | Commit: `df2ba09` feat(deploy): add ...   │
│  │  🔗 [查看原始对话]  [查看变更 Diff]                                       │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 设计约束与平台规范

- 严格遵循 `docs/unistyles.md`：禁止调用 `useUnistyles()`，使用 `StyleSheet.create((theme) => ...)`。
- 遵循跨平台交互原则：操作按钮在 Web 端采用悬浮显式，在 Native 移动端采用常驻显式。

---

## 6. Implementation Stages & Verification Plan

1. **Protocol 实施**：新增 `packages/protocol` 中的 Schema 与 RPC 消息定义，并添加对应双向序列化测试。
2. **Server 核心服务**：
   - 建立 `WorkspaceEvolutionService` 与持久化目录 `$PASEO_HOME/cache/workspace-evolution/`。
   - 实现轻量提炼调度器，在 Agent 归档或进入 Idle 时触发异步增量提炼。
   - 编写 `workspace-evolution-service.test.ts` 进行无网络 mock 验证。
3. **App 客户端组件与 Tab 挂载**：
   - 实现 `WorkspaceReaderScreen` 及其子组件（`ReaderHeader`, `ExecutiveSummaryCard`, `EvolutionTimeline`）。
   - 在 Workspace Tab 调度中支持 `reader` 目标类型。
4. **端到端实机验证**：
   - 针对 `/Users/jerry/.paseo/worktrees/01v9kkez/glorious-eagle` 的 4 个历史 Agent 运行数据执行提取，验证真实脉络图呈现效果。
