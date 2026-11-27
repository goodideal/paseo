// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const mockUseSettings = vi.fn(() => ({ status: "ready", values: DEFAULT_AGENT_HARNESS_SETTINGS }));
const mockUseRpc = vi.fn((_contract?: any) => vi.fn().mockResolvedValue({}));
const mockToast = { show: vi.fn(), error: vi.fn() };
const mockUseAgent = vi.fn(() => ({
  status: "idle",
  provider: "claude",
  model: "flash",
  currentModeId: "acceptEdits",
  metadata: {},
}));
const mockUseComposers = vi.fn((): any[] => []);

const mockUseWorkspaces = vi.fn((): any[] => []);
const mockUsePaseo = vi.fn((): any => ({ workspaces: { ref: vi.fn() } }));
const mockUseFileText = vi.fn((): any => ({ status: "loading" }));

vi.mock("@getpaseo/plugin/client", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useSettings: (...args: any[]) => (mockUseSettings as any)(...args),
    useRpc: (...args: any[]) => (mockUseRpc as any)(...args),
    useAgent: (...args: any[]) => (mockUseAgent as any)(...args),
    useComposers: (...args: any[]) => (mockUseComposers as any)(...args),
    useWorkspaces: (...args: any[]) => (mockUseWorkspaces as any)(...args),
    usePaseo: (...args: any[]) => (mockUsePaseo as any)(...args),
    useFileText: (...args: any[]) => (mockUseFileText as any)(...args),
  };
});

vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsSection: ({ title, info, children }: any) =>
    React.createElement(
      "div",
      { "data-testid": "settings-section" },
      React.createElement("h3", null, title),
      info ? React.createElement("span", null, info) : null,
      children,
    ),
  SettingsCard: ({ children }: any) =>
    React.createElement("div", { "data-testid": "settings-card" }, children),
  SettingsRow: ({ label, hint, children }: any) =>
    React.createElement(
      "div",
      { "data-testid": "settings-row" },
      React.createElement("span", null, label),
      hint ? React.createElement("small", null, hint) : null,
      children,
    ),
  SettingsSwitch: ({ label, hint, value, onValueChange, disabled }: any) =>
    React.createElement(
      "label",
      null,
      label,
      hint ? React.createElement("small", null, hint) : null,
      React.createElement("input", {
        type: "checkbox",
        "aria-label": label,
        checked: Boolean(value),
        disabled: Boolean(disabled),
        onChange: (e: any) => onValueChange(Boolean(e.target.checked)),
      }),
    ),
  SettingsSelect: ({ label, value, options, onValueChange, disabled }: any) =>
    React.createElement(
      "div",
      { "data-testid": "settings-select" },
      label,
      React.createElement(
        "select",
        {
          "aria-label": label,
          value,
          disabled: Boolean(disabled),
          onChange: (e: any) => onValueChange(e.target.value),
        },
        options.map((o: any) =>
          React.createElement("option", { key: o.value, value: o.value }, o.label),
        ),
      ),
    ),
  SettingsInput: React.forwardRef(function MockSettingsInput(
    { label, hint, initialValue, onChangeText, placeholder, disabled, secureTextEntry }: any,
    ref: any,
  ) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      getText: () => inputRef.current?.value ?? "",
      replaceText: (text: string) => {
        if (inputRef.current) {
          inputRef.current.value = text;
        }
      },
    }));
    return React.createElement(
      "div",
      { "data-testid": "settings-input" },
      React.createElement("span", null, label),
      hint ? React.createElement("small", null, hint) : null,
      React.createElement("input", {
        ref: inputRef,
        type: secureTextEntry ? "password" : "text",
        "aria-label": label,
        defaultValue: initialValue ?? "",
        placeholder,
        disabled: Boolean(disabled),
        onChange: (e: any) => onChangeText(e.target.value),
      }),
    );
  }),
  SettingsAction: ({ label, hint, actionLabel, onPress, disabled }: any) =>
    React.createElement(
      "div",
      { "data-testid": "settings-action" },
      label ? React.createElement("span", null, label) : null,
      hint ? React.createElement("small", null, hint) : null,
      React.createElement(
        "button",
        {
          type: "button",
          disabled: Boolean(disabled),
          onClick: onPress,
        },
        actionLabel,
      ),
    ),
  Icon: ({ name }: any) => React.createElement("span", { "data-testid": `icon-${name}` }, name),
  Loading: () => React.createElement("div", { "data-testid": "loading" }, "Loading..."),
  Modal: Object.assign(
    ({ open, title, children }: any) =>
      open
        ? React.createElement(
            "div",
            { "data-testid": "modal", role: "dialog", "aria-label": title },
            React.createElement("h2", null, title),
            children,
          )
        : null,
    {
      Content: ({ children }: any) => React.createElement("div", null, children),
    },
  ),
  ScrollView: ({ children }: any) =>
    React.createElement("div", { "data-testid": "plugin-scroll-view" }, children),
  useToast: () => mockToast,
}));

import contribute from "../index.client.js";
import {
  HARNESS_METADATA_KEY,
  HARNESS_METADATA_VERSION,
  type HarnessAgentMetadata,
} from "../shared/types.js";
import { HARNESS_BYPASSED_META_KEY } from "../shared/lifecycle-state.js";
import {
  BUILTIN_PROVIDER_MAPPINGS,
  BUILTIN_PROVIDER_THINKING_MAPPINGS,
} from "../shared/presets.js";
import {
  HARNESS_TRANSITION_TIMELINE_KIND,
  HARNESS_TRANSITION_TIMELINE_VERSION,
  type HarnessTransitionPayload,
} from "../shared/contracts.js";
import {
  buildTransitionViewModel,
  extractAgentHarnessMetadata,
  formatHarnessPillLabel,
  formatRoleDisplayName,
  resolveHarnessPillIcon,
} from "../client/metadata-utils.js";
import { HarnessTransitionCard } from "../client/transition-card.js";
import { HarnessPopover } from "../client/harness-popover.js";
import {
  buildOrderedProviderIds,
  formatProviderDisplayLabel,
  resolveActiveHostProviderId,
} from "../client/provider-catalog.js";
import { BUILTIN_LAZY_TOOL_SLICES, HarnessSettingsScreen } from "../client/settings-screen.js";
import { AgentTeamFilePanelHost, WorkspaceTeamEditor } from "../client/team-editor-panel.js";
import { notifyWorkspaceTeamUpdated } from "../client/team-events.js";
import { DEFAULT_AGENT_HARNESS_SETTINGS } from "../shared/settings.js";
import type {
  PluginButtonRegistration,
  PluginClientContext,
  PluginCommandCenterItemContribution,
  PluginComposerPillContribution,
  PluginSettingsScreenContribution,
  PluginTimelineRendererContribution,
} from "@getpaseo/plugin/client";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createSampleMetadata(overrides: Partial<HarnessAgentMetadata> = {}): HarnessAgentMetadata {
  return {
    version: HARNESS_METADATA_VERSION,
    role: "ui",
    initialTier: "plan",
    currentTier: "plan",
    currentModel: "claude-3-7-sonnet",
    phase: "design",
    roleMatchedRule: "rule_ui_keyword",
    tierMatchedRule: "rule_plan_design",
    userModelLocked: false,
    roleLockedByLabel: false,
    turnCount: 2,
    planTurnCount: 2,
    writeToolDetectedInPlan: false,
    handoffSuggestedAtTurn: null,
    autoDowngradedAtTurn: null,
    downgradeReason: null,
    lastProcessedTurnId: "turn-1",
    resumeModeId: "acceptEdits",
    lastBilledTier: null,
    lastBilledModel: null,
    ...overrides,
  };
}

