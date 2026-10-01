# Gitea Workflow 纯净精炼 Workspace 标题设计规范 (Design Spec)

## 1. 目标与背景 (Goal & Background)

在 Gitea Workflow 自动化流水线（`plugin-custom/gitea-workflow`）中，当触发 `agent-auto`、`agent-plan` 或 `agent-ready` 时，系统会自动创建或重命名工作区（Workspace Title）。
原逻辑直接使用 `[#${issue.number}] ${issue.title}`，而实际业务中 Issue 标题经常包含大量内部管理元数据前缀（如 `[req/TR]`、`[S]`、`[P1]`、`SP1`、`[Core]` 等）。这些前缀不仅占据了移动端和桌面端极为有限的 Workspace 标签页空间，还造成了强烈的“视觉污染”，导致开发者无法直观一眼看出核心任务。

**用户决策要求**：

- **方案 A + Emoji（英文标识）**：
  - Bug 类：`🐞 #<Number> [Bug] <主标题>`
  - 需求/功能类：`✨ #<Number> [Feature] <主标题>`
- 彻底剔除 `SP1`、`[SP1]`、`[req/TR]`、`[S]`、`[P1]`、`[Core]`、`[BUG]` 等非核心视觉噪音。
- 保留主标题语义及多语言（中英文混合、标点）。

## 2. 算法与规则设计 (Algorithm & Rules)

### 2.1 类型判定规则 (Bug vs Feature)

按优先级判定：

1. **显式标签检查 (Labels)**：
   - 若 `issue.labels` 包含任意匹配 `/^(bug|defect|故障|缺陷|crash)/i`，判定为 **Bug** (`kind = "bug"`)；
   - 若 `issue.labels` 包含任意匹配 `/^(feat|feature|enhancement|req|需求)/i`，判定为 **Feature** (`kind = "feature"`)。
2. **标题文本特征分析 (Title Inspection)**：
   - 若标题前缀或标签中包含 `[bug]`、`[defect]`、`[crash]`、`bug:`、`fix:`、`修复`、`缺陷`、`报错`、`白屏`，判定为 **Bug**；
   - 若标题包含 `[feat]`、`[feature]`、`[req`、`[需求]`、`feat:`、`支持`、`新增`、`实现`，判定为 **Feature**；
3. **缺省兜底**：
   - 默认判定为 **Feature** (`kind = "feature"`)。

### 2.2 视觉噪音剥离算法 (Noise Stripping)

1. **方括号标签过滤**：
   - 剔除标题开头的所有方括号标签 `\[[^\]]+\]`（例如 `[req/TR]`、`[S]`、`[P1]`、`[SP1]`、`[Bug]`、`[Feature]`、`[Core]` 等）。
2. **裸露噪音过滤 (Bare Noise)**：
   - 剔除开头的常见前缀，如 `SP\d+`、`P[0-4]`、`Bug:`、`Feature:`、`Fix:`、`Req:` 等及其后跟随的冒号、短横杠和空格。
3. **标点与空白整理**：
   - 清除开头剩余的无意义字符（如 `-`、`:`、`：`、`_` 及空白）。
   - 若清洗后为空，则回退为截断的原标题。

### 2.3 最终标题格式化 (Final Formatter)

```typescript
export function formatWorkflowWorkspaceTitle(params: {
  issueNumber: number;
  rawTitle: string;
  labels?: Array<{ name: string } | string>;
}): string {
  // Bug -> "🐞 #<issueNumber> [Bug] <cleanTitle>"
  // Feature -> "✨ #<issueNumber> [Feature] <cleanTitle>"
}
```

## 3. 调用链与落地点 (Integration Points)

1. **核心解析模块**：
   - `plugin-custom/gitea-workflow/server/workspace-title.ts`：导出 `formatWorkflowWorkspaceTitle`、`cleanIssueTitle`、`detectIssueKind`。
2. **Poller 调度器** (`plugin-custom/gitea-workflow/server/poller.ts`)：
   - 在 `runCreate` 时，传入格式化后的精炼标题：
     `title: formatWorkflowWorkspaceTitle({ issueNumber: issue.number, rawTitle: issue.title, labels: issue.labels })`
   - 在 `indexStore.recordRun` 中记录该精炼标题。
3. **Agent 执行适配器** (`plugin-custom/gitea-workflow/server/adapters/agent-execute.ts`)：
   - 在 `wsRef.setTitle(...)` 时，同样调用 `formatWorkflowWorkspaceTitle` 设置精炼标题。
