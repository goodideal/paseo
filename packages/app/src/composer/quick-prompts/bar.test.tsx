// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickPromptItem } from "@/stores/quick-prompts-store";
import { QuickPromptBar } from "./bar";

describe("QuickPromptBar", () => {
  afterEach(() => {
    cleanup();
  });

  const mockItems: QuickPromptItem[] = [
    {
      id: "item-1",
      label: "Continue",
      content: "Please continue to the next step.",
      triggerType: "fixed",
      enabled: true,
      createdAt: 1,
      order: 0,
    },
    {
      id: "item-2",
      label: "Fix Error",
      content: "Please fix error",
      triggerType: "rule",
      enabled: true,
      createdAt: 2,
      order: 1,
    },
  ];

  it("renders null when items array is empty", () => {
    const { queryByTestId } = render(
      <QuickPromptBar
        items={[]}
        onSelectPrompt={vi.fn()}
        onSelectForEdit={vi.fn()}
        onOpenManage={vi.fn()}
      />,
    );

    expect(queryByTestId("quick-prompt-bar")).toBeNull();
  });

  it("renders all items and manage button", () => {
    const { getByTestId, getByText } = render(
      <QuickPromptBar
        items={mockItems}
        onSelectPrompt={vi.fn()}
        onSelectForEdit={vi.fn()}
        onOpenManage={vi.fn()}
      />,
    );

    expect(getByTestId("quick-prompt-bar")).toBeDefined();
    expect(getByText("Continue")).toBeDefined();
    expect(getByText("Fix Error")).toBeDefined();
    expect(getByTestId("quick-prompt-manage-button")).toBeDefined();
  });

  it("triggers onSelectPrompt on single click (press)", () => {
    const onSelectPrompt = vi.fn();
    const { getByTestId } = render(
      <QuickPromptBar
        items={mockItems}
        onSelectPrompt={onSelectPrompt}
        onSelectForEdit={vi.fn()}
        onOpenManage={vi.fn()}
      />,
    );

    fireEvent.click(getByTestId("quick-prompt-chip-item-1"));
    expect(onSelectPrompt).toHaveBeenCalledTimes(1);
    expect(onSelectPrompt).toHaveBeenCalledWith(mockItems[0]);
  });

  it("does not trigger onSelectPrompt when isSubmitDisabled is true", () => {
    const onSelectPrompt = vi.fn();
    const { getByTestId } = render(
      <QuickPromptBar
        items={mockItems}
        onSelectPrompt={onSelectPrompt}
        onSelectForEdit={vi.fn()}
        onOpenManage={vi.fn()}
        isSubmitDisabled={true}
      />,
    );

    fireEvent.click(getByTestId("quick-prompt-chip-item-1"));
    expect(onSelectPrompt).not.toHaveBeenCalled();
  });

  it("triggers onOpenManage when manage button is clicked", () => {
    const onOpenManage = vi.fn();
    const { getByTestId } = render(
      <QuickPromptBar
        items={mockItems}
        onSelectPrompt={vi.fn()}
        onSelectForEdit={vi.fn()}
        onOpenManage={onOpenManage}
      />,
    );

    fireEvent.click(getByTestId("quick-prompt-manage-button"));
    expect(onOpenManage).toHaveBeenCalledTimes(1);
  });

  it("triggers onSelectForEdit on long press", () => {
    vi.useFakeTimers();
    const onSelectForEdit = vi.fn();
    const { getByTestId } = render(
      <QuickPromptBar
        items={mockItems}
        onSelectPrompt={vi.fn()}
        onSelectForEdit={onSelectForEdit}
        onOpenManage={vi.fn()}
      />,
    );

    const chip = getByTestId("quick-prompt-chip-item-1");
    fireEvent.mouseDown(chip);
    vi.advanceTimersByTime(400);
    fireEvent.mouseUp(chip);

    expect(onSelectForEdit).toHaveBeenCalledWith(mockItems[0]);
    vi.useRealTimers();
  });

  it("triggers onSelectForEdit on context menu (right click)", () => {
    const onSelectForEdit = vi.fn();
    const { getByTestId } = render(
      <QuickPromptBar
        items={mockItems}
        onSelectPrompt={vi.fn()}
        onSelectForEdit={onSelectForEdit}
        onOpenManage={vi.fn()}
      />,
    );

    const chip = getByTestId("quick-prompt-chip-item-1");
    fireEvent.contextMenu(chip);

    expect(onSelectForEdit).toHaveBeenCalledWith(mockItems[0]);
  });

  it("renders ephemeral option chips with proper distinction", () => {
    const ephemeralItems: QuickPromptItem[] = [
      {
        id: "ephemeral-opt-1",
        label: "1. WebSocket",
        content: "I choose Option 1.",
        triggerType: "ephemeral",
        enabled: true,
        ephemeral: true,
        createdAt: 1,
        order: -100,
      },
      ...mockItems,
    ];

    const { getByText } = render(
      <QuickPromptBar
        items={ephemeralItems}
        onSelectPrompt={vi.fn()}
        onSelectForEdit={vi.fn()}
        onOpenManage={vi.fn()}
      />,
    );

    expect(getByText("1. WebSocket")).toBeDefined();
    expect(getByText("Continue")).toBeDefined();
  });
});
