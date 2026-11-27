/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { useWorkspace } from "@getpaseo/plugin/client";
import { QuickToolsPopover } from "../client/popover.js";
import { QuickPromptsSettingsScreen } from "../client/settings-screen.js";
import {
  WORKSPACE_LABEL_COLOR_PALETTE,
  WORKSPACE_LABEL_LIGHT_COLOR_PALETTE,
} from "../client/color-palette.js";

const mockSyncLabels = vi.fn().mockResolvedValue({ tagged: 2, skipped: 4 });
const mockCopyText = vi.fn().mockResolvedValue(undefined);
const mockToastShow = vi.fn();
const mockToastError = vi.fn();
const mockSaveSettings = vi.fn().mockResolvedValue(true);

// Mock @getpaseo/plugin/client hooks
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: vi.fn(() => ({ status: "idle", cwd: "/repos/demo", labels: [] })),
  useWorkspace: vi.fn(() => ({
    projectId: "test-proj",
    kind: "worktree",
    branch: "feat/quick-tools",
    directory: "/repos/demo/.worktrees/feat-quick-tools",
  })),
  usePaseo: vi.fn(() => ({
    agents: {
      ref: vi.fn(() => ({
        timeline: {
          refetch: vi.fn().mockResolvedValue({ entries: [] }),
        },
      })),
    },
  })),
  useSettings: vi.fn(() => ({
    status: "ready",
    revision: "rev-1",
    saving: false,
    saveError: null,
    save: mockSaveSettings,
    values: {
      aiSuggestions: true,
      autoLabelWorkspaces: true,
      localLabelColor: "emerald",
      worktreeLabelColor: "amber",
    },
  })),
  useRpc: vi.fn((contract) => {
    if (contract.name.includes("workspace_labels.sync")) {
      return mockSyncLabels;
    }
    return vi.fn().mockImplementation(async () => {
      if (contract.name.includes("global.get")) {
        return {
          items: [
            {
              id: "p1",
              label: "Go",
              content: "Let us go",
              triggerType: "fixed",
              icon: "Rocket",
              color: "sky",
              enabled: true,
              createdAt: 1,
              order: 0,
            },
            {
              id: "p2",
              label: "Review",
              content: "Review code",
              triggerType: "fixed",
              icon: "Eye",
              color: "violet",
              enabled: true,
              createdAt: 2,
              order: 1,
            },
          ],
        };
      }
      return { items: [], disabledGlobalIds: [] };
    });
  }),
}));

