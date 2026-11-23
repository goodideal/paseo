// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QuickPromptsModal } from "../client/modal.js";
import type { QuickPromptItem } from "../shared/contracts.js";

const mockToastShow = vi.fn();
const mockToastError = vi.fn();

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Modal: Object.assign(
    ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? <div data-testid="modal-root">{children}</div> : null,
    {
      Content: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="modal-content">{children}</div>
      ),
    },
  ),
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TextInput: ({ onChangeText, ...props }: any) => (
    <input onChange={(e: any) => onChangeText?.(e.target.value)} {...props} />
  ),
  Icon: ({ name }: { name: string }) => <span data-testid={`mock-icon-${name}`}>{name}</span>,
  useToast: () => ({
    show: mockToastShow,
    error: mockToastError,
  }),
}));

describe("QuickPromptsModal Confirmation & Feedback", () => {
  const sampleItems: QuickPromptItem[] = [
    {
      id: "item-1",
      label: "Custom Continue",
      content: "Continue with plan",
      triggerType: "fixed",
      enabled: true,
      createdAt: 1000,
      order: 0,
    },
    {
      id: "item-2",
      label: "Custom Fix",
      content: "Fix the errors",
      triggerType: "fixed",
      enabled: true,
      createdAt: 2000,
      order: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not reset immediately on click; requires confirmation and shows success toast", async () => {
    const onResetGlobalDefaults = vi.fn().mockResolvedValue(undefined);
    const onSaveGlobalItems = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickPromptsModal
        visible={true}
        onClose={vi.fn()}
        globalItems={sampleItems}
        onSaveGlobalItems={onSaveGlobalItems}
        onResetGlobalDefaults={onResetGlobalDefaults}
      />,
    );

    const resetBtn = screen.getByText(/重置默认/);
    expect(resetBtn).toBeDefined();
    expect(screen.queryByText(/确认恢复默认提示词/)).toBeNull();

    fireEvent.click(resetBtn);
    expect(screen.getByText(/确认恢复默认提示词/)).toBeDefined();
    expect(onResetGlobalDefaults).not.toHaveBeenCalled();

    const cancelBtn = screen.getByText(/取消 \/ Cancel/);
    fireEvent.click(cancelBtn);
    expect(screen.queryByText(/确认恢复默认提示词/)).toBeNull();
    expect(onResetGlobalDefaults).not.toHaveBeenCalled();

    fireEvent.click(resetBtn);
    expect(screen.getByText(/确认恢复默认提示词/)).toBeDefined();

    const confirmResetBtn = screen.getByText(/确认重置 \/ Yes, Reset/);
    fireEvent.click(confirmResetBtn);

    await waitFor(() => {
      expect(onResetGlobalDefaults).toHaveBeenCalledTimes(1);
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      expect.stringContaining("已成功恢复默认快捷提示词"),
      { variant: "success" },
    );
  });

  it("requires confirmation when deleting a prompt item and displays toast on deletion", async () => {
    const onSaveGlobalItems = vi.fn().mockResolvedValue(undefined);
    const onResetGlobalDefaults = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickPromptsModal
        visible={true}
        onClose={vi.fn()}
        globalItems={sampleItems}
        onSaveGlobalItems={onSaveGlobalItems}
        onResetGlobalDefaults={onResetGlobalDefaults}
      />,
    );

    const deleteButtons = screen.getAllByText("🗑️");
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText(/确认删除提示词/)).toBeDefined();
    expect(screen.getAllByText(/Custom Continue/).length).toBeGreaterThanOrEqual(2);
    expect(onSaveGlobalItems).not.toHaveBeenCalled();

    const cancelBtn = screen.getByText(/取消 \/ Cancel/);
    fireEvent.click(cancelBtn);
    expect(screen.queryByText(/确认删除提示词/)).toBeNull();
    expect(onSaveGlobalItems).not.toHaveBeenCalled();

    const freshDeleteButtons = screen.getAllByText("🗑️");
    fireEvent.click(freshDeleteButtons[0]);
    const confirmDeleteBtn = screen.getByText(/确认删除 \/ Delete/);
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(onSaveGlobalItems).toHaveBeenCalledTimes(1);
    });

    const savedItems = onSaveGlobalItems.mock.calls[0][0];
    expect(savedItems.map((i: any) => i.id)).toEqual(["item-2"]);

    expect(mockToastShow).toHaveBeenCalledWith(expect.stringContaining("已删除提示词"), {
      variant: "info",
    });
  });
});

describe("QuickPromptsModal icon and color customization", () => {
  it("saves custom icon and color when creating a prompt", async () => {
    const onSaveGlobalItems = vi.fn().mockResolvedValue(undefined);
    const onResetGlobalDefaults = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickPromptsModal
        visible={true}
        onClose={vi.fn()}
        globalItems={[]}
        onSaveGlobalItems={onSaveGlobalItems}
        onResetGlobalDefaults={onResetGlobalDefaults}
      />,
    );

    // Open create form
    fireEvent.click(screen.getByText(/新增提示词/));

    // Fill label + content
    const labelInput = screen.getByPlaceholderText(/e.g. Continue/);
    fireEvent.change(labelInput, { target: { value: "Deploy Action" } });
    const contentInput = screen.getByPlaceholderText(/Enter full prompt content/);
    fireEvent.change(contentInput, { target: { value: "Deploy to production" } });

    // Select color (e.g. emerald 翠绿)
    const emeraldOption = screen.getByTestId("color-option-emerald");
    fireEvent.click(emeraldOption);

    // Select icon (e.g. Rocket 火箭)
    const rocketChip = screen.getByTestId("icon-quick-chip-Rocket");
    fireEvent.click(rocketChip);

    // Save
    fireEvent.click(screen.getByText(/保存 \/ Save/));

    await waitFor(() => {
      expect(onSaveGlobalItems).toHaveBeenCalledTimes(1);
    });
    const savedItems = onSaveGlobalItems.mock.calls[0][0];
    expect(savedItems[0].label).toBe("Deploy Action");
    expect(savedItems[0].color).toBe("emerald");
    expect(savedItems[0].icon).toBe("Rocket");
  });

  it("updates icon and color on edit", async () => {
    const onSaveGlobalItems = vi.fn().mockResolvedValue(undefined);
    const onResetGlobalDefaults = vi.fn().mockResolvedValue(undefined);
    const existing: QuickPromptItem[] = [
      {
        id: "item-edit-color",
        label: "Build",
        content: "Run build",
        color: "sky",
        icon: "Terminal",
        triggerType: "fixed",
        enabled: true,
        createdAt: 1,
        order: 0,
      },
    ];

    render(
      <QuickPromptsModal
        visible={true}
        onClose={vi.fn()}
        globalItems={existing}
        onSaveGlobalItems={onSaveGlobalItems}
        onResetGlobalDefaults={onResetGlobalDefaults}
      />,
    );

    const editBtn = screen.getByText("✏️");
    fireEvent.click(editBtn);

    // Change color to amber
    const amberOption = screen.getByTestId("color-option-amber");
    fireEvent.click(amberOption);

    // Change icon to Bug
    const bugChip = screen.getByTestId("icon-quick-chip-Bug");
    fireEvent.click(bugChip);

    // Save
    fireEvent.click(screen.getByText(/保存 \/ Save/));

    await waitFor(() => {
      expect(onSaveGlobalItems).toHaveBeenCalledTimes(1);
    });
    const savedItems = onSaveGlobalItems.mock.calls[0][0];
    expect(savedItems[0].color).toBe("amber");
    expect(savedItems[0].icon).toBe("Bug");
  });
});
