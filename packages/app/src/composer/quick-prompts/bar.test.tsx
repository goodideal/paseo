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
      label: "继续",
      content: "请继续执行下一步。",
      triggerType: "fixed",
      enabled: true,
      createdAt: 1,
      order: 0,
    },
    {
      id: "item-2",
      label: "修复测试",
      content: "请修复报错",
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
    expect(getByText("继续")).toBeDefined();
    expect(getByText("修复测试")).toBeDefined();
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
});
