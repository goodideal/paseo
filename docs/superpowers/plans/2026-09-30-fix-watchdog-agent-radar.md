# 修复与重构 Agent Radar & Watchdog 守护机制实现计划 (Fix & Refactor Watchdog Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底整治 `agent-radar` 插件中 Watchdog 拦截机制的误报、不合理时机与诡异提示语，消除 5 轮死循环弹窗与主会话误拦截，让看门狗真正成为仅针对后台自主推进的静默安全阀。

**Architecture:**

1. 将 Watchdog 阻断评估严格约束为**自动推进（Auto-Continue）的从属保护**；未开启自动推进的普通交互回合正常停顿等待人类，严禁拦截或弹窗。
2. 彻底移除 `fatal: `、人机方案提问等误报率极高的粗暴正则，将决策卡片的“Retry”重构为语义中立的“继续推进（Continue）”。
3. 替换注入大模型的 Prompt 模板，废除误导大模型重做任务的“请重试该步骤”，并完善 `turn_started` 时清理历史阻断状态的生命周期。

**Tech Stack:** TypeScript, React Native, Vitest, Zod, Paseo Plugin Server/Client API.

**Spec:** `openspec/specs/agent-radar/spec.md`

## Global Constraints

- 严禁影响 Paseo 核心包（`packages/server` 等），所有改动严格收敛在 `plugin-custom/agent-radar/` 插件内。
- 保证前后端 RPC 契约与设置 Schema 向后兼容。
- 遵循 Biome 格式化与项目 TypeScript 严格类型规范。
- 单测与集成测试必须全部通过，运行命令仅限单文件：`npx vitest run plugin-custom/agent-radar/tests/<file> --bail=1`。

## Review Focus

1. **主交互 Agent 误拦截**: 普通用户与主 Agent 对话时（未开启自动推进），即使回复包含“请确认方案”或 Git 普通输错，也不得触发 `watchdog-blocker` 或阻断卡片。
2. **5 轮自动推进上限解除死循环**: 达到 `maxAutoTurns` 阻断后，用户选择“继续推进”时，注入的 Prompt 不得含有“重试该步骤”，不得误导 LLM 重新派发重复子代理。
3. **幽灵卡片残留清除**: 当阻断触发后，若用户直接在输入框继续发言并启动新回合，旧的 `activeBlocker` 必须在 `turn_started` 立即被清理。
4. **PR 合并安全门禁完备性**: 即使清理了其他误报，涉及真正的 `gh pr merge` 或 `git merge` 时仍必须按规范拦截交由人工确认。
5. **错误指纹假阳性规避**: 大模型在普通对话或代码讲解中提到 `Error: xxx`，不得连续两次就误报为未收敛死循环。

---

### Task 1: 修正 `ManagedGovernor` 判定规则，消除误判与假阳性 (Fix Evaluation Rules in ManagedGovernor)

**Files:**

- Modify: `plugin-custom/agent-radar/server/managed-governor.ts:150-260`
- Test: `plugin-custom/agent-radar/tests/server.test.ts`

**Interfaces:**

- Consumes: `WatchdogIntent`, `evaluateOutput(agentId, outputText, toolCalls, isAutoContinueEnabled)`
- Produces: 准确识别真实崩溃（线程超限）、PR合并、真实死循环；放过正常人类交互与普通文本错误引用

- [ ] **Step 1: 编写针对误报场景的失败单测 (Write failing unit tests)**

在 `plugin-custom/agent-radar/tests/server.test.ts` 中增加测试用例：

1. 普通对话中提到 `fatal: Not a valid object` 或解释 Git 命令时不触发 `BLOCKER_ESCALATE`；
2. Agent 向用户询问方案选择（“请确认方案 A 还是 B”）时，不返回 `BLOCKER_ESCALATE`，返回 `NEUTRAL`；
3. 未开启自动推进时，即使连续轮次也不触发 `BLOCKER_ESCALATE`；
4. 达到轮数上限时，阻断原因应标明是自动推进轮数上限而非模糊故障。

```typescript
it("should NOT escalate on fatal text explanation or normal human clarification", () => {
  const governor = new ManagedGovernor();
  expect(
    governor.evaluateOutput("agent-1", "如果遇到 fatal: remote not found，请检查网络", []),
  ).toBe("NEUTRAL");
  expect(governor.evaluateOutput("agent-1", "我们有两种方案，请选择方案 1 还是方案 2？", [])).toBe(
    "NEUTRAL",
  );
});
```