vi.mock("@getpaseo/plugin/client/ui", () => ({
  useToast: vi.fn(() => ({ show: mockToastShow, error: mockToastError })),
  copyText: (...args: [string]) => mockCopyText(...args),
  Icon: vi.fn(({ name }) => <span data-testid={`icon-${name}`}>{name}</span>),
  SettingsSection: ({ title, children }: any) => (
    <div data-testid={`settings-section-${title}`}>
      <span>{title}</span>
      {children}
    </div>
  ),
  SettingsCard: ({ children }: any) => <div>{children}</div>,
  SettingsSwitch: ({ label, value, onValueChange }: any) => (
    <button
      type="button"
      data-testid={`settings-switch-${label}`}
      onClick={() => onValueChange(!value)}
    >
      {label}: {String(value)}
    </button>
  ),
  SettingsSelect: ({ label, value, options, onValueChange }: any) => (
    <select
      data-testid={`settings-select-${label}`}
      value={value}
      onChange={(e: any) => onValueChange(e.target.value)}
    >
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
  SettingsAction: ({ label, actionLabel, onPress }: any) => (
    <button type="button" data-testid={`settings-action-${label}`} onClick={onPress}>
      {actionLabel}
    </button>
  ),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Modal: Object.assign(() => null, { Content: () => null }),
  ScrollView: ({ children }: any) => <div>{children}</div>,
  TextInput: () => null,
  Icon: () => null,
  useToast: () => ({ show: mockToastShow, error: mockToastError }),
}));

vi.mock("../client/prompt-executor.js", () => ({
  executeQuickPrompt: vi.fn().mockResolvedValue(true),
}));

describe("QuickToolsPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders quick info, quick actions, and quick prompt chips cleanly", async () => {
    const close = vi.fn();
    const onOpenSettings = vi.fn();

    const { getByTestId, getByText, queryByPlaceholderText } = render(
      <QuickToolsPopover
        workspaceId="ws-1"
        agentId="agent-1"
        theme={
          {
            colors: {
              surface0: "#111",
              surface1: "#222",
              surface2: "#333",
              border: "#444",
              foreground: "#fff",
              foregroundMuted: "#888",
              accent: "#3b82f6",
            },
          } as any
        }
        host={{ id: "host-1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        close={close}
        onOpenSettings={onOpenSettings}
        context="agent"
      />,
    );

    await waitFor(() => {
      expect(getByTestId("quick-prompt-chip-p1")).toBeDefined();
      expect(getByTestId("quick-prompt-chip-p2")).toBeDefined();
      expect(getByTestId("icon-Rocket")).toBeDefined();
      expect(getByTestId("icon-Eye")).toBeDefined();
    });

    // Quick Info card shows kind badge, branch, and path with configured dark-theme amber color (#b29d64 -> rgb(178, 157, 100))
    expect(getByTestId("quick-tools-info-card")).toBeDefined();
    const kindBadge = getByTestId("quick-tools-kind-badge");
    expect(kindBadge).toBeDefined();
    const wtText = getByText("WT");
    expect(wtText).toBeDefined();
    const computedBadgeStyle = window.getComputedStyle(kindBadge);
    const computedTextStyle = window.getComputedStyle(wtText);
    expect(computedBadgeStyle.borderTopColor || computedBadgeStyle.borderColor).toMatch(
      /178,\s*157,\s*100/,
    );
    expect(computedBadgeStyle.backgroundColor).toMatch(/143,\s*120,\s*56/);
    expect(computedTextStyle.color).toMatch(/178,\s*157,\s*100/);
    expect(getByText("feat/quick-tools")).toBeDefined();
    expect(getByText("/repos/demo/.worktrees/feat-quick-tools")).toBeDefined();

    // Quick Actions work
    fireEvent.click(getByTestId("quick-tools-action-copy-path"));
    await waitFor(() => {
      expect(mockCopyText).toHaveBeenCalledWith("/repos/demo/.worktrees/feat-quick-tools");
      expect(mockToastShow).toHaveBeenCalledWith("Copied path");
    });

    fireEvent.click(getByTestId("quick-tools-action-copy-branch"));
    await waitFor(() => {
      expect(mockCopyText).toHaveBeenCalledWith("feat/quick-tools");
      expect(mockToastShow).toHaveBeenCalledWith("Copied branch");
    });

    fireEvent.click(getByTestId("quick-tools-action-sync-labels"));
    await waitFor(() => {
      expect(mockSyncLabels).toHaveBeenCalledWith({ force: true });
      expect(mockToastShow).toHaveBeenCalledWith("Labels synced: 2 updated, 4 unchanged");
    });

    expect(queryByPlaceholderText("搜索快捷指令...")).toBeNull();

    // Settings trigger opens Quick Tools settings and closes popover
    const settingsBtn = getByTestId("quick-tools-settings-trigger");
    expect(settingsBtn).toBeDefined();
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("renders Local badge with high-contrast light-theme emerald palette when workspace is local_checkout on a light surface", async () => {
    vi.mocked(useWorkspace).mockReturnValueOnce({
      projectId: "test-proj",
      kind: "local_checkout",
      branch: "main",
      directory: "/repos/demo",
    } as any);

    const { getByTestId, getByText } = render(
      <QuickToolsPopover
        workspaceId="ws-local"
        agentId="agent-1"
        theme={
          {
            colors: {
              surface0: "#ffffff",
              surface1: "#f5f5f5",
              surface2: "#eaeaea",
              border: "#d4d4d4",
              foreground: "#171717",
              foregroundMuted: "#737373",
              accent: "#2563eb",
            },
          } as any
        }
        host={{ id: "host-1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
        close={vi.fn()}
        context="agent"
      />,
    );

    const localBadge = getByTestId("quick-tools-kind-badge");
    const localText = getByText("Local");
    expect(localText).toBeDefined();
    // Light-theme emerald (#3e6e5d -> rgb(62, 110, 93)) instead of dark-theme (#6cae96 -> rgb(108, 174, 150))
    const computedLocalBadgeStyle = window.getComputedStyle(localBadge);
    const computedLocalTextStyle = window.getComputedStyle(localText);
    expect(computedLocalBadgeStyle.borderTopColor || computedLocalBadgeStyle.borderColor).toMatch(
      /62,\s*110,\s*93/,
    );
    expect(computedLocalBadgeStyle.backgroundColor).toMatch(/56,\s*128,\s*104/);
    expect(computedLocalTextStyle.color).toMatch(/62,\s*110,\s*93/);
    expect(WORKSPACE_LABEL_LIGHT_COLOR_PALETTE.emerald.text).toBe("#3e6e5d");
    expect(WORKSPACE_LABEL_COLOR_PALETTE.emerald.text).toBe("#6cae96");
  });
});

describe("QuickPromptsSettingsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveSettings.mockResolvedValue(true);
    mockSyncLabels.mockResolvedValue({ tagged: 2, skipped: 4 });
  });

  afterEach(() => {
    cleanup();
  });

  it("allows configuring Local Label Color and WT Label Color and triggers color sync without forcing unlabeled workspaces", async () => {
    const { getByTestId } = render(
      <QuickPromptsSettingsScreen
        theme={{ colors: { foreground: "#fff" } } as any}
        host={{ id: "host-1", label: "Local" }}
        layout={{ compact: false, platform: "web" }}
      />,
    );

    const localSelect = getByTestId("settings-select-Local Label Color") as HTMLSelectElement;
    const wtSelect = getByTestId("settings-select-WT Label Color") as HTMLSelectElement;
    expect(localSelect.value).toBe("emerald");
    expect(wtSelect.value).toBe("amber");

    fireEvent.change(localSelect, { target: { value: "teal" } });
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ localLabelColor: "teal" }),
        "rev-1",
      );
      expect(mockSyncLabels).toHaveBeenCalledWith({
        force: false,
        syncColor: true,
        localLabelColor: "teal",
        worktreeLabelColor: "amber",
      });
    });

    fireEvent.change(wtSelect, { target: { value: "orange" } });
    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ worktreeLabelColor: "orange" }),
        "rev-1",
      );
      expect(mockSyncLabels).toHaveBeenCalledWith({
        force: false,
        syncColor: true,
        localLabelColor: "emerald",
        worktreeLabelColor: "orange",
      });
    });
  });
});
