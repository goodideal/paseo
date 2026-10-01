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

    // Initial state: reset button is visible, confirm card is not visible
    const resetBtn = screen.getByText(/重置默认/);
    expect(resetBtn).toBeDefined();
    expect(screen.queryByText(/确认恢复默认提示词/)).toBeNull();

    // 1. Click reset button
    fireEvent.click(resetBtn);

    // Confirmation card is now visible, but reset has NOT been called yet
    expect(screen.getByText(/确认恢复默认提示词/)).toBeDefined();
    expect(onResetGlobalDefaults).not.toHaveBeenCalled();

    // 2. Click Cancel
    const cancelBtn = screen.getByText(/取消 \/ Cancel/);
    fireEvent.click(cancelBtn);

    // Confirmation card is dismissed, reset was still NOT called
    expect(screen.queryByText(/确认恢复默认提示词/)).toBeNull();
    expect(onResetGlobalDefaults).not.toHaveBeenCalled();

    // 3. Click Reset again to open confirmation
    fireEvent.click(resetBtn);
    expect(screen.getByText(/确认恢复默认提示词/)).toBeDefined();

    // 4. Click Confirm Reset button
    const confirmResetBtn = screen.getByText(/确认重置 \/ Yes, Reset/);
    fireEvent.click(confirmResetBtn);

    // Verify onResetGlobalDefaults was called
    await waitFor(() => {
      expect(onResetGlobalDefaults).toHaveBeenCalledTimes(1);
    });

    // Verify success toast was displayed
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
    // expect(deleteButtons.length).toBe(2);

    // Click delete on the first item ("Custom Continue")
    fireEvent.click(deleteButtons[0]);

    // Verify delete confirmation card is displayed
    expect(screen.getByText(/确认删除提示词/)).toBeDefined();
    expect(screen.getAllByText(/Custom Continue/).length).toBeGreaterThanOrEqual(2);
    expect(onSaveGlobalItems).not.toHaveBeenCalled();

    // Click cancel
    const cancelBtn = screen.getByText(/取消 \/ Cancel/);
    fireEvent.click(cancelBtn);
    expect(screen.queryByText(/确认删除提示词/)).toBeNull();
    expect(onSaveGlobalItems).not.toHaveBeenCalled();

    // Click delete again and confirm
    const freshDeleteButtons = screen.getAllByText("🗑️");
    fireEvent.click(freshDeleteButtons[0]);
    const confirmDeleteBtn = screen.getByText(/确认删除 \/ Delete/);
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(onSaveGlobalItems).toHaveBeenCalledTimes(1);
    });

    // Check that the remaining items exclude item-1
    const savedItems = onSaveGlobalItems.mock.calls[0][0];
    expect(savedItems.map((i: any) => i.id)).toEqual(["item-2"]);

    // Verify info toast was displayed
    expect(mockToastShow).toHaveBeenCalledWith(expect.stringContaining("已删除提示词"), {
      variant: "info",
    });
  });
});

describe("QuickPromptsModal target model configuration", () => {
  it("saves targetModelId when a model option is selected", async () => {
    const onSaveGlobalItems = vi.fn().mockResolvedValue(undefined);
    const onResetGlobalDefaults = vi.fn().mockResolvedValue(undefined);
    const availableModels = [
      { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
      { id: "gpt-5.4", label: "GPT-5.4" },
    ];

    render(
      <QuickPromptsModal
        visible={true}
        onClose={vi.fn()}
        globalItems={[]}
        onSaveGlobalItems={onSaveGlobalItems}
        onResetGlobalDefaults={onResetGlobalDefaults}
        availableModels={availableModels}
      />,
    );

    // Open create form
    fireEvent.click(screen.getByText(/新增提示词/));

    // Fill label + content
    const labelInput = screen.getByPlaceholderText(/e.g. Continue/);
    fireEvent.change(labelInput, { target: { value: "Opus Prompt" } });
    const contentInput = screen.getByPlaceholderText(/Enter full prompt content/);
    fireEvent.change(contentInput, { target: { value: "Use opus to do this" } });

    // Select model option
    fireEvent.click(screen.getByText("Claude 3.7 Sonnet"));

    // Save
    fireEvent.click(screen.getByText(/保存 \/ Save/));

    await waitFor(() => {
      expect(onSaveGlobalItems).toHaveBeenCalledTimes(1);
    });
    const savedItems = onSaveGlobalItems.mock.calls[0][0];
    expect(savedItems[0].targetModelId).toBe("claude-3-7-sonnet");
  });

  it("clears targetModelId when using current model on edit", async () => {
    const onSaveGlobalItems = vi.fn().mockResolvedValue(undefined);
    const onResetGlobalDefaults = vi.fn().mockResolvedValue(undefined);
    const existing = [
      {
        id: "item-with-model",
        label: "Model Prompt",
        content: "Do it",
        triggerType: "fixed" as const,
        enabled: true,
        createdAt: 1,
        order: 0,
        targetModelId: "claude-3-7-sonnet",
      },
    ];

    render(
      <QuickPromptsModal
        visible={true}
        onClose={vi.fn()}
        globalItems={existing}
        onSaveGlobalItems={onSaveGlobalItems}
        onResetGlobalDefaults={onResetGlobalDefaults}
        availableModels={[{ id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" }]}
      />,
    );

    // Edit via delete-free edit path: open edit by clicking edit button (✏️) if present
    fireEvent.click(screen.getByText(/Model Prompt/));
    // In list mode clicking the row label does not open edit; find edit button by label
    const editButtons = screen.getAllByText("✏️");
    if (editButtons.length > 0) {
      fireEvent.click(editButtons[0]);
    }

    // Clear model by choosing "使用当前模型"
    fireEvent.click(screen.getByText(/使用当前模型/));

    // Save
    fireEvent.click(screen.getByText(/保存 \/ Save/));

    await waitFor(() => {
      expect(onSaveGlobalItems).toHaveBeenCalledTimes(1);
    });
    const savedItems = onSaveGlobalItems.mock.calls[0][0];
    expect(savedItems[0].targetModelId).toBeUndefined();
  });
});
