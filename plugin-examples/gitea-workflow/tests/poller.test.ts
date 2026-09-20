import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MultiProjectPoller } from "../server/poller.js";
import { ProjectGiteaResolver } from "../server/resolver.js";
import { WorktreeOrchestrator } from "../server/orchestrator.js";
import { TaskStore } from "../server/store.js";
import { GiteaClientPool } from "../server/client-pool.js";

describe("MultiProjectPoller", () => {
  it("polls across multiple projects discovered from Paseo", async () => {
    const store = new TaskStore(join(tmpdir(), `test-poller-${Date.now()}.json`));
    const clientPool = new GiteaClientPool();
    const orchestrator = new WorktreeOrchestrator({ store, clientPool });

    const resolver = new ProjectGiteaResolver();
    vi.spyOn(resolver, "resolveProject").mockImplementation(async (project) => ({
      projectId: project.projectId,
      projectPath: project.projectRootPath,
      projectName: project.projectDisplayName || project.projectId,
      host: "gitea.local",
      baseUrl: "http://gitea.local",
      token: "mock-token",
      repoOwner: "org",
      repoName: project.projectId,
      authSource: "tea",
    }));

    const clientA = orchestrator.getClientForProject({
      baseUrl: "http://gitea.local",
      token: "mock-token",
      repoOwner: "org",
      repoName: "proj-a",
    });
    const clientB = orchestrator.getClientForProject({
      baseUrl: "http://gitea.local",
      token: "mock-token",
      repoOwner: "org",
      repoName: "proj-b",
    });

    vi.spyOn(clientA, "fetchReadyIssues").mockResolvedValue([
      {
        number: 1,
        title: "Issue for Proj A",
        body: "Body A",
        html_url: "http://gitea.local/org/proj-a/issues/1",
        labels: [{ name: "agent-ready" }],
      },
    ]);
    vi.spyOn(clientA, "claimIssue").mockResolvedValue(undefined);

    vi.spyOn(clientB, "fetchReadyIssues").mockResolvedValue([
      {
        number: 2,
        title: "Issue for Proj B",
        body: "Body B",
        html_url: "http://gitea.local/org/proj-b/issues/2",
        labels: [{ name: "agent-ready" }],
      },
    ]);
    vi.spyOn(clientB, "claimIssue").mockResolvedValue(undefined);

    const mockProjectsProvider = {
      list: async () => ({
        projects: [
          {
            projectId: "proj-a",
            projectRootPath: "/path/a",
            projectDisplayName: "Project Alpha",
            projectKind: "git",
          },
          {
            projectId: "proj-b",
            projectRootPath: "/path/b",
            projectDisplayName: "Project Beta",
            projectKind: "git",
          },
        ],
      }),
    };

    const poller = new MultiProjectPoller(resolver, orchestrator, mockProjectsProvider, 1000);
    await poller.poll();
    await orchestrator.waitForIdle();

    const tasks = await store.listTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.projectId).sort()).toEqual(["proj-a", "proj-b"]);
  });
});
