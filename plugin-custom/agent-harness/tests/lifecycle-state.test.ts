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
  tierToPhase,
} from "../shared/lifecycle-state.js";
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
    });

    it("recognizes English exec transition phrases", () => {
      expect(hasExplicitExecTransitionIntent("implement it")).toBe(true);
      expect(hasExplicitExecTransitionIntent("implement this plan")).toBe(true);
      expect(hasExplicitExecTransitionIntent("go ahead and implement")).toBe(true);
      expect(hasExplicitExecTransitionIntent("start implementing")).toBe(true);
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
        "okay",
        "go ahead",
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
    });

    it("matches Chinese short affirmative words", () => {
      const words = [
        "好",
        "好的",
        "好，继续",
        "好的，继续",
        "继续",
        "继续吧",
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

  describe("dual-state billing in evaluateTurnAfterTransition", () => {
    it("snapshots lastBilledTier and lastBilledModel upon transition to flash", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "ui",
          tier: "plan",
          model: "claude-3-7-sonnet",
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
        providerFlashModel: "claude-3-5-haiku",
      });

      expect(result.shouldDowngrade).toBe(true);
      expect(result.downgradeReason).toBe("explicit_exec_intent");
      expect(result.nextMeta.currentTier).toBe("flash");
      expect(result.nextMeta.currentModel).toBe("claude-3-5-haiku");
      expect(result.nextMeta.lastBilledTier).toBe("plan");
      expect(result.nextMeta.lastBilledModel).toBe("claude-3-7-sonnet");
    });

    it("updates lastBilledTier/Model on regular completed flash turns", () => {
      const meta = {
        ...createInitialHarnessMetadata({
          role: "backend",
          tier: "flash",
          model: "claude-3-5-haiku",
          roleMatchedRule: "keyword",
          tierMatchedRule: "flash",
          lastBilledTier: "plan",
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
        providerFlashModel: "claude-3-5-haiku",
      });

      expect(result.shouldDowngrade).toBe(false);
      expect(result.nextMeta.currentTier).toBe("flash");
      expect(result.nextMeta.lastBilledTier).toBe("flash");
      expect(result.nextMeta.lastBilledModel).toBe("claude-3-5-haiku");
    });
  });
});
