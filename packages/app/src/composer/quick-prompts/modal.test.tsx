import { i18n as testI18n } from "@/i18n/i18next";
void testI18n;
// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickPromptsStore } from "@/stores/quick-prompts-store";
import { QuickPromptsModal } from "./modal";

describe("QuickPromptsModal", () => {
  beforeEach(() => {
    useQuickPromptsStore.getState().resetToDefaults();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders list of items and actions when visible", () => {
    const { getByTestId, getByText } = render(
      <QuickPromptsModal visible={true} onClose={vi.fn()} />,
    );

    expect(getByTestId("quick-prompt-create-button")).toBeDefined();
    expect(getByTestId("quick-prompt-reset-button")).toBeDefined();
    expect(getByText("继续")).toBeDefined();
    expect(getByText("修复报错")).toBeDefined();
  });

  it("toggles item enabled state when switch is clicked", () => {
    const initialItem = useQuickPromptsStore
      .getState()
      .items.find((i) => i.id === "builtin-continue");
    expect(initialItem?.enabled).toBe(true);

    const { getByTestId } = render(<QuickPromptsModal visible={true} onClose={vi.fn()} />);

    fireEvent.click(getByTestId("quick-prompt-toggle-builtin-continue"));

    const updatedItem = useQuickPromptsStore
      .getState()
      .items.find((i) => i.id === "builtin-continue");
    expect(updatedItem?.enabled).toBe(false);
  });

  it("switches to create form on create button click", () => {
    const { getByTestId, queryByTestId } = render(
      <QuickPromptsModal visible={true} onClose={vi.fn()} />,
    );

    fireEvent.click(getByTestId("quick-prompt-create-button"));

    expect(getByTestId("quick-prompt-form-label")).toBeDefined();
    expect(getByTestId("quick-prompt-form-content")).toBeDefined();
    expect(queryByTestId("quick-prompt-create-button")).toBeNull();
  });

  it("deletes an item when delete button is clicked", () => {
    const { getByTestId } = render(<QuickPromptsModal visible={true} onClose={vi.fn()} />);

    fireEvent.click(getByTestId("quick-prompt-delete-builtin-continue"));

    const item = useQuickPromptsStore.getState().items.find((i) => i.id === "builtin-continue");
    expect(item).toBeUndefined();
  });
});