describe("Agent Harness Client - Metadata Utils", () => {
  describe("extractAgentHarnessMetadata", () => {
    it("returns null for null, undefined, or non-object values", () => {
      expect(extractAgentHarnessMetadata(null)).toBeNull();
      expect(extractAgentHarnessMetadata(undefined)).toBeNull();
      expect(extractAgentHarnessMetadata("string")).toBeNull();
      expect(extractAgentHarnessMetadata(123)).toBeNull();
    });

    it("returns null when agentHarness key is missing", () => {
      expect(extractAgentHarnessMetadata({})).toBeNull();
      expect(extractAgentHarnessMetadata({ otherKey: 123 })).toBeNull();
    });

    it("returns null when agentHarness does not match schema", () => {
      expect(
        extractAgentHarnessMetadata({
          [HARNESS_METADATA_KEY]: { invalid: true },
        }),
      ).toBeNull();
    });

    it("successfully parses valid metadata", () => {
      const validMeta = createSampleMetadata();
      const parsed = extractAgentHarnessMetadata({
        [HARNESS_METADATA_KEY]: validMeta,
      });
      expect(parsed).toEqual(validMeta);
    });
  });

  describe("formatRoleDisplayName", () => {
    it("formats UI, PM, QA in all-caps", () => {
      expect(formatRoleDisplayName("ui")).toBe("UI");
      expect(formatRoleDisplayName("pm")).toBe("PM");
      expect(formatRoleDisplayName("qa")).toBe("QA");
    });

    it("formats review as Gate", () => {
      expect(formatRoleDisplayName("review")).toBe("Gate");
    });

    it("capitalizes standard roles", () => {
      expect(formatRoleDisplayName("backend")).toBe("Backend");
      expect(formatRoleDisplayName("architect")).toBe("Architect");
      expect(formatRoleDisplayName("orchestrator")).toBe("Orchestrator");
      expect(formatRoleDisplayName("scout")).toBe("Scout");
      expect(formatRoleDisplayName("general")).toBe("General");
    });
  });

  describe("formatHarnessPillLabel", () => {
    it("returns Harness when metadata is null", () => {
      expect(formatHarnessPillLabel(null)).toBe("Harness");
    });

    it("returns honest dual-state copy when lastBilledTier differs from currentTier", () => {
      const dualStateMeta = createSampleMetadata({
        currentTier: "flash",
        lastBilledTier: "plan",
        role: "backend",
      });
      expect(formatHarnessPillLabel(dualStateMeta)).toBe("Next: Flash · Billed: Plan");

      const reviewMeta = createSampleMetadata({
        currentTier: "review",
        lastBilledTier: "flash",
        role: "review",
      });
      expect(formatHarnessPillLabel(reviewMeta)).toBe("Next: Review · Billed: Flash");
    });

    it("returns compact copy when lastBilledTier matches currentTier or is null", () => {
      const planUi = createSampleMetadata({
        currentTier: "plan",
        role: "ui",
        lastBilledTier: null,
      });
      expect(formatHarnessPillLabel(planUi)).toBe("Plan · UI");

      const flashBackend = createSampleMetadata({
        currentTier: "flash",
        role: "backend",
        lastBilledTier: "flash",
      });
      expect(formatHarnessPillLabel(flashBackend)).toBe("Flash · Backend");

      const reviewGate = createSampleMetadata({
        currentTier: "review",
        role: "review",
        lastBilledTier: "review",
      });
      expect(formatHarnessPillLabel(reviewGate)).toBe("Review · Gate");

      const planPm = createSampleMetadata({
        currentTier: "plan",
        role: "pm",
        lastBilledTier: null,
      });
      expect(formatHarnessPillLabel(planPm)).toBe("Plan · PM");

      const flashQa = createSampleMetadata({
        currentTier: "flash",
        role: "qa",
        lastBilledTier: null,
      });
      expect(formatHarnessPillLabel(flashQa)).toBe("Flash · QA");
    });
  });

  describe("resolveHarnessPillIcon", () => {
    it("returns Zap when metadata is null", () => {
      expect(resolveHarnessPillIcon(null)).toBe("Zap");
    });

    it("returns icons across legacy and 5-tier names", () => {
      const metaPlan = createSampleMetadata({ currentTier: "plan" });
      expect(resolveHarnessPillIcon(metaPlan)).toBe("Compass");

      expect(resolveHarnessPillIcon(createSampleMetadata({ currentTier: "fast" }))).toBe("Zap");
      expect(resolveHarnessPillIcon(createSampleMetadata({ currentTier: "standard" }))).toBe("Cpu");
      expect(
        resolveHarnessPillIcon(createSampleMetadata({ currentTier: "plan", phase: "exec" })),
      ).toBe("Compass");
      expect(
        resolveHarnessPillIcon(createSampleMetadata({ currentTier: "review", phase: "exec" })),
      ).toBe("ShieldCheck");
      expect(resolveHarnessPillIcon(createSampleMetadata({ currentTier: "deep" }))).toBe("Compass");
      expect(resolveHarnessPillIcon(createSampleMetadata({ currentTier: "max" }))).toBe("Flame");
    });

    it("returns ShieldCheck for review tier or review phase", () => {
      const meta = createSampleMetadata({ currentTier: "review" });
      expect(resolveHarnessPillIcon(meta)).toBe("ShieldCheck");

      const metaDeepReview = createSampleMetadata({ currentTier: "deep", phase: "review" });
      expect(resolveHarnessPillIcon(metaDeepReview)).toBe("ShieldCheck");
    });

    it("returns Zap for flash tier", () => {
      const meta = createSampleMetadata({ currentTier: "flash" });
      expect(resolveHarnessPillIcon(meta)).toBe("Zap");
    });
  });

  describe("buildTransitionViewModel", () => {
    it("maps initial_route correctly", () => {
      const payload: HarnessTransitionPayload = {
        transitionKind: "initial_route",
        role: "ui",
        fromTier: null,
        toTier: "plan",
        fromModel: null,
        toModel: "claude-3-7-sonnet",
        phase: "design",
        reason: "initial_route",
        turnNumber: 0,
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Initial Route");
      expect(vm.badgeCategory).toBe("accent");
      expect(vm.icon).toBe("Compass");
      expect(vm.tierSummary).toBe("Plan");
      expect(vm.modelSummary).toBe("claude-3-7-sonnet");
      expect(vm.readableReason).toBe("Initial domain role and model tier assigned");
    });

    it("maps plan_approved correctly", () => {
      const payload: HarnessTransitionPayload = {
        transitionKind: "plan_approved",
        role: "backend",
        fromTier: "deep",
        toTier: "standard",
        fromModel: "pro",
        toModel: "flash",
        phase: "exec",
        reason: "plan_approved",
        turnNumber: 3,
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Plan Approved -> Standard");
      expect(vm.badgeCategory).toBe("success");
      expect(vm.icon).toBe("ShieldCheck");
      expect(vm.tierSummary).toBe("Deep -> Standard");
      expect(vm.modelSummary).toBe("pro -> flash");
      expect(vm.fullMigrationSummary).toBe("deep (pro) -> standard (flash)");
      expect(vm.readableReason).toBe("Plan mode exit approved by user");
    });

    it("maps auto_downgrade correctly", () => {
      const payload: HarnessTransitionPayload = {
        transitionKind: "auto_downgrade",
        role: "ui",
        fromTier: "deep",
        toTier: "standard",
        fromModel: "pro",
        toModel: "flash",
        phase: "exec",
        reason: "write_tool_in_plan",
        turnNumber: 2,
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Auto Stepped Down -> Standard");
      expect(vm.badgeCategory).toBe("warning");
      expect(vm.icon).toBe("Zap");
      expect(vm.readableReason).toBe("Write/modification tool detected during plan phase");
    });

    it("maps manual_switch correctly", () => {
      const payload: HarnessTransitionPayload = {
        transitionKind: "manual_switch",
        role: "qa",
        fromTier: "flash",
        toTier: "review",
        fromModel: "claude-3-5-haiku",
        toModel: "claude-3-7-sonnet",
        phase: "review",
        reason: "manual_switch",
        turnNumber: 5,
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Manual Tier Switch");
      expect(vm.badgeCategory).toBe("accent");
      expect(vm.icon).toBe("Sliders");
    });

    it("maps specialist_handoff with child agent info correctly", () => {
      const payload: HarnessTransitionPayload = {
        transitionKind: "specialist_handoff",
        role: "orchestrator",
        fromTier: "plan",
        toTier: "flash",
        fromModel: "claude-3-7-sonnet",
        toModel: "claude-3-5-haiku",
        phase: "exec",
        reason: "specialist_handoff",
        turnNumber: 4,
        childAgentId: "child-agent-123",
        childAgentTitle: "[Backend] API Implementation",
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Specialist Handoff");
      expect(vm.badgeCategory).toBe("accent");
      expect(vm.icon).toBe("GitFork");
      expect(vm.childAgentId).toBe("child-agent-123");
      expect(vm.childAgentTitle).toBe("[Backend] API Implementation");
    });
  });
});

describe("Agent Harness Client - Extension Contributions", () => {
  it("registers timeline renderer, settings screen, command center item, and composer pills", async () => {
    vi.useFakeTimers();
    try {
      const timelineRenderers: PluginTimelineRendererContribution[] = [];
      const settingsScreens: PluginSettingsScreenContribution[] = [];
      const commandCenterItems: PluginCommandCenterItemContribution[] = [];
      const pills: PluginComposerPillContribution[] = [];

      const mockPillUpdates: Array<Record<string, unknown>> = [];
      const mockPillRemoves: string[] = [];

      let agentUpdateCallback: ((msg: any) => void) | null = null;
      const mockUnsub = vi.fn();
      const mockClose = vi.fn();

      const mockClient: Partial<PluginClientContext> = {
        addTimelineRenderer: vi.fn((contrib: PluginTimelineRendererContribution) => {
          timelineRenderers.push(contrib);
          return () => {
            const idx = timelineRenderers.indexOf(contrib);
            if (idx >= 0) timelineRenderers.splice(idx, 1);
          };
        }),
        addSettingsScreen: vi.fn((contrib: PluginSettingsScreenContribution) => {
          settingsScreens.push(contrib);
          return () => {
            const idx = settingsScreens.indexOf(contrib);
            if (idx >= 0) settingsScreens.splice(idx, 1);
          };
        }),
        addCommandCenterItem: vi.fn((contrib: PluginCommandCenterItemContribution) => {
          commandCenterItems.push(contrib);
          return () => {
            const idx = commandCenterItems.indexOf(contrib);
            if (idx >= 0) commandCenterItems.splice(idx, 1);
          };
        }),
        addComposerPill: vi.fn(
          (contrib: PluginComposerPillContribution): PluginButtonRegistration => {
            pills.push(contrib);
            return {
              update: vi.fn((patch) => {
                mockPillUpdates.push(patch);
              }),
              remove: vi.fn(() => {
                mockPillRemoves.push(contrib.agentId);
                const idx = pills.indexOf(contrib);
                if (idx >= 0) pills.splice(idx, 1);
              }),
            };
          },
        ),
        openSettings: vi.fn(),
        paseo: {
          agents: {
            list: vi.fn().mockResolvedValue({
              subscription: {
                subscribe: vi.fn(({ snapshot, update }) => {
                  agentUpdateCallback = update;
                  snapshot({
                    entries: [
                      {
                        agent: {
                          id: "agent-1",
                          workspaceId: "ws-1",
                          metadata: {
                            [HARNESS_METADATA_KEY]: createSampleMetadata({
                              currentTier: "plan",
                              role: "ui",
                            }),
                          },
                        },
                      },
                      {
                        agent: {
                          id: "agent-no-ws",
                          workspaceId: null,
                        },
                      },
                    ],
                  });
                  return mockUnsub;
                }),
                close: mockClose,
              },
            }),
          },
        } as any,
      };

      const disposePlugin = contribute(mockClient as PluginClientContext);

      // Verify timeline renderer registration
      expect(timelineRenderers).toHaveLength(1);
      expect(timelineRenderers[0]?.kind).toBe(HARNESS_TRANSITION_TIMELINE_KIND);
      expect(timelineRenderers[0]?.version).toBe(HARNESS_TRANSITION_TIMELINE_VERSION);

      // Verify settings screen registration
      expect(settingsScreens).toHaveLength(1);
      expect(settingsScreens[0]?.id).toBe("agent-harness-settings");
      expect(settingsScreens[0]?.title).toBe("Agent Harness");

      // Verify command center item registrations (global settings + workspace team editor)
      expect(commandCenterItems).toHaveLength(2);
      expect(commandCenterItems.map((c) => c.id)).toEqual([
        "agent-harness-settings-command",
        "agent-harness-workspace-team-command",
      ]);

      // Allow async agent subscription promise to resolve
      await Promise.resolve();

      // Initial mount yields briefly so quick-tools registers ahead of agent-harness
      expect(pills).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(150);

      // Verify composer pill registered for agent with workspaceId
      expect(pills).toHaveLength(1);
      expect(pills[0]?.agentId).toBe("agent-1");
      expect(pills[0]?.button.label).toBe("Plan · UI");
      expect(pills[0]?.button.icon).toBe("Compass");

      // Test agent_update: update existing pill with dual-state separation
      expect(agentUpdateCallback).not.toBeNull();
      agentUpdateCallback!({
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            id: "agent-1",
            workspaceId: "ws-1",
            metadata: {
              [HARNESS_METADATA_KEY]: createSampleMetadata({
                currentTier: "flash",
                lastBilledTier: "plan",
                role: "ui",
              }),
            },
          },
        },
      });

      expect(mockPillUpdates).toHaveLength(1);
      expect(mockPillUpdates[0]?.label).toBe("Next: Flash · Billed: Plan");
      expect(mockPillUpdates[0]?.icon).toBe("Zap");

      // Test agent_update with cleared workspaceId (zombie pill removal)
      agentUpdateCallback!({
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            id: "agent-1",
            workspaceId: null,
            metadata: {},
          },
        },
      });

      expect(mockPillRemoves).toContain("agent-1");
      expect(pills).toHaveLength(0);

      // Re-add agent-1 for remove test
      agentUpdateCallback!({
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: {
            id: "agent-1",
            workspaceId: "ws-1",
            metadata: {},
          },
        },
      });
      await vi.advanceTimersByTimeAsync(150);
      expect(pills).toHaveLength(1);

      // Test agent_update: remove agent
      agentUpdateCallback!({
        type: "agent_update",
        payload: {
          kind: "remove",
          agentId: "agent-1",
        },
      });

      expect(mockPillRemoves.filter((id) => id === "agent-1").length).toBe(2);
      expect(pills).toHaveLength(0);

      // Pending mount is cancelled cleanly if removed before delay elapses
      agentUpdateCallback!({
        type: "agent_update",
        payload: {
          kind: "upsert",
          agent: { id: "agent-ephemeral", workspaceId: "ws-1", metadata: {} },
        },
      });
      agentUpdateCallback!({
        type: "agent_update",
        payload: { kind: "remove", agentId: "agent-ephemeral" },
      });
      await vi.advanceTimersByTimeAsync(150);
      expect(pills).toHaveLength(0);

      // Test cleanup unsubscribes and closes subscription
      disposePlugin();
      expect(timelineRenderers).toHaveLength(0);
      expect(settingsScreens).toHaveLength(0);
      expect(commandCenterItems).toHaveLength(0);
      expect(mockUnsub).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes subscription immediately if cleanup was invoked before list promise resolved", async () => {
    const mockClose = vi.fn();
    const mockSubscribe = vi.fn();
    let resolveList: any;

    const mockClient: Partial<PluginClientContext> = {
      paseo: {
        agents: {
          list: vi.fn().mockReturnValue(
            new Promise((resolve) => {
              resolveList = resolve;
            }),
          ),
        },
      } as any,
    };

    const disposePlugin = contribute(mockClient as PluginClientContext);
    disposePlugin();

    resolveList({
      subscription: {
        subscribe: mockSubscribe,
        close: mockClose,
      },
    });

    await Promise.resolve();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});

describe("HarnessSettingsScreen - Forms Gate & State Handling", () => {
  const mockTheme = {
    colors: {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      border: "#333",
      foreground: "#fff",
      foregroundMuted: "#888",
    },
  } as any;

  const mockSurfaceProps = {
    theme: mockTheme,
    host: { id: "h1", label: "Local" },
    layout: { compact: false, platform: "web" as const },
  };

  it("renders loading indicator when status is loading", () => {
    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "loading",
          saving: false,
        },
      }),
    );

    expect(screen.getByText("Loading Agent Harness settings…")).toBeDefined();
    expect(screen.queryByText("Core Orchestration")).toBeNull();
  });

  it("renders error state with retry and reset actions when status is error", () => {
    const mockReload = vi.fn();
    const mockReset = vi.fn().mockResolvedValue(true);

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "error",
          error: "Failed to connect to daemon",
          saving: false,
          reload: mockReload,
          reset: mockReset,
        },
      }),
    );

    expect(screen.getByText("Configuration Status")).toBeDefined();
    expect(screen.getByText("Error Loading Settings")).toBeDefined();
    expect(screen.getByText("Failed to connect to daemon")).toBeDefined();

    // Verify switches are not rendered
    expect(screen.queryByText("Enable Agent Harness")).toBeNull();

    // Test retry button
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(mockReload).toHaveBeenCalledTimes(1);

    // Test reset button
    const resetBtn = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(resetBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("renders invalid state with retry and reset fallback to save when reset is unavailable", () => {
    const mockSave = vi.fn().mockResolvedValue(true);

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "invalid",
          error: "Schema validation failed for planTurnSoftLimit",
          revision: "rev-42",
          saving: false,
          save: mockSave,
        },
      }),
    );

    expect(screen.getByText("Invalid Settings Schema")).toBeDefined();
    expect(screen.getByText("Schema validation failed for planTurnSoftLimit")).toBeDefined();

    // Verify switches are not rendered
    expect(screen.queryByText("Core Orchestration")).toBeNull();

    // Test reset button falls back to save(DEFAULT_AGENT_HARNESS_SETTINGS)
    const resetBtn = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(resetBtn);
    expect(mockSave).toHaveBeenCalledWith(DEFAULT_AGENT_HARNESS_SETTINGS, "rev-42");
  });

  it("renders interactive switches when status is ready", () => {
    const mockSave = vi.fn().mockResolvedValue(true);

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "ready",
          values: DEFAULT_AGENT_HARNESS_SETTINGS,
          revision: "rev-1",
          saving: false,
          save: mockSave,
        },
      }),
    );

    expect(screen.getByText("Core Orchestration")).toBeDefined();
    expect(screen.getByText("Phase Lifecycle & Gates")).toBeDefined();
    expect(screen.getByText("Enable Agent Harness")).toBeDefined();
    expect(screen.getByText("Override Default Model Only")).toBeDefined();
    expect(screen.queryByTestId("plugin-scroll-view")).toBeNull();

    const switchInput = screen.getByLabelText("Enable Agent Harness");
    fireEvent.click(switchInput);

    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), "rev-1");
  });

  it("edits Antigravity provider mappings and specialist preferredProvider in HarnessSettingsScreen", () => {
    const mockSave = vi.fn().mockResolvedValue(true);

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "ready",
          values: DEFAULT_AGENT_HARNESS_SETTINGS,
          revision: "rev-matrix-1",
          saving: false,
          save: mockSave,
        },
      }),
    );

    expect(screen.getByText("Provider Tier Mappings & Bypass")).toBeDefined();
    expect(screen.getByText("Specialist Roles Matrix")).toBeDefined();

    // Verify antigravity target provider is selected by default and edit Standard Model & Thinking
    const targetProviderSelect = screen.getByLabelText("Target Provider") as HTMLSelectElement;
    expect(targetProviderSelect.value).toBe("antigravity");

    // Conditional custom model input is hidden until "__custom__" is chosen or stored
    expect(screen.queryByLabelText("Fast Custom Model ID")).toBeNull();

    const standardModelSelect = screen.getByLabelText("Standard Model") as HTMLSelectElement;
    fireEvent.change(standardModelSelect, { target: { value: "gemini-4-argon" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMappings: expect.objectContaining({
          antigravity: expect.objectContaining({
            standard: "gemini-4-argon",
          }),
        }),
      }),
      "rev-matrix-1",
    );

    // Editing Plan Model syncs `deep` alongside `plan` for lossless gitea-workflow compatibility
    const planModelSelect = screen.getByLabelText("Plan Model") as HTMLSelectElement;
    fireEvent.change(planModelSelect, { target: { value: "gemini-4-neon" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMappings: expect.objectContaining({
          antigravity: expect.objectContaining({
            plan: "gemini-4-neon",
            deep: "gemini-4-neon",
          }),
        }),
      }),
      "rev-matrix-1",
    );

    const planThinkingSelect = screen.getByLabelText("Plan Thinking") as HTMLSelectElement;
    fireEvent.change(planThinkingSelect, { target: { value: "xhigh" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        providerThinkingMappings: expect.objectContaining({
          antigravity: expect.objectContaining({
            plan: "xhigh",
            deep: "xhigh",
          }),
        }),
      }),
      "rev-matrix-1",
    );

    // Selecting Custom Model ID... reveals the custom input box dynamically
    const fastModelSelect = screen.getByLabelText("Fast Model") as HTMLSelectElement;
    fireEvent.change(fastModelSelect, { target: { value: "__custom__" } });
    expect(screen.getByLabelText("Fast Custom Model ID")).toBeDefined();

    // Reset Provider Mappings restores built-in 5-tier + deep defaults for Antigravity
    const resetProviderBtn = screen.getByRole("button", { name: "Reset defaults" });
    fireEvent.click(resetProviderBtn);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMappings: expect.objectContaining({
          antigravity: { ...BUILTIN_PROVIDER_MAPPINGS.antigravity },
        }),
        providerThinkingMappings: expect.objectContaining({
          antigravity: { ...BUILTIN_PROVIDER_THINKING_MAPPINGS.antigravity },
        }),
      }),
      "rev-matrix-1",
    );

    // Edit UI specialist preferredProvider -> antigravity
    const preferredProviderSelect = screen.getByLabelText(
      "Preferred Provider",
    ) as HTMLSelectElement;
    fireEvent.change(preferredProviderSelect, { target: { value: "antigravity" } });

    const lastCallValues = mockSave.mock.calls[mockSave.mock.calls.length - 1]?.[0];
    const updatedUi = lastCallValues.specialists.find((s: any) => s.id === "ui");
    expect(updatedUi?.preferredProvider).toBe("antigravity");
  });

  it("debounces SettingsInput saves without disabling text inputs and shows toast on save failure", async () => {
    vi.useFakeTimers();
    const mockSave = vi.fn().mockResolvedValue(false);
    try {
      render(
        React.createElement(HarnessSettingsScreen, {
          ...mockSurfaceProps,
          settingsOverride: {
            status: "ready",
            values: DEFAULT_AGENT_HARNESS_SETTINGS,
            revision: "rev-debounce-1",
            saving: true,
            save: mockSave,
          },
        }),
      );

      const bypassInput = screen.getByLabelText("Bypass Model Patterns") as HTMLInputElement;
      expect(bypassInput.disabled).toBe(false);

      fireEvent.change(bypassInput, {
        target: { value: "^gemini-pro-orchestrator, ^custom-orch" },
      });
      expect(mockSave).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(350);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          bypassModels: ["^gemini-pro-orchestrator", "^custom-orch"],
        }),
        "rev-debounce-1",
      );
      expect(mockToast.error).toHaveBeenCalledWith("Failed to save Agent Harness settings.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders Semantic Intent Router controls, omits deprecated v8 controls, and cascades routerProvider -> routerModel", () => {
    const mockSave = vi.fn().mockResolvedValue(true);

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            routerProvider: "",
            routerModel: "gemini-4-hydrogen",
          },
          revision: "rev-router-1",
          saving: false,
          save: mockSave,
        },
      }),
    );

    expect(screen.getByText("Semantic Intent Router")).toBeDefined();
    expect(screen.queryByText("L2 LLM Fallback Intent Classifier")).toBeNull();
    expect(screen.queryByLabelText("Classifier Endpoint URL")).toBeNull();
    expect(screen.queryByLabelText("Classifier API Key")).toBeNull();
    expect(screen.queryByLabelText("Enforce Session MCP Filtering")).toBeNull();

    // Toggle routerEnabled
    fireEvent.click(screen.getByLabelText("Enable Semantic Intent Router"));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ routerEnabled: false }),
      "rev-router-1",
    );

    // Changing Router Agent from Antigravity (with gemini-4-hydrogen) -> Claude cascades and clears routerModel
    const routerAgentSelect = screen.getByLabelText("Router Agent") as HTMLSelectElement;
    fireEvent.change(routerAgentSelect, { target: { value: "claude" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        routerProvider: "claude",
        routerModel: "",
      }),
      "rev-router-1",
    );

    // Router Reasoning Effort, Confidence Threshold, and Timeout
    fireEvent.change(screen.getByLabelText("Router Reasoning Effort"), {
      target: { value: "high" },
    });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ routerEffort: "high" }),
      "rev-router-1",
    );

    fireEvent.change(screen.getByLabelText("Confidence Threshold"), {
      target: { value: "0.90" },
    });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ routerConfidenceThreshold: 0.9 }),
      "rev-router-1",
    );

    fireEvent.change(screen.getByLabelText("Router Timeout"), {
      target: { value: "15000" },
    });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ routerTimeoutMs: 15000 }),
      "rev-router-1",
    );
  });

  it("prioritizes enabled host providers, reads modelDetails thinkingOptions, excludes gemini-3, and clears incompatible specialist modelOverride", async () => {
    const mockSave = vi.fn().mockResolvedValue(true);
    const inspectEnvMock = vi.fn().mockResolvedValue({
      availableProviders: [
        {
          provider: "claude",
          enabled: false,
          status: "disabled",
          models: ["claude-sonnet-4"],
        },
        {
          provider: "codex",
          enabled: true,
          status: "ready",
          defaultModel: "gpt-5.4",
          models: ["gpt-5.4", "gpt-5.4-mini", "gemini-3-pro", "gemini-pro-orchestrator"],
          modelDetails: [
            {
              id: "gpt-5.4",
              label: "GPT 5.4",
              isDefault: true,
              thinkingOptions: [
                { id: "low", label: "Low" },
                { id: "xhigh", label: "Extra High" },
              ],
            },
            { id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
            { id: "gemini-3-pro", label: "Deprecated Gemini 3" },
            { id: "gemini-pro-orchestrator", label: "Bypassed" },
          ],
        },
      ],
      diskProfiles: [],
      lazyToolSlices: [],
      hasRepoOverride: false,
      repoOverridePath: null,
      agentTeam: null,
      workspaces: [],
    });
    mockUseRpc.mockImplementation((contract: any) =>
      contract?.name === "agent_harness.environment.inspect.request"
        ? inspectEnvMock
        : vi.fn().mockResolvedValue({}),
    );

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            providerMappings: {
              ...DEFAULT_AGENT_HARNESS_SETTINGS.providerMappings,
              codex: {
                ...DEFAULT_AGENT_HARNESS_SETTINGS.providerMappings.codex,
                standard: "gpt-5.4",
              },
            },
            providerThinkingMappings: {
              ...DEFAULT_AGENT_HARNESS_SETTINGS.providerThinkingMappings,
              codex: {
                ...DEFAULT_AGENT_HARNESS_SETTINGS.providerThinkingMappings.codex,
                standard: "low",
              },
            },
            specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
              s.id === "ui" ? { ...s, preferredProvider: "codex", modelOverride: "gpt-5.4" } : s,
            ),
          },
          revision: "rev-host-1",
          saving: false,
          save: mockSave,
        },
      }),
    );

    // Target Provider auto-defaults to first enabled host provider (codex), NOT disabled claude or fallback antigravity
    const targetProviderSelect = screen.getByLabelText("Target Provider") as HTMLSelectElement;
    await vi.waitFor(() => {
      expect(targetProviderSelect.value).toBe("codex");
    });

    // Enabled provider appears before disabled provider with Active/Disabled suffixes
    const targetOptionTexts = Array.from(targetProviderSelect.options).map((o) => o.text);
    expect(targetOptionTexts[0]).toBe("Codex · Active");
    expect(targetOptionTexts).toContain("Claude · Disabled");

    // Excluded deprecated gemini-3, bypass models, AND unadvertised preset placeholders when live models exist
    const standardModelSelect = screen.getByLabelText("Standard Model") as HTMLSelectElement;
    const modelValues = Array.from(standardModelSelect.options).map((o) => o.value);
    expect(modelValues).toContain("gpt-5.4");
    expect(modelValues).toContain("gpt-5.4-mini");
    expect(modelValues).not.toContain("gemini-3-pro");
    expect(modelValues).not.toContain("gemini-pro-orchestrator");
    expect(modelValues).not.toContain("lite");
    expect(modelValues).not.toContain("flash");
    expect(modelValues).not.toContain("pro");

    // Standard Thinking uses modelDetails.thinkingOptions from inspected codex entry
    const standardThinkingSelect = screen.getByLabelText("Standard Thinking") as HTMLSelectElement;
    const thinkingValues = Array.from(standardThinkingSelect.options).map((o) => o.value);
    expect(thinkingValues).toEqual(["", "low", "xhigh"]);

    // Specialist Roles Matrix inherits Active host provider (Codex) and cascades clearing incompatible modelOverride
    const preferredProviderSelect = screen.getByLabelText(
      "Preferred Provider",
    ) as HTMLSelectElement;
    expect(Array.from(preferredProviderSelect.options)[0]?.text).toBe("Inherit (Active: Codex)");
    expect((screen.getByLabelText("Model Override ID") as HTMLInputElement).value).toBe("gpt-5.4");

    fireEvent.change(preferredProviderSelect, { target: { value: "claude" } });
    const lastCallValues = mockSave.mock.calls[mockSave.mock.calls.length - 1]?.[0];
    const updatedUi = lastCallValues.specialists.find((s: any) => s.id === "ui");
    expect(updatedUi?.preferredProvider).toBe("claude");
    expect(updatedUi?.modelOverride).toBe("");
    expect((screen.getByLabelText("Model Override ID") as HTMLInputElement).value).toBe("");
  });

  it("keeps offline Antigravity model fallback free of claude/gpt models and clears fast pending modelOverride on provider switch", async () => {
    vi.useFakeTimers();
    const mockSave = vi.fn().mockResolvedValue(true);
    try {
      render(
        React.createElement(HarnessSettingsScreen, {
          ...mockSurfaceProps,
          settingsOverride: {
            status: "ready",
            values: {
              ...DEFAULT_AGENT_HARNESS_SETTINGS,
              specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
                s.id === "ui" ? { ...s, preferredProvider: "antigravity", modelOverride: "" } : s,
              ),
            },
            revision: "rev-offline-1",
            saving: false,
            save: mockSave,
          },
        }),
      );

      // Offline Antigravity fallback must NOT include claude-* or gpt-* models
      const standardModelSelect = screen.getByLabelText("Standard Model") as HTMLSelectElement;
      const offlineModels = Array.from(standardModelSelect.options).map((o) => o.value);
      expect(offlineModels).toContain("gemini-4-hydrogen");
      expect(offlineModels).toContain("gemini-4-neon");
      expect(offlineModels).not.toContain("claude-sonnet-5-5");
      expect(offlineModels).not.toContain("gpt-oss-120b-medium");

      // Fast typing (<300ms debounce) into Model Override ID followed by switching to claude must clear pending override
      const overrideInput = screen.getByLabelText("Model Override ID") as HTMLInputElement;
      fireEvent.change(overrideInput, { target: { value: "gemini-4-hydrogen" } });
      expect(mockSave).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText("Preferred Provider"), {
        target: { value: "claude" },
      });

      expect(mockSave).toHaveBeenCalledTimes(1);
      const savedUi = mockSave.mock.calls[0]?.[0]?.specialists?.find((s: any) => s.id === "ui");
      expect(savedUi?.preferredProvider).toBe("claude");
      expect(savedUi?.modelOverride).toBe("");
      expect((screen.getByLabelText("Model Override ID") as HTMLInputElement).value).toBe("");

      await vi.advanceTimersByTimeAsync(350);
      expect(mockSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("HarnessPopover - Native Orchestrator & Dynamic Specialists", () => {
  const popoverTheme = {
    colors: {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      border: "#333",
      foreground: "#fff",
      foregroundMuted: "#888",
      accent: "#0af",
      statusWarning: "#fa0",
    },
  } as any;

  it("shows NATIVE ORCHESTRATOR badge, locks tier switches, and dynamically renders handoff specialists", () => {
    const mockSwitchFn = vi.fn().mockResolvedValue({});
    const mockOtherRpcFn = vi.fn().mockResolvedValue({});
    mockUseRpc.mockImplementation((contract: any) =>
      contract?.name === "agent_harness.tier.switch.request" ? mockSwitchFn : mockOtherRpcFn,
    );
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-pro-orchestrator",
      currentModeId: "full-access",
      metadata: {},
    });
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: {
        ...DEFAULT_AGENT_HARNESS_SETTINGS,
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
          s.id === "architect" || s.id === "review"
            ? { ...s, handoffEnabled: true, preferredProvider: "antigravity" }
            : s,
        ),
      },
    });

    render(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-1",
        agentId: "agt-orch",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );

    expect(screen.getByText("NATIVE ORCHESTRATOR")).toBeDefined();
    expect(screen.getByText("Native")).toBeDefined();
    expect(
      screen.getByText("Managed natively by Orchestrator — tier switching disabled."),
    ).toBeDefined();
    expect(screen.getByText("Architect Specialist")).toBeDefined();
    expect(screen.getByText("Gate Specialist")).toBeDefined();
    expect(screen.getByText("antigravity · plan")).toBeDefined();
    expect(screen.getByText("antigravity · review")).toBeDefined();

    expect(screen.getByLabelText("Switch to fast")).toBeDefined();
    expect(screen.getByLabelText("Switch to standard")).toBeDefined();
    expect(screen.getByLabelText("Switch to plan")).toBeDefined();
    expect(screen.getByLabelText("Switch to review")).toBeDefined();
    expect(screen.getByLabelText("Switch to max")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Switch to plan"));
    expect(mockSwitchFn).not.toHaveBeenCalled();
  });

  it("shows NATIVE ORCHESTRATOR and locks tier buttons on mid-session switch even when stale agentHarness metadata exists", () => {
    const mockSwitchFn = vi.fn().mockResolvedValue({});
    const noopRpc = vi.fn().mockResolvedValue({});
    mockUseRpc.mockImplementation((contract: any) =>
      contract?.name === "agent_harness.tier.switch.request" ? mockSwitchFn : noopRpc,
    );
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-pro-orchestrator",
      currentModeId: "full-access",
      metadata: {
        [HARNESS_BYPASSED_META_KEY]: true,
        [HARNESS_METADATA_KEY]: createSampleMetadata({
          role: "ui",
          currentTier: "plan",
          currentModel: "gemini-4-carbon",
          phase: "design",
          lastBilledTier: "standard",
          lastBilledModel: "gemini-4-neon",
        }),
      },
    } as any);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    render(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-1",
        agentId: "agt-mid-bypass",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );

    expect(screen.getByText("NATIVE ORCHESTRATOR")).toBeDefined();
    expect(screen.getByText("Native")).toBeDefined();
    expect(screen.getByText("gemini-pro-orchestrator")).toBeDefined();
    expect(screen.queryByText("UI · design")).toBeNull();
    expect(screen.queryByText("Read-only Plan (steps down to Standard)")).toBeNull();
    expect(
      screen.getByText("Managed natively by Orchestrator — tier switching disabled."),
    ).toBeDefined();

    fireEvent.click(screen.getByLabelText("Switch to review"));
    expect(mockSwitchFn).not.toHaveBeenCalled();
  });

  it("renders 5-tier controls, Manual Max warning badge, and dispatches tier switch RPC + composer sync", async () => {
    const mockSwitchFn = vi.fn().mockResolvedValue({
      currentModel: "gemini-4-carbon",
      recommendedModeId: "full-access",
      recommendedThinkingOptionId: "high",
    });
    const noopRpc = vi.fn().mockResolvedValue({});
    const mockComposerSetMode = vi.fn().mockResolvedValue(undefined);
    const mockComposerSetThinking = vi.fn().mockResolvedValue(undefined);
    mockUseComposers.mockReturnValue([
      {
        setMode: mockComposerSetMode,
        setThinking: mockComposerSetThinking,
      },
    ]);
    mockUseRpc.mockImplementation((contract: any) =>
      contract?.name === "agent_harness.tier.switch.request" ? mockSwitchFn : noopRpc,
    );
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-4-neon",
      currentModeId: "full-access",
      metadata: {
        [HARNESS_METADATA_KEY]: createSampleMetadata({
          role: "backend",
          currentTier: "max",
          currentModel: "gemini-4-neon",
          currentThinking: "xhigh",
          phase: "exec",
          lastBilledTier: "max",
          lastBilledModel: "gemini-4-neon",
        }),
      },
    } as any);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    render(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-1",
        agentId: "agt-max",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );

    expect(screen.getByText("Manual Max · High quota usage")).toBeDefined();
    expect(screen.getByText("Max · xhigh")).toBeDefined();
    expect(screen.getByLabelText("Switch to review")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Switch to plan"));
    expect(mockSwitchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agt-max",
        targetTier: "plan",
        currentModeId: "full-access",
      }),
    );

    await vi.waitFor(() => {
      expect(mockComposerSetMode).toHaveBeenCalledWith("full-access");
      expect(mockComposerSetThinking).toHaveBeenCalledWith("high");
    });

    fireEvent.click(screen.getByLabelText("Switch to review"));
    expect(mockSwitchFn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agt-max",
        targetTier: "review",
      }),
    );
    mockUseComposers.mockReturnValue([]);
  });

  it("shows read-only gate badges strictly for design/review phases and not for writable exec phase on plan/review tiers", () => {
    const noopRpc = vi.fn().mockResolvedValue({});
    mockUseRpc.mockImplementation(() => noopRpc);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    // 1. Manually switched to `plan` tier in writable `phase: "exec"` -> must NOT display Read-only Plan badge
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-4-carbon",
      currentModeId: "full-access",
      metadata: {
        [HARNESS_METADATA_KEY]: createSampleMetadata({
          role: "ui",
          currentTier: "plan",
          phase: "exec",
        }),
      },
    } as any);
    const { rerender } = render(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-1",
        agentId: "agt-phase",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );
    expect(screen.queryByText("Read-only Plan (steps down to Standard)")).toBeNull();
    expect(screen.queryByText("Read-only Review Gate")).toBeNull();

    // 2. Design phase shows Read-only Plan badge
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-4-carbon",
      currentModeId: "full-access",
      metadata: {
        [HARNESS_METADATA_KEY]: createSampleMetadata({
          role: "architect",
          currentTier: "plan",
          phase: "design",
        }),
      },
    } as any);
    rerender(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-1",
        agentId: "agt-phase",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );
    expect(screen.getByText("Read-only Plan (steps down to Standard)")).toBeDefined();

    // 3. Review phase shows Read-only Review Gate badge
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-4-argon",
      currentModeId: "full-access",
      metadata: {
        [HARNESS_METADATA_KEY]: createSampleMetadata({
          role: "review",
          currentTier: "review",
          phase: "review",
        }),
      },
    } as any);
    rerender(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-1",
        agentId: "agt-phase",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );
    expect(screen.getByText("Read-only Review Gate")).toBeDefined();
  });

  it("loads N dynamic workspace agent-team specialists via harnessEffectiveConfigRpc with RO tags and bound providers", async () => {
    const workspaceTeamRoles = [
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-uiux",
        shortLabel: "fe-uiux",
        builtIn: false,
        readonly: false,
        preferredProvider: "",
        preferredTier: "flash",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-architect",
        shortLabel: "fe-architect",
        builtIn: false,
        readonly: true,
        preferredProvider: "claude",
        preferredTier: "plan",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-developer",
        shortLabel: "fe-developer",
        builtIn: false,
        readonly: false,
        preferredProvider: "antigravity",
        preferredTier: "flash",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-qa",
        shortLabel: "fe-qa",
        builtIn: false,
        readonly: true,
        preferredProvider: "",
        preferredTier: "flash",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[2],
        id: "be-developer",
        shortLabel: "be-developer",
        builtIn: false,
        readonly: false,
        preferredProvider: "codex",
        preferredTier: "flash",
      },
    ];

    const effectiveRpcMock = vi.fn().mockResolvedValue({
      config: {
        specialists: workspaceTeamRoles,
        agentTeam: {
          projectSlug: "demo",
          preset: "web-react",
          manifestPath: "/repo/.agents/agent-team.json",
          checkoutRoot: "/repo",
          mainRepoRoot: "/repo",
          hasLocalAntigravityPlugin: true,
          roles: ["fe-uiux", "fe-architect", "fe-developer", "fe-qa", "be-developer"],
        },
      },
    });
    const noopRpc = vi.fn().mockResolvedValue({});
    mockUseRpc.mockImplementation((contract: any) =>
      contract?.name === "agent_harness.config.effective.request" ? effectiveRpcMock : noopRpc,
    );
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-pro-orchestrator",
      cwd: "/repo",
      currentModeId: "full-access",
      metadata: {},
    } as any);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    render(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-team",
        agentId: "agt-leaf",
        theme: popoverTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      } as any),
    );

    expect(await screen.findByText("fe-developer")).toBeDefined();
    expect(screen.getByText("fe-uiux")).toBeDefined();
    expect(screen.getByText("fe-architect")).toBeDefined();
    expect(screen.getByText("fe-qa")).toBeDefined();
    expect(screen.getByText("be-developer")).toBeDefined();
    expect(screen.getByText("codex · standard")).toBeDefined();
    expect(screen.getByText("antigravity · standard")).toBeDefined();
    expect(screen.getAllByText("RO")).toHaveLength(2);
  });

  it("renders HarnessPopover on mobile compact iOS without nested ScrollView or duplicate title and defers navigation past sheet close", async () => {
    const workspaceTeamRoles = [
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-uiux",
        shortLabel: "fe-uiux",
        builtIn: false,
        readonly: false,
        preferredProvider: "antigravity",
        preferredTier: "flash",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[1],
        id: "fe-architect",
        shortLabel: "fe-architect",
        builtIn: false,
        readonly: true,
        preferredProvider: "claude",
        preferredTier: "plan",
      },
      {
        ...DEFAULT_AGENT_HARNESS_SETTINGS.specialists[2],
        id: "be-developer",
        shortLabel: "be-developer",
        builtIn: false,
        readonly: false,
        preferredProvider: "codex",
        preferredTier: "flash",
      },
    ];

    const effectiveRpcMock = vi.fn().mockResolvedValue({
      config: {
        specialists: workspaceTeamRoles,
        agentTeam: {
          projectSlug: "demo",
          preset: "web-react",
          manifestPath: "/repo/.agents/agent-team.json",
          checkoutRoot: "/repo",
          mainRepoRoot: "/repo",
          hasLocalAntigravityPlugin: true,
          roles: ["fe-uiux", "fe-architect", "be-developer"],
        },
      },
    });
    const noopRpc = vi.fn().mockResolvedValue({});
    mockUseRpc.mockImplementation((contract: any) =>
      contract?.name === "agent_harness.config.effective.request" ? effectiveRpcMock : noopRpc,
    );
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-pro-orchestrator",
      cwd: "/repo",
      currentModeId: "full-access",
      metadata: {},
    } as any);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    const close = vi.fn();
    const onOpenTeamEditor = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      React.createElement(HarnessPopover, {
        workspaceId: "ws-mobile",
        agentId: "agt-mobile",
        theme: popoverTheme,
        layout: { compact: true, platform: "ios" },
        close,
        onOpenTeamEditor,
        onOpenSettings,
      } as any),
    );

    expect(await screen.findByText("be-developer")).toBeDefined();

    // Must NOT nest a ScrollView inside the host bottom sheet
    expect(screen.queryByTestId("plugin-scroll-view")).toBeNull();
    // Sheet header already draws "Agent Harness" on compact layouts
    expect(screen.queryByText("Agent Harness")).toBeNull();

    expect(screen.getByText("NATIVE ORCHESTRATOR")).toBeDefined();
    expect(screen.getByText("Next Turn")).toBeDefined();
    expect(screen.getByText("Last Billed")).toBeDefined();
    expect(screen.getByText("fe-uiux")).toBeDefined();
    expect(screen.getByText("fe-architect")).toBeDefined();
    expect(screen.getByText("be-developer")).toBeDefined();
    expect(screen.getByRole("button", { name: "Configure workspace team" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open Harness Settings" })).toBeDefined();

    vi.useFakeTimers();
    try {
      // Tapping navigation footer on iOS closes sheet first, then invokes callback after teardown delay
      fireEvent.click(screen.getByRole("button", { name: "Configure workspace team" }));
      expect(close).toHaveBeenCalledTimes(1);
      expect(onOpenTeamEditor).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      expect(onOpenTeamEditor).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Open Harness Settings" }));
      expect(close).toHaveBeenCalledTimes(2);
      expect(onOpenSettings).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("HarnessTransitionCard - Navigation & Specialist Handoff", () => {
  const baseCardProps = {
    agentId: "parent-agent",
    timestamp: new Date(),
    theme: {
      colors: {
        surface0: "#000",
        surface1: "#111",
        surface2: "#222",
        surface3: "#333",
        border: "#444",
        foreground: "#fff",
        foregroundMuted: "#888",
        accent: "#00f",
        statusSuccess: "#0f0",
        statusWarning: "#ff0",
      },
    } as any,
    layout: {
      compact: false,
      platform: "web" as const,
    },
    item: {
      type: "plugin" as const,
      kind: HARNESS_TRANSITION_TIMELINE_KIND,
      version: HARNESS_TRANSITION_TIMELINE_VERSION,
      data: {
        transitionKind: "specialist_handoff" as const,
        role: "orchestrator" as const,
        fromTier: "plan" as const,
        toTier: "flash" as const,
        fromModel: "claude-3-7-sonnet",
        toModel: "claude-3-5-haiku",
        phase: "exec" as const,
        reason: "specialist_handoff",
        turnNumber: 4,
        childAgentId: "child-agent-999",
        childAgentTitle: "[Backend] API Gateway",
        timestamp: "2026-11-12T00:00:00Z",
      },
    },
  };

  it("passes serverId from host.id when navigating to specialist", () => {
    const mockOpenAgent = vi.fn();

    render(
      React.createElement(HarnessTransitionCard, {
        ...baseCardProps,
        host: { id: "host-xyz", label: "Remote Host" },
        navigation: { openAgent: mockOpenAgent },
      } as any),
    );

    const openBtn = screen.getByRole("button", { name: "Open Specialist" });
    fireEvent.click(openBtn);

    expect(mockOpenAgent).toHaveBeenCalledWith({
      agentId: "child-agent-999",
      serverId: "host-xyz",
    });
  });

  it("prefers explicit serverId prop over host.id when navigating", () => {
    const mockOpenAgent = vi.fn();

    render(
      React.createElement(HarnessTransitionCard, {
        ...baseCardProps,
        serverId: "server-custom-123",
        host: { id: "host-xyz", label: "Remote Host" },
        navigation: { openAgent: mockOpenAgent },
      } as any),
    );

    const openBtn = screen.getByRole("button", { name: "Open Specialist" });
    fireEvent.click(openBtn);

    expect(mockOpenAgent).toHaveBeenCalledWith({
      agentId: "child-agent-999",
      serverId: "server-custom-123",
    });
  });

  it("navigates with only agentId when neither serverId nor host is present", () => {
    const mockOpenAgent = vi.fn();

    render(
      React.createElement(HarnessTransitionCard, {
        ...baseCardProps,
        navigation: { openAgent: mockOpenAgent },
      } as any),
    );

    const openBtn = screen.getByRole("button", { name: "Open Specialist" });
    fireEvent.click(openBtn);

    expect(mockOpenAgent).toHaveBeenCalledWith({
      agentId: "child-agent-999",
    });
  });
});

describe("Agent Harness Phase 3 - WorkspaceTeamEditor & Entry Points", () => {
  const editorTheme = {
    colors: {
      surface0: "#000000",
      surface1: "#111111",
      surface2: "#222222",
      border: "#333333",
      foreground: "#ffffff",
      foregroundMuted: "#888888",
      accent: "#0066cc",
      accentForeground: "#ffffff",
      statusSuccess: "#00aa44",
      statusWarning: "#ffaa00",
      statusDanger: "#cc2222",
    },
  } as any;

  const baseInspectResponse = {
    workspaceId: "ws-team-1",
    workspaceName: "Demo Repo",
    checkoutRoot: "/repos/demo",
    mainRepoRoot: "/repos/demo",
    isWorktree: false,
    manifestState: "present" as const,
    manifestPath: "/repos/demo/.agents/agent-team.json",
    manifest: {
      schema_version: "1.0.0",
      project_slug: "demo",
      preset: "lean-solo",
      targets: ["antigravity"],
      roles: ["be-developer"],
      capabilities: [],
      mcp_sources: ["serena"],
      guards: ["guard-serena-nomem"],
      tracker: "local",
      git_mode: "tracked-manifest",
      flow: { openspec: false, contracts: false, workflows: false, scaffold_docs: false },
      bindings: {},
    },
    localFederatedTargets: [],
    compilerAvailable: true,
    compilerMessage: null,
    catalog: {
      roles: [
        {
          id: "fe-architect",
          team: "fe",
          title: "Frontend Architect",
          readonly: true,
          recommended_model: "pro",
          requires_mcp: ["serena"],
          requires_guards: ["guard-git-safety"],
        },
        {
          id: "be-developer",
          team: "be",
          title: "Backend Developer",
          readonly: false,
          recommended_model: "inherit",
          requires_mcp: ["serena"],
          requires_guards: ["guard-serena-nomem"],
        },
      ],
      capabilities: [
        {
          id: "matt-sdd",
          title: "Matt SDD",
          description: "Spec workflow",
          requires_mcp: [],
          requires_guards: [],
          enables_flow: { openspec: true, contracts: true, workflows: false, scaffold_docs: false },
        },
      ],
      mcp_sources: [
        { id: "serena", description: "Serena", implies_guards: ["guard-serena-nomem"] },
      ],
      guards: [
        { id: "guard-serena-nomem", description: "Disable Serena memory" },
        { id: "guard-git-safety", description: "Git safety guard" },
      ],
    },
    presets: {
      "lean-solo": {
        id: "lean-solo",
        title: "Lean Solo",
        description: "Minimal",
        roles: ["be-developer"],
        capabilities: [],
        mcp_sources: ["serena"],
        guards: ["guard-serena-nomem"],
        flow: { openspec: false, contracts: false, workflows: false, scaffold_docs: false },
      },
    },
    availableProviders: [{ provider: "claude", enabled: true, models: ["claude-sonnet-4"] }],
    lazyToolSlices: ["backend.yaml", "ui.yaml"],
  };

  it("registers workspace panel, file panel, and workspace command without registering a header button", () => {
    const workspacePanels: any[] = [];
    const filePanels: any[] = [];
    const commandItems: any[] = [];
    const addHeaderButton = vi.fn();
    const openPanel = vi.fn();

    const mockClient: any = {
      addTimelineRenderer: vi.fn(() => () => {}),
      addSettingsScreen: vi.fn(() => () => {}),
      addCommandCenterItem: vi.fn((c) => {
        commandItems.push(c);
        return () => {};
      }),
      addWorkspacePanel: vi.fn((p) => {
        workspacePanels.push(p);
        return () => {};
      }),
      addFilePanel: vi.fn((p) => {
        filePanels.push(p);
        return () => {};
      }),
      addHeaderButton,
      addComposerPill: vi.fn(),
      openPanel,
      openSettings: vi.fn(),
    };

    const disposePlugin = contribute(mockClient as PluginClientContext);

    expect(addHeaderButton).not.toHaveBeenCalled();
    expect(workspacePanels).toHaveLength(1);
    expect(workspacePanels[0]).toMatchObject({
      id: "agent-team-panel",
      title: "Agent team",
      icon: "Users",
      locations: ["workspace", "explorer"],
    });
    expect(filePanels).toHaveLength(1);
    expect(filePanels[0]).toMatchObject({
      id: "agent-team-file-panel",
      files: { extensions: [], filenames: ["agent-team.json"] },
    });

    const wsCmd = commandItems.find((c) => c.id === "agent-harness-workspace-team-command");
    expect(wsCmd?.context).toBe("workspace");
    const cmdOpenPanel = vi.fn();
    wsCmd.onSelect({ openPanel: cmdOpenPanel });
    expect(cmdOpenPanel).toHaveBeenCalledWith("agent-team-panel");

    disposePlugin();
  });

  it("handles empty repo Detect & initialize, dirty tab tracking, and Discard reset", async () => {
    const setModified = vi.fn();
    const inspectMock = vi.fn().mockResolvedValue({
      ...baseInspectResponse,
      manifestState: "absent",
      manifest: null,
    });
    const detectMock = vi.fn().mockResolvedValue({
      workspaceId: "ws-team-1",
      checkoutRoot: "/repos/demo",
      recommendedPreset: "lean-solo",
      manifest: baseInspectResponse.manifest,
      notes: ["Defaulted to lean-solo"],
      usedCompiler: false,
    });
    const doctorMock = vi.fn();

    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.team.inspect.request") return inspectMock;
      if (contract?.name === "agent_harness.team.detect.request") return detectMock;
      if (contract?.name === "agent_harness.team.doctor.request") return doctorMock;
      return vi.fn().mockResolvedValue({});
    });

    render(
      React.createElement(WorkspaceTeamEditor, {
        workspaceId: "ws-team-1",
        theme: editorTheme,
        layout: { compact: false, platform: "web" },
        tab: { setModified, state: undefined, setState: vi.fn() },
      }),
    );

    const detectBtn = await screen.findByRole("button", { name: "Detect and initialize" });
    // Before initialization on an absent repo, footer Run doctor / Clean artifacts must not appear
    expect(screen.queryByRole("button", { name: "Run doctor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clean artifacts" })).toBeNull();

    fireEvent.click(detectBtn);

    expect(await screen.findByText("Detection notes")).toBeDefined();
    expect(setModified).toHaveBeenLastCalledWith(true);

    // Unsaved draft after Detect & initialize keeps Run doctor disabled until Save & compile
    const doctorBtn = screen.getByRole("button", { name: "Run doctor" });
    expect(doctorBtn.textContent).toContain("Run doctor (save first)");
    expect(doctorBtn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(doctorBtn);
    expect(doctorMock).not.toHaveBeenCalled();

    const discardBtn = screen.getByRole("button", { name: "Discard" });
    fireEvent.click(discardBtn);
    expect(setModified).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText("No agent team manifest found")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Run doctor" })).toBeNull();
  });

  it("applies role auto-deps, preserves manual guard uncheck, edits bindings, and preserves draft on save error", async () => {
    const setModified = vi.fn();
    const inspectMock = vi.fn().mockResolvedValue(baseInspectResponse);
    const saveMock = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        compiled: false,
        checkoutRoot: "/repos/demo",
        manifestPath: "/repos/demo/.agents/agent-team.json",
        manifest: baseInspectResponse.manifest,
        localFederatedTargets: [],
        warnings: [],
        message: "Synthesis syntax error",
        error: "Synthesis syntax error",
      })
      .mockResolvedValueOnce({
        success: true,
        compiled: true,
        checkoutRoot: "/repos/demo",
        manifestPath: "/repos/demo/.agents/agent-team.json",
        manifest: {
          ...baseInspectResponse.manifest,
          roles: ["be-developer", "fe-architect"],
          guards: ["guard-serena-nomem"],
          bindings: {
            "fe-architect": { provider: "claude", tier: "deep", model: "claude-opus-4" },
          },
        },
        localFederatedTargets: ["claude"],
        warnings: [],
        message: "Saved & compiled",
        error: null,
      });

    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.team.inspect.request") return inspectMock;
      if (contract?.name === "agent_harness.team.save.request") return saveMock;
      return vi.fn().mockResolvedValue({});
    });

    render(
      React.createElement(WorkspaceTeamEditor, {
        workspaceId: "ws-team-1",
        theme: editorTheme,
        layout: { compact: true, platform: "web" },
        tab: { setModified, state: undefined, setState: vi.fn() },
      }),
    );

    const roleBtn = await screen.findByRole("button", { name: "Toggle role fe-architect" });
    fireEvent.click(roleBtn);
    expect(await screen.findByText(/Auto-selected recommended dependencies/)).toBeDefined();

    // Manually uncheck guard-git-safety -> surfaces non-blocking advisory
    const guardBtn = screen.getByRole("button", { name: "Toggle guard guard-git-safety" });
    fireEvent.click(guardBtn);
    expect(await screen.findByText("Missing recommended dependencies")).toBeDefined();

    // Edit fe-architect binding
    fireEvent.change(screen.getByLabelText("fe-architect provider"), {
      target: { value: "claude" },
    });
    fireEvent.change(screen.getByLabelText("fe-architect tier"), {
      target: { value: "deep" },
    });
    fireEvent.change(screen.getByLabelText("fe-architect model override"), {
      target: { value: "claude-opus-4" },
    });

    // First Save fails -> banner visible AND draft/dirty preserved
    const saveBtn = screen.getByRole("button", { name: "Save & compile" });
    fireEvent.click(saveBtn);
    expect(await screen.findByText("Synthesis syntax error")).toBeDefined();
    expect(setModified).toHaveBeenLastCalledWith(true);

    // Second Save succeeds with unforced guards & bindings
    fireEvent.click(saveBtn);
    await screen.findByText("Saved & compiled").catch(() => {});
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1][0].manifest.guards).toEqual(["guard-serena-nomem"]);
    expect(saveMock.mock.calls[1][0].manifest.bindings["fe-architect"]).toEqual({
      provider: "claude",
      tier: "deep",
      model: "claude-opus-4",
    });
    expect(setModified).toHaveBeenLastCalledWith(false);
  });

  it("cascades WorkspaceTeamEditor role binding provider -> model, exposes plan/review tiers, and excludes gemini-3 models", async () => {
    const inspectMock = vi.fn().mockResolvedValue({
      ...baseInspectResponse,
      manifest: {
        ...baseInspectResponse.manifest,
        roles: ["be-developer", "fe-architect"],
        bindings: {
          "fe-architect": { provider: "claude", tier: "plan", model: "claude-sonnet-4" },
        },
      },
      availableProviders: [
        { provider: "codex", enabled: false, models: ["gpt-5.4"] },
        {
          provider: "claude",
          enabled: true,
          models: ["claude-sonnet-4", "claude-haiku-4", "gemini-3-pro"],
        },
        {
          provider: "antigravity",
          enabled: true,
          models: [
            "gemini-4-hydrogen",
            "gemini-4-carbon",
            "gemini-3-flash",
            "gemini-pro-orchestrator",
          ],
        },
      ],
    });
    const saveMock = vi.fn().mockResolvedValue({
      success: true,
      compiled: true,
      checkoutRoot: "/repos/demo",
      manifestPath: "/repos/demo/.agents/agent-team.json",
      manifest: {
        ...baseInspectResponse.manifest,
        roles: ["be-developer", "fe-architect"],
        bindings: {
          "fe-architect": { provider: "antigravity", tier: "review" },
        },
      },
      localFederatedTargets: ["antigravity"],
      warnings: [],
      message: "Saved",
      error: null,
    });
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.team.inspect.request") return inspectMock;
      if (contract?.name === "agent_harness.team.save.request") return saveMock;
      return vi.fn().mockResolvedValue({});
    });

    render(
      React.createElement(WorkspaceTeamEditor, {
        workspaceId: "ws-team-1",
        theme: editorTheme,
        layout: { compact: false, platform: "web" },
        tab: { setModified: vi.fn(), state: undefined, setState: vi.fn() },
      }),
    );

    const providerSelect = (await screen.findByLabelText(
      "fe-architect provider",
    )) as HTMLSelectElement;
    const providerTexts = Array.from(providerSelect.options).map((o) => o.text);
    // Active providers ordered first and Disabled marked clearly
    expect(providerTexts[0]).toBe("Inherit (Active: Antigravity)");
    expect(providerTexts).toContain("Claude · Active");
    expect(providerTexts).toContain("Antigravity · Active");
    expect(providerTexts).toContain("Codex · Disabled");
    expect(providerTexts.indexOf("Claude · Active")).toBeLessThan(
      providerTexts.indexOf("Codex · Disabled"),
    );

    // Tier dropdown exposes plan and review options
    const tierSelect = screen.getByLabelText("fe-architect tier") as HTMLSelectElement;
    const tierValues = Array.from(tierSelect.options).map((o) => o.value);
    expect(tierValues).toContain("plan");
    expect(tierValues).toContain("review");

    // Initial Claude model preset lists claude models and excludes gemini-3
    const presetSelect = screen.getByLabelText("fe-architect model preset") as HTMLSelectElement;
    expect(Array.from(presetSelect.options).map((o) => o.value)).toEqual([
      "",
      "claude-sonnet-4",
      "claude-haiku-4",
    ]);
    expect((screen.getByLabelText("fe-architect model override") as HTMLInputElement).value).toBe(
      "claude-sonnet-4",
    );

    // Switching provider to antigravity clears incompatible claude-sonnet-4 model
    fireEvent.change(providerSelect, { target: { value: "antigravity" } });
    expect((screen.getByLabelText("fe-architect model override") as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText("fe-architect model preset") as HTMLSelectElement).value).toBe(
      "",
    );

    // Antigravity model preset excludes gemini-3-flash and gemini-pro-orchestrator
    expect(Array.from(presetSelect.options).map((o) => o.value)).toEqual([
      "",
      "gemini-4-hydrogen",
      "gemini-4-carbon",
    ]);

    // Update tier to review and save -> model override stays cleared
    fireEvent.change(tierSelect, { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & compile" }));

    await vi.waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: expect.objectContaining({
            bindings: expect.objectContaining({
              "fe-architect": {
                provider: "antigravity",
                tier: "review",
              },
            }),
          }),
        }),
      );
    });
  });

  it("runs doctor, opens Clean confirmation Modal, and displays worktree inheritance + raw JSON in file panel", async () => {
    const inspectMock = vi.fn().mockResolvedValue({
      ...baseInspectResponse,
      isWorktree: true,
      manifestState: "inherited_from_main",
    });
    const doctorMock = vi.fn().mockResolvedValue({
      passed: true,
      exitCode: 0,
      passCount: 4,
      warnCount: 1,
      failCount: 0,
      output: "[PASS] manifest\n[WARN] minor note",
      compilerAvailable: true,
    });
    const cleanMock = vi.fn().mockResolvedValue({
      success: true,
      removedCount: 2,
      removed: [".agents/plugins", ".agents/agent-team.json"],
      localFederatedTargets: [],
      message: "Cleaned 2 generated item(s)",
      error: null,
    });

    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.team.inspect.request") return inspectMock;
      if (contract?.name === "agent_harness.team.doctor.request") return doctorMock;
      if (contract?.name === "agent_harness.team.clean.request") return cleanMock;
      return vi.fn().mockResolvedValue({});
    });
    mockUseFileText.mockReturnValue({
      status: "ready",
      text: '{"project_slug":"demo"}',
    });

    render(
      React.createElement(AgentTeamFilePanelHost, {
        workspaceId: "ws-team-1",
        file: {
          path: "/repos/demo/.agents/agent-team.json",
          name: "agent-team.json",
          extension: "json",
        } as any,
        params: { path: "/repos/demo/.agents/agent-team.json" },
        revision: 1,
        theme: editorTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        tab: { setModified: vi.fn(), state: undefined, setState: vi.fn() },
      }),
    );

    expect(await screen.findByText("Inherited from main project")).toBeDefined();
    expect(screen.getByRole("button", { name: "Materialize & compile in worktree" })).toBeDefined();

    // Expand raw JSON preview
    fireEvent.click(screen.getByRole("button", { name: "Show raw JSON" }));
    expect(screen.getByText('{"project_slug":"demo"}')).toBeDefined();

    // Run doctor
    fireEvent.click(screen.getByRole("button", { name: "Run doctor" }));
    expect(await screen.findByText(/PASS 4 · WARN 1 · FAIL 0/)).toBeDefined();

    // Open Clean modal, check delete manifest, Cancel -> verify reopening resets deleteManifest to false
    fireEvent.click(screen.getByRole("button", { name: "Clean artifacts" }));
    expect(screen.getByRole("dialog", { name: "Clean generated team artifacts" })).toBeDefined();
    const deleteToggleFirst = screen.getByLabelText(
      "Also delete .agents/agent-team.json",
    ) as HTMLInputElement;
    fireEvent.click(deleteToggleFirst);
    expect(deleteToggleFirst.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel clean" }));

    fireEvent.click(screen.getByRole("button", { name: "Clean artifacts" }));
    const deleteToggleReopened = screen.getByLabelText(
      "Also delete .agents/agent-team.json",
    ) as HTMLInputElement;
    expect(deleteToggleReopened.checked).toBe(false);
    fireEvent.click(deleteToggleReopened);
    fireEvent.click(screen.getByRole("button", { name: "Confirm clean" }));

    await vi.waitFor(() => {
      expect(cleanMock).toHaveBeenCalledWith({
        workspaceId: "ws-team-1",
        deleteManifest: true,
      });
    });
  });

  it("displays external path mismatch warning in AgentTeamFilePanelHost and live-refreshes Settings on team update", async () => {
    const inspectTeamMock = vi.fn().mockResolvedValue(baseInspectResponse);
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.team.inspect.request") {
        return inspectTeamMock;
      }
      return vi.fn().mockResolvedValue({});
    });
    mockUseFileText.mockReturnValue({
      status: "ready",
      text: '{"project_slug":"other"}',
    });

    render(
      React.createElement(AgentTeamFilePanelHost, {
        workspaceId: "ws-team-1",
        file: {
          path: "/repos/main-parent/.agents/agent-team.json",
          name: "agent-team.json",
          extension: "json",
        } as any,
        params: { path: "/repos/main-parent/.agents/agent-team.json" },
        revision: 1,
        theme: editorTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        tab: { setModified: vi.fn(), state: undefined, setState: vi.fn() },
      }),
    );

    expect(await screen.findByText("Viewing external manifest file path")).toBeDefined();
    cleanup();

    const inspectEnvMock = vi.fn().mockResolvedValue({
      availableProviders: [],
      diskProfiles: [],
      lazyToolSlices: [],
      hasRepoOverride: false,
      repoOverridePath: null,
      agentTeam: null,
      workspaces: [
        { id: "ws-live", name: "LiveWS", title: "Live WS", cwd: "/repos/live", branch: "main" },
      ],
    });
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.environment.inspect.request") return inspectEnvMock;
      return vi.fn().mockResolvedValue({});
    });

    const failingOpen = vi.fn(() => {
      throw new Error("Plugin panel context is unavailable");
    });

    render(
      React.createElement(HarnessSettingsScreen, {
        theme: editorTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        onOpenWorkspaceTeam: failingOpen,
        settingsOverride: {
          status: "ready",
          values: DEFAULT_AGENT_HARNESS_SETTINGS,
          revision: "rev-1",
          saving: false,
          save: vi.fn(),
        },
      }),
    );

    const openBtn = await screen.findByRole("button", { name: "Open workspace team editor" });
    await vi.waitFor(() => {
      expect((openBtn as HTMLButtonElement).disabled).toBe(false);
    });
    const callsBeforeNotify = inspectEnvMock.mock.calls.length;
    notifyWorkspaceTeamUpdated("ws-live");
    await vi.waitFor(() => {
      expect(inspectEnvMock.mock.calls.length).toBeGreaterThan(callsBeforeNotify);
    });

    fireEvent.click(openBtn);
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("Plugin panel context is unavailable"),
    );
  });

  it("refreshes HarnessPopover on notifyWorkspaceTeamUpdated and opens team editor from Popover & Settings", async () => {
    const effectiveRpcMock = vi.fn().mockResolvedValue({
      config: {
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
        agentTeam: null,
      },
    });
    const inspectEnvMock = vi.fn().mockResolvedValue({
      availableProviders: [],
      diskProfiles: [],
      lazyToolSlices: [],
      hasRepoOverride: false,
      repoOverridePath: null,
      agentTeam: null,
      workspaces: [
        { id: "ws-open", name: "OpenWS", title: "Open WS", cwd: "/repos/open", branch: "main" },
      ],
    });
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.config.effective.request") return effectiveRpcMock;
      if (contract?.name === "agent_harness.environment.inspect.request") return inspectEnvMock;
      return vi.fn().mockResolvedValue({});
    });
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "antigravity",
      model: "gemini-4-hydrogen-high",
      cwd: "/repos/open",
      currentModeId: "full-access",
      metadata: {},
    } as any);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    const onOpenTeamEditor = vi.fn();
    const onClose = vi.fn();
    render(
      React.createElement(HarnessPopover, {
        context: "agent" as const,
        host: { id: "h1", label: "Local" },
        workspaceId: "ws-open",
        agentId: "agt-pop",
        theme: editorTheme,
        layout: { compact: false, platform: "web" },
        close: onClose,
        onOpenTeamEditor,
      }),
    );

    const cfgTeamBtn = await screen.findByRole("button", { name: "Configure workspace team" });
    expect(effectiveRpcMock).toHaveBeenCalledTimes(1);

    notifyWorkspaceTeamUpdated("ws-open");
    await vi.waitFor(() => {
      expect(effectiveRpcMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(cfgTeamBtn);
    expect(onOpenTeamEditor).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();

    const onOpenWorkspaceTeam = vi.fn();
    render(
      React.createElement(HarnessSettingsScreen, {
        theme: editorTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        onOpenWorkspaceTeam,
        settingsOverride: {
          status: "ready",
          values: DEFAULT_AGENT_HARNESS_SETTINGS,
          revision: "rev-1",
          saving: false,
          save: vi.fn(),
        },
      }),
    );

    const openEditorBtn = await screen.findByRole("button", { name: "Open workspace team editor" });
    await vi.waitFor(() => {
      expect((openEditorBtn as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(openEditorBtn);
    expect(onOpenWorkspaceTeam).toHaveBeenCalledWith("ws-open");
  });

  it("locks writable specialist handoffs in HarnessPopover while parent agent is running, keeping readonly review enabled", async () => {
    const handoffRpcMock = vi.fn().mockResolvedValue({ childTitle: "[Review] Task Execution" });
    const effectiveRpcMock = vi.fn().mockResolvedValue({
      config: {
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
        agentTeam: null,
      },
    });
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.specialist.handoff.request") return handoffRpcMock;
      if (contract?.name === "agent_harness.config.effective.request") return effectiveRpcMock;
      return vi.fn().mockResolvedValue({});
    });
    mockUseAgent.mockReturnValue({
      status: "running",
      provider: "antigravity",
      model: "gemini-4-hydrogen",
      cwd: "/repos/open",
      currentModeId: "full-access",
      metadata: {},
    } as any);
    mockUseSettings.mockReturnValue({
      status: "ready",
      values: DEFAULT_AGENT_HARNESS_SETTINGS,
    });

    render(
      React.createElement(HarnessPopover, {
        context: "agent" as const,
        host: { id: "h1", label: "Local" },
        workspaceId: "ws-busy",
        agentId: "agt-busy",
        theme: editorTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      }),
    );

    expect(
      await screen.findByText("Parent turn running — writable specialists locked until turn ends"),
    ).toBeDefined();

    const uiBtn = screen.getByRole("button", { name: "UI Specialist" });
    fireEvent.click(uiBtn);
    expect(handoffRpcMock).not.toHaveBeenCalled();

    const gateBtn = screen.getByRole("button", { name: "Gate Specialist" });
    expect(screen.getByText("RO")).toBeDefined();
    fireEvent.click(gateBtn);
    await vi.waitFor(() => {
      expect(handoffRpcMock).toHaveBeenCalledWith({
        agentId: "agt-busy",
        workspaceId: "ws-busy",
        targetRole: "review",
      });
    });
  });
});

describe("Agent Harness Debug Trace UI & Role Lazy-Tool Slices", () => {
  const fullTheme = {
    colors: {
      surface0: "#000000",
      surface1: "#111111",
      surface2: "#222222",
      border: "#333333",
      foreground: "#ffffff",
      foregroundMuted: "#888888",
      accent: "#00aaff",
      accentForeground: "#ffffff",
      statusSuccess: "#00aa44",
      statusWarning: "#ffaa00",
      statusDanger: "#cc2222",
    },
  } as any;

  it("exports 8 role-semantic BUILTIN_LAZY_TOOL_SLICES without codex.yaml and safely displays legacy codex.yaml if unmigrated", () => {
    expect(BUILTIN_LAZY_TOOL_SLICES).not.toContain("codex.yaml");
    expect(Array.from(BUILTIN_LAZY_TOOL_SLICES)).toEqual([
      "general.yaml",
      "ui.yaml",
      "backend.yaml",
      "architect.yaml",
      "pm.yaml",
      "qa.yaml",
      "review.yaml",
      "scout.yaml",
    ]);

    const legacySettings = {
      ...DEFAULT_AGENT_HARNESS_SETTINGS,
      specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
        s.id === "ui" ? { ...s, lazyToolSlice: "codex.yaml" } : s,
      ),
    };
    const noopRpc = vi.fn().mockResolvedValue({});
    mockUseRpc.mockImplementation(() => noopRpc);

    render(
      React.createElement(HarnessSettingsScreen, {
        theme: fullTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        settingsOverride: {
          status: "ready",
          values: legacySettings,
          revision: "rev-legacy",
          saving: false,
          save: vi.fn(),
        },
      }),
    );

    const sliceSelect = screen.getByLabelText("Lazy-Tool Slice") as HTMLSelectElement;
    expect(sliceSelect.value).toBe("codex.yaml");
    const optionValues = Array.from(sliceSelect.options).map((o) => o.value);
    expect(optionValues).toContain("codex.yaml");
    expect(optionValues).toContain("general.yaml");
    expect(optionValues).toContain("architect.yaml");
    expect(optionValues).toContain("qa.yaml");
    expect(optionValues).toContain("scout.yaml");
    expect(screen.getByText("codex.yaml (legacy)")).toBeDefined();
  });

  it("persists debugLogs via settings.save before harnessDebugToggleRpc in HarnessPopover, enforces sync lock, and rolls back when save returns false", async () => {
    const callOrder: string[] = [];
    let resolveToggle: ((val: any) => void) | null = null;
    const toggleRpcMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            callOrder.push("rpc:true");
            resolveToggle = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("Daemon offline"))
      .mockResolvedValueOnce({
        enabled: false,
        logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
      });
    const effectiveRpcMock = vi.fn().mockResolvedValue({
      config: {
        specialists: DEFAULT_AGENT_HARNESS_SETTINGS.specialists,
        agentTeam: null,
      },
    });

    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.debug.toggle.request") return toggleRpcMock;
      if (contract?.name === "agent_harness.config.effective.request") return effectiveRpcMock;
      return vi.fn().mockResolvedValue({});
    });
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "claude",
      model: "flash",
      cwd: "/repos/demo",
      currentModeId: "acceptEdits",
      metadata: {},
    } as any);

    const saveMock = vi.fn().mockImplementation(async (nextValues: any, revision: string) => {
      callOrder.push(`save:${String(nextValues.debugLogs)}:${revision}`);
      return true;
    });
    const reloadMock = vi.fn().mockResolvedValue(undefined);
    const initialValues = { ...DEFAULT_AGENT_HARNESS_SETTINGS, debugLogs: false };
    mockUseSettings.mockReturnValue({
      status: "ready",
      revision: "rev-pop-1",
      saving: false,
      saveError: null,
      values: initialValues,
      save: saveMock,
      reload: reloadMock,
    } as any);

    render(
      React.createElement(HarnessPopover, {
        context: "agent" as const,
        host: { id: "h1", label: "Local" },
        workspaceId: "ws-dbg",
        agentId: "agt-dbg",
        theme: fullTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    );

    expect(screen.queryByTestId("plugin-scroll-view")).toBeNull();
    const offButton = screen.getByRole("button", { name: "Debug: OFF" });
    expect(screen.getByRole("button", { name: "Open Harness Settings" })).toBeDefined();

    // Same-frame double-click is blocked by synchronous lock ref before save resolves
    fireEvent.click(offButton);
    fireEvent.click(offButton);
    await vi.waitFor(() => {
      expect(toggleRpcMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ debugLogs: true }),
      "rev-pop-1",
    );
    expect(toggleRpcMock).toHaveBeenCalledWith({ enabled: true });
    expect(callOrder).toEqual(["save:true:rev-pop-1", "rpc:true"]);

    resolveToggle!({
      enabled: true,
      logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
    });

    const onButton = await screen.findByRole("button", { name: "Debug: ON" });
    expect(onButton).toBeDefined();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(mockToast.show).toHaveBeenCalledWith("Debug trace enabled", {
      variant: "success",
    });

    // Next click fails at RPC -> stays Debug: ON and shows error toast
    fireEvent.click(onButton);
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining("Daemon offline"));
    });
    expect(screen.getByRole("button", { name: "Debug: ON" })).toBeDefined();

    // Third click succeeds turning OFF
    fireEvent.click(screen.getByRole("button", { name: "Debug: ON" }));
    expect(await screen.findByRole("button", { name: "Debug: OFF" })).toBeDefined();
    expect(toggleRpcMock).toHaveBeenLastCalledWith({ enabled: false });
    expect(mockToast.show).toHaveBeenLastCalledWith("Debug trace disabled", { variant: "success" });

    // Fourth click: settings.save returns false -> aborts, shows error toast, does NOT call RPC
    saveMock.mockResolvedValueOnce(false);
    mockUseSettings.mockReturnValue({
      status: "ready",
      revision: "rev-pop-2",
      saving: false,
      saveError: "Revision conflict",
      values: initialValues,
      save: saveMock,
      reload: reloadMock,
    } as any);

    const callsBeforeFailedSave = toggleRpcMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Debug: OFF" }));
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Failed to save debug trace setting");
    });
    expect(toggleRpcMock).toHaveBeenCalledTimes(callsBeforeFailedSave);
    expect(screen.getByRole("button", { name: "Debug: OFF" })).toBeDefined();
  });

  it("disables HarnessPopover Debug toggle button when settings are not ready", () => {
    const toggleRpcMock = vi.fn();
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.debug.toggle.request") return toggleRpcMock;
      return vi.fn().mockResolvedValue({});
    });
    mockUseAgent.mockReturnValue({
      status: "idle",
      provider: "claude",
      model: "flash",
      cwd: "/repos/demo",
      currentModeId: "acceptEdits",
      metadata: {},
    } as any);
    mockUseSettings.mockReturnValue({
      status: "loading",
      saving: false,
    } as any);

    render(
      React.createElement(HarnessPopover, {
        context: "agent" as const,
        host: { id: "h1", label: "Local" },
        workspaceId: "ws-loading",
        agentId: "agt-loading",
        theme: fullTheme,
        layout: { compact: false, platform: "web" },
        close: vi.fn(),
      }),
    );

    const debugBtn = screen.getByRole("button", { name: "Debug: OFF" });
    expect(debugBtn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(debugBtn);
    expect(toggleRpcMock).not.toHaveBeenCalled();
  });

  it("renders Debug Trace & Diagnostics section in HarnessSettingsScreen with save-before-toggle, status, refresh, clear, and recent entries", async () => {
    const sampleEntries = [
      {
        ts: "2026-11-25T08:15:30.123Z",
        event: "harness.route",
        level: "info" as const,
        agentId: "agt-ui-1",
        role: "ui",
        phase: "design",
        provider: "claude",
        model: "pro",
        detail: { matchedRule: "rule_ui_keyword" },
      },
      {
        ts: "2026-11-25T08:14:10.000Z",
        event: "permission.block",
        level: "warn" as const,
        agentId: "agt-ui-1",
        role: "ui",
        phase: "design",
        detail: { toolName: "Edit" },
      },
    ];

    const callOrder: string[] = [];
    const debugStatusMock = vi
      .fn()
      .mockResolvedValueOnce({
        enabled: true,
        logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
        totalLines: 2,
        fileSizeBytes: 1536,
        rotatedExists: true,
        entries: sampleEntries,
      })
      .mockResolvedValueOnce({
        enabled: false,
        logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
        totalLines: 3,
        fileSizeBytes: 2048,
        rotatedExists: true,
        entries: [
          {
            ts: "2026-11-25T08:16:00.000Z",
            event: "debug.toggled",
            level: "info" as const,
            detail: { enabled: false },
          },
          ...sampleEntries,
        ],
      })
      .mockResolvedValueOnce({
        enabled: false,
        logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
        totalLines: 4,
        fileSizeBytes: 2560,
        rotatedExists: true,
        entries: [
          {
            ts: "2026-11-25T08:17:00.000Z",
            event: "harness.turn.after",
            level: "error" as const,
            role: "backend",
            phase: "exec",
            agentId: "agt-be-2",
          },
        ],
      })
      .mockResolvedValueOnce({
        enabled: false,
        logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
        totalLines: 0,
        fileSizeBytes: 0,
        rotatedExists: false,
        entries: [],
      });

    const debugToggleMock = vi.fn().mockImplementation(async (input: any) => {
      callOrder.push(`rpc:${String(input.enabled)}`);
      return {
        enabled: false,
        logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
      };
    });
    const debugClearMock = vi.fn().mockResolvedValue({
      cleared: true,
      removedBytes: 2560,
    });
    const inspectEnvMock = vi.fn().mockResolvedValue({
      availableProviders: [],
      diskProfiles: [],
      lazyToolSlices: ["ui.yaml", "general.yaml"],
      hasRepoOverride: false,
      repoOverridePath: null,
      agentTeam: null,
      workspaces: [],
    });

    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.debug.status.request") return debugStatusMock;
      if (contract?.name === "agent_harness.debug.toggle.request") return debugToggleMock;
      if (contract?.name === "agent_harness.debug.clear.request") return debugClearMock;
      if (contract?.name === "agent_harness.environment.inspect.request") return inspectEnvMock;
      return vi.fn().mockResolvedValue({});
    });

    const saveSpy = vi.fn().mockImplementation(async (nextValues: any, revision: string) => {
      callOrder.push(`save:${String(nextValues.debugLogs)}:${revision}`);
      return true;
    });
    const reloadSpy = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(HarnessSettingsScreen, {
        theme: fullTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        settingsOverride: {
          status: "ready",
          values: { ...DEFAULT_AGENT_HARNESS_SETTINGS, debugLogs: true },
          revision: "rev-dbg-1",
          saving: false,
          save: saveSpy,
          reload: reloadSpy,
        },
      }),
    );

    expect(screen.getByText("Debug Trace & Diagnostics")).toBeDefined();
    expect(
      await screen.findByText("/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl"),
    ).toBeDefined();
    expect(debugStatusMock).toHaveBeenCalledWith({ limit: 20 });
    expect(
      screen.getByText("2 entries · 1.5 KB · Rotated backup present (debug-trace.1.jsonl)"),
    ).toBeDefined();
    expect(screen.getByText("harness.route")).toBeDefined();
    expect(screen.getByText("08:15:30.123")).toBeDefined();
    expect(
      screen.getByText(
        "role=ui · phase=design · agent=agt-ui-1 · claude/pro · matchedRule=rule_ui_keyword",
      ),
    ).toBeDefined();
    expect(screen.getByText("permission.block")).toBeDefined();
    expect(
      screen.getByText("role=ui · phase=design · agent=agt-ui-1 · toolName=Edit"),
    ).toBeDefined();

    // Toggle Enable Debug Trace persists via settings.save FIRST, then calls harnessDebugToggleRpc
    const debugSwitch = screen.getByLabelText("Enable Debug Trace") as HTMLInputElement;
    expect(debugSwitch.checked).toBe(true);
    fireEvent.click(debugSwitch);

    await vi.waitFor(() => {
      expect(debugToggleMock).toHaveBeenCalledWith({ enabled: false });
    });
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLogs: false }),
      "rev-dbg-1",
    );
    expect(callOrder).toEqual(["save:false:rev-dbg-1", "rpc:false"]);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("debug.toggled")).toBeDefined();
    expect(mockToast.show).toHaveBeenCalledWith("Debug trace disabled", { variant: "success" });

    // Refresh Logs fetches updated status & entries
    const refreshBtn = screen.getByRole("button", { name: "Refresh Logs" });
    fireEvent.click(refreshBtn);
    expect(await screen.findByText("harness.turn.after")).toBeDefined();
    expect(screen.getByText(/role=backend · phase=exec · agent=agt-be-2/)).toBeDefined();

    // Clear Trace clears logs, refreshes status, shows empty message, and disables Clear Trace
    const clearBtn = screen.getByRole("button", { name: "Clear Trace" }) as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
    fireEvent.click(clearBtn);

    await vi.waitFor(() => {
      expect(debugClearMock).toHaveBeenCalledWith({});
    });
    expect(await screen.findByText("Debug trace is off")).toBeDefined();
    expect(screen.getByText("0 entries · 0 B · No rotated backup")).toBeDefined();
    expect(mockToast.show).toHaveBeenCalledWith(
      expect.stringContaining("Cleared debug trace (2.5 KB removed)"),
      { variant: "success" },
    );
    expect(
      (screen.getByRole("button", { name: "Clear Trace" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows error toast, reverts state, and skips debugToggleRpc when settings.save returns false in HarnessSettingsScreen", async () => {
    const debugStatusMock = vi.fn().mockResolvedValue({
      enabled: false,
      logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
      totalLines: 0,
      fileSizeBytes: 0,
      rotatedExists: false,
      entries: [],
    });
    const debugToggleMock = vi.fn();
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.debug.status.request") return debugStatusMock;
      if (contract?.name === "agent_harness.debug.toggle.request") return debugToggleMock;
      return vi.fn().mockResolvedValue({});
    });

    const saveSpy = vi.fn().mockResolvedValue(false);
    render(
      React.createElement(HarnessSettingsScreen, {
        theme: fullTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        settingsOverride: {
          status: "ready",
          values: { ...DEFAULT_AGENT_HARNESS_SETTINGS, debugLogs: false },
          revision: "rev-fail-1",
          saving: false,
          saveError: "Store write rejected",
          save: saveSpy,
        },
      }),
    );

    expect(await screen.findByText("Debug trace is off")).toBeDefined();
    const debugSwitch = screen.getByLabelText("Enable Debug Trace") as HTMLInputElement;
    expect(debugSwitch.checked).toBe(false);

    fireEvent.click(debugSwitch);
    await vi.waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ debugLogs: true }),
        "rev-fail-1",
      );
    });
    expect(mockToast.error).toHaveBeenCalledWith("Store write rejected");
    expect(debugToggleMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Enable Debug Trace") as HTMLInputElement).checked).toBe(false);
  });

  it("persists imported specialists via settings.save on import_from_disk and reports malformed debug status responses", async () => {
    const importedSpecialists = DEFAULT_AGENT_HARNESS_SETTINGS.specialists.map((s) =>
      s.id === "ui" ? { ...s, preferredTier: "deep" } : s,
    );
    const syncProfilesMock = vi.fn().mockResolvedValue({
      success: true,
      message: "Imported 9 profiles from disk",
      importedCount: 9,
      specialists: importedSpecialists,
    });
    const debugStatusMock = vi.fn().mockResolvedValue({ unexpected: true });
    const inspectEnvMock = vi.fn().mockResolvedValue({
      availableProviders: [],
      diskProfiles: [],
      lazyToolSlices: [],
      hasRepoOverride: false,
      repoOverridePath: null,
      agentTeam: null,
      workspaces: [],
    });

    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.profiles.sync.request") return syncProfilesMock;
      if (contract?.name === "agent_harness.debug.status.request") return debugStatusMock;
      if (contract?.name === "agent_harness.environment.inspect.request") return inspectEnvMock;
      return vi.fn().mockResolvedValue({});
    });

    const saveSpy = vi.fn().mockResolvedValue(true);
    render(
      React.createElement(HarnessSettingsScreen, {
        theme: fullTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        settingsOverride: {
          status: "ready",
          values: DEFAULT_AGENT_HARNESS_SETTINGS,
          revision: "rev-import-1",
          saving: false,
          save: saveSpy,
        },
      }),
    );

    // Malformed debug status response surfaces inline error and placeholder path without hardcoding ~/.paseo
    expect(await screen.findByText("Invalid debug trace status response")).toBeDefined();
    expect(screen.getByText("Resolving daemon log path...")).toBeDefined();

    // Clicking Refresh Logs with malformed response also pops error toast
    fireEvent.click(screen.getByRole("button", { name: "Refresh Logs" }));
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Invalid debug trace status response");
    });

    // Clicking Import persists imported specialists via settings.save
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await vi.waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ specialists: importedSpecialists }),
        "rev-import-1",
      );
    });
    expect(mockToast.show).toHaveBeenCalledWith("Imported 9 profiles from disk", {
      variant: "success",
    });
  });

  it("shows empty recorded state and disables Clear Trace when Debug Trace is ON with zero entries", async () => {
    const debugStatusMock = vi.fn().mockResolvedValue({
      enabled: true,
      logFilePath: "/Users/test/.paseo/plugin-data/agent-harness/debug-trace.jsonl",
      totalLines: 0,
      fileSizeBytes: 0,
      rotatedExists: false,
      entries: [],
    });
    mockUseRpc.mockImplementation((contract: any) => {
      if (contract?.name === "agent_harness.debug.status.request") return debugStatusMock;
      return vi.fn().mockResolvedValue({});
    });

    render(
      React.createElement(HarnessSettingsScreen, {
        theme: fullTheme,
        host: { id: "h1", label: "Local" },
        layout: { compact: false, platform: "web" },
        settingsOverride: {
          status: "ready",
          values: { ...DEFAULT_AGENT_HARNESS_SETTINGS, debugLogs: true },
          revision: "rev-empty",
          saving: false,
          save: vi.fn(),
        },
      }),
    );

    expect(await screen.findByText("No trace entries recorded yet")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Clear Trace" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("orders and formats provider catalog entries from host inspection", () => {
    expect(formatProviderDisplayLabel("antigravity")).toBe("Antigravity");
    expect(formatProviderDisplayLabel("opencode")).toBe("OpenCode");
    const providers = [
      { provider: "codex", enabled: false, models: ["flash"] },
      { provider: "claude", enabled: true, models: ["pro"] },
      { provider: "antigravity", enabled: true, models: ["gemini-4-neon"] },
    ];
    expect(resolveActiveHostProviderId(providers)).toBe("antigravity");
    expect(buildOrderedProviderIds(providers)).toEqual([
      "claude",
      "antigravity",
      "opencode",
      "pi",
      "codex",
    ]);
  });
});
