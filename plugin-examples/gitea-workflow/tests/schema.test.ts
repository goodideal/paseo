import { describe, expect, it } from "vitest";
import { GiteaWorkflowTaskSchema, GiteaSettingsSchema } from "../shared/types.js";
import { listTasksRpc, approveTaskRpc, rejectTaskRpc } from "../shared/contracts.js";

describe("Gitea Workflow Schemas and RPCs", () => {
  it("validates a valid task record", () => {
    const validTask = {
      id: "task-gitea-101",
      issueNumber: 101,
      issueTitle: "Fix navigation header alignment",
      issueUrl: "https://gitea.example.com/org/repo/issues/101",
      issueBody: "Header is overlapping on mobile viewports.",
      repoOwner: "org",
      repoName: "repo",
      branchName: "agent/issue-101-fix-header",
      workspaceId: "ws-123",
      agentId: "agent-456",
      state: "pending_human_review",
      screenshots: [
        {
          id: "sc-1",
          label: "Desktop (1280x800)",
          viewport: { width: 1280, height: 800 },
          relativePath: "screenshots/desktop.png",
          capturedAt: "2026-09-19T10:00:00.000Z",
        },
      ],
      diffSummary: {
        additions: 12,
        deletions: 4,
        filesChanged: 2,
      },
      createdAt: "2026-09-19T09:50:00.000Z",
      updatedAt: "2026-09-19T10:00:00.000Z",
    };

    const parsed = GiteaWorkflowTaskSchema.parse(validTask);
    expect(parsed.id).toBe("task-gitea-101");
    expect(parsed.state).toBe("pending_human_review");
  });

  it("validates plugin settings with defaults", () => {
    const settings = GiteaSettingsSchema.parse({
      giteaUrl: "https://gitea.mycompany.com",
      giteaToken: "secret-token",
      repoOwner: "mycompany",
      repoName: "frontend",
    });

    expect(settings.listenLabel).toBe("agent-ready");
    expect(settings.inProgressLabel).toBe("agent-in-progress");
    expect(settings.reviewedLabel).toBe("agent-reviewed");
    expect(settings.pollIntervalSeconds).toBe(60);
    expect(settings.maxConcurrentWorktrees).toBe(3);
  });

  it("exports valid RPC contracts", () => {
    expect(listTasksRpc.name).toBe("gitea.tasks.list");
    expect(approveTaskRpc.name).toBe("gitea.tasks.approve");
    expect(rejectTaskRpc.name).toBe("gitea.tasks.reject");
  });
});
