/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QuickToolsPopover } from "../client/popover.js";

const mockSyncLabels = vi.fn().mockResolvedValue({ tagged: 2, skipped: 4 });
const mockCopyText = vi.fn().mockResolvedValue(undefined);
const mockToastShow = vi.fn();
const mockToastError = vi.fn();

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
  useSettings: vi.fn(() => ({ status: "ready", values: { aiSuggestions: true } })),
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
}));

vi.mock("../client/prompt-executor.js", () => ({
  executeQuickPrompt: vi.fn().mockResolvedValue(true),
}));

describe("QuickToolsPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Quick Info card shows kind badge, branch, and path
    expect(getByTestId("quick-tools-info-card")).toBeDefined();
    expect(getByText("WT")).toBeDefined();
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
});
