// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { DecisionCard } from "../client/components/decision-card.js";
import { ActionButtons } from "../client/components/action-buttons.js";

const mockSubmit = vi.fn().mockResolvedValue({ success: true });

vi.mock("../client/hooks/use-decision-rpc.js", () => ({
  useDecisionRpc: () => ({
    submitDecision: mockSubmit,
    isSubmitting: false,
    error: null,
  }),
}));

describe("ActionButtons Component", () => {
  const options = [
    { id: "opt1", label: "Retry", description: "", actionType: "retry_with_tip" as const },
    { id: "opt2", label: "Cancel", description: "", actionType: "pause" as const },
  ];

  it("renders primary and secondary options", () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ActionButtons options={options} onSelect={onSelect} />);

    expect(screen.getByText("Retry")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("calls onSelect when pressed", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ActionButtons options={options} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Retry"));
    expect(onSelect).toHaveBeenCalledWith("opt1");
  });
});

describe("DecisionCard Component", () => {
  const mockItem = {
    type: "plugin" as const,
    kind: "watchdog_blocker",
    version: 1,
    data: {
      agentId: "agent-123",
      summary: "Agent blocked on test",
      rootCause: "Tests failed 3 times",
      options: [
        {
          id: "opt1",
          label: "Fix it",
          description: "Fix tests",
          actionType: "retry_with_tip" as const,
        },
      ],
      timestamp: new Date().toISOString(),
    },
  };

  const layout = { platform: "web" as const, compact: false };
  const host = { id: "host", label: "Host" };
  const theme: Parameters<typeof DecisionCard>[0]["theme"] = null!;

  it("renders pending state initially", () => {
    render(
      <DecisionCard
        item={mockItem}
        agentId="agent-123"
        timestamp={new Date()}
        layout={layout}
        host={host}
        theme={theme}
      />,
    );

    expect(screen.getByText("待决策")).toBeDefined();
    expect(screen.getByText(/Agent blocked on test/)).toBeDefined();
    expect(screen.getByText("Tests failed 3 times")).toBeDefined();
  });

  it("updates to resolved state after successful action", async () => {
    render(
      <DecisionCard
        item={mockItem}
        agentId="agent-123"
        timestamp={new Date()}
        layout={layout}
        host={host}
        theme={theme}
      />,
    );

    fireEvent.click(screen.getByText("Fix it"));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        agentId: "agent-123",
        optionId: "opt1",
      });
      expect(screen.getByText("已恢复")).toBeDefined();
      expect(screen.getByText(/已选择执行: Fix it/)).toBeDefined();
    });
  });
});

afterEach(cleanup);