- [ ] **Step 2: 运行测试验证失败 (Run test to verify failure)**

运行命令：`npx vitest run plugin-custom/agent-radar/tests/server.test.ts --bail=1`  
预期：FAIL，因为现有逻辑中 `trimmedOutput.includes("fatal: ")` 和 `isHumanDecisionNeeded` 会返回 `BLOCKER_ESCALATE`。

- [ ] **Step 3: 优化 `ManagedGovernor.ts` 中的评估实现 (Implement minimal fix)**

1. 移除 `trimmedOutput.includes("fatal: ")`，仅保留 `collab spawn failed: agent thread limit reached` 以及显式 `ERR_BLOCKED`；
2. 移除 `isHumanDecisionNeeded` 作为错误阻断的逻辑（人机对话应自然停顿等待用户输入，而非触发异常卡片）；
3. 改进 `extractErrorFingerprint` 与连续错误计数，仅在有明确报错特征且处于自动推进连续轮次中生效；
4. 强化 `isPrMergeIntent`，确保真正合并 PR 时依然安全截停；
5. 在 `evaluateOutput` 中增加参数或重构，区分自动推进上下文。

- [ ] **Step 4: 运行测试验证通过 (Run test to verify pass)**

运行命令：`npx vitest run plugin-custom/agent-radar/tests/server.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交代码 (Commit)**

```bash
git add plugin-custom/agent-radar/server/managed-governor.ts plugin-custom/agent-radar/tests/server.test.ts
git commit -m "fix(agent-radar): eliminate false positive triggers in watchdog governor

- Remove raw 'fatal: ' string matching that blocked normal git command discussions
- Remove human decision matching from error escalation (allow normal conversation)
- Narrow non-convergence and flapping rules to avoid false positives

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 重构服务端生命周期与恢复提示词，杜绝 5 轮死循环与幽灵卡片 (Refactor Server Lifecycle & Prompt Injection)

**Files:**

- Modify: `plugin-custom/agent-radar/index.server.ts:80-270`
- Modify: `plugin-custom/agent-radar/shared/types.ts`
- Test: `plugin-custom/agent-radar/tests/integration.test.ts`
- Test: `plugin-custom/agent-radar/tests/server.test.ts`

**Interfaces:**

- Consumes: `PluginHookContext`, `agent.turn_started`, `agent.turn_ended`
- Produces:
  - 自动推进未开启时绝对不挂出阻断卡片
  - 回合启动时自动清理旧的 `activeBlockers`
  - 决策卡片提供“继续推进（Continue）”选项并注入中立指令：`【自动推进提示】用户已授权继续推进任务，请按原定计划与步骤继续执行下一步，无须重复上一轮动作。`

- [ ] **Step 1: 编写集成测试暴露 5 轮死循环与自动推进关闭时的误触发 (Write failing integration tests)**

在 `plugin-custom/agent-radar/tests/integration.test.ts` 中新增场景：

1. 当 `autoContinue` 为 `false` 且 Agent 未开启自动推进时，回合结束即使内容未完成，也绝对不向 timeline 发送 `watchdog-blocker`；
2. 当触发轮数上限时，决策选项为 `continue` 和 `pause`；
3. 选择 `continue` 决策后，发送的 prompt 必须为继续推进提示，严禁出现“请重试该步骤”；
4. 验证 `agent.turn_started` 时旧的 activeBlocker 被自动清除。

- [ ] **Step 2: 运行测试验证失败 (Run test to verify failure)**

运行命令：`npx vitest run plugin-custom/agent-radar/tests/integration.test.ts --bail=1`  
预期：FAIL。

- [ ] **Step 3: 重构 `index.server.ts` 中的事件与 RPC 逻辑 (Implement minimal fix)**

1. **`agent.turn_started`**：
   - 当收到 `turn_started` 时，执行 `activeBlockers.delete(agentId)`，彻底清理幽灵卡片。
2. **`agent.turn_ended` 门禁收敛**：
   - 计算 `isAutoContinueEnabled = governor.isAgentAutoContinueEnabled(agentId, configuredAutoContinue)`。
   - **核心改动**：如果 `!isAutoContinueEnabled` 且不是真正的系统级严重故障（如 `collab spawn failed`），则直接视为普通回合结束，不执行 `BLOCKER_ESCALATE`，不向时间线添加卡片！
