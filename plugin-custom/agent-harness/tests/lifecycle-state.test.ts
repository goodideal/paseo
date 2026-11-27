import { describe, expect, it } from "vitest";
import {
  createInitialHarnessMetadata,
  shouldEnforceNativePlanMode,
  hasShortAffirmativeExecConfirmation,
  evaluateTurnAfterTransition,
  extractTimelineItems,
  hasExplicitExecTransitionIntent,
  inspectTurnTimeline,
  parseHarnessMetadata,
  reconcileRuntimeHarnessMetadata,
  tierToPhase,
} from "../shared/lifecycle-state.js";
import { resolveEffectiveHarnessConfig } from "../shared/config-resolver.js";
import { DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";
import {
  HARNESS_METADATA_KEY,
  HARNESS_METADATA_VERSION,
  type HarnessAgentMetadata,
} from "../shared/types.js";

describe("lifecycle-state", () => {
  describe("tierToPhase", () => {
    it("maps plan tier to design phase", () => {
      expect(tierToPhase("plan", "architect")).toBe("design");
      expect(tierToPhase("plan", "ui")).toBe("design");
      expect(tierToPhase("plan", "pm")).toBe("design");
    });

    it("maps flash tier to exec phase", () => {
      expect(tierToPhase("flash", "backend")).toBe("exec");
      expect(tierToPhase("flash", "ui")).toBe("exec");
      expect(tierToPhase("flash", "orchestrator")).toBe("exec");
    });

    it("maps review tier or review role to review phase", () => {
      expect(tierToPhase("review", "general")).toBe("review");
      expect(tierToPhase("review", "review")).toBe("review");
      expect(tierToPhase("plan", "review")).toBe("review");
      expect(tierToPhase("deep", "be-reviewer")).toBe("review");
      expect(tierToPhase("deep", "fe-reviewer")).toBe("review");
      expect(tierToPhase("deep", "ops-auditor")).toBe("review");
    });

    it("maps agent-team architect and pm suffixed roles to design phase", () => {
      expect(tierToPhase("deep", "fe-architect")).toBe("design");
      expect(tierToPhase("deep", "be-architect")).toBe("design");
      expect(tierToPhase("deep", "fe-pm")).toBe("design");
      expect(tierToPhase("standard", "be-developer", null, "design")).toBe("design");
    });
  });

  describe("createInitialHarnessMetadata", () => {
    it("initializes metadata with correct defaults", () => {
      const meta = createInitialHarnessMetadata({
        role: "ui",
        tier: "plan",
        model: "claude-3-7-sonnet",
        roleMatchedRule: "label:role",
        tierMatchedRule: "plan_keyword",
        userModelLocked: false,
        roleLockedByLabel: true,
      });

      expect(meta).toEqual({
        version: HARNESS_METADATA_VERSION,
        role: "ui",
        initialTier: "plan",
        currentTier: "plan",
        currentModel: "claude-3-7-sonnet",
        currentThinking: null,
        phase: "design",
        roleMatchedRule: "label:role",
        tierMatchedRule: "plan_keyword",
        userModelLocked: false,
        roleLockedByLabel: true,
        turnCount: 0,
        planTurnCount: 0,
        writeToolDetectedInPlan: false,
        handoffSuggestedAtTurn: null,
        autoDowngradedAtTurn: null,
        downgradeReason: null,
        lastProcessedTurnId: null,
        resumeModeId: null,
        lastBilledTier: null,
        lastBilledModel: null,
        lastBilledThinking: null,
      });
    });
  });

  describe("parseHarnessMetadata", () => {
    it("parses valid HarnessAgentMetadata object", () => {
      const valid = createInitialHarnessMetadata({
        role: "backend",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "keyword",
        tierMatchedRule: "default",
      });

      const parsed = parseHarnessMetadata(valid);
      expect(parsed).toEqual(valid);
    });

    it("parses from nested agent.metadata record with HARNESS_METADATA_KEY", () => {
      const valid = createInitialHarnessMetadata({
        role: "backend",
        tier: "flash",
        model: "flash",
        roleMatchedRule: "keyword",
        tierMatchedRule: "default",
      });

      const container = {
        otherPluginKey: { some: "data" },
        [HARNESS_METADATA_KEY]: valid,
      };

      const parsed = parseHarnessMetadata(container);
      expect(parsed).toEqual(valid);
    });

    it("returns null for invalid inputs", () => {
      expect(parseHarnessMetadata(null)).toBeNull();
      expect(parseHarnessMetadata(undefined)).toBeNull();
      expect(parseHarnessMetadata("not an object")).toBeNull();
      expect(parseHarnessMetadata({})).toBeNull();
      expect(parseHarnessMetadata({ version: "not-a-number" })).toBeNull();
    });
  });

  describe("inspectTurnTimeline", () => {
    it("scans only items after the last user message", () => {
      const items = [
        { type: "user_message", text: "First turn question" },
        { type: "tool_call", name: "Write", input: { file_path: "src/old.ts" } },
        { type: "assistant_message", text: "Answered" },
        { type: "user_message", text: "Second turn prompt" },
        { type: "tool_call", name: "Read", input: { file_path: "src/new.ts" } },
      ];

      const inspected = inspectTurnTimeline(items);
      expect(inspected.latestUserText).toBe("Second turn prompt");
      expect(inspected.detectedCodeWrite).toBe(false);
      expect(inspected.handoffInvoked).toBe(false);
    });

    it("detects code write tool targeting source files (.ts, .tsx, .css, etc.)", () => {
      const items = [
        { type: "user_message", text: "实施" },
        {
          type: "tool_call",
          name: "Edit",
          input: { file_path: "packages/app/src/components/button.tsx" },
        },
      ];

      const inspected = inspectTurnTimeline(items);
      expect(inspected.detectedCodeWrite).toBe(true);
    });

    it("detects code write tool using detail.filePath or detail.type", () => {
      const items = [
        { type: "user_message", text: "更新配置" },
        {
          type: "tool_call",
          name: "write_file",
          detail: { type: "write", filePath: "packages/server/config.json" },
        },
      ];

      const inspected = inspectTurnTimeline(items);
      expect(inspected.detectedCodeWrite).toBe(true);
    });

    it("detects code write tool with missing or empty file path as non-whitelisted", () => {
      const items = [
        { type: "user_message", text: "应用补丁" },
        {
          type: "tool_call",
          name: "apply_patch",
          input: {},
        },
      ];

      const inspected = inspectTurnTimeline(items);
      expect(inspected.detectedCodeWrite).toBe(true);
    });

    it("exempts documentation and spec files (.md, .mdx, .txt, openspec/**)", () => {
      const items = [
        { type: "user_message", text: "编写设计文档" },
        {
          type: "tool_call",
          name: "Write",
          input: { file_path: "openspec/changes/add-auth/proposal.md" },
        },
        {
          type: "tool_call",
          name: "Edit",
          input: { file_path: "docs/design.md" },
        },
        {
          type: "tool_call",
          name: "Write",
          input: { file_path: "GLOSSARY.md" },
        },
        {
          type: "tool_call",
          name: "Write",
          input: { file_path: "openspec\\changes\\add-auth\\proposal.md" },
        },
        {
          type: "tool_call",
          name: "Write",
          input: { file_path: "C:\\project\\openspec\\specs\\tasks.yaml" },
        },
      ];

      const inspected = inspectTurnTimeline(items);
      expect(inspected.detectedCodeWrite).toBe(false);
    });

    it("marks detectedCodeWrite if any path in replace_in_files is not exempt", () => {
      const items = [
        { type: "user_message", text: "修改多个文件" },
        {
          type: "tool_call",
          name: "replace_in_files",
          input: {
            paths: ["docs/readme.md", "src/index.ts"],
          },
        },
      ];

      const inspected = inspectTurnTimeline(items);
      expect(inspected.detectedCodeWrite).toBe(true);
    });

    it("detects paseo-handoff invocation via Skill tool or shell command", () => {
      const itemsSkill = [
        { type: "user_message", text: "交接" },
        {
          type: "tool_call",
          name: "Skill",
          input: { skill: "paseo-handoff", args: "hand off to flash" },
        },
      ];
      expect(inspectTurnTimeline(itemsSkill).handoffInvoked).toBe(true);

      const itemsShell = [
        { type: "user_message", text: "交接" },
        {
          type: "tool_call",
          name: "Bash",
          detail: {
            type: "shell",
            command: 'paseo run --workspace "$PASEO_WORKSPACE_ID" --label role=ui',
          },
        },
      ];
      expect(inspectTurnTimeline(itemsShell).handoffInvoked).toBe(true);
    });

    it("detects handoff when input or arguments is a JSON-encoded string", () => {
      const itemsInputJson = [
        {
          type: "tool_use",
          name: "Bash",
          input: JSON.stringify({ command: "paseo run --workspace ws1 --label role=backend" }),
        },
      ];
      expect(inspectTurnTimeline(itemsInputJson).handoffInvoked).toBe(true);

      const itemsArgsJson = [
        {
          type: "tool_call",
          name: "execute_command",
          arguments: JSON.stringify({ command: "paseo-handoff to backend" }),
        },
      ];
      expect(inspectTurnTimeline(itemsArgsJson).handoffInvoked).toBe(true);
    });

    it("extracts file paths when tool call args is a JSON-encoded string", () => {
      const itemsArgsJson = [
        {
          type: "tool_call",
          name: "Edit",
          args: JSON.stringify({ file_path: "src/server/index.ts" }),
        },
      ];
      expect(inspectTurnTimeline(itemsArgsJson).detectedCodeWrite).toBe(true);
    });

    it("detects Antigravity paseo.create_agent and mcp_paseo_create_agent specialist spawns as handoffs", () => {
      const mappedAgyCall = [
        { type: "user_message", text: "ok, continue" },
        {
          type: "tool_call",
          name: "paseo.create_agent",
          detail: {
            type: "unknown",
            input: { labels: { role: "ui" } },
          },
        },
      ];
      expect(inspectTurnTimeline(mappedAgyCall).handoffInvoked).toBe(true);

      const rawMcpLeafCall = [
        { type: "user_message", text: "开始审查" },
        {
          type: "tool_call",
          name: "mcp_paseo_create_agent",
          input: { labels: { "paseo.harness-leaf": "1" } },
        },
      ];
      expect(inspectTurnTimeline(rawMcpLeafCall).handoffInvoked).toBe(true);

      const nonHarnessSpawn = [
        { type: "user_message", text: "create helper" },
        {
          type: "tool_call",
          name: "mcp_paseo_create_agent",
          input: { labels: { custom: "helper" } },
        },
      ];
      expect(inspectTurnTimeline(nonHarnessSpawn).handoffInvoked).toBe(false);
    });

    it("supports mixed-case path keys and exempts .gemini/antigravity-cli/brain/ planning docs", () => {
      const brainDocCall = [
        { type: "user_message", text: "write brain artifact" },
        {
          type: "tool_call",
          name: "write_to_file",
          input: {
            TargetFile:
              "/Users/jerry/.gemini/antigravity-cli/brain/conv-123/implementation_plan.json",
          },
        },
        {
          type: "tool_call",
          name: "Write",
          input: {
            Path: "/Users/jerry/.gemini/antigravity-cli/brain/conv-123/scratch/notes.ts",
          },
        },
      ];
      expect(inspectTurnTimeline(brainDocCall).detectedCodeWrite).toBe(false);

      for (const [key, val] of [
        ["Path", "src/app.ts"],
        ["TargetFile", "src/server.ts"],
        ["filepath", "src/util.ts"],
        ["destination", "src/dest.ts"],
        ["TargetDir", "src/out"],
      ] as const) {
        const writeCall = [
          { type: "user_message", text: "edit code" },
          {
            type: "tool_call",
            name: "write_to_file",
            input: { [key]: val },
          },
        ];
        expect(
          inspectTurnTimeline(writeCall).detectedCodeWrite,
          `Key ${key} should detect code write`,
        ).toBe(true);
      }

      const arrayPathsCall = [
        { type: "user_message", text: "edit files" },
        {
          type: "tool_call",
          name: "replace_in_files",
          args: { files: ["/Users/jerry/.gemini/antigravity-cli/brain/c1/a.md", "src/b.ts"] },
        },
      ];
      expect(inspectTurnTimeline(arrayPathsCall).detectedCodeWrite).toBe(true);
    });

    it("detects Antigravity exit_plan_mode as planExitInvoked and writable invoke_subagent as writableSubagentInvoked", () => {
      const exitPlanTimeline = [
        { type: "user_message", text: "design plan" },
        { type: "tool_call", name: "exit_plan_mode", input: {} },
      ];
      const exitInspected = inspectTurnTimeline(exitPlanTimeline);
      expect(exitInspected.planExitInvoked).toBe(true);
      expect(exitInspected.writableSubagentInvoked).toBe(false);

      for (const writableType of ["impl-worker", "ui-specialist", "ops-specialist", "self"]) {
        const writableSubagentTimeline = [
          { type: "user_message", text: "delegate implementation" },
          {
            type: "tool_call",
            name: "invoke_subagent",
            input: { TypeName: writableType, Task: "Implement module" },
          },
        ];
        const res = inspectTurnTimeline(writableSubagentTimeline);
        expect(res.writableSubagentInvoked, `TypeName=${writableType} should be writable`).toBe(
          true,
        );
      }

      for (const readonlyType of ["research", "spec-critic", "code-reviewer", "qa-verifier"]) {
        const readonlySubagentTimeline = [
          { type: "user_message", text: "inspect codebase" },
          {
            type: "tool_call",
            name: "invoke_subagent",
            input: { TypeName: readonlyType, Task: "Inspect files" },
          },
        ];
        const res = inspectTurnTimeline(readonlySubagentTimeline);
        expect(res.writableSubagentInvoked, `TypeName=${readonlyType} should NOT be writable`).toBe(
          false,
        );
      }
    });
  });

  describe("hasExplicitExecTransitionIntent", () => {
    it("recognizes Chinese exec transition phrases", () => {
      expect(hasExplicitExecTransitionIntent("好的，就按方案A改代码")).toBe(true);
      expect(hasExplicitExecTransitionIntent("按这个方案实现")).toBe(true);
      expect(hasExplicitExecTransitionIntent("直接改")).toBe(true);
      expect(hasExplicitExecTransitionIntent("直接写代码")).toBe(true);
      expect(hasExplicitExecTransitionIntent("直接落地")).toBe(true);
      expect(hasExplicitExecTransitionIntent("开始写代码")).toBe(true);
      expect(hasExplicitExecTransitionIntent("开始实施吧")).toBe(true);
      expect(hasExplicitExecTransitionIntent("启动服务")).toBe(true);
      expect(hasExplicitExecTransitionIntent("重启开发服务")).toBe(true);
    });

    it("recognizes English exec transition phrases", () => {
      expect(hasExplicitExecTransitionIntent("implement it")).toBe(true);
      expect(hasExplicitExecTransitionIntent("implement this plan")).toBe(true);
      expect(hasExplicitExecTransitionIntent("go ahead and implement")).toBe(true);
      expect(hasExplicitExecTransitionIntent("start implementing")).toBe(true);
      expect(hasExplicitExecTransitionIntent("start dev server")).toBe(true);
    });

    it("recognizes conventional commit prefixes", () => {
      expect(hasExplicitExecTransitionIntent("fix: resolve button alignment")).toBe(true);
      expect(hasExplicitExecTransitionIntent("feat: add toggle switch")).toBe(true);
    });

    it("rejects negative or discussion phrases", () => {
      expect(hasExplicitExecTransitionIntent("不要改代码，再想想")).toBe(false);
      expect(hasExplicitExecTransitionIntent("先别写，还有其他方案吗")).toBe(false);
      expect(hasExplicitExecTransitionIntent("先不要改，我们再对比一下")).toBe(false);
      expect(hasExplicitExecTransitionIntent("你怎么看这个方案？")).toBe(false);
    });
  });

  describe("evaluateTurnAfterTransition", () => {
    const baseSettings = {
      planTurnSoftLimit: 3,
      autoDowngradePlanOnExec: true,
    };

    it("increments counters and stays in plan on Turn 1 design discussion", () => {
      const meta = createInitialHarnessMetadata({
        role: "ui",
        tier: "plan",
        model: "custom/plan",
        roleMatchedRule: "ui_consultation",
        tierMatchedRule: "plan",
      });

      const evaluation = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_1",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "如何设计这个弹窗的布局？",
          detectedCodeWrite: false,
          handoffInvoked: false,
        },
        providerFlashModel: "custom/flash",
      });

      expect(evaluation.shouldDowngrade).toBe(false);
      expect(evaluation.nextMeta.turnCount).toBe(1);
      expect(evaluation.nextMeta.planTurnCount).toBe(1);
      expect(evaluation.nextMeta.currentTier).toBe("plan");
      expect(evaluation.nextMeta.phase).toBe("design");
      expect(evaluation.nextMeta.handoffSuggestedAtTurn).toBeNull();
    });

    it("triggers downgrade on Turn 2 when user gives explicit exec intent", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "custom/plan",
          roleMatchedRule: "ui_consultation",
          tierMatchedRule: "plan",
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const evaluation = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_2",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "好的，就按方案A改代码",
          detectedCodeWrite: false,
          handoffInvoked: false,
        },
        providerFlashModel: "custom/flash",
      });

      expect(evaluation.shouldDowngrade).toBe(true);
      expect(evaluation.downgradeReason).toBe("explicit_exec_intent");
      expect(evaluation.flashModel).toBe("custom/flash");
    });

    it("triggers downgrade when code write is detected in plan phase (even on Turn 1)", () => {
      const meta = createInitialHarnessMetadata({
        role: "ui",
        tier: "plan",
        model: "custom/plan",
        roleMatchedRule: "ui_consultation",
        tierMatchedRule: "plan",
      });

      const evaluation = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_1",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "调整样式",
          detectedCodeWrite: true,
          handoffInvoked: false,
        },
        providerFlashModel: "custom/flash",
      });

      expect(evaluation.shouldDowngrade).toBe(true);
      expect(evaluation.downgradeReason).toBe("write_tool_in_plan");
    });

    it("records handoffSuggestedAtTurn when planTurnCount reaches planTurnSoftLimit", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "custom/plan",
          roleMatchedRule: "ui_consultation",
          tierMatchedRule: "plan",
        }),
        turnCount: 2,
        planTurnCount: 2,
      };

      const evaluation = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_3",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "还有第三种布局方案吗？",
          detectedCodeWrite: false,
          handoffInvoked: false,
        },
        providerFlashModel: "custom/flash",
      });

      expect(evaluation.shouldDowngrade).toBe(false);
      expect(evaluation.nextMeta.turnCount).toBe(3);
      expect(evaluation.nextMeta.planTurnCount).toBe(3);
      expect(evaluation.nextMeta.handoffSuggestedAtTurn).toBe(3);
    });

    it("exempts downgrade if userModelLocked is true", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "custom/plan",
          roleMatchedRule: "ui_consultation",
          tierMatchedRule: "plan",
          userModelLocked: true,
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const evaluation = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_2",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "直接改代码",
          detectedCodeWrite: true,
          handoffInvoked: false,
        },
        providerFlashModel: "custom/flash",
      });

      expect(evaluation.canAutoDowngrade).toBe(false);
      expect(evaluation.shouldDowngrade).toBe(false);
    });

    it("exempts downgrade if roleLockedByLabel is true for architect or pm", () => {
      const architectMeta = {
        ...createInitialHarnessMetadata({
          role: "architect",
          tier: "plan",
          model: "claude-3-7-sonnet",
          roleMatchedRule: "label:role",
          tierMatchedRule: "role_tier:architect",
          roleLockedByLabel: true,
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const evaluation = evaluateTurnAfterTransition({
        meta: architectMeta,
        turnId: "turn_2",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "好的，就按方案A改代码",
          detectedCodeWrite: false,
          handoffInvoked: false,
        },
        providerFlashModel: "flash",
      });

      expect(evaluation.canAutoDowngrade).toBe(false);
      expect(evaluation.shouldDowngrade).toBe(false);
    });

    it("does not downgrade on explicit exec intent if handoffInvoked is true", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "custom/plan",
          roleMatchedRule: "ui_consultation",
          tierMatchedRule: "plan",
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const evaluation = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_2",
        settings: baseSettings,
        timelineInspection: {
          latestUserText: "好的，就按方案A改代码",
          detectedCodeWrite: false,
          handoffInvoked: true,
        },
        providerFlashModel: "custom/flash",
      });

      expect(evaluation.shouldDowngrade).toBe(false);
    });

    it("does not set writeToolDetectedInPlan when code write occurs in exec/flash phase", () => {
      const meta: HarnessAgentMetadata = {
        version: 1,
        role: "backend",
        initialTier: "flash",
        currentTier: "flash",
        currentModel: "flash",
        phase: "exec",
        roleMatchedRule: "rule",
        tierMatchedRule: "rule",
        userModelLocked: false,
        roleLockedByLabel: false,
        turnCount: 2,
        planTurnCount: 0,
        writeToolDetectedInPlan: false,
        handoffSuggestedAtTurn: null,
        autoDowngradedAtTurn: null,
        downgradeReason: null,
        lastProcessedTurnId: null,
        resumeModeId: null,
        lastBilledTier: "flash",
        lastBilledModel: "flash",
      };

      const result = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_exec_write",
        settings: {
          planTurnSoftLimit: 3,
          autoDowngradePlanOnExec: true,
        },
        timelineInspection: {
          latestUserText: "继续修改代码",
          detectedCodeWrite: true,
          handoffInvoked: false,
        },
      });

      expect(result.nextMeta.writeToolDetectedInPlan).toBe(false);
    });
  });

  describe("extractTimelineItems", () => {
    it("extracts from arrays, entries objects, and items objects", () => {
      expect(extractTimelineItems([1, 2])).toEqual([1, 2]);
      expect(extractTimelineItems({ items: [3, 4] })).toEqual([3, 4]);
      expect(extractTimelineItems({ entries: [{ item: 5 }, { item: 6 }] })).toEqual([5, 6]);
      expect(extractTimelineItems(null)).toEqual([]);
      expect(extractTimelineItems(undefined)).toEqual([]);
      expect(extractTimelineItems("string")).toEqual([]);
    });
  });

  describe("shouldEnforceNativePlanMode", () => {
    it("returns true when all conditions are met for human root agent", () => {
      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "ui",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "claude",
        }),
      ).toBe(true);

      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "general",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "opencode",
        }),
      ).toBe(true);
    });

    it("returns false for orchestrator or non-plan tiers", () => {
      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "orchestrator",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "claude",
        }),
      ).toBe(false);

      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "flash",
          role: "ui",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "claude",
        }),
      ).toBe(false);
    });

    it("returns false if userModelLocked or roleLockedByLabel or disabled in settings", () => {
      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: false,
          tier: "plan",
          role: "ui",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "claude",
        }),
      ).toBe(false);

      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "ui",
          userModelLocked: true,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "claude",
        }),
      ).toBe(false);

      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "ui",
          userModelLocked: false,
          roleLockedByLabel: true,
          hasParentAgent: false,
          provider: "claude",
        }),
      ).toBe(false);
    });

    it("returns false if hasParentAgent is true (exempts background subagents)", () => {
      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "architect",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: true,
          provider: "claude",
        }),
      ).toBe(false);
    });

    it("returns false if provider does not support native plan mode", () => {
      expect(
        shouldEnforceNativePlanMode({
          phaseLifecycleEnabled: true,
          enforceNativePlanMode: true,
          tier: "plan",
          role: "backend",
          userModelLocked: false,
          roleLockedByLabel: false,
          hasParentAgent: false,
          provider: "codex",
        }),
      ).toBe(false);
    });
  });

  describe("hasShortAffirmativeExecConfirmation", () => {
    it("returns false if planTurnCount < 1", () => {
      expect(hasShortAffirmativeExecConfirmation("yes", 0)).toBe(false);
      expect(hasShortAffirmativeExecConfirmation("好的", 0)).toBe(false);
    });

    it("matches English short affirmative words", () => {
      const words = [
        "yes",
        "yes, continue",
        "yes continue",
        "continue",
        "ok",
        "ok, continue",
        "ok continue",
        "okay",
        "okay, continue",
        "sure, continue",
        "go",
        "go ahead",
        "let's go",
        "proceed",
        "do it",
        "ship it",
        "sounds good",
        "lgtm",
      ];
      for (const w of words) {
        expect(hasShortAffirmativeExecConfirmation(w, 1)).toBe(true);
        expect(hasShortAffirmativeExecConfirmation(w.toUpperCase(), 1)).toBe(true);
        expect(hasShortAffirmativeExecConfirmation(w + "!", 2)).toBe(true);
      }
      expect(hasShortAffirmativeExecConfirmation("ok continue!", 1, ["ok, continue"])).toBe(true);
    });

    it("matches Chinese short affirmative words", () => {
      const words = [
        "好",
        "好的",
        "好，继续",
        "好的，继续",
        "好，开始",
        "好的，开始",
        "继续",
        "继续吧",
        "继续执行",
        "按方案执行",
        "改吧",
        "写吧",
        "开始",
        "开始吧",
        "可以",
        "可以，开始吧",
        "行",
        "行，改吧",
        "行改吧",
        "好的继续",
        "好继续",
        "可以开始吧",
        "好改吧",
        "好的改吧",
        "按这个来",
      ];
      for (const w of words) {
        expect(hasShortAffirmativeExecConfirmation(w, 1)).toBe(true);
        expect(hasShortAffirmativeExecConfirmation(w + "！", 1)).toBe(true);
      }
    });

    it("matches composite English and Chinese two-word affirmative phrases while rejecting questions and negations", () => {
      const compositePhrases = [
        "yes, go",
        "yes go",
        "yes please",
        "ok go",
        "ok proceed",
        "sure go",
        "go ahead",
        "sounds good, go",
        "好，开始",
        "好的，继续",
        "好的，开始执行",
        "可以，动手",
        "同意，继续",
      ];
      for (const phrase of compositePhrases) {
        expect(hasShortAffirmativeExecConfirmation(phrase, 1), `Failed: ${phrase}`).toBe(true);
      }

      expect(hasShortAffirmativeExecConfirmation("yes, go?", 1)).toBe(false);
      expect(hasShortAffirmativeExecConfirmation("好，开始？", 1)).toBe(false);
      expect(hasShortAffirmativeExecConfirmation("no, don't go", 1)).toBe(false);
      expect(hasShortAffirmativeExecConfirmation("not yet", 1)).toBe(false);
    });

    it("rejects negative phrases even if they contain affirmative words", () => {
      expect(hasShortAffirmativeExecConfirmation("先别写，再想想", 1)).toBe(false);
      expect(hasShortAffirmativeExecConfirmation("不要改代码", 1)).toBe(false);
      expect(hasShortAffirmativeExecConfirmation("还有别的方法吗", 1)).toBe(false);
    });

    it("rejects long text (>32 chars)", () => {
      expect(
        hasShortAffirmativeExecConfirmation(
          "好的，继续处理后续任务，但是我们需要非常注意各种情况的边界条件并进行全面的回归测试",
          1,
        ),
      ).toBe(false);
    });
  });

  describe("dual-state billing and orthogonal phase gating in evaluateTurnAfterTransition", () => {
    it("snapshots lastBilledTier and lastBilledModel upon transition to standard", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "deep",
          phase: "design",
          model: "pro",
          thinkingOptionId: "high",
          roleMatchedRule: "keyword",
          tierMatchedRule: "plan",
        }),
        turnCount: 1,
        planTurnCount: 1,
      };

      const result = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_2",
        settings: {
          planTurnSoftLimit: 3,
          autoDowngradePlanOnExec: true,
        },
        timelineInspection: {
          latestUserText: "yes, continue",
          detectedCodeWrite: false,
          handoffInvoked: false,
        },
        providerStandardModel: "flash",
        providerStandardThinking: "medium",
      });

      expect(result.shouldDowngrade).toBe(true);
      expect(result.downgradeReason).toBe("explicit_exec_intent");
      expect(result.nextMeta.currentTier).toBe("standard");
      expect(result.nextMeta.currentModel).toBe("flash");
      expect(result.nextMeta.currentThinking).toBe("medium");
      expect(result.nextMeta.phase).toBe("exec");
      expect(result.nextMeta.lastBilledTier).toBe("deep");
      expect(result.nextMeta.lastBilledModel).toBe("pro");
      expect(result.nextMeta.lastBilledThinking).toBe("high");
    });

    it("keeps deep or max writable in exec phase without enforcing plan mode or auto-downgrading on code writes", () => {
      for (const execTier of ["deep", "max"] as const) {
        expect(
          shouldEnforceNativePlanMode({
            phaseLifecycleEnabled: true,
            enforceNativePlanMode: true,
            tier: execTier,
            phase: "exec",
            role: "backend",
            userModelLocked: false,
            roleLockedByLabel: false,
            hasParentAgent: false,
            provider: "claude",
          }),
        ).toBe(false);

        const execMeta = createInitialHarnessMetadata({
          role: "backend",
          tier: execTier,
          phase: "exec",
          model: execTier === "max" ? "plan" : "pro",
          thinkingOptionId: execTier === "max" ? "xhigh" : "high",
          roleMatchedRule: "rpc",
          tierMatchedRule: "rpc:manual_switch",
        });

        const result = evaluateTurnAfterTransition({
          meta: execMeta,
          turnId: `turn_${execTier}_write`,
          settings: {
            planTurnSoftLimit: 3,
            autoDowngradePlanOnExec: true,
          },
          timelineInspection: {
            latestUserText: "修改核心协议并发逻辑",
            detectedCodeWrite: true,
            handoffInvoked: false,
          },
          providerStandardModel: "flash",
          providerStandardThinking: "medium",
        });

        expect(result.shouldDowngrade).toBe(false);
        expect(result.nextMeta.currentTier).toBe(execTier);
        expect(result.nextMeta.phase).toBe("exec");
        expect(result.nextMeta.writeToolDetectedInPlan).toBe(false);
      }
    });

    it("updates lastBilledTier/Model on regular completed standard turns", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "backend",
          tier: "standard",
          model: "claude-3-5-haiku",
          roleMatchedRule: "keyword",
          tierMatchedRule: "standard",
          lastBilledTier: "deep",
          lastBilledModel: "claude-3-7-sonnet",
        }),
        turnCount: 2,
        planTurnCount: 1,
        autoDowngradedAtTurn: 2,
      };

      const result = evaluateTurnAfterTransition({
        meta,
        turnId: "turn_3",
        settings: {
          planTurnSoftLimit: 3,
          autoDowngradePlanOnExec: true,
        },
        timelineInspection: {
          latestUserText: "check lint",
          detectedCodeWrite: false,
          handoffInvoked: false,
        },
        providerStandardModel: "claude-3-5-haiku",
      });

      expect(result.shouldDowngrade).toBe(false);
      expect(result.nextMeta.currentTier).toBe("standard");
      expect(result.nextMeta.lastBilledTier).toBe("standard");
      expect(result.nextMeta.lastBilledModel).toBe("claude-3-5-haiku");
    });

    it("reconciles drifted runtime thinkingOptionId even when snapshot model matches metadata", () => {
      const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
      const meta = createInitialHarnessMetadata({
        role: "general",
        tier: "deep",
        phase: "design",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "default_general",
        tierMatchedRule: "plan",
      });

      const reconciled = reconcileRuntimeHarnessMetadata({
        meta,
        snapshot: {
          model: "gemini-4-carbon",
          thinkingOptionId: "medium",
          runtimeInfo: { model: "gemini-4-carbon", thinkingOptionId: "medium" },
        },
        provider: "antigravity",
        config,
      });

      expect(reconciled.changed).toBe(true);
      expect(reconciled.meta.currentThinking).toBe("medium");
    });

    it("detects mid-session switch to bypassModels or bypassProviders and upgrades legacy deep+phase", () => {
      const config = resolveEffectiveHarnessConfig(DEFAULT_AGENT_HARNESS_SETTINGS);
      const activeMeta = createInitialHarnessMetadata({
        role: "backend",
        tier: "standard",
        phase: "exec",
        model: "gemini-4-neon",
        thinkingOptionId: "high",
        roleMatchedRule: "default_general",
        tierMatchedRule: "default_empty",
      });

      const bypassedModelResult = reconcileRuntimeHarnessMetadata({
        meta: activeMeta,
        snapshot: {
          runtimeInfo: { model: "gemini-pro-orchestrator-neon" },
        },
        provider: "antigravity",
        config,
      });
      expect(bypassedModelResult.bypassed).toBe(true);
      expect(bypassedModelResult.changed).toBe(false);

      const legacyReviewMeta = createInitialHarnessMetadata({
        role: "review",
        tier: "deep",
        phase: "review",
        model: "gemini-4-argon",
        thinkingOptionId: "high",
        roleMatchedRule: "label:role",
        tierMatchedRule: "review",
      });
      const upgradedReview = reconcileRuntimeHarnessMetadata({
        meta: legacyReviewMeta,
        snapshot: {
          runtimeInfo: { model: "gemini-4-argon", thinkingOptionId: "high" },
        },
        provider: "antigravity",
        config,
      });
      expect(upgradedReview.bypassed).toBe(false);
      expect(upgradedReview.changed).toBe(true);
      expect(upgradedReview.meta.currentTier).toBe("review");
      expect(upgradedReview.meta.initialTier).toBe("review");
    });

    it("downgrades design -> exec on planExitInvoked or writableSubagentInvoked, but stays in design on readonly subagent", () => {
      const designMeta = createInitialHarnessMetadata({
        role: "general",
        tier: "deep",
        phase: "design",
        model: "gemini-4-carbon",
        thinkingOptionId: "high",
        roleMatchedRule: "default_general",
        tierMatchedRule: "plan",
      });

      const exitEval = evaluateTurnAfterTransition({
        meta: designMeta,
        turnId: "turn_exit_plan",
        settings: { planTurnSoftLimit: 3, autoDowngradePlanOnExec: true },
        timelineInspection: {
          latestUserText: "设计架构方案",
          detectedCodeWrite: false,
          handoffInvoked: false,
          planExitInvoked: true,
          writableSubagentInvoked: false,
        },
        providerStandardModel: "gemini-4-argon",
        providerStandardThinking: "high",
      });
      expect(exitEval.shouldDowngrade).toBe(true);
      expect(exitEval.downgradeReason).toBe("plan_approved");
      expect(exitEval.nextMeta.phase).toBe("exec");
      expect(exitEval.nextMeta.currentTier).toBe("standard");

      const writableEval = evaluateTurnAfterTransition({
        meta: designMeta,
        turnId: "turn_writable_sub",
        settings: { planTurnSoftLimit: 3, autoDowngradePlanOnExec: true },
        timelineInspection: {
          latestUserText: "设计架构方案",
          detectedCodeWrite: false,
          handoffInvoked: false,
          planExitInvoked: false,
          writableSubagentInvoked: true,
        },
        providerStandardModel: "gemini-4-argon",
        providerStandardThinking: "high",
      });
      expect(writableEval.shouldDowngrade).toBe(true);
      expect(writableEval.downgradeReason).toBe("write_tool_in_plan");
      expect(writableEval.nextMeta.phase).toBe("exec");
      expect(writableEval.nextMeta.currentTier).toBe("standard");

      const readonlyEval = evaluateTurnAfterTransition({
        meta: designMeta,
        turnId: "turn_readonly_sub",
        settings: { planTurnSoftLimit: 3, autoDowngradePlanOnExec: true },
        timelineInspection: {
          latestUserText: "设计架构方案",
          detectedCodeWrite: false,
          handoffInvoked: false,
          planExitInvoked: false,
          writableSubagentInvoked: false,
        },
        providerStandardModel: "gemini-4-argon",
        providerStandardThinking: "high",
      });
      expect(readonlyEval.shouldDowngrade).toBe(false);
      expect(readonlyEval.nextMeta.phase).toBe("design");
    });

    it("rejects path traversal (..) and non-home .gemini/antigravity-cli/brain directories as exempt docs", () => {
      const traversalCases = [
        "openspec/../../src/app.ts",
        "docs/../src/secret.ts",
        "/Users/jerry/.gemini/antigravity-cli/brain/../../../projects/ai/paseo/src/index.ts",
        ".gemini\\antigravity-cli\\brain\\..\\..\\src\\index.ts",
        "/tmp/.gemini/antigravity-cli/brain/evil.ts",
        "/Users/jerry/repo/.gemini/antigravity-cli/brain/fake.ts",
        "repo/.gemini/antigravity-cli/brain/fake.ts",
        "/Users/jerry/.gemini/antigravity-cli/brain/",
      ];

      for (const filePath of traversalCases) {
        const res = inspectTurnTimeline([
          { type: "tool_call", name: "write_to_file", input: { TargetFile: filePath } },
        ]);
        expect(res.detectedCodeWrite, `expected detectedCodeWrite=true for ${filePath}`).toBe(true);
      }

      const validHomeCases = [
        "/home/alice/.gemini/antigravity-cli/brain/conv-1/plan.ts",
        "~/.gemini/antigravity-cli/brain/conv-2/scratch.ts",
      ];
      for (const filePath of validHomeCases) {
        const res = inspectTurnTimeline([
          { type: "tool_call", name: "write_to_file", input: { TargetFile: filePath } },
        ]);
        expect(res.detectedCodeWrite, `expected detectedCodeWrite=false for ${filePath}`).toBe(
          false,
        );
      }
    });
  });
});
