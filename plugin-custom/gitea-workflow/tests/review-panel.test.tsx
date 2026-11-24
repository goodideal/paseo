// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const mockListTasks = vi.fn().mockResolvedValue({ tasks: [] });
const mockApproveTask = vi.fn().mockResolvedValue({ ok: true });
const mockRejectTask = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (def: { name?: string }) => {
    if (def?.name === "gitea.tasks.list") return mockListTasks;
    if (def?.name === "gitea.tasks.approve") return mockApproveTask;
    if (def?.name === "gitea.tasks.reject") return mockRejectTask;
    return vi.fn();
  },
  usePaseo: () => null,
}));

import { ReviewPanel } from "../client/review-panel.js";

afterEach(() => {
  cleanup();
  mockListTasks.mockReset().mockResolvedValue({ tasks: [] });
});

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

  it("renders staticReview role/tier badge with antigravity/gemini-4-carbon default and harness step metadata in AuditTimeline", async () => {
    mockListTasks.mockResolvedValue({
      tasks: [
        {
          id: "task-202",
          projectId: "proj-1",
          projectPath: "/repo",
          issueNumber: 42,
          issueTitle: "Support Agent Harness",
          issueUrl: "http://gitea.local/org/repo/issues/42",
          issueBody: "Integrate agent harness routing",
          giteaBaseUrl: "http://gitea.local",
          repoOwner: "org",
          repoName: "repo",
          branchName: "feat/issue-42",
          workspaceId: "ws-1",
          agentId: "ag-1",
          state: "pending_human_review",
          screenshots: [],
          reviewSignOff: {
            staticReview: {
              passed: true,
              role: "review",
              tier: "review",
              summary: "Dual-axis approved",
            },
          },
          diffSummary: null,
          createdAt: "2026-11-24T00:00:00.000Z",
          updatedAt: "2026-11-24T00:10:00.000Z",
        },
      ],
    });

    const mockWorkflowApi = {
      inspect: vi.fn().mockResolvedValue({
        id: "task-202",
        status: "waiting_approval",
        stepAttempts: [
          {
            stepId: "independent-review",
            attempt: 1,
            status: "succeeded",
            startedAt: "2026-11-24T00:05:00.000Z",
            completedAt: "2026-11-24T00:08:00.000Z",
            skipReason: null,
            failureReason: null,
            harness: {
              enabled: true,
              mode: "auto",
              role: "review",
              tier: "review",
              phase: "review",
              provider: "antigravity",
              model: "gemini-4-carbon",
            },
          },
        ],
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

    expect(
      await screen.findByText("review (review) · antigravity/gemini-4-carbon · Dual-axis approved"),
    ).toBeDefined();

    fireEvent.click(screen.getByText("审计"));
    expect(
      await screen.findByText("Harness: review · review (antigravity/gemini-4-carbon)"),
    ).toBeDefined();
  });
});
