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

vi.mock("@getpaseo/plugin/client", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useSettings: (...args: any[]) => (mockUseSettings as any)(...args),
    useRpc: (...args: any[]) => (mockUseRpc as any)(...args),
    useAgent: (...args: any[]) => (mockUseAgent as any)(...args),
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
  ScrollView: ({ children }: any) => React.createElement("div", null, children),
  useToast: () => mockToast,
}));

import contribute from "../index.client.js";
import {
  HARNESS_METADATA_KEY,
  HARNESS_METADATA_VERSION,
  type HarnessAgentMetadata,
} from "../shared/types.js";
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
import { HarnessSettingsScreen } from "../client/settings-screen.js";
import { HarnessPopover } from "../client/harness-popover.js";
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

    it("returns Compass for plan tier", () => {
      const meta = createSampleMetadata({ currentTier: "plan" });
      expect(resolveHarnessPillIcon(meta)).toBe("Compass");
    });

    it("returns ShieldCheck for review tier", () => {
      const meta = createSampleMetadata({ currentTier: "review" });
      expect(resolveHarnessPillIcon(meta)).toBe("ShieldCheck");
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
        fromTier: "plan",
        toTier: "flash",
        fromModel: "claude-3-7-sonnet",
        toModel: "claude-3-5-haiku",
        phase: "exec",
        reason: "plan_approved",
        turnNumber: 3,
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Plan Approved -> Flash");
      expect(vm.badgeCategory).toBe("success");
      expect(vm.icon).toBe("ShieldCheck");
      expect(vm.tierSummary).toBe("Plan -> Flash");
      expect(vm.modelSummary).toBe("claude-3-7-sonnet -> claude-3-5-haiku");
      expect(vm.fullMigrationSummary).toBe("plan (claude-3-7-sonnet) -> flash (claude-3-5-haiku)");
      expect(vm.readableReason).toBe("Plan mode exit approved by user");
    });

    it("maps auto_downgrade correctly", () => {
      const payload: HarnessTransitionPayload = {
        transitionKind: "auto_downgrade",
        role: "ui",
        fromTier: "plan",
        toTier: "flash",
        fromModel: "claude-3-7-sonnet",
        toModel: "claude-3-5-haiku",
        phase: "exec",
        reason: "write_tool_in_plan",
        turnNumber: 2,
        timestamp: "2026-11-12T00:00:00Z",
      };
      const vm = buildTransitionViewModel(payload);
      expect(vm.title).toBe("Auto Downgraded -> Flash");
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

    const cleanup = contribute(mockClient as PluginClientContext);

    // Verify timeline renderer registration
    expect(timelineRenderers).toHaveLength(1);
    expect(timelineRenderers[0]?.kind).toBe(HARNESS_TRANSITION_TIMELINE_KIND);
    expect(timelineRenderers[0]?.version).toBe(HARNESS_TRANSITION_TIMELINE_VERSION);

    // Verify settings screen registration
    expect(settingsScreens).toHaveLength(1);
    expect(settingsScreens[0]?.id).toBe("agent-harness-settings");
    expect(settingsScreens[0]?.title).toBe("Agent Harness");

    // Verify command center item registration
    expect(commandCenterItems).toHaveLength(1);
    expect(commandCenterItems[0]?.id).toBe("agent-harness-settings-command");

    // Allow async agent subscription promise to resolve
    await Promise.resolve();

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

    // Test cleanup unsubscribes and closes subscription
    cleanup();
    expect(timelineRenderers).toHaveLength(0);
    expect(settingsScreens).toHaveLength(0);
    expect(commandCenterItems).toHaveLength(0);
    expect(mockUnsub).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
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

    const cleanup = contribute(mockClient as PluginClientContext);
    cleanup();

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

    // Verify antigravity target provider is selected by default and edit Flash preset
    const targetProviderSelect = screen.getByLabelText("Target Provider") as HTMLSelectElement;
    expect(targetProviderSelect.value).toBe("antigravity");

    const flashPresetSelect = screen.getByLabelText("Flash Tier Preset") as HTMLSelectElement;
    fireEvent.change(flashPresetSelect, { target: { value: "gemini-4-neon-high" } });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMappings: expect.objectContaining({
          antigravity: expect.objectContaining({
            flash: "gemini-4-neon-high",
          }),
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
    expect((screen.getByLabelText("Flash Model ID") as HTMLInputElement).value).toBe(
      "gemini-4-neon-high",
    );
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

      const endpointInput = screen.getByLabelText("Classifier Endpoint URL") as HTMLInputElement;
      expect(endpointInput.disabled).toBe(false);

      fireEvent.change(endpointInput, {
        target: { value: "https://custom.llm.example/v1/chat/completions" },
      });
      expect(mockSave).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(350);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          llmFallbackEndpoint: "https://custom.llm.example/v1/chat/completions",
        }),
        "rev-debounce-1",
      );
      expect(mockToast.error).toHaveBeenCalledWith("Failed to save Agent Harness settings.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not echo stored llmFallbackApiKey back into input and supports clearing stored key", () => {
    const mockSave = vi.fn().mockResolvedValue(true);

    render(
      React.createElement(HarnessSettingsScreen, {
        ...mockSurfaceProps,
        settingsOverride: {
          status: "ready",
          values: {
            ...DEFAULT_AGENT_HARNESS_SETTINGS,
            llmFallbackApiKey: "secret-key-do-not-echo",
          },
          revision: "rev-secret-1",
          saving: false,
          save: mockSave,
        },
      }),
    );

    const apiKeyInput = screen.getByLabelText("Classifier API Key") as HTMLInputElement;
    expect(apiKeyInput.value).toBe("");
    expect(apiKeyInput.placeholder).toContain("Configured");

    const clearBtn = screen.getByRole("button", { name: "Clear API Key" });
    fireEvent.click(clearBtn);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ llmFallbackApiKey: "" }),
      "rev-secret-1",
    );
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
          s.id === "architect"
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
    expect(screen.getByText("antigravity · plan")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Switch to plan"));
    expect(mockSwitchFn).not.toHaveBeenCalled();
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
      model: "gemini-4-hydrogen-high",
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
    expect(screen.getByText("codex · flash")).toBeDefined();
    expect(screen.getByText("antigravity · flash")).toBeDefined();
    expect(screen.getAllByText("RO")).toHaveLength(2);
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