3. **选项与恢复 Prompt 重构**：
   - 当由于轮数上限（Reached auto-turn limit）或普通等待阻断时，提供的选项为：
     - `id: "continue"`, `label: "继续推进"`, `description: "授权继续按计划自主执行下一阶段"`, `actionType: "retry_with_tip"`
     - `id: "pause"`, `label: "暂停"`, `description: "暂停自动推进，转为人工交互"`, `actionType: "pause"`
   - 在 `handleResolveDecision` 中：
     - 若 `option.id === "approve_pr"`：Prompt 为 `"已由用户在 Agent Radar 手动批准 PR 合并，请继续执行合并与验证。"`；
     - 若 `option.id === "continue"`：Prompt 为 `"【自动推进提示】用户已授权继续推进任务，请按原定计划与步骤继续执行下一步，无须重复上一轮动作。"`；
     - 其它恢复 Prompt 为中立指令，彻底删除带有诱导误判的“请重试该步骤”。

- [ ] **Step 4: 运行测试验证通过 (Run test to verify pass)**

运行命令：`npx vitest run plugin-custom/agent-radar/tests/integration.test.ts --bail=1`  
预期：PASS。

- [ ] **Step 5: 提交代码 (Commit)**

```bash
git add plugin-custom/agent-radar/index.server.ts plugin-custom/agent-radar/shared/types.ts plugin-custom/agent-radar/tests/integration.test.ts
git commit -m "fix(agent-radar): refactor watchdog lifecycle and replace misleading prompts

- Gate blocker escalation strictly to auto-continue enabled agents
- Clear stale blockers on turn_started to prevent ghost cards
- Replace misleading 'retry the step' prompt with forward-propelling continuation instruction
- Rename auto-turn limit option to '继续推进 (Continue)'

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 优化客户端决策卡片与动作按钮体验 (Refine Client DecisionCard UX)

**Files:**

- Modify: `plugin-custom/agent-radar/client/components/decision-card.tsx`
- Modify: `plugin-custom/agent-radar/client/components/action-buttons.tsx`
- Test: `plugin-custom/agent-radar/tests/client.test.tsx`

**Interfaces:**

- Consumes: `BlockerReport`, `useDecisionRpc`
- Produces: 清晰准确的决策按钮与状态文案（“已授权继续”而不是含糊的“已恢复”）

- [ ] **Step 1: 编写客户端组件单测 (Write unit tests)**

在 `plugin-custom/agent-radar/tests/client.test.tsx` 中校验：

1. 决策卡片在解决 `continue` 选项后，显示“✓ 已授权继续推进任务”；
2. 标题与文案清晰贴切，不给用户造成“系统报错瘫痪”的错觉。

- [ ] **Step 2: 运行测试确认结果并修改组件 (Run test and update components)**

修改 `decision-card.tsx`：

1. 已解决文案根据选项自定义（如 `continue` 显示“✓ 已授权继续，代理正推进下一步任务”）；
2. 完善徽标状态与可访问性标签。

- [ ] **Step 3: 运行客户端测试验证通过 (Run client test)**

运行命令：`npx vitest run plugin-custom/agent-radar/tests/client.test.tsx --bail=1`  
预期：PASS。

- [ ] **Step 4: 提交代码 (Commit)**

```bash
git add plugin-custom/agent-radar/client/components/decision-card.tsx plugin-custom/agent-radar/client/components/action-buttons.tsx plugin-custom/agent-radar/tests/client.test.tsx
git commit -m "refactor(agent-radar): refine decision card and action buttons UI copy

- Update resolved state copy to clearly reflect continued execution
- Polish accessibility labels and button color cues

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 全仓回归测试与质量检验 (Comprehensive Verification)

**Files:**

- Test: `plugin-custom/agent-radar/tests/*.ts`

- [ ] **Step 1: 运行 agent-radar 完整单测与集成测试**

运行：`npx vitest run plugin-custom/agent-radar/tests/ --bail=1`  
预期：所有测试套件（topology, sdd-parser, types, integration, client, server）100% 通过。

- [ ] **Step 2: 运行全仓类型检查**

运行：`npm run typecheck`  
预期：TypeScript 编译零报错。

- [ ] **Step 3: 运行代码规范检查与格式化**

运行：`npm run lint -- plugin-custom/agent-radar`  
运行：`npm run format:check`  
预期：零 Linter 告警，格式完全符合规范。

- [ ] **Step 4: 提交最终成果**

```bash
git add -A plugin-custom/agent-radar/
git commit -m "chore(agent-radar): complete watchdog refactor and regression tests

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
