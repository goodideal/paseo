import { describe, it, expect, vi } from "vitest";
import { DiagnosticsService } from "../server/diagnostics.js";

describe("DiagnosticsService", () => {
  it("returns sanitized diagnostic status without exposing auth tokens", async () => {
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-1",
        host: "git.example.com",
        baseUrl: "https://git.example.com",
        token: "secret-token-12345",
        repoOwner: "org",
        repoName: "repo",
        authSource: "tea",
      }),
    };
    const mockClient = {
      fetchReadyIssues: vi.fn().mockResolvedValue([{ number: 1, title: "Issue 1" }]),
    };
    const mockPool = {
      getClient: vi.fn().mockReturnValue(mockClient),
    };
    const mockSettings = {
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
    };

    const service = new DiagnosticsService(
      mockResolver as any,
      mockPool as any,
      mockSettings as any,
    );
    const results = await service.diagnoseProjects([
      { projectId: "proj-1", projectRootPath: "/app", projectDisplayName: "My App" } as any,
    ]);

    expect(results).toHaveLength(1);
    const diag = results[0];
    expect(diag.projectId).toBe("proj-1");
    expect(diag.connectionStatus).toBe("connected");
    expect(diag.authSource).toBe("tea");
    expect(diag.pendingIssueCount).toBe(1);
    expect(diag.authorized).toBe(true);
    expect(diag.readyLabel).toBe("agent-ready");
    // 强制验证凭据安全红线：绝不能泄露 token
    expect((diag as any).token).toBeUndefined();
    expect(JSON.stringify(diag)).not.toContain("secret-token-12345");
  });

  it("handles non-gitea and unresolved projects gracefully", async () => {
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue(null),
    };
    const mockPool = { getClient: vi.fn() };
    const mockSettings = {
      isProjectAuthorized: vi.fn().mockReturnValue(false),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
    };

    const service = new DiagnosticsService(
      mockResolver as any,
      mockPool as any,
      mockSettings as any,
    );
    const results = await service.diagnoseProjects([
      { projectId: "proj-non-gitea", projectRootPath: "/app2" } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].connectionStatus).toBe("not_gitea");
    expect(results[0].authSource).toBe("none");
    expect(results[0].authorized).toBe(false);
  });

  it("populates project agentTeam and top-level harnessStatus when agent-harness is available", async () => {
    const mockResolver = {
      resolveProject: vi.fn().mockResolvedValue({
        projectId: "proj-1",
        projectName: "My App",
        host: "git.example.com",
        baseUrl: "https://git.example.com",
        token: "secret-token",
        repoOwner: "org",
        repoName: "my-app",
        authSource: "tea",
      }),
    };
    const mockPool = {
      getClient: vi.fn().mockReturnValue({
        fetchReadyIssues: vi.fn().mockResolvedValue([]),
      }),
    };
    const mockSettings = {
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
      getHarnessMode: vi.fn().mockReturnValue("auto"),
    };
    const mockPaseo = {
      plugins: {
        invoke: vi.fn().mockResolvedValue({
          config: {
            enabled: true,
            specialists: {
              ui: { enabled: true },
              backend: { enabled: true },
              review: { enabled: true },
            },
            agentTeam: {
              projectSlug: "my-app",
              preset: "fullstack-pro",
              rolesCount: 5,
            },
          },
        }),
      },
    };

    const service = new DiagnosticsService(
      mockResolver as any,
      mockPool as any,
      mockSettings as any,
      () => mockPaseo,
    );

    const [results, harnessStatus] = await Promise.all([
      service.diagnoseProjects([
        { projectId: "proj-1", projectRootPath: "/app", projectDisplayName: "My App" } as any,
      ]),
      service.probeHarnessStatus(),
    ]);

    expect(results[0].agentTeam).toEqual({
      projectSlug: "my-app",
      preset: "fullstack-pro",
      rolesCount: 5,
    });
    expect(harnessStatus).toEqual({
      available: true,
      enabled: true,
      specialistsCount: 3,
    });
  });

  it("diagnoses multiple projects concurrently while preserving input order", async () => {
    const mockResolver = {
      resolveProject: vi.fn().mockImplementation(async (proj: { projectId: string }) => {
        if (proj.projectId === "proj-slow") {
          await new Promise((r) => setTimeout(r, 20));
        }
        return {
          projectId: proj.projectId,
          projectName: proj.projectId,
          host: "git.example.com",
          baseUrl: "https://git.example.com",
          token: "tok",
          repoOwner: "org",
          repoName: proj.projectId,
          authSource: "tea",
        };
      }),
    };
    const mockPool = {
      getClient: vi.fn().mockReturnValue({
        fetchReadyIssues: vi.fn().mockResolvedValue([]),
      }),
    };
    const mockSettings = {
      isProjectAuthorized: vi.fn().mockReturnValue(true),
      getReadyLabel: vi.fn().mockReturnValue("agent-ready"),
    };

    const service = new DiagnosticsService(
      mockResolver as any,
      mockPool as any,
      mockSettings as any,
    );
    const results = await service.diagnoseProjects([
      { projectId: "proj-slow", projectRootPath: "/slow" } as any,
      { projectId: "proj-fast", projectRootPath: "/fast" } as any,
    ]);

    expect(results.map((r) => r.projectId)).toEqual(["proj-slow", "proj-fast"]);
  });
});
