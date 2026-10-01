// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QuickPromptBar } from "../client/bar.js";
import type { PluginTheme } from "@getpaseo/plugin";
import type { QuickPromptItem } from "../shared/contracts.js";

const darkTheme: PluginTheme = {
  colors: {
    surface0: "#171717",
    surface1: "#262626",
    surface2: "#333333",
    surface3: "#404040",
    border: "#404040",
    foreground: "#f3f4f6",
    foregroundMuted: "#9ca3af",
    accent: "#3b82f6",
    accentForeground: "#ffffff",
    statusSuccess: "#6cb17b",
    statusWarning: "#c09664",
    statusDanger: "#d8847b",
  },
};

const lightTheme: PluginTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#fafafa",
    surface2: "#f4f4f5",
    surface3: "#e4e4e7",
    border: "#e4e4e7",
    foreground: "#1a1a1e",
    foregroundMuted: "#71717a",
    accent: "#20744A",
    accentForeground: "#ffffff",
    statusSuccess: "#3e704a",
    statusWarning: "#7b5d39",
    statusDanger: "#9d433b",
  },
};

const ruleItem: QuickPromptItem = {
  id: "rule-1",
  label: "Fix Error",
  content: "Fix it",
  triggerType: "rule",
  ruleCondition: { keywords: ["error"] },
  enabled: true,
  createdAt: 3,
  order: 0,
};

const fixedItem: QuickPromptItem = {
  id: "fixed-1",
  label: "Continue",
  content: "Continue",
  triggerType: "fixed",
  enabled: true,
  createdAt: 1,
  order: 1,
};

function renderBar(theme: PluginTheme, items: QuickPromptItem[] = [ruleItem, fixedItem]) {
  return render(
    <QuickPromptBar
      items={items}
      onSelectPrompt={vi.fn()}
      onSelectForEdit={vi.fn()}
      onOpenManage={vi.fn()}
      theme={theme}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("QuickPromptBar theme tokens", () => {
  it("renders rule chip with accent text and border in light theme (not accentForeground)", () => {
    renderBar(lightTheme, [ruleItem]);

    const chip = screen.getByTestId("quick-prompt-chip-rule-1") as HTMLElement;
    expect(chip).toBeDefined();

    const chipText = Array.from(chip.querySelectorAll("div")) as HTMLElement[];
    const labelText = chipText.find((el) => el.textContent === "Fix Error");
    expect(labelText).toBeDefined();
    expect(labelText?.getAttribute("style")).toContain("color: rgb(32, 116, 74)");
    expect(labelText?.getAttribute("style")).not.toContain("color: rgb(255, 255, 255)");
  });

  it("uses surface3 background when hovered", () => {
    const { container } = renderBar(lightTheme, [ruleItem]);
    const chip = screen.getByTestId("quick-prompt-chip-rule-1") as HTMLElement;
    fireEvent.mouseEnter(chip);
    expect(chip.getAttribute("style")).toContain("background-color: rgb(228, 228, 231)");
  });
});
