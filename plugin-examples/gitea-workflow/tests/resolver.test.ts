import { describe, expect, it } from "vitest";
import { ProjectGiteaResolver } from "../server/resolver.js";
import { GiteaClientPool } from "../server/client-pool.js";

describe("ProjectGiteaResolver & GiteaClientPool", () => {
  it("resolves project with tea login matching ssh host", async () => {
    const resolver = new ProjectGiteaResolver({
      resolveGitRemote: async () => "git@gitea.corp.com:frontend/web-app.git",
      runTea: async () => ({
        stdout: JSON.stringify([
          {
            name: "corp-login",
            url: "https://gitea.corp.com:8443",
            ssh_host: "gitea.corp.com",
            token: "tea-secret-token",
          },
        ]),
        stderr: "",
      }),
      resolveSshHost: async (h) => h,
    });

    const resolved = await resolver.resolveProject({
      projectId: "proj-123",
      projectRootPath: "/path/to/project",
      projectDisplayName: "My Web App",
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.host).toBe("gitea.corp.com");
    expect(resolved?.baseUrl).toBe("https://gitea.corp.com:8443");
    expect(resolved?.token).toBe("tea-secret-token");
    expect(resolved?.repoOwner).toBe("frontend");
    expect(resolved?.repoName).toBe("web-app");
    expect(resolved?.authSource).toBe("tea");
  });

  it("resolves project using HTTP probe and env var token fallback", async () => {
    const resolver = new ProjectGiteaResolver({
      resolveGitRemote: async () => "git@internal-git.local:backend/service.git",
      runTea: async () => ({ stdout: "[]", stderr: "" }),
      resolveSshHost: async (h) => h,
      probeUrl: async (url) => url.includes(":3000"),
      env: {
        GITEA_TOKEN_INTERNAL_GIT_LOCAL: "env-token-456",
      },
    });

    const resolved = await resolver.resolveProject({
      projectId: "proj-456",
      projectRootPath: "/path/to/service",
      projectDisplayName: "Backend Service",
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.host).toBe("internal-git.local");
    expect(resolved?.baseUrl).toBe("http://internal-git.local:3000");
    expect(resolved?.token).toBe("env-token-456");
    expect(resolved?.repoOwner).toBe("backend");
    expect(resolved?.repoName).toBe("service");
    expect(resolved?.authSource).toBe("env");
  });

  it("skips non-gitea hosts like github.com", async () => {
    const resolver = new ProjectGiteaResolver({
      resolveGitRemote: async () => "git@github.com:facebook/react.git",
      runTea: async () => ({ stdout: "[]", stderr: "" }),
    });

    const resolved = await resolver.resolveProject({
      projectId: "proj-gh",
      projectRootPath: "/path/to/react",
    });

    expect(resolved).toBeNull();
  });

  it("GiteaClientPool manages and reuses clients", () => {
    const pool = new GiteaClientPool();
    const config = {
      giteaUrl: "http://gitea.local",
      giteaToken: "tok",
      repoOwner: "org",
      repoName: "repo",
    };

    const client1 = pool.getClient(config);
    const client2 = pool.getClient(config);
    expect(client1).toBe(client2);

    const client3 = pool.getClient({ ...config, repoName: "other-repo" });
    expect(client1).not.toBe(client3);
  });
});
