import { describe, expect, it } from "vitest";
import {
  GiteaWorkflowTaskSchema,
  GiteaSettingsSchema,
  ResolvedProjectGiteaSchema,
} from "../shared/types.js";
import { listTasksRpc, approveTaskRpc, rejectTaskRpc } from "../shared/contracts.js";

describe("Gitea Workflow Schemas and RPCs", () => {
  it("validates a valid task record with project scoping", () => {
    const validTask = {
      id: "task-proj1-gitea-101",
      projectId: "proj-1",
      projectPath: "/path/to/proj1",
      issueNumber: 101,
      issueTitle: "Fix navigation header alignment",
      issueUrl: "https://gitea.example.com/org/repo/issues/101",
      issueBody: "Header is overlapping on mobile viewports.",
      giteaBaseUrl: "https://gitea.example.com",
      giteaToken: "tok-101",
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
    expect(parsed.id).toBe("task-proj1-gitea-101");
    expect(parsed.projectId).toBe("proj-1");
    expect(parsed.state).toBe("pending_human_review");
  });

  it("validates resolved project schema", () => {
    const resolved = ResolvedProjectGiteaSchema.parse({
      projectId: "proj-1",
      projectPath: "/workspace/my-app",
      projectName: "my-app",
      host: "gitea.internal",
      baseUrl: "https://gitea.internal:8443",
      token: "secret-token",
      repoOwner: "team",
      repoName: "my-app",
      authSource: "tea",
    });

    expect(resolved.authSource).toBe("tea");
    expect(resolved.baseUrl).toBe("https://gitea.internal:8443");
  });

  it("validates plugin settings with defaults without requiring static git urls", () => {
    const settings = GiteaSettingsSchema.parse({});

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
