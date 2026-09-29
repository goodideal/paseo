// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewPanel } from "../client/review-panel.js";

describe("ReviewPanel", () => {
  it("renders pending interaction card when agent asks design question", async () => {
    const mockWorkflowApi = {
      inspect: vi.fn().mockResolvedValue({
        id: "run-101",
        status: "running",
        pendingInteraction: {
          id: "inter-1",
          promptArtifactId: "art-q",
          question: "需要支持哪些数据库？",
        },
        stepAttempts: [{ stepId: "brainstorm-agent", status: "running" }],
      }),
      interactionRespond: vi.fn().mockResolvedValue({}),
      runInspect: vi.fn().mockResolvedValue({
        run: {
          id: "run-101",
          status: "running",
          pendingInteraction: {
            id: "inter-1",
            promptArtifactId: "art-q",
            question: "需要支持哪些数据库？",
          },
          stepAttempts: [{ stepId: "brainstorm-agent", status: "running" }],
        },
      }),
    };

    render(
      <ReviewPanel
        workspaceId="ws-1"
        theme={
          {
            colors: {
              foreground: "#fff",
              foregroundMuted: "#888",
              surface0: "#000",
              surface1: "#111",
              border: "#333",
              accent: "#00f",
              accentForeground: "#fff",
              statusSuccess: "#0f0",
              statusDanger: "#f00",
              statusWarning: "#fa0",
            },
          } as any
        }
        workflowApi={mockWorkflowApi as any}
      />,
    );

    expect(await screen.findByText("需要支持哪些数据库？")).toBeDefined();
    const input = screen.getByPlaceholderText("输入回复...");
    fireEvent.change(input, { target: { value: "支持 PostgreSQL 和 SQLite" } });
    fireEvent.click(screen.getByText("发送回复"));

    expect(mockWorkflowApi.interactionRespond).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "支持 PostgreSQL 和 SQLite" }),
    );
  });
});
