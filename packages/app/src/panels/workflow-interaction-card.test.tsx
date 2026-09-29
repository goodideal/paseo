/* eslint-disable react-perf/jsx-no-new-object-as-prop, @typescript-eslint/no-explicit-any */
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof window !== "undefined") {
    if (!window.screen) (window as any).screen = {} as Screen;
    if (!window.screen.orientation) {
      (window.screen as any).orientation = { type: "landscape-primary", angle: 0 };
    }
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        addEventListener: () => {},
        addListener: () => {},
        dispatchEvent: () => false,
        matches: false,
        media: "",
        onchange: null,
        removeEventListener: () => {},
        removeListener: () => {},
      }),
    });
  }
});

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { WorkflowInteractionCard } from "./workflow-interaction-card";

describe("WorkflowInteractionCard", () => {
  const pendingInteraction = {
    id: "interaction_1",
    runId: "run_1",
    stepId: "step_ask",
    status: "pending" as const,
    promptArtifactId: "art_q_1",
    requestedAt: 100,
  };

  it("renders interaction, handles typing and submits answer disabling button while pending", async () => {
    let resolveRespond!: () => void;
    const respond = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRespond = resolve;
        }),
    );

    render(
      <WorkflowInteractionCard
        interaction={pendingInteraction}
        promptContent="请问是否采用完整门禁？"
        onRespond={respond}
      />,
    );

    expect(screen.getByText("请问是否采用完整门禁？")).toBeDefined();
    const input = screen.getByLabelText("Reply");
    fireEvent.change(input, { target: { value: "采用完整门禁" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

    expect(respond).toHaveBeenCalledWith("采用完整门禁");
    expect(screen.getByRole("button", { name: "Sending..." })).toHaveProperty("disabled", true);

    await act(async () => {
      resolveRespond();
    });
  });

  it("displays error message if submission fails", () => {
    render(
      <WorkflowInteractionCard
        interaction={pendingInteraction}
        onRespond={vi.fn()}
        error="Network error answering interaction"
      />,
    );
    expect(screen.getByText("Network error answering interaction")).toBeDefined();
  });
});
