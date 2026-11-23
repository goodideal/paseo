/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QuickPromptsPopover } from "../client/popover.js";

// Mock @getpaseo/plugin/client hooks
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: vi.fn(() => ({ status: "idle", labels: [] })),
  useWorkspace: vi.fn(() => ({ projectId: "test-proj" })),
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

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  useToast: vi.fn(() => ({ show: vi.fn() })),
  Icon: vi.fn(({ name }) => <span data-testid={`icon-${name}`}>{name}</span>),
}));

vi.mock("../client/prompt-executor.js", () => ({
  executeQuickPrompt: vi.fn().mockResolvedValue(true),
}));

describe("QuickPromptsPopover (Minimal Strip)", () => {
  it("renders action chips cleanly with custom icon and color support", async () => {
    const close = vi.fn();
    const onOpenSettings = vi.fn();

    const { getByTestId, queryByPlaceholderText, queryByText } = render(
      <QuickPromptsPopover
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

    // Verification of minimalism: no search box, no redundant tabs, no bottom caption
    expect(queryByPlaceholderText("搜索快捷指令...")).toBeNull();
    expect(queryByText("全部")).toBeNull();
    expect(queryByText("AI推荐")).toBeNull();
    expect(queryByText("规则推荐")).toBeNull();
    expect(queryByText("点击一键发送 · 或在输入框输入 /快捷键")).toBeNull();

    // Settings trigger exists
    const settingsBtn = getByTestId("quick-prompts-settings-trigger");
    expect(settingsBtn).toBeDefined();
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
