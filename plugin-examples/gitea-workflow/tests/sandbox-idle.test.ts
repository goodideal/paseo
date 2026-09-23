import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../server/store.js";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { GiteaClientPool } from "../server/client-pool.js";
import type { GiteaWorkflowTask } from "../shared/types.js";

describe("Sandbox 24-Hour Idle Service Reclamation", () => {
  it("automatically stops dev service and marks task hibernated after idle timeout", async () => {
    const storePath = join(tmpdir(), `test-idle-${Date.now()}.json`);
    const store = new TaskStore(storePath);
    const clientPool = new GiteaClientPool();

    const stopMock = vi.fn().mockResolvedValue(undefined);

    const orchestrator = new WorktreeOrchestrator({
      store,
      clientPool,
      sandboxIdleTimeoutMs: 0, // 1 second for unit test
      paseoApi: {
        scripts: {
          start: vi.fn().mockResolvedValue(undefined),
          stop: stopMock,
        },
      },
    });

    const oldDate = new Date(Date.now() - 5000).toISOString();
    const task: GiteaWorkflowTask = {
      id: "task-idle-test",
      projectId: "proj-web",
      projectPath: "/tmp/web",
      issueNumber: 101,
      issueTitle: "Feature A",
      issueUrl: "http://gitea.local/issues/101",
      issueBody: "test",
      giteaBaseUrl: "http://gitea.local",
      repoOwner: "owner",
      repoName: "web",
      branchName: "agent/issue-101",
      workspaceId: "ws-101",
      agentId: "agent-101",
      state: "pending_human_review",
      previewUrl: "http://dev--issue-101--web.localhost:8080",
      screenshots: [],
      diffSummary: null,
      createdAt: oldDate,
      updatedAt: oldDate,
    };

    await store.saveTask(task);

    // Run processQueue which triggers reapIdleSandboxServices
    await orchestrator.processQueue();

    expect(stopMock).toHaveBeenCalledWith({
      workspaceId: "ws-101",
      scriptName: "dev",
    });

    const updated = await store.getTask(task.id);
    expect(updated?.sandboxHibernated).toBe(true);
    expect(updated?.previewUrl).toBeNull();
  });
});
