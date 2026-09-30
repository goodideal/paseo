import { describe, expect, it } from "vitest";
import {
  GiteaWorkflowTaskSchema,
  GiteaSettingsSchema,
  GiteaHostSettingsSchema,
  GiteaTriggerModeSchema,
  LIFECYCLE_LABELS,
  ResolvedProjectGiteaSchema,
  TRIGGER_LABELS,
} from "../shared/types.js";
import {
  listTasksRpc,
  approveTaskRpc,
  rejectTaskRpc,
  diagnoseProjectsRpc,
  pruneEvidenceRpc,
} from "../shared/contracts.js";

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
    expect(diagnoseProjectsRpc.name).toBe("gitea.diagnostics.list");
    expect(pruneEvidenceRpc.name).toBe("gitea.evidence.prune");
  });

  it("provides safe defaults with global automation disabled in GiteaHostSettingsSchema", () => {
    const settings = GiteaHostSettingsSchema.parse({});
    expect(settings.enabled).toBe(false);
    expect(settings.workflowPolicy).toBe("full_superpowers");
    expect(settings.pollIntervalSeconds).toBe(60);
    expect(settings.maxConcurrentRuns).toBe(3);
    expect(settings.evidenceRetentionDays).toBe(90);
    expect(settings.projects).toEqual({});
  });

  it("validates project authorization and policy override in GiteaHostSettingsSchema", () => {
    const settings = GiteaHostSettingsSchema.parse({
      enabled: true,
      projects: {
        "proj-1": {
          enabled: true,
          readyLabel: "bot-task",
          workflowPolicyOverride: "issue_preapproved",
        },
      },
    });
    expect(settings.projects["proj-1"].readyLabel).toBe("bot-task");
    expect(settings.projects["proj-1"].workflowPolicyOverride).toBe("issue_preapproved");
  });
});

describe("Trigger Mode and Label Schemas", () => {
  it("validates valid trigger modes", () => {
    expect(GiteaTriggerModeSchema.parse("auto")).toBe("auto");
    expect(GiteaTriggerModeSchema.parse("plan")).toBe("plan");
    expect(() => GiteaTriggerModeSchema.parse("ready")).toThrow();
  });

  it("exports expected trigger and lifecycle labels", () => {
    expect(TRIGGER_LABELS.AUTO).toContain("agent-auto");
    expect(TRIGGER_LABELS.AUTO).toContain("agent:auto");
    expect(TRIGGER_LABELS.PLAN).toContain("agent-plan");
    expect(TRIGGER_LABELS.PLAN).toContain("agent:plan");
    expect(LIFECYCLE_LABELS.IN_PROGRESS).toBe("agent-in-progress");
    expect(LIFECYCLE_LABELS.WAITING_APPROVAL).toBe("agent-waiting-approval");
    expect(LIFECYCLE_LABELS.DELIVERED).toBe("agent-delivered");
    expect(LIFECYCLE_LABELS.FAILED).toBe("agent-failed");
  });
});
